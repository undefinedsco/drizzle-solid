import * as sparqljs from 'sparqljs';
import { PodTable, PodColumnBase } from '../../schema';
import { SelectQueryPlan } from '../../select-plan';
import { SPARQLQuery } from '../types';
import { getPredicateForColumn, resolveColumn, formatValue } from '../helpers';
import { AggregateExpression, isAggregateExpression } from '../../aggregates';
import { QueryCondition } from '../../query-conditions';
import { BinaryExpression, LogicalExpression, UnaryExpression, SelectionAliasExpression } from '../../expressions';
import type { UriResolver } from '../../uri';
import { UriResolverImpl } from '../../uri';
import { ExpressionBuilder } from './expression-builder';
import type { TableRegistryContext } from '../../ast-to-sparql';

export class SelectBuilder {
  private generator: any;
  private prefixes: Record<string, string>;
  private expressionBuilder: ExpressionBuilder;
  private tableContext?: TableRegistryContext;
  private uriResolver: UriResolver;

  constructor(prefixes: Record<string, string>, uriResolver: UriResolver = new UriResolverImpl()) {
    this.generator = new (sparqljs as any).Generator();
    this.prefixes = prefixes;
    this.uriResolver = uriResolver;
    this.expressionBuilder = new ExpressionBuilder(uriResolver);
  }

  /**
   * Set table context for URI link resolution
   */
  setTableContext(context: TableRegistryContext): void {
    this.tableContext = context;
    this.expressionBuilder.setTableContext(context);
  }

  convertSelect(ast: any, table: PodTable, targetGraph?: string, fromSources?: string[], allowGraphVariable = true): SPARQLQuery {
    const selectQuery: any = {
      queryType: 'SELECT',
      variables: this.buildSelectVariables(ast, table),
      where: this.buildWherePatterns(ast, table, targetGraph, fromSources, allowGraphVariable), // Pass fromSources here
      type: 'query',
      prefixes: this.prefixes
    };

    // Add FROM clauses if fromSources are provided and no explicit targetGraph
    // If targetGraph is defined, it will be handled in buildWherePatterns using GRAPH <targetGraph> { ... }
    if (fromSources && fromSources.length > 0 && !targetGraph) {
      selectQuery.from = {
        default: fromSources.map(uri => ({ termType: 'NamedNode', value: uri })), // These will be treated as default graphs for the query
        named: [] // We are not using NAMED for now, but could be extended
      };
    }

    if (typeof ast.limit === 'number') {
      selectQuery.limit = ast.limit;
    }

    if (typeof ast.offset === 'number') {
      selectQuery.offset = ast.offset;
    }

    if (Array.isArray(ast.orderBy) && ast.orderBy.length > 0) {
      selectQuery.order = ast.orderBy.map((item: { column: string; direction: 'asc' | 'desc' }) => ({
        expression: { termType: 'Variable', value: item.column },
        descending: item.direction === 'desc'
      }));
    }

    // Add GROUP BY clause
    if (Array.isArray(ast.groupBy) && ast.groupBy.length > 0) {
      selectQuery.group = ast.groupBy.map((col: string) => ({
        expression: { termType: 'Variable', value: col }
      }));
    }

    if (Array.isArray(ast.having) && ast.having.length > 0) {
      selectQuery.having = ast.having;
    }

    if (ast.distinct) {
      selectQuery.distinct = true;
    }

    const query = this.generator.stringify(selectQuery);

    return {
      type: 'SELECT',
      query,
      prefixes: this.prefixes
    };
  }

