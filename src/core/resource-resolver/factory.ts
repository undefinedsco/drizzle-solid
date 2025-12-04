/**
 * ResourceResolver Factory
 *
 * Creates the appropriate resolver based on table configuration
 */

import type { PodTable } from '../pod-table';
import type { ResourceResolver, ResourceResolverFactory } from './types';
import { FragmentResourceResolver } from './fragment-resolver';
import { DocumentResourceResolver } from './document-resolver';
import { subjectResolver } from '../subject/resolver';

export class ResourceResolverFactoryImpl implements ResourceResolverFactory {
  private podBaseUrl: string;
  private resolverCache = new WeakMap<PodTable, ResourceResolver>();

  constructor(podBaseUrl: string) {
    this.podBaseUrl = podBaseUrl;
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
    // Delegate to subjectResolver for consistent mode detection
    return subjectResolver.getResourceMode(table);
  }
}

/**
 * Determine the resource mode for a table
 * Utility function for use outside of factory context
 * @deprecated Use subjectResolver.getResourceMode() directly
 */
export function getResourceMode(table: PodTable): 'fragment' | 'document' {
  return subjectResolver.getResourceMode(table);
}
