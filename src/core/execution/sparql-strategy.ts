import type { ComunicaSPARQLExecutor } from '../sparql-executor';
import type { ASTToSPARQLConverter, SPARQLQuery } from '../ast-to-sparql';
import type { SelectQueryPlan } from '../select-plan';
import type { ExecutionStrategy } from './types';
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

    // For SPARQL endpoint queries (especially CSS /-/sparql), we don't need GRAPH ?g wrapper
    // because the endpoint is a federated query interface that automatically queries 
    // all documents under the container. Using GRAPH ?g can cause issues with some endpoints.
    // Only use GRAPH when we have a specific targetGraph.
    const useGraphVariable = targetGraph !== undefined;
    
    if (extendedPlan._simpleSelectOptions) {
      sparqlQuery = this.sparqlConverter.convertSimpleSelect(extendedPlan._simpleSelectOptions, targetGraph, undefined, useGraphVariable);
    } else if (extendedPlan._sql && plan.baseTable) {
      const ast = this.sparqlConverter.parseDrizzleAST(extendedPlan._sql, plan.baseTable);
      sparqlQuery = this.sparqlConverter.convertSelect(ast, plan.baseTable, targetGraph, undefined, useGraphVariable);
    } else {
      sparqlQuery = this.sparqlConverter.convertSelectPlan(plan, targetGraph, undefined, useGraphVariable);
    }

    console.log('DEBUG: Generated SPARQL Query for SELECT:', sparqlQuery.query);
    console.log('DEBUG: resourceUrl =', resourceUrl);

    // Fast path: Direct fetch to SPARQL endpoint (bypass Comunica for speed)
    // This is much faster than Comunica which does extra processing
    if (resourceUrl.includes('/-/sparql')) {
      return await this.executeDirectSparqlSelect(resourceUrl, sparqlQuery, plan);
    }

    // Fallback to Comunica for non-endpoint sources
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
   * Execute SPARQL SELECT directly via fetch (fast path, bypasses Comunica)
   */
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
    return this.parseSparqlResultsJson(json, plan);
  }

  /**
   * Parse SPARQL Results JSON format into row objects
   */
  private parseSparqlResultsJson(json: any, plan: SelectQueryPlan): any[] {
    const bindings = json?.results?.bindings || [];

    return bindings.map((binding: Record<string, any>) => {
      const row: Record<string, any> = {};

      for (const [varName, termObj] of Object.entries(binding)) {
        if (!termObj) continue;

        // Convert SPARQL result term to JS value
        row[varName] = this.convertSparqlTerm(termObj);
      }

      // Extract ID from subject URI if present
      if (row.subject && plan.baseTable) {
        const subjectUri = row.subject as string;

        // Preserve the full subject URI in @id for downstream processing
        // (hydrateInlineColumns needs full URI, not just the ID)
        row['@id'] = subjectUri;

        // Use UriResolver to properly extract ID from subject URI
        const parsed = this.uriResolver.parseSubject(subjectUri, plan.baseTable);
        if (parsed && parsed.id) {
          row.id = parsed.id;
        }

        // Fallback to simple extraction if resolver parsing failed
        if (!row.id) {
          const hashIndex = subjectUri.lastIndexOf('#');
          if (hashIndex !== -1) {
            row.id = subjectUri.substring(hashIndex + 1);
          } else {
            // Or from "http://pod/path/id.ttl" -> "id"
            const lastSlash = subjectUri.lastIndexOf('/');
            const filename = subjectUri.substring(lastSlash + 1);
            if (filename.endsWith('.ttl')) {
              row.id = filename.slice(0, -4);
            }
          }
        }

        delete row.subject;
      }

      return row;
    });
  }

  /**
   * Convert a SPARQL result term to a JavaScript value
   */
  private convertSparqlTerm(term: { type: string; value: string; datatype?: string }): any {
    if (!term || !term.type) return null;

    const { type, value, datatype } = term;

    if (type === 'uri') {
      return value;
    }

    if (type === 'bnode') {
      return `_:${value}`;
    }

    if (type === 'literal' || type === 'typed-literal') {
      const effectiveDatatype = datatype || this.extractDatatypeFromValue(value);

      if (effectiveDatatype) {
        return this.convertTypedLiteral(value, effectiveDatatype);
      }
      return this.extractLiteralValue(value);
    }

    return value;
  }

  /**
   * Convert a typed literal value to JavaScript type
   */
  private convertTypedLiteral(value: string, datatype: string): any {
    const literalValue = this.extractLiteralValue(value);

    if (datatype === 'http://www.w3.org/2001/XMLSchema#integer' ||
        datatype === 'http://www.w3.org/2001/XMLSchema#int') {
      return parseInt(literalValue, 10);
    }
    if (datatype === 'http://www.w3.org/2001/XMLSchema#decimal' ||
        datatype === 'http://www.w3.org/2001/XMLSchema#float' ||
        datatype === 'http://www.w3.org/2001/XMLSchema#double') {
      return parseFloat(literalValue);
    }
    if (datatype === 'http://www.w3.org/2001/XMLSchema#boolean') {
      return literalValue === 'true' || literalValue === '1';
    }
    if (datatype === 'http://www.w3.org/2001/XMLSchema#dateTime' ||
        datatype === 'http://www.w3.org/2001/XMLSchema#date') {
      return new Date(literalValue);
    }

    return literalValue;
  }

  /**
   * Extract datatype from a value string like "true"^^<http://...#boolean>
   */
  private extractDatatypeFromValue(value: string): string | undefined {
    const match = value.match(/\^\^<?([^>]+)>?$/);
    return match ? match[1] : undefined;
  }

  /**
   * Extract literal value from a typed literal string like "true"^^<...>
   */
  private extractLiteralValue(value: string): string {
    // Remove quotes and datatype annotation
    const match = value.match(/^"(.*)"\^\^/);
    if (match) {
      return match[1];
    }
    // Remove just quotes
    if (value.startsWith('"') && value.endsWith('"')) {
      return value.slice(1, -1);
    }
    return value;
  }

}