  convertSelectPlan(plan: SelectQueryPlan, targetGraph?: string, fromSources?: string[], allowGraphVariable = true): SPARQLQuery {
    const orderByDescriptors = plan.orderBy
      ?.map((descriptor) => {
        const columnName = descriptor.reference?.column ?? descriptor.rawColumn;
        if (!columnName) {
          return undefined;
        }
        return {
          column: columnName,
          direction: descriptor.direction
        };
      })
      .filter((value): value is { column: string; direction: 'asc' | 'desc' } => !!value);

    // Convert groupBy ColumnReference[] to column names for ast
    const groupByColumns = plan.groupBy?.map((ref) => ref.column);

    const ast: any = {
      select: plan.select,
      columns: plan.selectAll ? '*' : undefined,
      where: plan.conditionTree ?? plan.where,
      limit: plan.limit,
      offset: plan.offset,
      orderBy: orderByDescriptors,
      groupBy: groupByColumns,
      having: this.buildHavingExpressions(plan),
      distinct: plan.distinct
    };

    return this.convertSelect(ast, plan.baseTable, targetGraph, fromSources, allowGraphVariable);
  }

  private buildHavingExpressions(plan: SelectQueryPlan): any[] | undefined {
    if (!plan.having) {
      return undefined;
    }

    const expression = this.buildHavingExpression(plan.having, plan.select, plan.baseTable);
    if (!expression) {
      return undefined;
    }

    const prefixLines = Object.entries(this.prefixes)
      .map(([prefix, uri]) => `PREFIX ${prefix}: <${uri}>`)
      .join('\n');
    const groupVars = plan.groupBy?.map((ref) => `?${ref.column}`) ?? [];
    const selectVars = groupVars.length > 0 ? groupVars.join(' ') : '?subject';
    const groupByClause = groupVars.length > 0 ? ` GROUP BY ${groupVars.join(' ')}` : '';
    const dummyQuery = `${prefixLines}\nSELECT ${selectVars} WHERE { ?subject ?predicate ?object . }${groupByClause} HAVING (${expression})`;
    const parser = new (sparqljs as any).Parser({ skipUngroupedVariableCheck: true });
    const parsed = parser.parse(dummyQuery);
    return parsed.having;
  }

  private buildHavingExpression(
    condition: QueryCondition,
    selectFields: SelectQueryPlan['select'],
    table: PodTable
  ): string {
    switch (condition.type) {
      case 'logical_expr':
        return this.buildHavingLogicalExpression(condition as LogicalExpression, selectFields, table);
      case 'unary_expr':
        return this.buildHavingUnaryExpression(condition as UnaryExpression, selectFields, table);
      case 'binary_expr':
        return this.buildHavingBinaryExpression(condition as BinaryExpression, selectFields, table);
      default:
        return '';
    }
  }

  private buildHavingLogicalExpression(
    condition: LogicalExpression,
    selectFields: SelectQueryPlan['select'],
    table: PodTable
  ): string {
    const op = condition.operator === 'OR' ? ' || ' : ' && ';
    const parts = (condition.expressions ?? [])
      .map((child) => this.buildHavingExpression(child as QueryCondition, selectFields, table))
      .filter((value) => value.length > 0);

    if (parts.length === 0) {
      return '';
    }

    return `(${parts.join(op)})`;
  }

  private buildHavingUnaryExpression(
    condition: UnaryExpression,
    selectFields: SelectQueryPlan['select'],
    table: PodTable
  ): string {
    const op = condition.operator.toUpperCase();
    if (op === 'NOT') {
      const child = this.buildHavingExpression(condition.value as QueryCondition, selectFields, table);
      return child ? `!(${child})` : '';
    }

    if (op === 'EXISTS' || op === 'NOT EXISTS') {
      const expr = `EXISTS { ${String(condition.value)} }`;
      return op === 'NOT EXISTS' ? `!(${expr})` : expr;
    }

    const operand = this.buildHavingOperand(condition.value, selectFields, table);
    if (!operand) {
      return '';
    }

    if (op === 'IS NULL') {
      return `!(BOUND(${operand}))`;
    }
    if (op === 'IS NOT NULL') {
      return `BOUND(${operand})`;
    }

    return '';
  }

