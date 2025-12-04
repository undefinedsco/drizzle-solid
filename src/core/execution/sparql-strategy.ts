/**
 * SPARQL Execution Strategy
 *
 * Implements ExecutionStrategy for SPARQL mode.
 * - All operations use direct SPARQL queries to an endpoint
 * - Supports both same-origin (authenticated) and cross-origin (unauthenticated) endpoints
 */

import type { ComunicaSPARQLExecutor } from '../sparql-executor';
import type { ASTToSPARQLConverter, SPARQLQuery } from '../ast-to-sparql';
import type { SelectQueryPlan } from '../select-plan';
import type {
  ExecutionStrategy,
  ExecutionResult,
  InsertQueryPlan,
  UpdateQueryPlan,
  DeleteQueryPlan
} from './types';
import { isSameOrigin, getFetchForOrigin } from '../utils/origin-auth';

export interface SparqlStrategyDependencies {
  sparqlExecutor: ComunicaSPARQLExecutor;
  sparqlConverter: ASTToSPARQLConverter;
  sessionFetch: typeof fetch;
  podUrl: string;
}

export class SparqlStrategy implements ExecutionStrategy {
  readonly mode = 'sparql' as const;

  private sparqlExecutor: ComunicaSPARQLExecutor;
  private sparqlConverter: ASTToSPARQLConverter;
  private sessionFetch: typeof fetch;
  private podUrl: string;

  constructor(deps: SparqlStrategyDependencies) {
    this.sparqlExecutor = deps.sparqlExecutor;
    this.sparqlConverter = deps.sparqlConverter;
    this.sessionFetch = deps.sessionFetch;
    this.podUrl = deps.podUrl;
  }

  /**
   * Get the appropriate fetch function for a SPARQL endpoint
   */
  private getFetchForEndpoint(endpoint: string): typeof fetch {
    return getFetchForOrigin(endpoint, this.podUrl, this.sessionFetch);
  }

  /**
   * Execute SELECT query via SPARQL endpoint
   */
  async executeSelect(
    plan: SelectQueryPlan,
    _containerUrl: string,
    resourceUrl: string // In SPARQL mode, this is the endpoint URL
  ): Promise<any[]> {
    // Convert plan to SPARQL - check for simple select options or SQL
    let sparqlQuery;
    const extendedPlan = plan as SelectQueryPlan & {
      _simpleSelectOptions?: {
        table: any;
        where?: Record<string, unknown>;
        limit?: number;
        offset?: number;
        orderBy?: Array<{ column: string; direction: 'asc' | 'desc' }>;
        distinct?: boolean;
      };
      _sql?: any;
    };

    if (extendedPlan._simpleSelectOptions) {
      // Use convertSimpleSelect for simple operations
      sparqlQuery = this.sparqlConverter.convertSimpleSelect(extendedPlan._simpleSelectOptions);
    } else if (extendedPlan._sql && plan.baseTable) {
      // Use convertSelect for SQL-based operations
      const ast = this.sparqlConverter.parseDrizzleAST(extendedPlan._sql, plan.baseTable);
      sparqlQuery = this.sparqlConverter.convertSelect(ast, plan.baseTable);
    } else {
      // Use convertSelectPlan for full plans
      sparqlQuery = this.sparqlConverter.convertSelectPlan(plan);
    }

    if (isSameOrigin(resourceUrl, this.podUrl)) {
      // Same origin: use authenticated executor
      return await this.sparqlExecutor.executeQueryWithSource(sparqlQuery, resourceUrl);
    } else {
      // Cross-origin: create an unauthenticated executor
      const { ComunicaSPARQLExecutor } = await import('../sparql-executor');
      const unauthExecutor = new ComunicaSPARQLExecutor({
        sources: [resourceUrl],
        fetch: fetch,
        logging: false
      });
      return await unauthExecutor.executeQueryWithSource(sparqlQuery, resourceUrl);
    }
  }

  /**
   * Execute INSERT operation via SPARQL UPDATE
   */
  async executeInsert(
    plan: InsertQueryPlan,
    _containerUrl: string,
    resourceUrl: string
  ): Promise<ExecutionResult[]> {
    const sparqlQuery = this.sparqlConverter.convertInsert(plan, plan.table);
    return await this.executeSparqlUpdate(resourceUrl, sparqlQuery);
  }

  /**
   * Execute UPDATE operation via SPARQL UPDATE
   */
  async executeUpdate(
    plan: UpdateQueryPlan,
    _containerUrl: string,
    resourceUrl: string
  ): Promise<ExecutionResult[]> {
    const sparqlQuery = this.sparqlConverter.convertUpdate(
      plan.data,
      plan.where,
      plan.table
    );
    return await this.executeSparqlUpdate(resourceUrl, sparqlQuery);
  }

  /**
   * Execute DELETE operation via SPARQL UPDATE
   */
  async executeDelete(
    plan: DeleteQueryPlan,
    _containerUrl: string,
    resourceUrl: string
  ): Promise<ExecutionResult[]> {
    const sparqlQuery = this.sparqlConverter.convertDelete(
      plan.where,
      plan.table
    );
    return await this.executeSparqlUpdate(resourceUrl, sparqlQuery);
  }

  /**
   * Execute a SPARQL UPDATE query against an endpoint
   */
  private async executeSparqlUpdate(
    endpoint: string,
    sparqlQuery: SPARQLQuery
  ): Promise<ExecutionResult[]> {
    const fetchFn = this.getFetchForEndpoint(endpoint);

    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sparql-update' },
      body: sparqlQuery.query
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return [{
        success: false,
        source: endpoint,
        status: response.status,
        via: 'sparql-endpoint',
        error: `${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`
      }];
    }

    return [{
      success: true,
      source: endpoint,
      status: response.status,
      via: 'sparql-endpoint'
    }];
  }
}
