/**
 * Origin-based Authentication Utilities
 *
 * Provides helpers for determining whether to use authenticated
 * or unauthenticated fetch based on URL origin comparison.
 */

/**
 * Check if a URL is on the same origin as a reference URL
 * Used to determine whether to use authenticated fetch for SPARQL endpoints
 *
 * @param url - The URL to check
 * @param referenceUrl - The reference URL (usually the Pod URL)
 * @returns true if both URLs share the same origin
 */
export function isSameOrigin(url: string, referenceUrl: string): boolean {
  try {
    const targetUrl = new URL(url);
    const baseUrl = new URL(referenceUrl);
    return targetUrl.origin === baseUrl.origin;
  } catch {
    return false;
  }
}

/**
 * Get the appropriate fetch function for a URL based on origin
 *
 * - Same-origin URLs (e.g., CSS SPARQL sidecar): use authenticated session.fetch
 * - Cross-origin URLs: use standard unauthenticated fetch
 *
 * @param url - The URL to fetch from
 * @param podUrl - The Pod base URL for origin comparison
 * @param sessionFetch - The authenticated fetch function from Solid session
 * @returns The appropriate fetch function to use
 */
export function getFetchForOrigin(
  url: string,
  podUrl: string,
  sessionFetch: typeof fetch
): typeof fetch {
  if (isSameOrigin(url, podUrl)) {
    return sessionFetch;
  }
  return fetch;
}
