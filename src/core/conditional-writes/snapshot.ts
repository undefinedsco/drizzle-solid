import { readConditionalResponse } from './http';
import { Parser } from 'n3';
import type { Quad } from '@rdfjs/types';
import type { PodTable } from '../schema';
import type { ResourceSnapshot } from './types';

interface SnapshotState { table: PodTable; fetch: typeof fetch; quads: readonly Quad[] }
const snapshots = new WeakMap<ResourceSnapshot, SnapshotState>();
export function exactDocument(iri: string): string {
  const url = new URL(iri);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Expected an absolute HTTP resource IRI');
  url.hash = '';
  return url.href;
}
export function strongEtag(etag: string | null): etag is string {
  return etag !== null && /^"[^"\r\n]+"$/.test(etag);
}
export async function readResourceSnapshot<T extends PodTable<any>>(table: T, subjectIri: string, authenticatedFetch: typeof fetch): Promise<ResourceSnapshot<T>> {
  const documentIri = exactDocument(subjectIri);
  const response = await authenticatedFetch(documentIri, { headers: { Accept: 'text/turtle' }, redirect: 'error' });
  const text = await readConditionalResponse(response);
  if (!response.ok) {
    throw Object.assign(new Error(`Snapshot GET failed (${response.status})`), { status: response.status });
  }
  if (response.status !== 200 || response.headers.has('content-range')) {
    throw new Error('Snapshot requires a complete HTTP 200 representation without Content-Range');
  }
  const etag = response.headers.get('etag');
  if (!strongEtag(etag)) throw new Error('Conditional writes require a strong ETag from the snapshot GET');
  const quads = new Parser({ baseIRI: documentIri, format: 'text/turtle' }).parse(text);
  if (!quads.some(quad => quad.subject.termType === 'NamedNode' && quad.subject.value === subjectIri)) throw new Error('Exact snapshot subject does not exist');
  // Freeze the RDF terms as well as the containers: callers cannot alter the version proof.
  for (const quad of quads) {
    for (const term of [quad.subject, quad.predicate, quad.object, quad.graph]) {
      if (term.termType === 'Literal') Object.freeze(term.datatype);
      Object.freeze(term);
    }
    Object.freeze(quad);
  }
  Object.freeze(quads);
  const snapshot = Object.freeze({ table, subjectIri, documentIri, etag, quads });
  snapshots.set(snapshot, { table, fetch: authenticatedFetch, quads });
  return snapshot;
}
export function snapshotState(snapshot: ResourceSnapshot, table: PodTable, subjectIri: string, authenticatedFetch: typeof fetch): SnapshotState {
  const state = snapshots.get(snapshot);
  if (!state || state.table !== table || state.fetch !== authenticatedFetch || snapshot.subjectIri !== subjectIri) throw new Error('Snapshot does not belong to this exact table, subject and session');
  return state;
}
