import type { ASTToSPARQLConverter, SPARQLQuery } from '../ast-to-sparql';
import type { SelectQueryPlan } from '../select-plan';
import type { ComunicaSPARQLExecutor } from '../sparql-executor';
import type { SPARQLQueryEngineFactory } from '../sparql-engine';
import type { UriResolver } from '../uri';
import { isSameOrigin } from '../utils/origin-auth';
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
  private podUrl: string;
  private uriResolver: UriResolver;
  private createQueryEngine?: SPARQLQueryEngineFactory;

  constructor(deps: SparqlStrategyDependencies) {
    this.sparqlExecutor = deps.sparqlExecutor;
    this.sparqlConverter = deps.sparqlConverter;
    this.podUrl = deps.podUrl;
    this.uriResolver = deps.uriResolver;
    this.createQueryEngine = deps.createQueryEngine;
  }

  setPodUrl(podUrl: string): void {
    this.podUrl = podUrl;
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
    const allowGraphVariable = targetGraph !== undefined;

    if (extendedPlan._simpleSelectOptions) {
      sparqlQuery = this.sparqlConverter.convertSimpleSelect(extendedPlan._simpleSelectOptions as any, targetGraph, undefined, allowGraphVariable);
    } else if (extendedPlan._sql && plan.baseTable) {
      const ast = this.sparqlConverter.parseDrizzleAST(extendedPlan._sql as any, plan.baseTable);
      sparqlQuery = this.sparqlConverter.convertSelect(ast, plan.baseTable, targetGraph, undefined, allowGraphVariable);
    } else {
      sparqlQuery = this.sparqlConverter.convertSelectPlan(plan, targetGraph, undefined, allowGraphVariable);
    }

    if (isSameOrigin(resourceUrl, this.podUrl)) {
      return await this.sparqlExecutor.executeQueryWithSource(
        sparqlQuery,
        resourceUrl,
        resourceUrl.includes('/sparql') ? 'sparql' : 'auto'
      );
    }

    const { ComunicaSPARQLExecutor } = await import('../sparql-executor');
    const unauthExecutor = new ComunicaSPARQLExecutor({
      sources: [resourceUrl],
      fetch: fetch,
      logging: false,
      createQueryEngine: this.createQueryEngine,
    });
    return await unauthExecutor.executeQueryWithSource(
      sparqlQuery,
      resourceUrl,
      resourceUrl.includes('/sparql') ? 'sparql' : 'auto'
    );
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

}
