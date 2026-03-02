import { QueryEngine } from '@comunica/query-sparql-solid';

/**
 * Resolver to find the actual storage root (SP) from a WebID (IdP).
 * Implements the IdP-SP Separation architecture.
 */
export class WebIdResolver {
  private engine: QueryEngine;
  private cache: Map<string, string> = new Map();

  constructor() {
    this.engine = new QueryEngine();
  }

  /**
   * Resolve the storage root URL from a WebID Profile.
   * Prioritizes pim:storage (WSIM) over solid:pod.
   * 
   * @param webId The WebID to resolve
   * @param fetchFn The authenticated fetch function (optional)
   * @returns The resolved storage URL (with trailing slash), or null if not found
   */
  async resolveStorage(webId: string, fetchFn?: typeof fetch): Promise<string | null> {
    if (this.cache.has(webId)) {
      return this.cache.get(webId)!;
    }

    try {
      // PIM Storage (WSIM) is the primary predicate, solid:pod is secondary
      // We look for both
      const query = `
        SELECT ?storage WHERE {
          { <${webId}> <http://www.w3.org/ns/pim/space#storage> ?storage }
          UNION
          { <${webId}> <http://www.w3.org/ns/solid/terms#pod> ?storage }
        } LIMIT 1
      `;

      // Use authenticated fetch if available, otherwise fall back to unauthenticated
      // Profile documents are usually public, but some might be private
      const context: any = {
        sources: [webId],
        lenient: true
      };
      
      if (fetchFn) {
        context.fetch = fetchFn;
      }

      const bindingsStream = await this.engine.queryBindings(query, context);
      const bindings = await bindingsStream.toArray();

      if (bindings.length > 0) {
        const storage = bindings[0].get('storage')?.value;
        if (storage) {
          // Ensure trailing slash for directory/container semantics
          const normalized = storage.endsWith('/') ? storage : `${storage}/`;
          
          console.log(`[WebIdResolver] Resolved storage for ${webId} -> ${normalized}`);
          this.cache.set(webId, normalized);
          return normalized;
        }
      }
    } catch (error) {
      console.warn(`[WebIdResolver] Failed to resolve storage for ${webId}`, error);
    }
    
    return null;
  }
  
  /**
   * Clear the internal cache
   */
  clearCache() {
    this.cache.clear();
  }
}

// Singleton instance
export const webIdResolver = new WebIdResolver();
