// AST 到 SPARQL 转换器 - 使用 sparqljs 重构版本
import { SQL } from 'drizzle-orm';
import { PodTable, PodColumnBase, type PodTableMapping } from './pod-table';
import type { QueryCondition } from './query-conditions';
import { AggregateExpression, isAggregateExpression } from './aggregates';
import { subjectResolver } from './subject';
import * as sparqljs from 'sparqljs';
import type { SelectQueryPlan } from './select-plan';

// SPARQL 查询类型
export interface SPARQLQuery {
  type: 'SELECT' | 'INSERT' | 'DELETE' | 'UPDATE' | 'ASK';
  query: string;
  prefixes: Record<string, string>;
}

// AST 节点类型
export interface ASTNode {
  type: string;
  [key: string]: any;
}

// SPARQL 转换器 - 使用 sparqljs 重构
export class ASTToSPARQLConverter {
  private generator: any; // 使用 any 避免类型问题
  private podUrl: string;
  private webId: string;
  private useRelativeUris: boolean;
  private prefixes: Record<string, string> = {
    'rdf': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    'rdfs': 'http://www.w3.org/2000/01/rdf-schema#',
    'schema': 'https://schema.org/',
    'foaf': 'http://xmlns.com/foaf/0.1/',
    'dc': 'http://purl.org/dc/terms/',
    'solid': 'http://www.w3.org/ns/solid/terms#',
    'ldp': 'http://www.w3.org/ns/ldp#'
  };

  /**
   * @deprecated Hardcoded default predicates are an anti-pattern and will be removed in future versions.
   * Please explicitly define predicates in your PodTable definitions or use standard vocabularies.
   */
  private defaultPredicates: Record<string, string> = {
    'id': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#about',
    'name': 'http://xmlns.com/foaf/0.1/name',
    'title': 'http://purl.org/dc/terms/title',
    'description': 'http://purl.org/dc/terms/description',
    'content': 'http://purl.org/dc/terms/description',
    'createdAt': 'https://schema.org/dateCreated',
    'updatedAt': 'https://schema.org/dateModified',
    'created_at': 'https://schema.org/dateCreated',
    'updated_at': 'https://schema.org/dateModified',
    'email': 'http://xmlns.com/foaf/0.1/mbox',
    'url': 'http://xmlns.com/foaf/0.1/homepage',
    'homepage': 'http://xmlns.com/foaf/0.1/homepage'
  };

  constructor(podUrl: string, webId?: string) {
    this.generator = new (sparqljs as any).Generator();
    this.podUrl = podUrl;
    this.webId = webId || '';
    this.useRelativeUris = true; // 默认使用相对URI，符合Solid最佳实践
  }

  // 转换 SELECT 查询 - 使用 sparqljs
  convertSelect(ast: any, table: PodTable): SPARQLQuery {
    const selectQuery: any = {
      queryType: 'SELECT',
      variables: this.buildSelectVariables(ast, table),
      where: this.buildWherePatterns(ast, table),
      type: 'query',
      prefixes: this.prefixes
    };

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

  convertSelectPlan(plan: SelectQueryPlan): SPARQLQuery {
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
      orderBy: orderByDescriptors && orderByDescriptors.length > 0 ? orderByDescriptors : undefined,
      distinct: plan.distinct
    };

    return this.convertSelect(ast, plan.baseTable);
  }

  // Migrated from PodDialect to handle simple object queries
  convertSimpleSelect(operation: {
    table: PodTable;
    where?: Record<string, unknown>;
    limit?: number;
    offset?: number;
    orderBy?: Array<{ column: string; direction: 'asc' | 'desc' }>;
    distinct?: boolean;
  }): SPARQLQuery {
    const table = operation.table;
    const rdfClass = table.config.type || 'http://example.org/Entity';
    const namespace = table.config.namespace || '';

    const selectVars: string[] = ['?subject'];
    const wherePatterns: string[] = [`?subject a <${rdfClass}> .`];
    
    // Use existing prefixes logic if possible, but for now replicate PodDialect manual build for safety
    const prefixes = [
      'PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>',
      'PREFIX foaf: <http://xmlns.com/foaf/0.1/>',
      'PREFIX schema: <https://schema.org/>',
      'PREFIX dc: <http://purl.org/dc/terms/>',
      'PREFIX xsd: <http://www.w3.org/2001/XMLSchema#'
    ];

    const columnPredicates = new Map<string, string>();
    let filteredByIdentifier = false;

    // 为每个列生成变量和模式
    Object.keys(table.columns).forEach(columnName => {
      const column = table.columns[columnName];
      let predicate;

      if (typeof (column as any).getPredicateUri === 'function') {
        predicate = (column as any).getPredicateUri();
      } else {
        predicate = (column as any).predicate;
      }

      if (!predicate) {
        predicate = (column as any).options?.predicate;
      }

      if (!predicate && namespace) {
        const nsUri = typeof namespace === 'string' ? namespace : namespace.uri;
        predicate = `${nsUri}${columnName}`;
      }

      if (!predicate) {
        predicate = this.defaultPredicates[columnName as keyof typeof this.defaultPredicates];
      }

      if (!predicate) {
        predicate = `http://example.org/${columnName}`;
      }

      if (predicate && !predicate.startsWith('http')) {
        predicate = `http://example.org/${predicate}`;
      }

      if (predicate) {
        columnPredicates.set(columnName, predicate);
      }

      if (predicate) {
        const varName = `?${columnName}`;
        selectVars.push(varName);

        const isRequired = (column as any).options?.required || false;
        if (isRequired) {
          wherePatterns.push(`?subject <${predicate}> ${varName} .`);
        } else {
          wherePatterns.push(`OPTIONAL { ?subject <${predicate}> ${varName} . }`);
        }
      }
    });

    const isUriString = (value: string): boolean => value.startsWith('http://') || value.startsWith('https://');

    const formatLiteral = (value: unknown): string | null => {
      if (value === null || value === undefined) {
        return null;
      }
      if (typeof value === 'string') {
        const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\"');
        return `"${escaped}"`;
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value.toString();
      }
      if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
      }
      if (value instanceof Date) {
        return `"${value.toISOString()}"^^xsd:dateTime`;
      }
      const asString = String(value);
      const escaped = asString.replace(/\\/g, '\\\\').replace(/"/g, '\"');
      return `"${escaped}"`;
    };

    if (operation.where) {
      for (const [key, rawValue] of Object.entries(operation.where)) {
        if (rawValue === undefined) continue;

        const values = Array.isArray(rawValue) ? rawValue : [rawValue];

        if (key === 'subject' || key === '@id') {
          filteredByIdentifier = true;
          const formatted = values
            .map((value) => {
              if (typeof value !== 'string') return null;
              const trimmed = value.trim();
              if (!trimmed) return null;
              if (isUriString(trimmed)) return `<${trimmed}>`;
              // Use SubjectResolver for fragment handling logic if needed, 
              // or simple fragment assumption if table context implies it.
              // For now, assume subjectResolver is available or copy logic.
              // Copy logic for safety:
              const clean = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
              // We need base... 
              const baseResource = (table as any).getResourcePath?.() || table.config.base || table.getContainerPath();
              // We don't have resolveAbsoluteUrl here easily without podUrl context?
              // But we have this.podUrl.
              // Let's assume baseResource is absolute or relative to podUrl.
              // Minimal implementation:
              return `<${trimmed}>`; // Fallback if we can't resolve fragment easily without SubjectResolver instance logic
            })
            .filter((value): value is string => Boolean(value));

          if (formatted.length === 1) {
            wherePatterns.push(`FILTER(?subject = ${formatted[0]})`);
          } else if (formatted.length > 1) {
            const valuesClause = formatted.join(' ');
            wherePatterns.push(`VALUES ?subject { ${valuesClause} }`);
          }
          continue;
        }

        if (key === 'id') {
          filteredByIdentifier = true;
          // Handling 'id' where clause requires resolving to Subject URI usually.
          // We will use subjectResolver if available.
          const subjects = values.map(val => {
             return subjectResolver.resolve(table, { id: val });
          }).map(uri => `<${uri}>`);
          
          if (subjects.length === 1) {
            wherePatterns.push(`FILTER(?subject = ${subjects[0]})`);
          } else if (subjects.length > 0) {
             wherePatterns.push(`VALUES ?subject { ${subjects.join(' ')} }`);
          }
          continue;
        }

        const predicate = columnPredicates.get(key);
        if (!predicate) continue;

        const formattedValues = values
          .map((value) => formatLiteral(value))
          .filter((value): value is string => Boolean(value));

        if (formattedValues.length === 0) continue;

        if (formattedValues.length === 1) {
          wherePatterns.push(`?subject <${predicate}> ${formattedValues[0]} .`);
        } else {
          const tempVar = `?${key}_filter`;
          wherePatterns.push(`?subject <${predicate}> ${tempVar} .`);
          const filterValues = formattedValues.join(', ');
          wherePatterns.push(`FILTER(${tempVar} IN (${filterValues}))`);
        }
      }
    }

    let query = `${prefixes.join('\n')}\nSELECT ${selectVars.join(' ')} WHERE {\n  ${wherePatterns.join('\n  ')}\n}`;

    if (operation.limit) {
      query += `\nLIMIT ${operation.limit}`;
    } else if (filteredByIdentifier) {
      query += '\nLIMIT 1';
    }
    if (operation.offset) {
      query += `\nOFFSET ${operation.offset}`;
    }
    
    return {
      type: 'SELECT',
      query: query.trim(),
      prefixes: {
        'rdf': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
        'schema': 'https://schema.org/',
        'foaf': 'http://xmlns.com/foaf/0.1/',
        'dc': 'http://purl.org/dc/terms/'
      }
    };
  }

