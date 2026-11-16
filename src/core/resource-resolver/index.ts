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
export {
  DIRECTORY_METADATA_GRAPH_VARIABLE,
  getTableSubjectTemplate,
  isOwnDirectoryMetadataRow,
  metadataGraphIriForSubject,
  resolveDirectoryResourceMetadataLayout,
  toExplicitMetadataGraphSpec,
} from './directory-layout';
export type {
  DirectoryResourceMetadataLayout,
  ExplicitMetadataGraphSpec,
} from './directory-layout';
