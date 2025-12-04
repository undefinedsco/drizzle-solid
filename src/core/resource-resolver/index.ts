/**
 * ResourceResolver Module
 *
 * Provides abstraction for fragment vs document mode resource resolution
 */

export type { ResourceResolver, ResourceResolverFactory } from './types';
export { BaseResourceResolver } from './base-resolver';
export { FragmentResourceResolver } from './fragment-resolver';
export { DocumentResourceResolver } from './document-resolver';
export { ResourceResolverFactoryImpl, getResourceMode } from './factory';
