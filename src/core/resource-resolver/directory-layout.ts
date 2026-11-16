/**
 * Directory-resource metadata layout
 *
 * A resource whose id template ends in `/` is stored as an LDP container
 * (a "directory resource"). The container document itself only carries
 * containment triples; the resource's own RDF lives in the server-managed
 * auxiliary metadata document (`{resource}.meta`), which the Pod stores in the
 * named graph `meta:{resourceIRI}`.
 *
 * This module is the single canonical place that answers:
 *  - does this table's collection consist of directory resources?
 *  - what is the bounded metadata graph namespace for its collection?
 *  - is a returned (graph, subject) pair the resource's own facet?
 *
 * It derives the layout from the existing id template contract only. It never
 * branches on a specific model/type/provider identity and never changes the
 * shared resource definitions.
 */
import type { PodTable } from '../schema';

/** Bounded explicit metadata graph binding for a collection SELECT. */
export interface DirectoryResourceMetadataLayout {
  /** Template that identified the directory layout (explicit or id default). */
  readonly subjectTemplate: string;
  /** Canonical collection base IRI, trailing slash preserved. */
  readonly collectionBaseIri: string;
  /** Literal graph namespace: `meta:` + collectionBaseIri. */
  readonly metadataGraphPrefix: string;
}

/** Explicit metadata-graph binding handed to the SELECT builder. */
export interface ExplicitMetadataGraphSpec {
  readonly graphVariable: string;
  readonly namespacePrefix: string;
}

export const DIRECTORY_METADATA_GRAPH_VARIABLE = 'metadataGraph';

function normalizeTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function readIdDefaultTemplate(table: PodTable): string | undefined {
  const defaultValue = (table as unknown as {
    columns?: Record<string, { options?: { defaultValue?: unknown } }>;
  }).columns?.id?.options?.defaultValue;
  return typeof defaultValue === 'string' ? defaultValue : undefined;
}

/**
 * The storage template for a table: an explicit subjectTemplate wins, else the
 * id column default (the shape shared Models use, e.g. `{key}/`).
 */
export function getTableSubjectTemplate(table: PodTable): string | undefined {
  const explicit = table.getSubjectTemplate?.() ?? table.config?.subjectTemplate;
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return explicit.trim();
  }
  const fromIdDefault = readIdDefaultTemplate(table);
  return fromIdDefault && fromIdDefault.trim().length > 0 ? fromIdDefault.trim() : undefined;
}

/**
 * Resolve the directory-resource layout for a table, or null for ordinary
 * document/fragment layouts.
 *
 * `collectionBaseIri` must be the table's canonical collection base (the
 * container whose children are the rows), not a per-database endpoint.
 */
export function resolveDirectoryResourceMetadataLayout(
  table: PodTable,
  collectionBaseIri: string,
): DirectoryResourceMetadataLayout | null {
  if (!collectionBaseIri) {
    return null;
  }

  const subjectTemplate = getTableSubjectTemplate(table);
  if (!subjectTemplate || !subjectTemplate.endsWith('/') || subjectTemplate.startsWith('#')) {
    return null;
  }

  const base = normalizeTrailingSlash(collectionBaseIri);
  return {
    subjectTemplate,
    collectionBaseIri: base,
    metadataGraphPrefix: `meta:${base}`,
  };
}

/** Build the explicit graph binding consumed by the SELECT builder. */
export function toExplicitMetadataGraphSpec(
  layout: DirectoryResourceMetadataLayout,
  graphVariable: string = DIRECTORY_METADATA_GRAPH_VARIABLE,
): ExplicitMetadataGraphSpec {
  return {
    graphVariable,
    namespacePrefix: layout.metadataGraphPrefix,
  };
}

/** The metadata graph IRI that stores one directory resource's facet. */
export function metadataGraphIriForSubject(subjectIri: string): string {
  return `meta:${subjectIri}`;
}

/**
 * A collection result row is this resource's own facet only when its graph is
 * exactly `meta:{subject}` and both stay inside the bounded collection
 * namespace. Foreign metadata about another IRI can never become a row.
 */
export function isOwnDirectoryMetadataRow(
  layout: DirectoryResourceMetadataLayout,
  graphIri: unknown,
  subjectIri: unknown,
): boolean {
  if (typeof graphIri !== 'string' || typeof subjectIri !== 'string') {
    return false;
  }
  if (!graphIri.startsWith(layout.metadataGraphPrefix)) {
    return false;
  }
  if (!subjectIri.startsWith(layout.collectionBaseIri)) {
    return false;
  }
  return graphIri === metadataGraphIriForSubject(subjectIri);
}
