import type { ASTToSPARQLConverter, SPARQLQuery } from '../ast-to-sparql';
import type { SelectQueryPlan } from '../select-plan';
import type { ComunicaSPARQLExecutor } from '../sparql-executor';
import type { SPARQLQueryEngineFactory } from '../sparql-engine';
import type { UriResolver } from '../uri';
import { isSameOrigin, getFetchForOrigin } from '../utils/origin-auth';
import type { ExecutionStrategy } from './types';

export interface SparqlStrategyDependencies {
  sparqlExecutor: ComunicaSPARQLExecutor;
  sparqlConverter: ASTToSPARQLConverter;
  sessionFetch: typeof fetch;
  podUrl: string;
  uriResolver: UriResolver;
  createQueryEngine?: SPARQLQueryEngineFactory;
}

export class SparqlStrategy implements ExecutionStrategy {
  readonly mode = 'sparql' as const;

  private sparqlExecutor: ComunicaSPARQLExecutor;
  private sparqlConverter: ASTToSPARQLConverter;
  private sessionFetch: typeof fetch;
  private podUrl: string;
  private uriResolver: UriResolver;
  private createQueryEngine?: SPARQLQueryEngineFactory;

  constructor(deps: SparqlStrategyDependencies) {
    this.sparqlExecutor = deps.sparqlExecutor;
    this.sparqlConverter = deps.sparqlConverter;
    this.sessionFetch = deps.sessionFetch;
    this.podUrl = deps.podUrl;
    this.uriResolver = deps.uriResolver;
    this.createQueryEngine = deps.createQueryEngine;
  }

  private resolveTargetGraph(table?: { config?: { base?: string; containerPath?: string }; getContainerPath?: () => string }, forSelect = false): string | undefined {
    if (!table) return undefined;

    const isDocumentMode = this.uriResolver.getResourceMode(table as any) === 'document';

    if (isDocumentMode) {
      if (forSelect) {
        return undefined;
      }
      return table.config?.containerPath ?? table.getContainerPath?.();
    }

    return table.config?.base;
  }

  private getFetchForEndpoint(endpoint: string): typeof fetch {
    return getFetchForOrigin(endpoint, this.podUrl, this.sessionFetch);
  }

  async executeSelect(
    plan: SelectQueryPlan,
    _containerUrl: string,
    resourceUrl: string
  ): Promise<any[]> {
    const table = plan.baseTable;
    const targetGraph = this.resolveTargetGraph(table, true);

    const extendedPlan = plan as SelectQueryPlan & {
      _sql?: unknown;
      _simpleSelectOptions?: unknown;
    };

    let sparqlQuery: SPARQLQuery;
    const useGraphVariable = targetGraph !== undefined;

    if (extendedPlan._simpleSelectOptions) {
      sparqlQuery = this.sparqlConverter.convertSimpleSelect(extendedPlan._simpleSelectOptions as any, targetGraph, undefined, useGraphVariable);
    } else if (extendedPlan._sql && plan.baseTable) {
      const ast = this.sparqlConverter.parseDrizzleAST(extendedPlan._sql as any, plan.baseTable);
      sparqlQuery = this.sparqlConverter.convertSelect(ast, plan.baseTable, targetGraph, undefined, useGraphVariable);
    } else {
      sparqlQuery = this.sparqlConverter.convertSelectPlan(plan, targetGraph, undefined, useGraphVariable);
    }

    console.log('DEBUG: Generated SPARQL Query for SELECT:', sparqlQuery.query);
    console.log('DEBUG: resourceUrl =', resourceUrl);

    if (resourceUrl.includes('/-/sparql')) {
      return await this.executeDirectSparqlSelect(resourceUrl, sparqlQuery, plan);
    }

    if (isSameOrigin(resourceUrl, this.podUrl)) {
      return await this.sparqlExecutor.executeQueryWithSource(sparqlQuery, resourceUrl);
    }

    const { ComunicaSPARQLExecutor } = await import('../sparql-executor');
    const unauthExecutor = new ComunicaSPARQLExecutor({
      sources: [resourceUrl],
      fetch: fetch,
      logging: false,
      createQueryEngine: this.createQueryEngine,
    });
    return await unauthExecutor.executeQueryWithSource(sparqlQuery, resourceUrl);
  }

  private async executeDirectSparqlSelect(
    endpoint: string,
    sparqlQuery: SPARQLQuery,
    plan: SelectQueryPlan
  ): Promise<any[]> {
    const fetchFn = this.getFetchForEndpoint(endpoint);

    console.log('[SparqlStrategy] Direct fetch to SPARQL endpoint:', endpoint);

    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sparql-query',
        'Accept': 'application/sparql-results+json'
      },
      body: sparqlQuery.query
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`SPARQL SELECT failed: ${response.status} ${response.statusText} - ${text}`);
    }

    const json = await response.json();

    const rows = (json.results?.bindings || []).map((binding: any) => {
      const row: Record<string, any> = {};
      for (const [key, value] of Object.entries(binding)) {
        row[key] = this.parseSparqlValue(value as any);
      }
      return row;
    });

    if (plan.limit !== undefined && rows.length > plan.limit) {
      return rows.slice(0, plan.limit);
    }

    return rows;
  }

  async executeInsert(): Promise<any[]> {
    throw new Error('SPARQL mode INSERT is not supported directly; writes should route through LDP strategy');
  }

  async executeUpdate(): Promise<any[]> {
    throw new Error('SPARQL mode UPDATE is not supported directly; writes should route through LDP strategy');
  }

  async executeDelete(): Promise<any[]> {
    throw new Error('SPARQL mode DELETE is not supported directly; writes should route through LDP strategy');
  }

  private parseSparqlValue(value: any): any {
    if (!value || typeof value !== 'object') {
      return value;
    }

    if (value.type === 'uri') {
      return value.value;
    }

    if (value.type === 'literal') {
      if (value.datatype?.includes('#integer') || value.datatype?.includes('#int')) {
        return Number.parseInt(value.value, 10);
      }
      if (value.datatype?.includes('#decimal') || value.datatype?.includes('#double')) {
        return Number.parseFloat(value.value);
      }
      if (value.datatype?.includes('#boolean')) {
        return value.value === 'true';
      }
      return value.value;
    }

    return value.value ?? value;
  }
}
