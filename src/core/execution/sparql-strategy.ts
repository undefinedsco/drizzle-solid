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
import type { UriResolver } from '../uri';

export interface SparqlStrategyDependencies {
  sparqlExecutor: ComunicaSPARQLExecutor;
  sparqlConverter: ASTToSPARQLConverter;
  sessionFetch: typeof fetch;
  podUrl: string;
  uriResolver: UriResolver;
}

export class SparqlStrategy implements ExecutionStrategy {
  readonly mode = 'sparql' as const;

  private sparqlExecutor: ComunicaSPARQLExecutor;
  private sparqlConverter: ASTToSPARQLConverter;
  private sessionFetch: typeof fetch;
  private podUrl: string;
  private uriResolver: UriResolver;

  constructor(deps: SparqlStrategyDependencies) {
    this.sparqlExecutor = deps.sparqlExecutor;
    this.sparqlConverter = deps.sparqlConverter;
    this.sessionFetch = deps.sessionFetch;
    this.podUrl = deps.podUrl;
    this.uriResolver = deps.uriResolver;
  }

  /**
   * Resolve target graph based on resource mode
   * - Document Mode SELECT: undefined (let CSS auto-query container and all sub-graphs)
   * - Document Mode INSERT/UPDATE/DELETE: container path as graph
   * - Fragment Mode: base file path
   */
  private resolveTargetGraph(table?: { config?: { base?: string; containerPath?: string }; getContainerPath?: () => string }, forSelect = false): string | undefined {
    if (!table) return undefined;
    
    // Determine resource mode to choose correct graph
    const isDocumentMode = this.uriResolver.getResourceMode(table as any) === 'document';
    
    if (isDocumentMode) {
      // Document Mode:
      // - For SELECT: no graph specified (CSS will auto-query container and all sub-graphs)
      // - For INSERT/UPDATE/DELETE: use container path as graph
      if (forSelect) {
        return undefined; // Let CSS use default behavior
      }
      return table.config?.containerPath ?? table.getContainerPath?.();
    }
    
    // Fragment Mode: graph = base file
    // e.g., /data/tags.ttl (all fragments in this file share the same graph)
    return table.config?.base;
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
    const table = plan.baseTable;
    
    // Determine target graph based on resource mode
    // - Document Mode: no graph (CSS will auto-query container and all sub-graphs)
    // - Fragment Mode: graph = base file
    const targetGraph = this.resolveTargetGraph(table, true /* forSelect */);

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

    // Pass `true` for `includeGraph` to ensure the graph is included if targetGraph is defined.
    // The SparqlConverter will handle the specific syntax (FROM/GRAPH).
    if (extendedPlan._simpleSelectOptions) {
      sparqlQuery = this.sparqlConverter.convertSimpleSelect(extendedPlan._simpleSelectOptions, targetGraph, undefined, true);
    } else if (extendedPlan._sql && plan.baseTable) {
      const ast = this.sparqlConverter.parseDrizzleAST(extendedPlan._sql, plan.baseTable);
      sparqlQuery = this.sparqlConverter.convertSelect(ast, plan.baseTable, targetGraph, undefined, true);
    } else {
      sparqlQuery = this.sparqlConverter.convertSelectPlan(plan, targetGraph, undefined, true);
    }

    console.log('DEBUG: Generated SPARQL Query for SELECT:', sparqlQuery.query);

    if (isSameOrigin(resourceUrl, this.podUrl)) {
      return await this.sparqlExecutor.executeQueryWithSource(sparqlQuery, resourceUrl);
    } else {
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
   * 
   * @deprecated This method is not called in SPARQL-as-LDP-enhancement mode.
   * All write operations are routed to LdpStrategy for Solid Notifications compatibility.
   * Kept for potential future use (e.g., pure SPARQL mode).
   * @see LdpStrategy.executeInsert for the active implementation
   */
  async executeInsert(
    plan: InsertQueryPlan,
    _containerUrl: string,
    resourceUrl: string
  ): Promise<ExecutionResult[]> {
    const table = plan.table;
    const targetGraph = this.resolveTargetGraph(table);

    // targetGraph is now resolved for both Document Mode (base container) and Fragment Mode (base file)
    // Safety check: ensure targetGraph is resolved
    if (!targetGraph) {
        throw new Error('INSERT operation in SPARQL mode requires a target graph. Ensure table.config.base is set.');
    }

    const sparqlQuery = this.sparqlConverter.convertInsert(plan, table, targetGraph);
    return await this.executeSparqlUpdate(resourceUrl, sparqlQuery, table.config.containerPath);
  }

  /**
   * Execute UPDATE operation via SPARQL UPDATE
   * 
   * @deprecated This method is not called in SPARQL-as-LDP-enhancement mode.
   * All write operations are routed to LdpStrategy for Solid Notifications compatibility.
   * Kept for potential future use (e.g., pure SPARQL mode).
   * @see LdpStrategy.executeUpdate for the active implementation
   */
  async executeUpdate(
    plan: UpdateQueryPlan,
    _containerUrl: string,
    resourceUrl: string
  ): Promise<ExecutionResult[]> {
    const table = plan.table;
    const targetGraph = this.resolveTargetGraph(table);
    
    if (!targetGraph) {
        throw new Error('UPDATE operation in SPARQL mode requires a target graph. Ensure table.config.base is set.');
    }
    
    const sparqlQuery = this.sparqlConverter.convertUpdate(
      plan.data,
      plan.where,
      table,
      targetGraph
    );
    return await this.executeSparqlUpdate(resourceUrl, sparqlQuery, table.config.containerPath);
  }

  /**
   * Execute DELETE operation via SPARQL UPDATE
   * 
   * @deprecated This method is not called in SPARQL-as-LDP-enhancement mode.
   * All write operations are routed to LdpStrategy for Solid Notifications compatibility.
   * Kept for potential future use (e.g., pure SPARQL mode).
   * @see LdpStrategy.executeDelete for the active implementation
   */
  async executeDelete(
    plan: DeleteQueryPlan,
    _containerUrl: string,
    resourceUrl: string
  ): Promise<ExecutionResult[]> {
    const table = plan.table;
    const targetGraph = this.resolveTargetGraph(table);
    
    if (!targetGraph) {
        throw new Error('DELETE operation in SPARQL mode requires a target graph. Ensure table.config.base is set.');
    }
    
    const sparqlQuery = this.sparqlConverter.convertDelete(
      plan.where,
      table,
      targetGraph
    );
    return await this.executeSparqlUpdate(resourceUrl, sparqlQuery, table.config.containerPath);
  }

  /**
   * Execute a SPARQL UPDATE query against an endpoint
   */
  private async executeSparqlUpdate(
    endpoint: string,
    sparqlQuery: SPARQLQuery,
    containerUri?: string
  ): Promise<ExecutionResult[]> {
    const fetchFn = this.getFetchForEndpoint(endpoint);

    // DEBUG: 打印生成的 SPARQL
    console.log('[SparqlStrategy] Executing Update:', sparqlQuery.query);

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

    // 更新成功后使缓存失效，避免后续查询命中旧数据
    await this.sparqlExecutor.invalidateHttpCache(endpoint).catch(() => undefined);
    if (containerUri) {
      console.log('DEBUG: Invalidating container cache for:', containerUri);
      await this.sparqlExecutor.invalidateHttpCache(containerUri).catch(() => undefined);
    }
    await this.sparqlExecutor.invalidateHttpCache(undefined as any).catch(() => undefined); // Invalidate all caches as a fallback

    return [{
      success: true,
      source: endpoint,
      status: response.status,
      via: 'sparql-endpoint'
    }];
  }
}