  // 转换 INSERT 查询 - 使用 sparqljs
  convertInsert(valuesOrPlan: any[] | { table: PodTable; rows: any[] }, table?: PodTable): SPARQLQuery {
    if (!table && !valuesOrPlan) {
      throw new Error('INSERT operation requires a target table');
    }
    let rows: any[];
    let targetTable: PodTable;
    if (Array.isArray(valuesOrPlan)) {
      rows = valuesOrPlan;
      if (!table) {
        throw new Error('INSERT operation requires a target table');
      }
      targetTable = table;
    } else {
      rows = valuesOrPlan.rows;
      targetTable = valuesOrPlan.table;
    }

    // 检查是否有重复的ID
    const existingIds = new Set<string>();
    const duplicateIds: string[] = [];
    
    for (const record of rows) {
      if (record.id) {
        if (existingIds.has(record.id)) {
          duplicateIds.push(record.id);
        } else {
          existingIds.add(record.id);
        }
      }
    }
    
    if (duplicateIds.length > 0) {
      throw new Error(`Duplicate IDs found in insert data: ${duplicateIds.join(', ')}`);
    }
    
    const insertQuery: any = {
      type: 'update',
      prefixes: this.prefixes,
      updates: [{
        updateType: 'insert',
        insert: [{
          type: 'bgp',
          triples: this.buildInsertTriples(rows, targetTable)
        }]
      }]
    };

    return {
      type: 'INSERT',
      query: this.generator.stringify(insertQuery),
      prefixes: this.prefixes
    };
  }

  // 转换 UPDATE 查询 - 使用 DELETE/INSERT 组合
  convertUpdate(setData: any, whereConditions: any, table: PodTable): SPARQLQuery {
    const targetRecords = this.extractSubjectRecords(whereConditions);
    if (targetRecords.length === 0) {
      throw new Error('UPDATE operation requires an id or @id condition to target a specific resource');
    }

    const prefixLines = Object.entries(this.prefixes)
      .map(([prefix, uri]) => `PREFIX ${prefix}: <${uri}>`)
      .join('\n');

    const statements: string[] = [];

    for (const record of targetRecords) {
      const resourceUri = this.generateSubjectUri(record, table);
      const updateBlock = this.buildUpdateStatementsForRecord(resourceUri, setData, table);
      if (updateBlock) {
        statements.push(updateBlock);
      }
    }

    if (statements.length === 0) {
      throw new Error('No valid update statements generated for provided data');
    }

    const query = `${prefixLines}
${statements.join(';\n')}`.trimEnd();

    return {
      type: 'UPDATE',
      query,
      prefixes: this.prefixes
    };
  }

  // 转换 DELETE 查询 - 使用正确的 SPARQL UPDATE 格式
  convertDelete(whereConditions: any, table: PodTable): SPARQLQuery {
    const prefixLines = Object.entries(this.prefixes)
      .map(([prefix, uri]) => `PREFIX ${prefix}: <${uri}>`)
      .join('\n');

    let query: string;

    if (!whereConditions) {
      query = `${prefixLines}
DELETE WHERE {
  ?subject rdf:type <${table.config.type}> .
  ?subject ?p ?o .
}`;
    } else {
      const targetRecords = this.extractSubjectRecords(whereConditions);
      if (targetRecords.length === 0) {
        throw new Error('DELETE operation requires an id or @id condition to target a specific resource');
      }

      const deleteBlocks = targetRecords.map((record) => {
        const resourceUri = this.generateSubjectUri(record, table);
        const inlineDeletes = this.buildInlineCascadeDeleteBlocks(resourceUri, table);
        return [`DELETE WHERE {\n  <${resourceUri}> ?p ?o .\n}`, ...inlineDeletes].join(';\n');
      });

      query = `${prefixLines}
${deleteBlocks.join(';\n')}`;
    }

    return {
      type: 'DELETE',
      query,
      prefixes: this.prefixes
    };
  }

