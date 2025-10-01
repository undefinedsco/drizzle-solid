// AST 到 SPARQL 转换器 - 使用 sparqljs 重构版本
import { SQL } from 'drizzle-orm';
import { PodTable, PodColumnBase } from './pod-table';
import type { QueryCondition } from './query-conditions';
import { AggregateExpression, isAggregateExpression } from './aggregates';
import * as sparqljs from 'sparqljs';

// SPARQL 查询类型
export interface SPARQLQuery {
  type: 'SELECT' | 'INSERT' | 'DELETE' | 'UPDATE';
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

  // 转换 INSERT 查询 - 使用 sparqljs
  convertInsert(values: any[], table: PodTable): SPARQLQuery {
    // 检查是否有重复的ID
    const existingIds = new Set<string>();
    const duplicateIds: string[] = [];
    
    for (const record of values) {
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
          triples: this.buildInsertTriples(values, table)
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
    // 构建资源 URI
    const resourceUri = this.generateSubjectUri(whereConditions, table);
    
    // 使用更简单的 DELETE WHERE + INSERT DATA 组合方式
    // 这种方式对大多数 Solid 服务器更兼容
    const prefixLines = Object.entries(this.prefixes)
      .map(([prefix, uri]) => `PREFIX ${prefix}: <${uri}>`)
      .join('\n');
    
    const deleteStatements: string[] = [];
    const insertTriples: string[] = [];

    Object.entries(setData).forEach(([columnName, value], index) => {
      const column = table.columns[columnName];
      if (!column) {
        return;
      }

      const predicate = this.getPredicateForColumn(column, table);
      const formattedValue = this.formatValue(value, column);
      const variableName = `?value${index}`;

      deleteStatements.push(`DELETE WHERE {\n  <${resourceUri}> <${predicate}> ${variableName} .\n}`);
      insertTriples.push(`  <${resourceUri}> <${predicate}> ${formattedValue} .`);
    });

    const deleteBlock = deleteStatements.length > 0
      ? `${deleteStatements.join(';\n')}\n;\n`
      : '';

    const insertBlock = insertTriples.length > 0
      ? `INSERT DATA {\n${insertTriples.join('\n')}\n}`
      : '';

    const query = `${prefixLines}
${deleteBlock}${insertBlock}`.trimEnd();

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

    if (whereConditions && Object.keys(whereConditions).length > 0) {
      const resourceUri = this.generateSubjectUri(whereConditions, table);
      query = `${prefixLines}
DELETE WHERE {
  <${resourceUri}> ?p ?o .
}`;
    } else {
      query = `${prefixLines}
DELETE WHERE {
  ?subject rdf:type <${table.config.rdfClass}> .
  ?subject ?p ?o .
}`;
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

  formatLiteralValue(value: any, column?: any): string {
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

    if (ast.columns === '*' || !ast.columns) {
      const cols = Object.keys(table.columns)
        .filter(col => col !== 'id')
        .map(col => ({ termType: 'Variable', value: col }));
      return variables.concat(cols);
    }

    const cols = ast.columns
      .filter((col: string) => col !== 'id')
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
        object: { termType: 'NamedNode', value: table.config.rdfClass } as any
      }]
    });

    // 添加属性模式（使用 OPTIONAL 处理可选属性）
    Object.entries(table.columns).forEach(([columnName, column]) => {
      if (columnName === 'id') return; // 跳过 id 字段

      const predicate = this.getPredicateForColumn(column, table);
      const triple: any = {
        subject: { termType: 'Variable', value: 'subject' },
        predicate: { termType: 'NamedNode', value: predicate },
        object: { termType: 'Variable', value: columnName }
      };

      if (column.options.required) {
        // 必需字段直接添加到 BGP
        patterns.push({
          type: 'bgp',
          triples: [triple]
        });
      } else {
        // 可选字段使用 OPTIONAL
        patterns.push({
          type: 'optional',
          patterns: [{
            type: 'bgp',
            triples: [triple]
          }]
        });
      }
    });

    // 添加 WHERE 条件过滤器
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

  private isQueryCondition(value: any): value is QueryCondition {
    return value && typeof value === 'object' && 'type' in value && 'operator' in value;
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

    if (rawValue === undefined) {
      return null;
    }

    const variable = { termType: 'Variable', value: columnName };
    const literalInput = Array.isArray(rawValue)
      ? rawValue.map((item) => this.buildLiteralTerm(item))
      : this.buildLiteralTerm(rawValue);
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
      .replace(/([.+^${}()|\[\]\\])/g, '\\$1')
      .replace(/%/g, '.*')
      .replace(/_/g, '.');

    return {
      regex: `^${escaped}$`,
      flags: 'i'
    };
  }

