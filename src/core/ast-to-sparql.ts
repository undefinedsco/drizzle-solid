import { SQL } from 'drizzle-orm';
import { PodTable } from './pod-table';
import { SelectBuilder } from './sparql/builder/select-builder';
import { UpdateBuilder } from './sparql/builder/update-builder';
import { SPARQLQuery } from './sparql/types';
import { SelectQueryPlan } from './select-plan';
import { getPredicateForColumn, formatValue, generateSubjectUri } from './sparql/helpers';
import { ExpressionBuilder } from './sparql/builder/expression-builder';
import { QueryCondition } from './query-conditions';
import type { UriResolver } from './uri';
import { UriResolverImpl } from './uri';

export type { SPARQLQuery };

/**
 * Table registry context for URI resolution
 */
export interface TableRegistryContext {
  tableRegistry: Map<string, PodTable[]>;
  tableNameRegistry: Map<string, PodTable>;
  baseUri?: string;
}

export class ASTToSPARQLConverter {
  private selectBuilder: SelectBuilder;
  private updateBuilder: UpdateBuilder;
  private expressionBuilder: ExpressionBuilder;
  private tableContext?: TableRegistryContext;
  private uriResolver: UriResolver;
  private prefixes: Record<string, string> = {
    'rdf': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    'rdfs': 'http://www.w3.org/2000/01/rdf-schema#',
    'schema': 'https://schema.org/',
    'foaf': 'http://xmlns.com/foaf/0.1/',
    'dc': 'http://purl.org/dc/terms/',
    'solid': 'http://www.w3.org/ns/solid/terms#',
    'ldp': 'http://www.w3.org/ns/ldp#',
    'xsd': 'http://www.w3.org/2001/XMLSchema#'
  };

  constructor(private podUrl: string, private webId?: string, uriResolver?: UriResolver) {
    this.uriResolver = uriResolver ?? new UriResolverImpl(podUrl);
    this.selectBuilder = new SelectBuilder(this.prefixes, this.uriResolver);
    this.updateBuilder = new UpdateBuilder(this.prefixes, this.uriResolver);
    this.expressionBuilder = new ExpressionBuilder(this.uriResolver);
  }

  /**
   * Set table registry for URI reference resolution
   */
  setTableRegistry(
    tableRegistry: Map<string, PodTable[]>,
    tableNameRegistry: Map<string, PodTable>,
    baseUri?: string
  ): void {
    this.tableContext = { tableRegistry, tableNameRegistry, baseUri };
    this.selectBuilder.setTableContext(this.tableContext);
    this.expressionBuilder.setTableContext(this.tableContext);
    this.updateBuilder.setTableContext(this.tableContext);
  }

  convertSelect(ast: any, table: PodTable, targetGraph?: string, fromSources?: string[], allowGraphVariable = true): SPARQLQuery {
    return this.selectBuilder.convertSelect(ast, table, targetGraph, fromSources, allowGraphVariable);
  }

  buildWhereClauseForCondition(whereAst: any, table: PodTable): string {
    return this.expressionBuilder.buildWhereClause(whereAst as QueryCondition, table);
  }

  convertSelectPlan(plan: SelectQueryPlan, targetGraph?: string, fromSources?: string[], allowGraphVariable = true): SPARQLQuery {
    return this.selectBuilder.convertSelectPlan(plan, targetGraph, fromSources, allowGraphVariable);
  }

  convertSimpleSelect(operation: {
    table: PodTable;
    where?: Record<string, unknown>;
    limit?: number;
    offset?: number;
    orderBy?: Array<{ column: string; direction: 'asc' | 'desc' }>;
    distinct?: boolean;
  }, targetGraph?: string, fromSources?: string[], allowGraphVariable = true): SPARQLQuery {
    return this.selectBuilder.convertSimpleSelect(operation, targetGraph, fromSources, allowGraphVariable);
  }

  convertInsert(valuesOrPlan: any[] | { table: PodTable; rows: any[] }, table?: PodTable, targetGraph?: string): SPARQLQuery {
    return this.updateBuilder.convertInsert(valuesOrPlan, table, targetGraph);
  }

  convertUpdate(setData: any, whereConditions: any, table: PodTable, targetGraph?: string): SPARQLQuery {
    return this.updateBuilder.convertUpdate(setData, whereConditions, table, targetGraph);
  }

  convertDelete(whereConditions: any, table: PodTable, targetGraph?: string): SPARQLQuery {
    return this.updateBuilder.convertDelete(whereConditions, table, targetGraph);
  }

  getPrefixes(): Record<string, string> {
    return this.prefixes;
  }

  addPrefix(prefix: string, uri: string): void {
    this.prefixes[prefix] = uri;
    // Re-instantiate builders to propagate prefixes if necessary, 
    // or make builders reference this.prefixes object (passed by reference).
    // Since we passed object ref in constructor, it should update automatically 
    // if we mutate the object.
  }

  // Legacy / Helper methods exposed for other modules
  
  getPredicateForColumnPublic(column: any, table: PodTable): string {
    return getPredicateForColumn(column, table);
  }

  formatLiteralValue(value: any, column?: any): string | string[] {
    return formatValue(value, column);
  }

  generateSubjectUri(record: any, table: PodTable): string {
    return generateSubjectUri(record, table, this.uriResolver);
  }

  /**
   * @deprecated Use parseDrizzleAST() + convertSelect() with table context instead
   * Direct SQL conversion without table context is limited and may not work correctly
   */
  convert(sql: SQL): SPARQLQuery {
    const sqlString = sql.queryChunks.join('');

    if (sqlString.toLowerCase().includes('select')) {
      return this.convertSelect({
        select: undefined,
        columns: '*',
        where: this.parseWhereClause(sql)
      }, {} as any);
    }

    throw new Error(`Direct SQL conversion without table context is limited: ${sqlString}`);
  }

  parseDrizzleAST(sql: SQL, table: PodTable): any {
    // Basic placeholder
    return {
      type: 'select',
      columns: '*',
      where: this.parseWhereClause(sql)
    };
  }

  private parseWhereClause(sql: SQL): any {
    // Placeholder for AST parsing
    return {};
  }
}