  // 获取前缀对象
  getPrefixes(): Record<string, string> {
    return this.prefixes;
  }

  buildWhereClauseForCondition(whereAst: any, table: PodTable): string {
    return this.buildWhereClause({ where: whereAst }, table);
  }

  getPredicateForColumnPublic(column: any, table: PodTable): string {
    return this.getPredicateForColumn(column, table);
  }

  formatLiteralValue(value: any, column?: any): string | string[] {
    return this.formatValue(value, column);
  }

  // 构建 SELECT 变量 - 使用 sparqljs 格式
  private buildSelectVariables(ast: any, table: PodTable): any[] {
    const selectFields = ast.select;
    const variables: any[] = [{ termType: 'Variable', value: 'subject' }];

    if (selectFields && typeof selectFields === 'object' && Object.keys(selectFields).length > 0) {
      const mapped = Object.entries(selectFields).map(([alias, field]) =>
        this.buildSelectEntry(alias, field, table)
      );
      return variables.concat(mapped);
    }

    const skipColumns = new Set(['id', 'subject']);

    if (ast.columns === '*' || !ast.columns) {
      const cols = Object.keys(table.columns)
        .filter((col) => !skipColumns.has(col))
        .map((col) => ({ termType: 'Variable', value: col }));
      return variables.concat(cols);
    }

    const cols = ast.columns
      .filter((col: string) => !skipColumns.has(col))
      .map((col: string) => ({ termType: 'Variable', value: col }));
    return variables.concat(cols);
  }