  // 构建字面量项
  private buildLiteralTerm(value: any): any {
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
      object: { termType: 'NamedNode', value: table.config.rdfClass }
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
    triples.push(`${subject} rdf:type <${table.config.rdfClass}> .`);
    
    // 为每个列添加可选的三元组（除了id字段）
    for (const [columnName, column] of Object.entries(table.columns)) {
      // 跳过id字段，它不存储为RDF属性
      if (columnName === 'id') {
        continue;
      }
      
      const predicate = this.getPredicateForColumn(column, table);
      const variable = `?${columnName}`;
      
      if (column.options.required) {
        triples.push(`${subject} <${predicate}> ${variable} .`);
      } else {
        triples.push(`OPTIONAL { ${subject} <${predicate}> ${variable} } .`);
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
        object: { termType: 'NamedNode', value: table.config.rdfClass }
      });

      // 添加属性三元组
      Object.entries(record).forEach(([columnName, value]) => {
        if (columnName === 'id' || value === undefined || value === null) return;

        const column = table.columns[columnName];
        if (!column) return;

        const predicate = this.getPredicateForColumn(column, table);
        triples.push({
          subject,
          predicate: { termType: 'NamedNode', value: predicate },
          object: this.buildLiteralTerm(value)
        });
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
      
      const predicate = this.getPredicateForColumn(column, table);
      triples.push({
        subject,
        predicate: { termType: 'NamedNode', value: predicate },
        object: { termType: 'Variable', value: `old_${columnName}` }
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
      
      const predicate = this.getPredicateForColumn(column, table);
      triples.push({
        subject,
        predicate: { termType: 'NamedNode', value: predicate },
        object: this.buildLiteralTerm(value)
      });
    });
    
    return triples;
  }

  // 获取列的谓词
  private getPredicateForColumn(column: any, table: PodTable): string {
    // 优先级：显式predicate > namespace + columnName > 标准默认映射 > fallback
    if (column.predicate && typeof column.predicate === 'string') return column.predicate;
    if (column.options?.predicate) return column.options.predicate;
    if (typeof column.getPredicate === 'function') return column.getPredicate(table.config.namespace);

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
    // 从 webId 中提取用户路径
    const userPath = this.extractUserPathFromWebId();
    const containerPath = table.config.containerPath || '/data/';
    
    // 修复：去掉容器路径末尾的斜杠，因为我们要生成资源URI而不是容器URI
    const cleanContainerPath = containerPath.replace(/\/$/, '');
    
    // 构建完整的容器路径
    const fullContainerPath = cleanContainerPath.startsWith(userPath) ? 
      cleanContainerPath : 
      userPath + cleanContainerPath.replace(/^\//, '');
    
    const id = record.id || Date.now();
    
    // 始终使用绝对路径，确保SPARQL查询中的URI是完整的
    const baseUri = `${this.podUrl}${fullContainerPath}`;
    return `${baseUri}#${id}`; // 使用 # 分隔符，符合RDF最佳实践
  }

  // 从 webId 中提取用户路径
  private extractUserPathFromWebId(): string {
    if (!this.webId) {
      return '';
    }

    try {
      const url = new URL(this.webId);
      const pathParts = url.pathname.split('/');
      if (pathParts.length >= 2) {
        const username = pathParts[1];
        return `/${username}/`;
      }
    } catch (error) {
      console.warn('Failed to parse webId:', this.webId, error);
    }

    return '';
  }

  // 格式化值
  formatValue(value: any, column?: any): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }
    
    // 处理 JSON 和 Object 类型
    if (column?.dataType === 'json' || column?.dataType === 'object') {
      // 将 JSON/Object 数据序列化为 JSON 字符串，并标记为 JSON 类型
      const jsonString = JSON.stringify(value);
      return `"${jsonString.replace(/"/g, '\\"')}"^^<http://www.w3.org/2001/XMLSchema#json>`;
    }
    
    if (typeof value === 'string') {
      if (column?.isReference()) {
        // 引用类型使用 URI
        return `<${value}>`;
      } else {
        // 字符串字面量
        return `"${value.replace(/"/g, '\\"')}"`;
      }
    }
    
    if (typeof value === 'number') {
      if (column?.isReference()) {
        // 引用类型的数字ID转换为URI
        return `<${column.options.referenceTarget}/${value}>`;
      } else {
        return value.toString();
      }
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

  // 主要的转换方法 - 从 SQL 对象转换为 SPARQL
  convert(sql: SQL): SPARQLQuery {
    const sqlString = sql.queryChunks.join('');
    
    if (sqlString.toLowerCase().includes('select')) {
      // 创建一个简化的 AST 并转换
      const ast = this.parseSelectAST(sql, null as any);
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

  // 解析 Drizzle SQL AST（这是关键部分）
  parseDrizzleAST(sql: SQL, table: PodTable): any {
    // 这里需要解析 Drizzle 的 SQL AST
    // Drizzle 的 SQL 对象包含查询的结构化信息
    
    const sqlString = sql.queryChunks.join('');
    // 注意：SQL 对象的实际结构可能不同，这里使用安全的属性访问
    const params = (sql as any).params || [];
    
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
  private parseSelectAST(sql: SQL, table: PodTable): any {
    // 解析 SELECT 查询的 AST
    return {
      type: 'select',
      columns: '*', // 简化处理
      where: this.parseWhereClause(sql)
    };
  }

  // 解析 INSERT AST
  private parseInsertAST(sql: SQL, table: PodTable): any {
    return {
      type: 'insert',
      values: (sql as any).params || [] // 插入的值
    };
  }

  // 解析 UPDATE AST
  private parseUpdateAST(sql: SQL, table: PodTable): any {
    return {
      type: 'update',
      set: {}, // 需要从 AST 中提取
      where: this.parseWhereClause(sql)
    };
  }

  // 解析 DELETE AST
  private parseDeleteAST(sql: SQL, table: PodTable): any {
    return {
      type: 'delete',
      where: this.parseWhereClause(sql)
    };
  }

  // 解析 WHERE 子句
  private parseWhereClause(sql: SQL): any {
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
