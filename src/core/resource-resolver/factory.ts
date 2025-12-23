/**
 * ResourceResolver Factory
 *
 * Creates the appropriate resolver based on table configuration
 */

import type { PodTable } from '../pod-table';
import type { ResourceResolver, ResourceResolverFactory } from './types';
import { FragmentResourceResolver } from './fragment-resolver';
import { DocumentResourceResolver } from './document-resolver';
import type { UriResolver } from '../uri';
import { UriResolverImpl } from '../uri';

export class ResourceResolverFactoryImpl implements ResourceResolverFactory {
  private podBaseUrl: string;
  private resolverCache = new WeakMap<PodTable, ResourceResolver>();
  private uriResolver: UriResolver;

  constructor(podBaseUrl: string, uriResolver?: UriResolver) {
    this.podBaseUrl = podBaseUrl;
    this.uriResolver = uriResolver ?? new UriResolverImpl();
  }

  /**
   * Update the pod base URL (e.g., after WebID discovery)
   */
  setPodBaseUrl(url: string): void {
    this.podBaseUrl = url;
    // Clear cache when base URL changes
    this.resolverCache = new WeakMap();
  }

  getResolver(table: PodTable): ResourceResolver {
    // Check cache first
    const cached = this.resolverCache.get(table);
    if (cached) {
      return cached;
    }

    // Determine mode from table configuration
    const mode = this.determineMode(table);

    // Create appropriate resolver
    const resolver = mode === 'document'
      ? new DocumentResourceResolver(this.podBaseUrl)
      : new FragmentResourceResolver(this.podBaseUrl);

    // Cache and return
    this.resolverCache.set(table, resolver);
    return resolver;
  }

  private determineMode(table: PodTable): 'fragment' | 'document' {
    // Delegate to UriResolver for consistent mode detection
    return this.uriResolver.getResourceMode(table);
  }
}

/**
 * Determine the resource mode for a table
 * Utility function for use outside of factory context
 * @deprecated Prefer using a UriResolver instance directly
 */
export function getResourceMode(table: PodTable): 'fragment' | 'document' {
  const resolver = new UriResolverImpl();
  return resolver.getResourceMode(table);
}
