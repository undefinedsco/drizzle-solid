import * as sparqljs from 'sparqljs';
import { PodTable, PodColumnBase } from '../../pod-table';
import { SelectQueryPlan } from '../../select-plan';
import { SPARQLQuery } from '../types';
import { getPredicateForColumn, resolveColumn, formatValue } from '../helpers';
import { AggregateExpression, isAggregateExpression } from '../../aggregates';
import { subjectResolver } from '../../subject';
import { ExpressionBuilder } from './expression-builder';

export class SelectBuilder {
  private generator: any;
  private prefixes: Record<string, string>;
  private expressionBuilder: ExpressionBuilder;

  constructor(prefixes: Record<string, string>) {
    this.generator = new (sparqljs as any).Generator();
    this.prefixes = prefixes;
    this.expressionBuilder = new ExpressionBuilder();
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

    if (ast.distinct) {
      selectQuery.distinct = true;
    }

    return {
      type: 'SELECT',
      query: this.generator.stringify(selectQuery),
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

    const ast: any = {
      select: plan.select,
      columns: plan.selectAll ? '*' : undefined,
      where: plan.conditionTree ?? plan.where,
      limit: plan.limit,
      offset: plan.offset,
      orderBy: orderByDescriptors,
      distinct: plan.distinct
    };

    return this.convertSelect(ast, plan.baseTable, targetGraph, fromSources, allowGraphVariable);
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

    if (operation.limit) {
      selectQuery.limit = operation.limit;
    }
    if (operation.offset) {
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
    const variables: any[] = [{ termType: 'Variable', value: 'subject' }];

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

    Object.entries(table.columns).forEach(([columnName, column]) => {
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

      if (column.options?.required) {
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
    if (allowGraphVariable && subjectResolver.getResourceMode(table) === 'document' && (!fromSources || fromSources.length === 0)) {
      return [{
        type: 'graph',
        name: { termType: 'Variable', value: 'g' },
        patterns
      }];
    }
    
    return patterns;
  }
}