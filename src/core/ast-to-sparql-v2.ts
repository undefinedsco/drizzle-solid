import * as sparqljs from 'sparqljs';
import { DataFactory } from 'n3';
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
  private generator: sparqljs.SparqlGenerator;
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

  private createVariable(name: string): sparqljs.VariableTerm {
    return DataFactory.variable(name) as sparqljs.VariableTerm;
  }

  private createNamedNode(value: string): sparqljs.IriTerm {
    return DataFactory.namedNode(value) as sparqljs.IriTerm;
  }

  private createLiteral(value: string, datatype?: string): sparqljs.LiteralTerm {
    if (datatype) {
      return DataFactory.literal(value, DataFactory.namedNode(datatype)) as sparqljs.LiteralTerm;
    }
    return DataFactory.literal(value) as sparqljs.LiteralTerm;
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
    const insertQuery: sparqljs.Update = {
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
    const updateQuery: sparqljs.Update = {
      type: 'update',
      prefixes: this.prefixes,
      updates: [{
        updateType: 'insertdelete',
        insert: [{
          type: 'bgp',
          triples: this.buildUpdateTriples(setData, table)
        }],
        delete: [{
          type: 'bgp',
          triples: this.buildDeleteTriples(setData, table)
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
    const deleteQuery: sparqljs.Update = {
      type: 'update',
      prefixes: this.prefixes,
      updates: [{
        updateType: 'insertdelete',
        insert: [],
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
      return Object.keys(table.columns)
        .filter(col => col !== 'id')
        .map(col => this.createVariable(col));
    }

    return (ast.columns as string[])
      .filter((col: string) => col !== 'id')
      .map((col: string) => this.createVariable(col));
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
        subject: this.createVariable('subject'),
        predicate: this.createNamedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
        object: this.createNamedNode(table.config.rdfClass)
      }]
    });

    // 添加属性模式（使用 OPTIONAL 处理可选属性）
    Object.entries(table.columns).forEach(([columnName, column]) => {
      if (columnName === 'id') return; // 跳过 id 字段

      const predicate = this.getPredicateForColumn(column, table);
      const triple: sparqljs.Triple = {
        subject: this.createVariable('subject'),
        predicate: this.createNamedNode(predicate),
        object: this.createVariable(columnName)
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
            this.createVariable('subject'),
            this.createNamedNode(resourceUri)
          ]
        }
      };
    }

    const columnVar = this.createVariable(columnName);

    let sparqlOperator: string;
    let args: sparqljs.Expression[];

    switch (operator) {
      case '=':
        sparqlOperator = '=';
        args = [columnVar, this.buildLiteralTerm(value) as sparqljs.Expression];
        break;
      case '!=':
        sparqlOperator = '!=';
        args = [columnVar, this.buildLiteralTerm(value) as sparqljs.Expression];
        break;
      case '>':
        sparqlOperator = '>';
        args = [columnVar, this.buildLiteralTerm(value) as sparqljs.Expression];
        break;
      case '<':
        sparqlOperator = '<';
        args = [columnVar, this.buildLiteralTerm(value) as sparqljs.Expression];
        break;
      case 'LIKE':
        sparqlOperator = 'regex';
        args = [
          columnVar,
          this.createLiteral(value.toString().replace(/%/g, '.*')),
          this.createLiteral('i')
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
      return this.createLiteral(value);
    }

    if (typeof value === 'number') {
      const datatype = Number.isInteger(value)
        ? 'http://www.w3.org/2001/XMLSchema#integer'
        : 'http://www.w3.org/2001/XMLSchema#decimal';
      return this.createLiteral(value.toString(), datatype);
    }

    if (typeof value === 'boolean') {
      return this.createLiteral(value.toString(), 'http://www.w3.org/2001/XMLSchema#boolean');
    }

    if (value instanceof Date) {
      return this.createLiteral(value.toISOString(), 'http://www.w3.org/2001/XMLSchema#dateTime');
    }

    return this.createLiteral(String(value));
  }

  /**
   * 构建 INSERT 三元组
   */
  private buildInsertTriples(values: any[], table: PodTable): sparqljs.Triple[] {
    const triples: sparqljs.Triple[] = [];

    for (const record of values) {
      const subjectUri = this.generateSubjectUri(record, table);
      const subject = this.createNamedNode(subjectUri);

      // 添加类型三元组
      triples.push({
        subject,
        predicate: this.createNamedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
        object: this.createNamedNode(table.config.rdfClass)
      });

      // 添加属性三元组
      Object.entries(record).forEach(([columnName, value]) => {
        if (columnName === 'id' || value === undefined || value === null) return;

        const column = table.columns[columnName];
        if (!column) return;

        const predicate = this.getPredicateForColumn(column, table);
        triples.push({
          subject,
          predicate: this.createNamedNode(predicate),
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
    const subject = this.createVariable('subject');

    Object.keys(setData).forEach(columnName => {
      const column = table.columns[columnName];
      if (!column) return;

      const predicate = this.getPredicateForColumn(column, table);
      triples.push({
        subject,
        predicate: this.createNamedNode(predicate),
        object: this.createVariable(`old_${columnName}`)
      });
    });

    return triples;
  }

  /**
   * 构建更新三元组
   */
  private buildUpdateTriples(setData: any, table: PodTable): sparqljs.Triple[] {
    const triples: sparqljs.Triple[] = [];
    const subject = this.createVariable('subject');

    Object.entries(setData).forEach(([columnName, value]) => {
      const column = table.columns[columnName];
      if (!column) return;

      const predicate = this.getPredicateForColumn(column, table);
      triples.push({
        subject,
        predicate: this.createNamedNode(predicate),
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
    const subject = this.createVariable('subject');

    // 类型三元组
    triples.push({
      subject,
      predicate: this.createNamedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
      object: this.createNamedNode(table.config.rdfClass)
    });

    // 属性三元组
    Object.entries(table.columns).forEach(([columnName, column]) => {
      if (columnName === 'id') return;

      const predicate = this.getPredicateForColumn(column, table);
      triples.push({
        subject,
        predicate: this.createNamedNode(predicate),
        object: this.createVariable(columnName)
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
