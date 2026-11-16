import type { ASTToSPARQLConverter, SPARQLQuery } from '../ast-to-sparql';
import type { SelectQueryPlan } from '../select-plan';
import type { ComunicaSPARQLExecutor } from '../sparql-executor';
import type { SPARQLQueryEngineFactory } from '../sparql-engine';
import type { UriResolver } from '../uri';
import { isSameOrigin } from '../utils/origin-auth';
import type { ResourceResolver } from '../resource-resolver';
import type { PodTable } from '../schema';
import {
  isOwnDirectoryMetadataRow,
  toExplicitMetadataGraphSpec,
  type DirectoryResourceMetadataLayout,
  type ExplicitMetadataGraphSpec,
} from '../resource-resolver/directory-layout';
import type { ExecutionStrategy, SelectExecutionOptions } from './types';

export interface SparqlStrategyDependencies {
  sparqlExecutor: ComunicaSPARQLExecutor;
  sparqlConverter: ASTToSPARQLConverter;
  sessionFetch: typeof fetch;
  podUrl: string;
  uriResolver: UriResolver;
  createQueryEngine?: SPARQLQueryEngineFactory;
  getResolver?: (table: PodTable) => ResourceResolver;
}

export class SparqlStrategy implements ExecutionStrategy {
  readonly mode = 'sparql' as const;

  private sparqlExecutor: ComunicaSPARQLExecutor;
  private sparqlConverter: ASTToSPARQLConverter;
  private podUrl: string;
  private uriResolver: UriResolver;
  private createQueryEngine?: SPARQLQueryEngineFactory;
  private getResolver?: (table: PodTable) => ResourceResolver;

  constructor(deps: SparqlStrategyDependencies) {
    this.sparqlExecutor = deps.sparqlExecutor;
    this.sparqlConverter = deps.sparqlConverter;
    this.podUrl = deps.podUrl;
    this.uriResolver = deps.uriResolver;
    this.createQueryEngine = deps.createQueryEngine;
    this.getResolver = deps.getResolver;
  }

  setPodUrl(podUrl: string): void {
    this.podUrl = podUrl;
  }

  private resolvePodResourceIri(value?: string): string | undefined {
    if (!value) return value;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;

    const podRoot = this.podUrl?.trim();
    if (!podRoot) return value;

    const normalizedPodRoot = podRoot.endsWith('/') ? podRoot : `${podRoot}/`;
    if (value.startsWith('/')) {
      return `${normalizedPodRoot.replace(/\/+$/, '')}${value}`;
    }

    try {
      return new URL(value, normalizedPodRoot).toString();
    } catch {
      return value;
    }
  }

  /**
   * Resolve the explicit metadata facet binding for a directory-resource
   * collection SELECT.
   *
   * Only collection reads take this path: exact-by-IRI reads and ordinary
   * document tables never receive a metadata binding. The collection base is
   * the table's canonical base resolved against the Pod root (never a
   * per-database endpoint), so the bounded namespace is stable across DBs.
   */
  private resolveExplicitMetadataGraph(
    table: PodTable,
    options?: SelectExecutionOptions,
  ): ExplicitMetadataGraphSpec | undefined {
    if (options?.exactResource) {
      return undefined;
    }
    const resolver = this.getResolver?.(table);
    if (!resolver?.resolveDirectoryMetadataLayout) {
      return undefined;
    }
    const collectionBase = this.resolvePodResourceIri(table.config?.base);
    if (!collectionBase) {
      return undefined;
    }
    const layout: DirectoryResourceMetadataLayout | null =
      resolver.resolveDirectoryMetadataLayout(table, collectionBase);
    return layout ? toExplicitMetadataGraphSpec(layout) : undefined;
  }

  /**
   * Keep only rows that came from this resource's own facet. The builder
   * already binds the graph, but the row guard is the correctness boundary:
   * foreign metadata about another IRI can never become a row.
   *
   * Only applies when the graph variable was actually projected. Grouped and
   * aggregate plans keep the binding in WHERE and do not project the graph, so
   * their result rows legitimately have no graph/subject bindings and must not
   * be discarded here.
   */
  private filterOwnMetadataRows(
    table: PodTable,
    rows: any[],
    metadataGraph: ExplicitMetadataGraphSpec | undefined,
  ): any[] {
    if (!metadataGraph) {
      return rows;
    }
    const resolver = this.getResolver?.(table);
    const collectionBase = this.resolvePodResourceIri(table.config?.base);
    const layout = resolver && collectionBase
      ? resolver.resolveDirectoryMetadataLayout(table, collectionBase)
      : null;
    if (!layout) {
      return rows;
    }
    return rows.filter((row) => isOwnDirectoryMetadataRow(
      layout,
      this.readBindingValue(row?.[metadataGraph.graphVariable]),
      this.readBindingValue(row?.subject),
    ));
  }