  private buildHavingBinaryExpression(
    condition: BinaryExpression,
    selectFields: SelectQueryPlan['select'],
    table: PodTable
  ): string {
    const left = this.buildHavingOperand(condition.left, selectFields, table);
    if (!left) {
      return '';
    }

    const operator = condition.operator.toUpperCase();
    if (operator === 'BETWEEN' || operator === 'NOT BETWEEN') {
      const values = Array.isArray(condition.right) ? condition.right : [];
      if (values.length !== 2) {
        return '';
      }
      const minValue = this.buildHavingOperand(values[0], selectFields, table);
      const maxValue = this.buildHavingOperand(values[1], selectFields, table);
      const expr = `(${left} >= ${minValue} && ${left} <= ${maxValue})`;
      return operator === 'NOT BETWEEN' ? `!${expr}` : expr;
    }

    if (operator === 'IN' || operator === 'NOT IN') {
      const values = Array.isArray(condition.right) ? condition.right : [];
      const formatted = values.map((value) => this.buildHavingOperand(value, selectFields, table)).join(', ');
      const expr = `${left} IN (${formatted})`;
      return operator === 'NOT IN' ? `!(${expr})` : expr;
    }

    const right = this.buildHavingOperand(condition.right, selectFields, table);
    if (!right) {
      return '';
    }

    return `${left} ${condition.operator} ${right}`;
  }

  private buildHavingOperand(
    operand: unknown,
    selectFields: SelectQueryPlan['select'],
    table: PodTable
  ): string {
    if (operand instanceof SelectionAliasExpression) {
      return this.buildHavingAliasOperand(operand.alias, selectFields, table);
    }

    if (typeof operand === 'string' && selectFields && operand in selectFields) {
      return this.buildHavingAliasOperand(operand, selectFields, table);
    }

    if (operand instanceof PodColumnBase) {
      return `?${resolveColumn(operand, table).name}`;
    }

    if (operand && typeof operand === 'object' && 'name' in (operand as Record<string, unknown>)) {
      return `?${resolveColumn(operand, table).name}`;
    }

    if (typeof operand === 'string' && table.columns[operand]) {
      return `?${resolveColumn(operand, table).name}`;
    }

    return String(formatValue(operand, undefined, this.uriResolver, this.getUriContext()));
  }

  private buildHavingAliasOperand(
    alias: string,
    selectFields: SelectQueryPlan['select'],
    table: PodTable
  ): string {
    const field = selectFields?.[alias];
    if (!field) {
      return `?${alias}`;
    }

    if (isAggregateExpression(field)) {
      return this.buildAggregateOperand(field, table);
    }

    if (field instanceof PodColumnBase || typeof field === 'string' || (field && typeof field === 'object' && 'name' in (field as Record<string, unknown>))) {
      return `?${resolveColumn(field, table).name}`;
    }

    return `?${alias}`;
  }

  private buildAggregateOperand(aggregate: AggregateExpression, table: PodTable): string {
    const distinct = aggregate.distinct ? 'DISTINCT ' : '';
    if (!aggregate.column) {
      return `${aggregate.func.toUpperCase()}(*)`;
    }

    const column = resolveColumn(aggregate.column, table);
    return `${aggregate.func.toUpperCase()}(${distinct}?${column.name})`;
  }

  private getUriContext() {
    if (!this.tableContext) return undefined;
    return {
      baseUri: this.tableContext.baseUri,
      tableRegistry: this.tableContext.tableRegistry,
      tableNameRegistry: this.tableContext.tableNameRegistry,
    };
  }

