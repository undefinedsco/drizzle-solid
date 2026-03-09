import { Parser, type Quad } from 'n3';

const PIM_STORAGE = 'http://www.w3.org/ns/pim/space#storage';
const SOLID_POD = 'http://www.w3.org/ns/solid/terms#pod';

/**
 * Resolver to find the actual storage root (SP) from a WebID (IdP).
 * Implements the IdP-SP Separation architecture.
 */
export class WebIdResolver {
  private cache: Map<string, string> = new Map();

  private extractStorageFromProfile(webId: string, profileText: string, contentType?: string | null): string | null {
    const normalizedContentType = contentType?.split(';')[0]?.trim().toLowerCase();
    const parser = new Parser({
      baseIRI: webId,
      format: normalizedContentType === 'application/n-triples' ? 'N-Triples' : undefined,
    });

    const quads = parser.parse(profileText);
    const preferredPredicates = [PIM_STORAGE, SOLID_POD];

    for (const predicate of preferredPredicates) {
      const match = quads.find((quad: Quad) => {
        return quad.subject.value === webId && quad.predicate.value === predicate;
      });

      if (match?.object?.value) {
        return match.object.value;
      }
    }

    return null;
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
      const effectiveFetch = fetchFn ?? fetch;
      const response = await effectiveFetch(webId, {
        headers: {
          Accept: 'text/turtle, application/n-triples;q=0.9, text/n3;q=0.8, */*;q=0.1'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch WebID profile: ${response.status} ${response.statusText}`);
      }

      const profileText = await response.text();
      const storage = this.extractStorageFromProfile(
        webId,
        profileText,
        response.headers.get('content-type')
      );

      if (storage) {
        const normalized = storage.endsWith('/') ? storage : `${storage}/`;
        console.log(`[WebIdResolver] Resolved storage for ${webId} -> ${normalized}`);
        this.cache.set(webId, normalized);
        return normalized;
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
