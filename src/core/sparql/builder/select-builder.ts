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
      orderBy: orderByDescriptors,
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
      'PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>'
    ];

    const columnPredicates = new Map<string, string>();
    let filteredByIdentifier = false;

    // 为每个列生成变量和模式
    Object.keys(table.columns).forEach(columnName => {
      const column = table.columns[columnName];
      let predicate = getPredicateForColumn(column, table);

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
              
              const baseResource = (table as any).getResourcePath?.() || table.config.base || table.getContainerPath();
              // Note: This part is simplified compared to SubjectResolver logic
              return `<${trimmed}>`; 
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
          .map((value) => formatValue(value)) // Use shared formatValue
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

    const skipColumns = new Set(['subject']);

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

    // 仅当 id 使用 @id（未绑定谓词）时，绑定 fragment 为 ?id 便于过滤
    const idColumn = (table.columns as Record<string, PodColumnBase | undefined>)['id'];
    if (idColumn) {
      const idPredicate = getPredicateForColumn(idColumn, table);
      if (idPredicate === '@id') {
        patterns.push({
          type: 'bind',
          variable: { termType: 'Variable', value: 'id' } as any,
          expression: {
            type: 'operation',
            operator: 'strafter',
            args: [
              { type: 'operation', operator: 'str', args: [{ termType: 'Variable', value: 'subject' } as any] },
              { termType: 'Literal', value: '#' } as any
            ]
          }
        } as any);
      }
    }

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

    return patterns;
  }
}