  /** Executors may hand back a plain value or a term-like `{ value }` object. */
  private readBindingValue(value: unknown): unknown {
    if (value && typeof value === 'object' && 'value' in (value as Record<string, unknown>)) {
      return (value as { value?: unknown }).value;
    }
    return value;
  }

  private resolveTargetGraph(table?: { config?: { base?: string; containerPath?: string }; getContainerPath?: () => string }, forSelect = false): string | undefined {
    if (!table) return undefined;

    const isDocumentMode = this.uriResolver.getResourceMode(table as any) === 'document';

    if (isDocumentMode) {
      if (forSelect) {
        return undefined;
      }
      return this.resolvePodResourceIri(table.config?.containerPath ?? table.getContainerPath?.());
    }

    return this.resolvePodResourceIri(table.config?.base);
  }

  async executeSelect(
    plan: SelectQueryPlan,
    _containerUrl: string,
    resourceUrl: string,
    options?: SelectExecutionOptions
  ): Promise<any[]> {
    const table = plan.baseTable;
    const targetGraph = this.resolveTargetGraph(table, true);
    // An exact-by-IRI select goes to the concrete document and never to a
    // collection endpoint, bound or table-level.
    const exactSourceUrl = options?.exactResource
      ? this.resolvePodResourceIri(options.exactResource)
      : undefined;
    // A per-database bound endpoint is authoritative for collection SELECT.
    // Never fall back to the (potentially broader) table-level endpoint.
    const configuredEndpoint = options?.boundEndpoint ?? table.getSparqlEndpoint?.();
    const sourceUrl = exactSourceUrl
      ?? this.resolvePodResourceIri(configuredEndpoint)
      ?? resourceUrl;
    const sourceType = exactSourceUrl
      ? 'auto'
      : options?.boundEndpoint || configuredEndpoint || sourceUrl.includes('/sparql')
      ? 'sparql'
      : 'auto';

    const extendedPlan = plan as SelectQueryPlan & {
      _sql?: unknown;
      _simpleSelectOptions?: unknown;
    };

    let sparqlQuery: SPARQLQuery;
    const allowGraphVariable = targetGraph !== undefined;
    // Only a collection SELECT over a directory-resource layout binds the
    // explicit metadata facet graph. Exact and ordinary reads stay unchanged.
    const metadataGraph = this.resolveExplicitMetadataGraph(table, options);

    if (extendedPlan._simpleSelectOptions) {
      sparqlQuery = this.sparqlConverter.convertSimpleSelect(extendedPlan._simpleSelectOptions as any, targetGraph, undefined, allowGraphVariable, metadataGraph);
    } else if (extendedPlan._sql && plan.baseTable) {
      const ast = this.sparqlConverter.parseDrizzleAST(extendedPlan._sql as any, plan.baseTable);
      sparqlQuery = this.sparqlConverter.convertSelect(ast, plan.baseTable, targetGraph, undefined, allowGraphVariable, metadataGraph);
    } else {
      sparqlQuery = this.sparqlConverter.convertSelectPlan(plan, targetGraph, undefined, allowGraphVariable, metadataGraph);
    }

    let rows: any[];
    if (isSameOrigin(sourceUrl, this.podUrl)) {
      rows = await this.sparqlExecutor.executeQueryWithSource(
        sparqlQuery,
        sourceUrl,
        sourceType
      );
    } else {
      const { ComunicaSPARQLExecutor } = await import('../sparql-executor');
      const unauthExecutor = new ComunicaSPARQLExecutor({
        sources: [sourceUrl],
        fetch: fetch,
        logging: false,
        createQueryEngine: this.createQueryEngine,
      });
      rows = await unauthExecutor.executeQueryWithSource(
        sparqlQuery,
        sourceUrl,
        sourceType
      );
    }

    const projectedMetadataGraph = sparqlQuery.metadataGraphVariable
      ? metadataGraph
      : undefined;
    return this.filterOwnMetadataRows(table, rows, projectedMetadataGraph);
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