  // Migrated from PodDialect to handle simple object queries
  convertSimpleSelect(operation: {
    table: PodTable;
    where?: Record<string, unknown>;
    limit?: number;
    offset?: number;
    orderBy?: Array<{ column: string; direction: 'asc' | 'desc' }>;
    distinct?: boolean;
  }, targetGraph?: string, fromSources?: string[], allowGraphVariable = true): SPARQLQuery {
    const table = operation.table;
    const rdfClass = table.config.type || 'http://example.org/Entity';

    const selectQuery: any = {
      queryType: 'SELECT',
      variables: [{ termType: 'Variable', value: 'subject' }],
      where: this.buildWherePatterns(operation, table, targetGraph, fromSources, allowGraphVariable),
      type: 'query',
      prefixes: this.prefixes
    };

    // Add FROM clauses if fromSources are provided and no explicit targetGraph
    if (fromSources && fromSources.length > 0 && !targetGraph) {
      selectQuery.from = {
        default: fromSources.map(uri => ({ termType: 'NamedNode', value: uri })),
        named: []
      };
    }

    // Build select variables based on table columns
    Object.keys(table.columns).forEach(columnName => {
      const column = table.columns[columnName];
      const predicate = getPredicateForColumn(column, table);
      if (predicate && predicate !== '@id') { // Skip @id as it's virtual
        selectQuery.variables.push({ termType: 'Variable', value: columnName });
      }
    });

    if (typeof operation.limit === 'number') {
      selectQuery.limit = operation.limit;
    }
    if (typeof operation.offset === 'number') {
      selectQuery.offset = operation.offset;
    }
    if (operation.orderBy && operation.orderBy.length > 0) {
      selectQuery.order = operation.orderBy.map(item => ({
        expression: { termType: 'Variable', value: item.column },
        descending: item.direction === 'desc'
      }));
    }
    if (operation.distinct) {
      selectQuery.distinct = true;
    }

    return {
      type: 'SELECT',
      query: this.generator.stringify(selectQuery),
      prefixes: this.prefixes
    };
  }

  // 构建 SELECT 变量 - 使用 sparqljs 格式
  private buildSelectVariables(ast: any, table: PodTable): any[] {
    const selectFields = ast.select;
    const hasGroupBy = Array.isArray(ast.groupBy) && ast.groupBy.length > 0;
    
    // Check if all select fields are aggregate expressions
    // In this case, the query is an implicit aggregate and ?subject should not be included
    let allAggregates = false;
    if (selectFields && typeof selectFields === 'object' && Object.keys(selectFields).length > 0) {
      const fieldValues = Object.values(selectFields);
      allAggregates = fieldValues.length > 0 && fieldValues.every((f) => isAggregateExpression(f));
    }
    
    // When GROUP BY is present, only include ?subject if it's in the GROUP BY clause
    // When all fields are aggregates (implicit aggregation), also exclude ?subject
    // Otherwise, SPARQL will reject the query with "Projection of ungrouped variable"
    const includeSubject = !allAggregates && (!hasGroupBy || (hasGroupBy && ast.groupBy.includes('subject')));
    const variables: any[] = includeSubject ? [{ termType: 'Variable', value: 'subject' }] : [];

    // Skip columns that use @id predicate (virtual, derived from subject in JS)
    const skipColumns = new Set(['subject']);
    for (const [colName, column] of Object.entries(table.columns)) {
      const predicate = getPredicateForColumn(column as PodColumnBase, table);
      if (predicate === '@id') {
        skipColumns.add(colName);
      }
    }

    if (selectFields && typeof selectFields === 'object' && Object.keys(selectFields).length > 0) {
      const mapped = Object.entries(selectFields)
        .filter(([alias]) => !skipColumns.has(alias))
        .map(([alias, field]) => this.buildSelectEntry(alias, field, table));
      return variables.concat(mapped);
    }

    if (ast.columns === '*' || !ast.columns) {
      const cols = Object.keys(table.columns)
        .filter((col) => !skipColumns.has(col))
        .map((col) => ({ termType: 'Variable', value: col }));
      return variables.concat(cols);
    }

    const cols = ast.columns
      .filter((col: any) => {
        const colName = typeof col === 'string' ? col : col.name;
        return !skipColumns.has(colName);
      })
      .map((col: any) => {
        const colName = typeof col === 'string' ? col : col.name;
        return { termType: 'Variable', value: colName };
      });
    return variables.concat(cols);
  }

  private buildSelectEntry(alias: string, field: unknown, table: PodTable): any {
    if (isAggregateExpression(field)) {
      return this.buildAggregateSelectEntry(alias, field, table);
    }

    const column = resolveColumn(field, table);
    const columnVariable = column.name;

    if (alias === columnVariable) {
      return { termType: 'Variable', value: columnVariable };
    }

    return {
      expression: { termType: 'Variable', value: columnVariable },
      variable: { termType: 'Variable', value: alias }
    };
  }

