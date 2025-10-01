import * as sparqljs from 'sparqljs';
import { PodTable } from './pod-table';

// SPARQL 查询类型
export interface SPARQLQuery {
  type: 'SELECT' | 'INSERT' | 'DELETE' | 'UPDATE';
  query: string;
  prefixes: Record<string, string>;
}

/**
 * 使用 sparqljs 的 AST 转 SPARQL 转换器
 * 相比手动拼接字符串，这种方式更安全、更可维护
 */
export class SparqlJSConverter {
  private generator: sparqljs.Generator;
  private podUrl: string;
  private webId: string;
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
    this.podUrl = podUrl;
    this.webId = webId || '';
    this.generator = new sparqljs.Generator();
  }

  /**
   * 转换 SELECT 查询
   */
  convertSelect(ast: any, table: PodTable): SPARQLQuery {
    const selectQuery: sparqljs.SelectQuery = {
      queryType: 'SELECT',
      variables: this.buildSelectVariables(ast, table),
      where: this.buildWherePatterns(ast, table),
      type: 'query',
      prefixes: this.prefixes
    };

    return {
      type: 'SELECT',
      query: this.generator.stringify(selectQuery),
      prefixes: this.prefixes
    };
  }

  /**
   * 转换 INSERT 查询
   */
  convertInsert(values: any[], table: PodTable): SPARQLQuery {
    const insertQuery: sparqljs.UpdateQuery = {
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

  /**
   * 转换 UPDATE 查询
   */
  convertUpdate(setData: any, whereConditions: any, table: PodTable): SPARQLQuery {
    const updateQuery: sparqljs.UpdateQuery = {
      type: 'update',
      prefixes: this.prefixes,
      updates: [{
        updateType: 'deletewhere', // 使用 DELETE/INSERT WHERE 模式
        delete: [{
          type: 'bgp',
          triples: this.buildDeleteTriples(setData, table)
        }],
        insert: [{
          type: 'bgp',
          triples: this.buildUpdateTriples(setData, table)
        }],
        where: this.buildWherePatterns({ where: whereConditions }, table)
      }]
    };

    return {
      type: 'UPDATE',
      query: this.generator.stringify(updateQuery),
      prefixes: this.prefixes
    };
  }

  /**
   * 转换 DELETE 查询
   */
  convertDelete(whereConditions: any, table: PodTable): SPARQLQuery {
    const deleteQuery: sparqljs.UpdateQuery = {
      type: 'update',
      prefixes: this.prefixes,
      updates: [{
        updateType: 'delete',
        delete: [{
          type: 'bgp',
          triples: this.buildAllTriples(table)
        }],
        where: this.buildWherePatterns({ where: whereConditions }, table)
      }]
    };

    return {
      type: 'DELETE',
      query: this.generator.stringify(deleteQuery),
      prefixes: this.prefixes
    };
  }

  /**
   * 构建 SELECT 变量
   */
  private buildSelectVariables(ast: any, table: PodTable): sparqljs.Variable[] {
    if (ast.columns === '*' || !ast.columns) {
      // SELECT * - 返回所有列变量（除了id）
      return Object.keys(table.columns)
        .filter(col => col !== 'id')
        .map(col => ({ termType: 'Variable', value: col }));
    }
    
    // 指定列
    return ast.columns
      .filter((col: string) => col !== 'id')
      .map((col: string) => ({ termType: 'Variable', value: col }));
  }

  /**
   * 构建 WHERE 模式
   */
  private buildWherePatterns(ast: any, table: PodTable): sparqljs.Pattern[] {
    const patterns: sparqljs.Pattern[] = [];

    // 添加类型约束
    patterns.push({
      type: 'bgp',
      triples: [{
        subject: { termType: 'Variable', value: 'subject' },
        predicate: { termType: 'NamedNode', value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' },
        object: { termType: 'NamedNode', value: table.config.rdfClass }
      }]
    });

    // 添加属性模式（使用 OPTIONAL 处理可选属性）
    Object.entries(table.columns).forEach(([columnName, column]) => {
      if (columnName === 'id') return; // 跳过 id 字段

      const predicate = this.getPredicateForColumn(column, table);
      const triple: sparqljs.Triple = {
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

  /**
   * 构建过滤器模式
   */
  private buildFilterPatterns(whereConditions: any, table: PodTable): sparqljs.Pattern[] {
    const patterns: sparqljs.Pattern[] = [];

    if (whereConditions.type === 'binary_expr') {
      const { left, operator, right } = whereConditions;
      const filter = this.buildFilterExpression(left.column, operator, right.value, table);
      if (filter) {
        patterns.push(filter);
      }
    } else if (typeof whereConditions === 'object' && whereConditions !== null) {
      // 处理对象形式的 WHERE 条件
      Object.entries(whereConditions).forEach(([columnName, value]) => {
        const filter = this.buildFilterExpression(columnName, '=', value, table);
        if (filter) {
          patterns.push(filter);
        }
      });
    }

    return patterns;
  }

  /**
   * 构建过滤器表达式
   */
  private buildFilterExpression(
    columnName: string, 
    operator: string, 
    value: any, 
    table: PodTable
  ): sparqljs.Pattern | null {
    // 特殊处理 id 字段
    if (columnName === 'id') {
      const resourceUri = this.generateSubjectUri({ id: value }, table);
      return {
        type: 'filter',
        expression: {
          type: 'operation',
          operator: '=',
          args: [
            { termType: 'Variable', value: 'subject' },
            { termType: 'NamedNode', value: resourceUri }
          ]
        }
      };
    }

    // 构建操作符表达式
    let sparqlOperator: string;
    let args: sparqljs.Expression[];

    switch (operator) {
      case '=':
        sparqlOperator = '=';
        args = [
          { termType: 'Variable', value: columnName },
          this.buildLiteralTerm(value)
        ];
        break;
      case '!=':
        sparqlOperator = '!=';
        args = [
          { termType: 'Variable', value: columnName },
          this.buildLiteralTerm(value)
        ];
        break;
      case '>':
        sparqlOperator = '>';
        args = [
          { termType: 'Variable', value: columnName },
          this.buildLiteralTerm(value)
        ];
        break;
      case '<':
        sparqlOperator = '<';
        args = [
          { termType: 'Variable', value: columnName },
          this.buildLiteralTerm(value)
        ];
        break;
      case 'LIKE':
        sparqlOperator = 'regex';
        args = [
          { termType: 'Variable', value: columnName },
          { termType: 'Literal', value: value.toString().replace(/%/g, '.*') }
        ];
        break;
      default:
        return null;
    }

    return {
      type: 'filter',
      expression: {
        type: 'operation',
        operator: sparqlOperator,
        args
      }
    };
  }

  /**
   * 构建字面量项
   */
  private buildLiteralTerm(value: any): sparqljs.Term {
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

  /**
   * 构建 INSERT 三元组
   */
  private buildInsertTriples(values: any[], table: PodTable): sparqljs.Triple[] {
    const triples: sparqljs.Triple[] = [];

    for (const record of values) {
      const subjectUri = this.generateSubjectUri(record, table);
      const subject: sparqljs.Term = { termType: 'NamedNode', value: subjectUri };

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

  /**
   * 构建删除三元组（用于 UPDATE）
   */
  private buildDeleteTriples(setData: any, table: PodTable): sparqljs.Triple[] {
    const triples: sparqljs.Triple[] = [];
    const subject: sparqljs.Term = { termType: 'Variable', value: 'subject' };

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

  /**
   * 构建更新三元组
   */
  private buildUpdateTriples(setData: any, table: PodTable): sparqljs.Triple[] {
    const triples: sparqljs.Triple[] = [];
    const subject: sparqljs.Term = { termType: 'Variable', value: 'subject' };

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

  /**
   * 构建所有三元组（用于 DELETE）
   */
  private buildAllTriples(table: PodTable): sparqljs.Triple[] {
    const triples: sparqljs.Triple[] = [];
    const subject: sparqljs.Term = { termType: 'Variable', value: 'subject' };

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

  /**
   * 获取列的谓词
   */
  private getPredicateForColumn(column: any, table: PodTable): string {
    return column.getPredicate(table.config.namespace);
  }

  /**
   * 生成主体 URI
   */
  private generateSubjectUri(record: any, table: PodTable): string {
    const userPath = this.extractUserPathFromWebId();
    const containerPath = table.config.containerPath || '/data/';
    const fullContainerPath = containerPath.startsWith(userPath) ? 
      containerPath : 
      userPath + containerPath.replace(/^\//, '');
    
    const id = record.id || Date.now();
    return `${this.podUrl}${fullContainerPath}#${id}`;
  }

  /**
   * 从 webId 中提取用户路径
   */
  private extractUserPathFromWebId(): string {
    if (!this.webId) {
      throw new Error('WebID is not set');
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

  /**
   * 添加自定义前缀
   */
  addPrefix(prefix: string, uri: string): void {
    this.prefixes[prefix] = uri;
  }

  /**
   * 获取前缀
   */
  getPrefixes(): Record<string, string> {
    return this.prefixes;
  }
}