  private buildSelectEntry(alias: string, field: unknown, table: PodTable): any {
    if (isAggregateExpression(field)) {
      return this.buildAggregateSelectEntry(alias, field, table);
    }

    const column = this.resolveColumn(field, table);
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
      ? { termType: 'Variable', value: this.resolveColumn(aggregate.column, table).name }
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

  private resolveColumn(field: unknown, table: PodTable): PodColumnBase {
    if (field && typeof field === 'object' && field instanceof PodColumnBase) {
      return field;
    }

    if (field && typeof field === 'object' && 'name' in (field as Record<string, unknown>)) {
      const potential = (field as { name?: unknown }).name;
      if (typeof potential === 'string' && table.columns[potential]) {
        return table.columns[potential];
      }
    }

    if (typeof field === 'string') {
      const column = table.columns[field];
      if (column) {
        return column;
      }
    }

    throw new Error(`Unable to resolve column reference for select field: ${String(field)}`);
  }

  // 构建 WHERE 模式 - 使用 sparqljs 格式
  private buildWherePatterns(ast: any, table: PodTable): any[] {
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
      if (columnName === 'id') return; // 跳过 id 字段

      const predicate = this.getPredicateForColumn(column, table);
      const subjectVar = { termType: 'Variable', value: 'subject' } as any;
      const valueVar = { termType: 'Variable', value: columnName } as any;
      const { subject: tripleSubject, object: tripleObject } = this.resolveTripleTerms(
        subjectVar,
        valueVar,
        column,
        table
      );
      const triple: sparqljs.Triple = {
        subject: tripleSubject,
        predicate: { termType: 'NamedNode', value: predicate } as any,
        object: tripleObject
      };

      if (column.options.required) {
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

    // 添加 WHERE 条件过滤器 (必须在 BIND 之前)
    if (ast.where) {
      const filters = this.buildFilterPatterns(ast.where, table);
      patterns.push(...filters);
    }

    return patterns;
  }

  // 构建过滤器模式
  private buildFilterPatterns(whereConditions: any, table: PodTable): any[] {
    if (!whereConditions) {
      return [];
    }

    if (this.isQueryCondition(whereConditions)) {
      const expression = this.buildConditionExpression(whereConditions, table);
      return expression ? [{ type: 'filter', expression }] : [];
    }

    if (typeof whereConditions === 'object' && whereConditions !== null) {
      const entries = Object.entries(whereConditions)
        .map(([columnName, value]) => {
          if (value === undefined) {
            return null;
          }

          const condition: QueryCondition = value === null
            ? { type: 'unary_expr', operator: 'IS NULL', column: columnName }
            : {
                type: 'binary_expr',
                operator: '=',
                column: columnName,
                value,
                left: { column: columnName },
                right: { value }
              };

          return this.buildConditionExpression(condition, table);
        })
        .filter((expression): expression is any => !!expression);

      return entries.length > 0 ? entries.map((expression) => ({ type: 'filter', expression })) : [];
    }

    return [];
  }

  private buildConditionExpression(condition: QueryCondition, table: PodTable): any | null {
    switch (condition.type) {
      case 'binary_expr':
        return this.buildBinaryExpression(condition, table);
      case 'logical_expr':
        return this.buildLogicalExpression(condition, table);
      case 'unary_expr':
        return this.buildUnaryExpression(condition, table);
      default:
        return null;
    }
  }

  private buildBinaryExpression(condition: QueryCondition, table: PodTable): any | null {
    const columnName = condition.column || condition.left?.column;
    if (!columnName) {
      return null;
    }

    const operator = (condition.operator || '=').toUpperCase();
    const rawValue = condition.value ?? condition.right?.value;

    if (columnName === '@id' || columnName === 'subject') {
      const subjectVariable = { termType: 'Variable', value: 'subject' } as any;
      const targetValue = typeof rawValue === 'string' ? rawValue : String(rawValue ?? '');

      if (!targetValue) {
        return null;
      }

      if (operator === '=' || operator === '!=' || operator === '<>') {
        return {
          type: 'operation',
          operator: operator === '<>' ? '!=' : operator,
          args: [subjectVariable, { termType: 'NamedNode', value: targetValue } as any]
        };
      }

      if ((operator === 'IN' || operator === 'NOT IN') && Array.isArray(rawValue)) {
        const uris = rawValue
          .map((value) => ({ termType: 'NamedNode', value: String(value) } as any));

        const inOperator = operator === 'NOT IN' ? 'notin' : 'in';
        return {
          type: 'operation',
          operator: inOperator,
          args: [subjectVariable, uris]
        };
      }

      return null;
    }

    if (columnName === 'id') {
      const subjectVariable = { termType: 'Variable', value: 'subject' } as any;

      if (operator === '=' || operator === '!=' || operator === '<>') {
        const resourceUri = this.generateSubjectUri({ id: rawValue }, table);
        return {
          type: 'operation',
          operator: operator === '<>' ? '!=' : operator,
          args: [subjectVariable, { termType: 'NamedNode', value: resourceUri } as any]
        };
      }

      if ((operator === 'IN' || operator === 'NOT IN') && Array.isArray(rawValue)) {
        const uris = rawValue
          .map((value) => ({ termType: 'NamedNode', value: this.generateSubjectUri({ id: value }, table) } as any));

        const inOperator = operator === 'NOT IN' ? 'notin' : 'in';
        return {
          type: 'operation',
          operator: inOperator,
          args: [subjectVariable, uris]
        };
      }

      return null;
    }

    const column = table.columns?.[columnName];

    if (rawValue === undefined) {
      return null;
    }

    const variable = { termType: 'Variable', value: columnName };
    const literalInput = Array.isArray(rawValue)
      ? rawValue.map((item) => this.buildLiteralTerm(item, column))
      : this.buildLiteralTerm(rawValue, column);
    const literalSingle = Array.isArray(literalInput) ? null : literalInput;

    switch (operator) {
      case '=':
      case '!=':
      case '>':
      case '<':
      case '>=':
      case '<=':
        if (!literalSingle) {
          return null;
        }
        return {
          type: 'operation',
          operator,
          args: [variable, literalSingle]
        };
      case 'LIKE': {
        if (!literalSingle) {
          return null;
        }
        const { regex, flags } = this.convertLikePattern(String(rawValue ?? ''));
        const args: any[] = [
          { type: 'operation', operator: 'str', args: [variable] },
          { termType: 'Literal', value: regex }
        ];
        if (flags) {
          args.push({ termType: 'Literal', value: flags });
        }
        return {
          type: 'operation',
          operator: 'regex',
          args
        };
      }
      case 'REGEX': {
        const patternValue = typeof rawValue === 'object' && rawValue !== null
          ? String(rawValue.pattern ?? '')
          : String(rawValue ?? '');
        if (!patternValue) {
          return null;
        }
        const flagsValue = typeof rawValue === 'object' && rawValue !== null
          ? rawValue.flags
          : undefined;
        const args: any[] = [
          { type: 'operation', operator: 'str', args: [variable] },
          { termType: 'Literal', value: patternValue }
        ];
        if (flagsValue) {
          args.push({ termType: 'Literal', value: String(flagsValue) });
        }
        return {
          type: 'operation',
          operator: 'regex',
          args
        };
      }
      case 'IN': {
        if (!Array.isArray(literalInput)) {
          return null;
        }
        return {
          type: 'operation',
          operator: 'in',
          args: [variable, literalInput]
        };
      }
      case 'NOT IN': {
        if (!Array.isArray(literalInput)) {
          return null;
        }
        return {
          type: 'operation',
          operator: 'notin',
          args: [variable, literalInput]
        };
      }
      default:
        return null;
    }
  }

  private buildLogicalExpression(condition: QueryCondition, table: PodTable): any | null {
    if (!condition.conditions || condition.conditions.length === 0) {
      return null;
    }

    const expressions = condition.conditions
      .map((child) => this.buildConditionExpression(child, table))
      .filter((expr): expr is any => !!expr);

    if (expressions.length === 0) {
      return null;
    }

    if (expressions.length === 1) {
      return expressions[0];
    }

    const operator = condition.operator === 'AND' ? '&&' : '||';
    return expressions.reduce((acc, expr) => ({
      type: 'operation',
      operator,
      args: [acc, expr]
    }));
  }

  private buildUnaryExpression(condition: QueryCondition, table: PodTable): any | null {
    if (condition.operator === 'NOT' && condition.left) {
      const inner = this.buildConditionExpression(condition.left as QueryCondition, table);
      if (!inner) {
        return null;
      }
      return {
        type: 'operation',
        operator: '!',
        args: [inner]
      };
    }

    const columnName = condition.column || condition.left?.column;
    if (!columnName) {
      return null;
    }

    const variable = columnName === 'id'
      ? { termType: 'Variable', value: 'subject' }
      : { termType: 'Variable', value: columnName };

    const boundExpression = {
      type: 'operation',
      operator: 'bound',
      args: [variable]
    };

    if (condition.operator === 'IS NULL') {
      return {
        type: 'operation',
        operator: '!',
        args: [boundExpression]
      };
    }

    if (condition.operator === 'IS NOT NULL') {
      return boundExpression;
    }

    return null;
  }

  private convertLikePattern(pattern: string): { regex: string; flags?: string } {
    const escaped = pattern
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/%/g, '.*')
      .replace(/_/g, '.');

    return {
      regex: `^${escaped}$`,
      flags: 'i'
    };
  }

  private isInverseColumn(column: any, table?: PodTable): boolean {
    if (!column) {
      return false;
    }
    if (typeof column.isInverse === 'function') {
      try {
        return column.isInverse();
      } catch {
        // fall through to options/mapping
      }
    }
    if (column.options?.inverse) {
      return true;
    }
    if (table && typeof (table as any).getMapping === 'function') {
      const mapping = (table as any).getMapping() as PodTableMapping;
      return mapping?.columns?.[column.name]?.inverse === true;
    }
    return false;
  }

  private resolveTripleTerms(
    subjectTerm: any,
    valueTerm: any,
    column: any,
    table?: PodTable
  ): { subject: any; object: any } {
    if (this.isInverseColumn(column, table)) {
      return {
        subject: valueTerm,
        object: subjectTerm
      };
    }
    return {
      subject: subjectTerm,
      object: valueTerm
    };
  }

  private buildTripleStringPattern(
    subject: string,
    value: string,
    predicate: string,
    column: any,
    table?: PodTable
  ): string {
    return this.isInverseColumn(column, table)
      ? `${value} <${predicate}> ${subject}`
      : `${subject} <${predicate}> ${value}`;
  }

  // 构建字面量项
  private buildLiteralTerm(value: any, column?: any): any {
    // 处理引用类型（WebID等）
    if (column?.options?.referenceTarget && typeof value === 'string') {
      return {
        termType: 'NamedNode',
        value: value
      };
    }

    // 使用列的类型信息确定数据类型
    if (column) {
      switch (column.dataType) {
        case 'string':
          return {
            termType: 'Literal',
            value: String(value)
          };
        case 'integer':
          return {
            termType: 'Literal',
            value: String(Number(value)),
            datatype: { termType: 'NamedNode', value: 'http://www.w3.org/2001/XMLSchema#integer' }
          };
        case 'boolean':
          return {
            termType: 'Literal',
            value: String(Boolean(value)),
            datatype: { termType: 'NamedNode', value: 'http://www.w3.org/2001/XMLSchema#boolean' }
          };
        case 'datetime': {
          const date = value instanceof Date ? value : new Date(value);
          return {
            termType: 'Literal',
            value: date.toISOString(),
            datatype: { termType: 'NamedNode', value: 'http://www.w3.org/2001/XMLSchema#dateTime' }
          };
        }
        case 'json':
        case 'object':
          return {
            termType: 'Literal',
            value: JSON.stringify(value),
            datatype: { termType: 'NamedNode', value: 'http://www.w3.org/2001/XMLSchema#json' }
          };
        
        case 'uri':
          // URI 类型作为 NamedNode
          if (typeof value !== 'string' || (!value.startsWith('http://') && !value.startsWith('https://'))) {
            throw new Error(`URI column requires valid HTTP(S) URL, got: ${value}`);
          }
          return {
            termType: 'NamedNode',
            value: value
          };
      }
    }

    // 回退到类型推断
    if (typeof value === 'string') {
      return {
        termType: 'Literal',
        value,
        datatype: { termType: 'NamedNode', value: 'http://www.w3.org/2001/XMLSchema#string' }
      };
    } else if (typeof value === 'number') {
      const datatype = Number.isInteger(value) 
        ? 'http://www.w3.org/2001/XMLSchema#integer'
        : 'http://www.w3.org/2001/XMLSchema#decimal';
      return {
        termType: 'Literal',
        value: value.toString(),
        datatype: { termType: 'NamedNode', value: datatype }
      };
    } else if (typeof value === 'boolean') {
      return {
        termType: 'Literal',
        value: value.toString(),
        datatype: { termType: 'NamedNode', value: 'http://www.w3.org/2001/XMLSchema#boolean' }
      };
    } else if (value instanceof Date) {
      return {
        termType: 'Literal',
        value: value.toISOString(),
        datatype: { termType: 'NamedNode', value: 'http://www.w3.org/2001/XMLSchema#dateTime' }
      };
    } else {
      return {
        termType: 'Literal',
        value: String(value)
      };
    }
  }

  // 构建所有三元组（用于 DELETE）
  private buildAllTriples(table: PodTable): any[] {
    const triples: any[] = [];
    const subject: any = { termType: 'Variable', value: 'subject' };

    // 类型三元组
    triples.push({
      subject,
      predicate: { termType: 'NamedNode', value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' },
      object: { termType: 'NamedNode', value: table.config.type }
    });

    // 属性三元组
    Object.entries(table.columns).forEach(([columnName, column]) => {
      if (columnName === 'id') return;

      const predicate = this.getPredicateForColumn(column, table);
      triples.push({
        subject,
        predicate: { termType: 'NamedNode', value: predicate },
        object: { termType: 'Variable', value: columnName }
      });
    });

    return triples;
  }

  // 构建 WHERE 子句内容（不包含WHERE关键字）
  private buildWhereClause(ast: any, table: PodTable): string {
    const triples: string[] = [];
    const filters: string[] = [];
    
    // 主体变量
    const subject = '?subject';
    
    // RDF 类型约束
    triples.push(`${subject} rdf:type <${table.config.type}> .`);
    
    // 为每个列添加可选的三元组（除了id字段）
    for (const [columnName, column] of Object.entries(table.columns)) {
      // 跳过id字段，它不存储为RDF属性
      if (columnName === 'id') {
        continue;
      }
      
      const predicate = this.getPredicateForColumn(column, table);
      const variable = `?${columnName}`;
      const triplePattern = this.buildTripleStringPattern(subject, variable, predicate, column, table);
      
      if (column.options.required) {
        triples.push(`${triplePattern} .`);
      } else {
        triples.push(`OPTIONAL { ${triplePattern} } .`);
      }
    }
    
    // 添加 WHERE 条件
    if (ast.where) {
      const conditions = this.buildLegacyWhereFilters(ast.where, table);
      // FILTER条件单独收集，放在WHERE子句的最后
      filters.push(...conditions);
    }
    
    // 组合三元组和FILTER条件
    let result = triples.join('\n  ');
    if (filters.length > 0) {
      result += '\n  ' + filters.join('\n  ');
    }
    
    return result;
  }

  private buildLegacyWhereFilters(whereAst: any, table: PodTable): string[] {
    const filterPatterns = this.buildFilterPatterns(whereAst, table);

    return filterPatterns
      .filter((pattern) => pattern.type === 'filter')
      .map((pattern) => this.filterPatternToString(pattern))
      .filter((filter): filter is string => Boolean(filter));
  }

  private filterPatternToString(pattern: any): string | null {
    try {
      const query = {
        type: 'query',
        queryType: 'SELECT',
        variables: [{ termType: 'Wildcard' }],
        where: [pattern],
        prefixes: this.prefixes
      };

      const queryString = this.generator.stringify(query);
      const match = queryString.match(/WHERE\s*\{\s*(FILTER\(.*\))\s*\}/is);
      return match ? match[1].trim() : null;
    } catch (error) {
      return null;
    }
  }

  // 构建插入三元组 - 使用 sparqljs 格式
  private buildInsertTriples(values: any[], table: PodTable): any[] {
    const triples: any[] = [];
    
    for (const record of values) {
      const subjectUri = this.generateSubjectUri(record, table);
      const subject: any = { termType: 'NamedNode', value: subjectUri };

      // 添加类型三元组
      triples.push({
        subject,
        predicate: { termType: 'NamedNode', value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' },
        object: { termType: 'NamedNode', value: table.config.type }
      });
      const parents = typeof table.getSubClassOf === 'function' ? table.getSubClassOf() : [];
      for (const parentClass of parents) {
        triples.push({
          subject,
          predicate: { termType: 'NamedNode', value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' },
          object: { termType: 'NamedNode', value: parentClass }
        });
      }

      // 添加属性三元组
      Object.entries(record).forEach(([columnName, value]) => {
        if (columnName === 'id' || value === undefined || value === null) return;

        const column = table.columns[columnName];
        if (!column) return;

        if (this.isInlineObjectColumn(column)) {
          const inlineValues = Array.isArray(value) ? value : [value];
          inlineValues.forEach((inlineValue, index) => {
            if (!inlineValue) return;
            const childIri = subjectResolver.resolveInlineChild(subjectUri, column.name, inlineValue, index);
            triples.push({
              subject,
              predicate: { termType: 'NamedNode', value: this.getPredicateForColumn(column, table) },
              object: { termType: 'NamedNode', value: childIri }
            });
            const childTriples = this.buildInlineChildTriples(childIri, inlineValue, table);
            triples.push(...childTriples);
          });
          return;
        }

        const predicate = this.getPredicateForColumn(column, table);

        // 处理数组类型 - 多重属性
        if (column.options?.isArray && Array.isArray(value)) {
          // 为数组的每个元素创建单独的三元组
          value.forEach(arrayItem => {
            if (arrayItem !== undefined && arrayItem !== null) {
              const literalTerm = this.buildLiteralTerm(arrayItem, column);
              const { subject: tripleSubject, object: tripleObject } = this.resolveTripleTerms(
                subject,
                literalTerm,
                column,
                table
              );
              triples.push({
                subject: tripleSubject,
                predicate: { termType: 'NamedNode', value: predicate },
                object: tripleObject
              });
            }
          });
        } else {
          // 普通单值属性
          const literalTerm = this.buildLiteralTerm(value, column);
          const { subject: tripleSubject, object: tripleObject } = this.resolveTripleTerms(
            subject,
            literalTerm,
            column,
            table
          );
          triples.push({
            subject: tripleSubject,
            predicate: { termType: 'NamedNode', value: predicate },
            object: tripleObject
          });
        }
      });
    }
    
    return triples;
  }

  // 构建检查资源是否存在的查询
  buildExistenceCheckQuery(values: any[], table: PodTable): string {
    const conditions: string[] = [];
    
    for (const record of values) {
      // 在Solid中，检查WebID是否存在
      const subjectUri = this.generateSubjectUri(record, table);
      // 如果使用相对路径，直接检查片段标识符
      if (subjectUri.startsWith('#')) {
        conditions.push(`?subject ?p ?o . FILTER(STRENDS(STR(?subject), "${subjectUri}"))`);
      } else {
        conditions.push(`<${subjectUri}> ?p ?o`);
      }
    }
    
    if (conditions.length === 0) {
      return '';
    }
    
    return `ASK WHERE {
  ${conditions.join(' .\n  ')} .
}`;
  }

  // 构建删除三元组（用于更新）- 使用 sparqljs 格式
  private buildDeleteTriples(setData: any, table: PodTable): any[] {
    const triples: any[] = [];
    const subject: any = { termType: 'Variable', value: 'subject' };
    
    Object.keys(setData).forEach(columnName => {
      const column = table.columns[columnName];
      if (!column) return;
      if (this.isInlineObjectColumn(column)) return;
      
      const predicate = this.getPredicateForColumn(column, table);
      const valueVar = { termType: 'Variable', value: `old_${columnName}` } as any;
      const { subject: tripleSubject, object: tripleObject } = this.resolveTripleTerms(
        subject,
        valueVar,
        column,
        table
      );
      triples.push({
        subject: tripleSubject,
        predicate: { termType: 'NamedNode', value: predicate },
        object: tripleObject
      });
    });
    
    return triples;
  }

  // 构建更新三元组 - 使用 sparqljs 格式
  private buildUpdateTriples(setData: any, table: PodTable): any[] {
    const triples: any[] = [];
    const subject: any = { termType: 'Variable', value: 'subject' };
    
    Object.entries(setData).forEach(([columnName, value]) => {
      const column = table.columns[columnName];
      if (!column) return;
      if (this.isInlineObjectColumn(column)) return;
      
      const predicate = this.getPredicateForColumn(column, table);
      const literalTerm = this.buildLiteralTerm(value, column);
      const { subject: tripleSubject, object: tripleObject } = this.resolveTripleTerms(
        subject,
        literalTerm,
        column,
        table
      );
      triples.push({
        subject: tripleSubject,
        predicate: { termType: 'NamedNode', value: predicate },
        object: tripleObject
      });
    });
    
    return triples;
  }

  // 获取列的谓词
  private getPredicateForColumn(column: any, table: PodTable): string {
    if (typeof (table as any).getMapping === 'function') {
      const mapping = (table as any).getMapping() as PodTableMapping;
      const mapped = mapping?.columns?.[column.name];
      if (mapped?.predicate) {
        return mapped.predicate;
      }
    }
    // 优先级：显式predicate > namespace + columnName > 标准默认映射 > fallback
    if (column.predicate && typeof column.predicate === 'string') return column.predicate;
    if (column.options?.predicate) return column.options.predicate;
    if (typeof column.getPredicate === 'function') {
      try {
        return column.getPredicate(table.config.namespace);
      } catch (error) {
        // fall through to default map
        if (process.env.DEBUG?.includes('sparql')) {
          console.warn('getPredicate fallback for column', column.name, error);
        }
      }
    }

    // 如果设置了namespace，优先用namespace + columnName
    const namespace = table.config.namespace;
    if (namespace) {
      return `${namespace}${column.name}`;
    }

    // 标准默认映射（当没有namespace时）
    const defaultPredicates: Record<string, string> = {
      // 基础标识符
      'id': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#about',
      
      // 通用名称和描述
      'name': 'http://xmlns.com/foaf/0.1/name',
      'title': 'http://purl.org/dc/terms/title',
      'description': 'http://purl.org/dc/terms/description',
      'content': 'http://purl.org/dc/terms/description',  // 通用内容字段
      
      // 时间戳
      'createdAt': 'https://schema.org/dateCreated',
      'updatedAt': 'https://schema.org/dateModified',
      'created_at': 'https://schema.org/dateCreated',  // 兼容下划线命名
      'updated_at': 'https://schema.org/dateModified', // 兼容下划线命名
      
      // 联系信息
      'email': 'http://xmlns.com/foaf/0.1/mbox',
      'url': 'http://xmlns.com/foaf/0.1/homepage',
      'homepage': 'http://xmlns.com/foaf/0.1/homepage' // 别名
    };

    const defaultUri = defaultPredicates[column.name];
    if (defaultUri) {
      return defaultUri;
    }

    // 最后的fallback
    return `http://example.org/${column.name}`;
  }

  // 生成主体 URI
  generateSubjectUri(record: any, table: PodTable): string {
    const normalizedRecord = this.normalizeSubjectInput(record);
    return subjectResolver.resolve(table, normalizedRecord);
  }

  private normalizeSubjectInput(record: any): Record<string, any> {
    if (record && typeof record === 'object' && 'type' in record && 'operator' in record) {
      const extracted = this.extractSubjectRecord(record as QueryCondition);
      return extracted ?? {};
    }
    return record ?? {};
  }

  private extractSubjectRecords(where: any): Record<string, any>[] {
    if (!where) {
      return [];
    }

    if (this.isQueryCondition(where)) {
      if (where.operator?.toUpperCase() === 'IN' && where.column && (where.column === '@id' || where.column === 'id')) {
        const key = where.column;
        const values = this.extractConditionValues(where);
        return values.map((value) => ({ [key]: value }));
      }
      const record = this.extractSubjectRecord(where);
      return record ? [record] : [];
    }

    if (typeof where === 'object' && (where.id || where['@id'])) {
      return [where];
    }

    return [];
  }

  private extractSubjectRecord(where: any): Record<string, any> | null {
    if (!where) {
      return null;
    }

    if (this.isQueryCondition(where)) {
      const idValue = this.findConditionValue(where, 'id');
      const iriValue = this.findConditionValue(where, '@id');
      const record: Record<string, any> = {};
      if (iriValue) {
        record['@id'] = iriValue;
      }
      if (idValue) {
        record.id = idValue;
      }
      return Object.keys(record).length > 0 ? record : null;
    }

    if (typeof where === 'object') {
      if (where.id || where['@id']) {
        return where;
      }
    }

    return null;
  }

  private buildUpdateStatementsForRecord(resourceUri: string, setData: Record<string, any>, table: PodTable): string | null {
    const deleteTriples: string[] = [];
    const insertTriples: string[] = [];
    const wherePatterns: string[] = [];

    Object.entries(setData).forEach(([columnName, originalValue], index) => {
      const column = table.columns[columnName];
      if (!column) {
        return;
      }

      let value = originalValue;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        value = trimmed.length > 0 ? trimmed : null;
      }

      if (this.isInlineObjectColumn(column)) {
        const predicate = this.getPredicateForColumn(column, table);
        const inlineValues = Array.isArray(value) ? value : value === null ? [] : [value];
        inlineValues.forEach((inlineValue, childIndex) => {
          if (!inlineValue) return;
          const childIri = subjectResolver.resolveInlineChild(resourceUri, column.name, inlineValue, childIndex);
          insertTriples.push(`<${resourceUri}> <${predicate}> <${childIri}> .`);
          insertTriples.push(...this.buildInlineChildTripleStrings(childIri, inlineValue, table));
        });
        deleteTriples.push(`<${resourceUri}> <${predicate}> ?old_${column.name} .`);
        deleteTriples.push(`?old_${column.name} ?p_${column.name} ?o_${column.name} .`);
        wherePatterns.push(`OPTIONAL { <${resourceUri}> <${predicate}> ?old_${column.name} . ?old_${column.name} ?p_${column.name} ?o_${column.name} . }`);
        return;
      }

      const predicate = this.getPredicateForColumn(column, table);
      const variableName = `old_${columnName}_${index}`;
      const isInverse = this.isInverseColumn(column, table);

      if (isInverse) {
        // For inverse columns, swap subject and object
        deleteTriples.push(`?${variableName} <${predicate}> <${resourceUri}> .`);
        wherePatterns.push(`OPTIONAL { ?${variableName} <${predicate}> <${resourceUri}> . }`);
        if (value !== null && value !== undefined) {
          const formattedValue = this.formatColumnValue(value, column);
          insertTriples.push(`${formattedValue} <${predicate}> <${resourceUri}> .`);
        }
      } else {
        deleteTriples.push(`<${resourceUri}> <${predicate}> ?${variableName} .`);
        wherePatterns.push(`OPTIONAL { <${resourceUri}> <${predicate}> ?${variableName} . }`);
        if (value !== null && value !== undefined) {
          const formattedValue = this.formatColumnValue(value, column);
          insertTriples.push(`<${resourceUri}> <${predicate}> ${formattedValue} .`);
        }
      }
    });

    if (deleteTriples.length === 0 && insertTriples.length === 0) {
      return null;
    }

    const deleteBlock = deleteTriples.length > 0 ? `DELETE {\n  ${deleteTriples.join('\n  ')}\n}` : '';
    const insertBlock = insertTriples.length > 0 ? `INSERT {\n  ${insertTriples.join('\n  ')}\n}` : 'INSERT { }';
    const whereBlock = wherePatterns.length > 0 ? `WHERE {\n  ${wherePatterns.join('\n  ')}\n}` : 'WHERE { }';

    return [deleteBlock, insertBlock, whereBlock].filter(Boolean).join('\n');
  }

  private isQueryCondition(value: any): value is QueryCondition {
    return value && typeof value === 'object' && 'type' in value && 'operator' in value;
  }

  private findConditionValue(condition: QueryCondition, column: string): string | undefined {
    if (!condition) {
      return undefined;
    }

    switch (condition.type) {
      case 'binary_expr': {
        const targetColumn = condition.column ?? condition.left?.column;
        if (targetColumn === column && ['=', '=='].includes((condition.operator ?? '').toUpperCase())) {
          const raw = condition.value ?? condition.right?.value;
          if (typeof raw === 'string') {
            return raw;
          }
        }
        return undefined;
      }
      case 'logical_expr': {
        for (const child of condition.conditions ?? []) {
          const value = this.findConditionValue(child, column);
          if (value) {
            return value;
          }
        }
        return undefined;
      }
      default:
        return undefined;
    }
  }

  private extractConditionValues(condition: QueryCondition): string[] {
    if (!condition) {
      return [];
    }
    const raw = condition.value ?? condition.right?.value;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.filter((entry): entry is string => typeof entry === 'string');
  }

  private formatColumnValue(value: any, column: any): string {
    if (column?.options?.referenceTarget && typeof value === 'string') {
      return `<${value}>`;
    }
    if (column?.dataType === 'uri' && typeof value === 'string') {
      return `<${value}>`;
    }
    const formatted = this.formatValue(value, column);
    if (Array.isArray(formatted)) {
      return formatted.join(' ');
    }
    return formatted;
  }

  // 格式化值 - 使用 Column 的统一格式化方法
  formatValue(value: any, column?: any): string | string[] {
    if (column && typeof column.formatValue === 'function') {
      // 使用 Column 的统一格式化方法
      return column.formatValue(value);
    }

    // 回退到基本格式化（向后兼容）
    if (value === null || value === undefined) {
      throw new Error('Cannot format null or undefined value');
    }
    
    if (typeof value === 'string') {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    
    if (typeof value === 'number') {
      return value.toString();
    }
    
    if (typeof value === 'boolean') {
      return `"${value}"^^<http://www.w3.org/2001/XMLSchema#boolean>`;
    }
    
    if (value instanceof Date) {
      return `"${value.toISOString()}"^^<http://www.w3.org/2001/XMLSchema#dateTime>`;
    }
    
    return `"${String(value)}"`;
  }

  // 添加自定义前缀
  addPrefix(prefix: string, uri: string): void {
    this.prefixes[prefix] = uri;
  }

  getRdfTypePredicate(): string {
    return 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
  }

  // 主要的转换方法 - 从 SQL 对象转换为 SPARQL
  convert(sql: SQL): SPARQLQuery {
    const sqlString = sql.queryChunks.join('');
    
    if (sqlString.toLowerCase().includes('select')) {
      // 创建一个简化的 AST 并转换
      this.parseSelectAST(sql, null as any);
      return {
        type: 'SELECT',
        query: `
          PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
          PREFIX schema: <https://schema.org/>
          
          SELECT * WHERE {
            ?subject ?predicate ?object .
          }
        `,
        prefixes: this.prefixes
      };
    } else if (sqlString.toLowerCase().includes('insert')) {
      return {
        type: 'INSERT',
        query: `
          PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
          PREFIX schema: <https://schema.org/>
          
          INSERT DATA {
            # Insert statements will be generated
          }
        `,
        prefixes: this.prefixes
      };
    } else if (sqlString.toLowerCase().includes('update')) {
      return {
        type: 'UPDATE',
        query: `
          PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
          PREFIX schema: <https://schema.org/>
          
          DELETE { ?subject ?predicate ?oldValue }
          INSERT { ?subject ?predicate ?newValue }
          WHERE { ?subject ?predicate ?oldValue }
        `,
        prefixes: this.prefixes
      };
    } else if (sqlString.toLowerCase().includes('delete')) {
      return {
        type: 'DELETE',
        query: `
          PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
          PREFIX schema: <https://schema.org/>
          
          DELETE WHERE {
            ?subject ?predicate ?object .
          }
        `,
        prefixes: this.prefixes
      };
    } else {
      throw new Error(`Unsupported SQL operation: ${sqlString}`);
    }
  }

  private isInlineObjectColumn(column: any): boolean {
    if (!column) return false;
    if (column.dataType === 'object') return true;
    if (column.dataType === 'array') {
      const elem = (column as any).elementType ?? column.options?.baseType;
      return elem === 'object';
    }
    return false;
  }

  private buildInlineChildTriples(childIri: string, inlineValue: Record<string, any>, table: PodTable): any[] {
    const triples: any[] = [];
    const subject: any = { termType: 'NamedNode', value: childIri };
    const namespaceUri = table.config.namespace?.uri ?? table.config.namespace;

    Object.entries(inlineValue || {}).forEach(([key, raw]) => {
      if (key === 'id' || key === '@id') return;
      if (raw === undefined || raw === null) return;
      const predicate = key.startsWith('http://') || key.startsWith('https://')
        ? key
        : namespaceUri
          ? `${namespaceUri}${key}`
          : `http://example.org/${key}`;

      const values = Array.isArray(raw) ? raw : [raw];
      values.forEach((entry) => {
        const term = this.buildLiteralTerm(entry);
        triples.push({
          subject,
          predicate: { termType: 'NamedNode', value: predicate },
          object: term
        });
      });
    });

    return triples;
  }

  private buildInlineChildTripleStrings(childIri: string, inlineValue: Record<string, any>, table: PodTable): string[] {
    const namespaceUri = table.config.namespace?.uri ?? table.config.namespace;
    const lines: string[] = [];

    Object.entries(inlineValue || {}).forEach(([key, raw]) => {
      if (key === 'id' || key === '@id') return;
      if (raw === undefined || raw === null) return;
      const predicate = key.startsWith('http://') || key.startsWith('https://')
        ? key
        : namespaceUri
          ? `${namespaceUri}${key}`
          : `http://example.org/${key}`;
      const values = Array.isArray(raw) ? raw : [raw];
      values.forEach((entry) => {
        const formattedValue = this.formatColumnValue(entry, undefined);
        lines.push(`  <${childIri}> <${predicate}> ${formattedValue} .`);
      });
    });

    return lines;
  }

  private buildInlineCascadeDeleteBlocks(resourceUri: string, table: PodTable): string[] {
    const blocks: string[] = [];
    Object.values(table.columns).forEach((column) => {
      if (!this.isInlineObjectColumn(column)) return;
      const predicate = this.getPredicateForColumn(column, table);
      blocks.push(`DELETE WHERE {\n  <${resourceUri}> <${predicate}> ?inline_obj_${column.name} .\n  ?inline_obj_${column.name} ?p_${column.name} ?o_${column.name} .\n}`);
    });
    return blocks;
  }
  // 解析 Drizzle SQL AST（这是关键部分）
  parseDrizzleAST(sql: SQL, table: PodTable): any {
    // 这里需要解析 Drizzle 的 SQL AST
    // Drizzle 的 SQL 对象包含查询的结构化信息
    
    const sqlString = sql.queryChunks.join('');
    // 注意：SQL 对象的实际结构可能不同，这里使用安全的属性访问
    // 简化的 AST 解析（实际实现需要更复杂的解析逻辑）
    if (sqlString.includes('SELECT')) {
      return this.parseSelectAST(sql, table);
    } else if (sqlString.includes('INSERT')) {
      return this.parseInsertAST(sql, table);
    } else if (sqlString.includes('UPDATE')) {
      return this.parseUpdateAST(sql, table);
    } else if (sqlString.includes('DELETE')) {
      return this.parseDeleteAST(sql, table);
    }
    
    throw new Error(`Unsupported SQL operation: ${sqlString}`);
  }

  // 解析 SELECT AST
  private parseSelectAST(sql: SQL, _table: PodTable): any {
    void _table;
    // 解析 SELECT 查询的 AST
    return {
      type: 'select',
      columns: '*', // 简化处理
      where: this.parseWhereClause(sql)
    };
  }

  // 解析 INSERT AST
  private parseInsertAST(sql: SQL, _table: PodTable): any {
    void _table;
    return {
      type: 'insert',
      values: (sql as any).params || [] // 插入的值
    };
  }

  // 解析 UPDATE AST
  private parseUpdateAST(sql: SQL, _table: PodTable): any {
    void _table;
    return {
      type: 'update',
      set: {}, // 需要从 AST 中提取
      where: this.parseWhereClause(sql)
    };
  }

  // 解析 DELETE AST
  private parseDeleteAST(sql: SQL, _table: PodTable): any {
    void _table;
    return {
      type: 'delete',
      where: this.parseWhereClause(sql)
    };
  }

  // 解析 WHERE 子句
  private parseWhereClause(_sql: SQL): any {
    void _sql;
    // 简化的 WHERE 解析
    // 实际需要解析 SQL 的 WHERE AST
    return null;
  }

  // 获取字段的谓词URI
  getFieldPredicate(fieldName: string, table: PodTable): string {
    const column = table.columns[fieldName];
    if (!column) {
      throw new Error(`Column ${fieldName} not found in table ${table.config.name}`);
    }
    return this.getPredicateForColumn(column, table);
  }


}