  private buildAggregateSelectEntry(alias: string, aggregate: AggregateExpression, table: PodTable): any {
    const aggregation = aggregate.func;
    const expressionTerm = aggregate.column
      ? { termType: 'Variable', value: resolveColumn(aggregate.column, table).name }
      : new (sparqljs as any).Wildcard();

    return {
      expression: {
        type: 'aggregate',
        aggregation,
        distinct: !!aggregate.distinct,
        expression: expressionTerm
      },
      variable: { termType: 'Variable', value: alias }
    };
  }

  // 构建 WHERE 模式 - 使用 sparqljs 格式
  private buildWherePatterns(ast: any, table: PodTable, targetGraph?: string, fromSources?: string[], allowGraphVariable = true): any[] {
    const patterns: sparqljs.Pattern[] = [];

    // 添加类型约束
    patterns.push({
      type: 'bgp',
      triples: [{
        subject: { termType: 'Variable', value: 'subject' } as any,
        predicate: { termType: 'NamedNode', value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' } as any,
        object: { termType: 'NamedNode', value: table.config.type } as any
      }]
    });

    // 添加属性模式（使用 OPTIONAL 处理可选属性）
    const requiredTriples: sparqljs.Triple[] = [];
    const optionalTriples: sparqljs.Triple[] = [];

    // Extract columns referenced in WHERE conditions (these should be required, not optional)
    const whereColumns = new Set<string>();
    if (ast.where && typeof ast.where === 'object') {
      const extractWhereColumns = (condition: any) => {
        if (!condition || typeof condition !== 'object') return;
        // Check for column in BinaryExpression.left
        if (condition.left) {
          if (typeof condition.left === 'string') {
            whereColumns.add(condition.left);
          } else if (condition.left.name) {
            whereColumns.add(condition.left.name);
          }
        }
        // Check for column in UnaryExpression.value (e.g., isNull, not)
        if (condition.value) {
          if (typeof condition.value === 'string') {
            whereColumns.add(condition.value);
          } else if (condition.value.name) {
            whereColumns.add(condition.value.name);
          } else if (typeof condition.value === 'object') {
            extractWhereColumns(condition.value);
          }
        }
        // Recursively check nested conditions (LogicalExpression like and/or)
        if (condition.expressions && Array.isArray(condition.expressions)) {
          condition.expressions.forEach(extractWhereColumns);
        }
      };
      extractWhereColumns(ast.where);
    }

    // Determine which columns to include in WHERE patterns
    // If ast.select specifies columns, only include those columns (plus any referenced in where/orderBy/groupBy)
    const selectFields = ast.select;
    let columnsToInclude: Set<string> | null = null;

    if (selectFields && typeof selectFields === 'object' && Object.keys(selectFields).length > 0) {
      columnsToInclude = new Set<string>();

      // Helper to extract column name from various field types
      const extractColumnName = (field: any): string | null => {
        if (!field) return null;
        if (typeof field === 'string') return field;
        if (field.name) return field.name;
        // Handle aggregate expressions (e.g., sum(column), avg(column))
        if (isAggregateExpression(field)) {
          if (field.column) {
            return extractColumnName(field.column);
          }
          return null; // count(*) doesn't reference a specific column
        }
        return null;
      };

      for (const [alias, field] of Object.entries(selectFields)) {
        // Add the alias itself (it might match a column name)
        columnsToInclude.add(alias);
        // Extract actual column name from the field
        const colName = extractColumnName(field);
        if (colName) {
          columnsToInclude.add(colName);
        }
      }

      // Include columns referenced in WHERE conditions
      whereColumns.forEach(col => columnsToInclude!.add(col));
      
      // Include columns referenced in ORDER BY
      if (Array.isArray(ast.orderBy)) {
        for (const order of ast.orderBy) {
          if (order.column) {
            columnsToInclude.add(order.column);
          }
        }
      }
      
      // Include columns referenced in GROUP BY
      if (Array.isArray(ast.groupBy)) {
        for (const group of ast.groupBy) {
          const colName = extractColumnName(group);
          if (colName) {
            columnsToInclude.add(colName);
          }
        }
      }
    }

    Object.entries(table.columns).forEach(([columnName, column]) => {
      // Skip columns not in the select list (if column selection is active)
      if (columnsToInclude && !columnsToInclude.has(columnName)) {
        return;
      }

      const predicate = getPredicateForColumn(column, table);

      // Fix: Do not generate triple patterns for virtual @id predicate.
      // The ID is derived via BIND from the subject, not matched via a property.
      if (predicate === '@id') {
        return;
      }

      const subjectVar = { termType: 'Variable', value: 'subject' } as any;
      const valueVar = { termType: 'Variable', value: columnName } as any;

      const isInverse = column.options?.inverse;
      const triple: sparqljs.Triple = {
        subject: isInverse ? valueVar : subjectVar,
        predicate: { termType: 'NamedNode', value: predicate } as any,
        object: isInverse ? subjectVar : valueVar
      };

      // Inverse triples MUST be OPTIONAL to avoid breaking compound query optimization
      // in xpod's ComunicaQuintEngine. When inverse triples (where subject != ?subject)
      // are in the required BGP, the engine's compound query optimizer mishandles them,
      // causing other fields to be dropped from results.
      if (isInverse) {
        optionalTriples.push(triple);
      } else if (column.options?.required || whereColumns.has(columnName)) {
        // Columns referenced in WHERE conditions should be required, not optional
        // This fixes issue #4: FILTER on optional fields returning 0 results
        requiredTriples.push(triple);
      } else {
        optionalTriples.push(triple);
      }
    });

    if (requiredTriples.length > 0) {
      patterns.push({
        type: 'bgp',
        triples: requiredTriples
      });
    }

    optionalTriples.forEach((triple) => {
      patterns.push({
        type: 'optional',
        patterns: [{
          type: 'bgp',
          triples: [triple]
        }]
      });
    });

    // @id 列的 id 统一由 JS 端 extractIdFromSubject 从 ?subject 提取
    // 不再生成 BIND(STRAFTER(...))，保持 SPARQL 简洁且兼容所有模式

    // 添加 FILTER
    if (ast.where) {
      const filterString = this.expressionBuilder.buildWhereClause(ast.where, table);
      if (filterString) {
        try {
          // Hack: Wrap filter in a dummy query to parse it into AST
          const prefixLines = Object.entries(this.prefixes)
            .map(([prefix, uri]) => `PREFIX ${prefix}: <${uri}>`)
            .join('\n');
          const dummyQuery = `${prefixLines}\nSELECT * WHERE { ${filterString} }`;
          const parser = new (sparqljs as any).Parser();
          const parsed = parser.parse(dummyQuery);
          
          // console.log('DEBUG PARSED:', JSON.stringify(parsed, null, 2));
          
          // Find the filter pattern in the parsed query
          if (parsed.where) {
            const filterPattern = parsed.where.find((p: any) => p.type === 'filter');
            if (filterPattern) {
              patterns.push(filterPattern);
            } else {
               // Fallback: check if it's inside a group?
               // sparqljs parser usually puts FILTER at top level of WHERE if it's simple.
            }
          }
        } catch (e) {
          console.warn('Failed to parse filter string into AST:', filterString, e);
        }
      }
    }

    // 如果指定了目标 Graph，则将所有模式包裹在 GRAPH 块中
    if (targetGraph) {
      return [{
        type: 'graph',
        name: { termType: 'NamedNode', value: targetGraph },
        patterns: patterns
      }];
    }

    // Only use GRAPH ?g if no explicit targetGraph AND no fromSources are provided.
    // If fromSources are provided, FROM clauses at query level define the sources.
    if (allowGraphVariable && this.uriResolver.getResourceMode(table) === 'document' && (!fromSources || fromSources.length === 0)) {
      return [{
        type: 'graph',
        name: { termType: 'Variable', value: 'g' },
        patterns
      }];
    }
    
    return patterns;
  }
}
