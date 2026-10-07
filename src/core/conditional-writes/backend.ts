export { ConditionalHttpError } from './http';
import { ConditionalHttpError, readConditionalResponse as readResponse } from './http';
import { randomUUID } from 'node:crypto';
import { Parser } from 'n3';
import { exactDocument, strongEtag } from './snapshot';
import type { ConditionalPatch, ConditionalWriteBackend, ConditionalWriteContext, ConditionalWriteResult } from './types';

export interface StrictIfMatchN3Options {
  /** Canonical authenticated transport. Must not replay mutation requests. */
  fetch: typeof fetch;
  /** Exact resource/container scope with the same reviewed server implementation. */
  scope: string;
  /** A new unique, caller-owned document inside scope; never an existing resource. */
  probeDocument: string;
}
export class ConditionalBackendQualificationError extends Error {
  probeDocument?: string;
  probeRetained?: boolean;
}

function within(document: string, scope: string): boolean {
  const target = new URL(document); const boundary = new URL(scope);
  return !/%(?:2f|5c|2e)/i.test(target.pathname + boundary.pathname) && !boundary.hash && target.origin === boundary.origin && (boundary.pathname.endsWith('/') ? target.pathname.startsWith(boundary.pathname) : target.pathname === boundary.pathname) && !target.search && !boundary.search;
}
function patch(document: string, old: string, next: string, where = old): string {
  const fact = (value: string): string => `<${document}#probe> <https://example.org/conditional-probe/value> ${JSON.stringify(value)} .`;
  return `@prefix solid:<http://www.w3.org/ns/solid/terms#>. _:patch a solid:InsertDeletePatch; solid:deletes {${fact(old)}}; solid:inserts {${fact(next)}}; solid:where {${fact(where)}}.`;
}
/** Explicit conformance check, not automatic server detection or a durable receipt.
 * Its scope additionally requires the implementation/transport contract in types.ts.
 */
export class StrictIfMatchN3Backend implements ConditionalWriteBackend {
  private constructor(readonly fetch: typeof globalThis.fetch, private readonly scope: string) {}
  static async qualify(options: StrictIfMatchN3Options): Promise<StrictIfMatchN3Backend> {
    const document = exactDocument(options.probeDocument);
    const scope = new URL(options.scope).href;
    if (document !== options.probeDocument || !within(document, scope)) throw new ConditionalBackendQualificationError('Probe must be an exact document inside the qualified scope');
    const old = randomUUID(); const current = randomUUID(); const forbidden = randomUUID();
    let creationAttempted = false;
    let created = false;
    let qualified = false;
    let ownedEtag: string | undefined;
    let ownedValue: string | undefined;
    try {
      const existing = await options.fetch(document, { redirect: 'error' });
      await readResponse(existing);
      if (existing.status !== 404) throw new ConditionalBackendQualificationError('Probe document is not confirmed absent');
      creationAttempted = true;
      const create = await options.fetch(document, { method: 'PUT', redirect: 'error', headers: { 'Content-Type': 'text/turtle', 'If-None-Match': '*' }, body: `<${document}#probe> <https://example.org/conditional-probe/value> ${JSON.stringify(old)} .` });
      await readResponse(create);
      if (create.status !== 201) throw new ConditionalBackendQualificationError(`Owned probe creation was not confirmed (${create.status})`);
      created = true;
      const getVersion = async (): Promise<string> => {
        const get = await options.fetch(document, { redirect: 'error', headers: { Accept: 'text/turtle' } });
        await readResponse(get);
        const etag = get.headers.get('etag');
        if (get.status !== 200 || get.headers.has('content-range') || !strongEtag(etag)) throw new ConditionalBackendQualificationError('Probe GET did not return a strong version');
        return etag;
      };
      const send = async (etag: string, body: string): Promise<number> => {
        const response = await options.fetch(document, { method: 'PATCH', redirect: 'error', headers: { 'Content-Type': 'text/n3', 'If-Match': etag }, body });
        await readResponse(response);
        return response.status;
      };
      const original = await getVersion();
      const first = await send(original, patch(document, old, current));
      if (first < 200 || first >= 300) throw new ConditionalBackendQualificationError(`N3 patch failed (${first})`);
      let fresh = await getVersion();
      if (fresh === original) throw new ConditionalBackendQualificationError('Resource version did not change after mutation');
      let value = current;
      for (let index = 0; index < 3; index++) {
        const next = randomUUID();
        const result = await send(fresh, patch(document, value, next));
        if (result < 200 || result >= 300) throw new ConditionalBackendQualificationError('Repeated version probe failed');
        const changed = await getVersion();
        if (changed === fresh) throw new ConditionalBackendQualificationError('Resource version collided during consecutive mutations');
        fresh = changed; value = next;
      }
      const restore = await send(fresh, patch(document, value, current));
      if (restore < 200 || restore >= 300) throw new ConditionalBackendQualificationError('Probe restore failed');
      const restored = await getVersion();
      if (restored === fresh) throw new ConditionalBackendQualificationError('Resource version did not change after probe restore');
      fresh = restored;
      // WHERE still matches: neither no-match conflict nor equivalent success qualifies.
      if (await send(original, patch(document, current, current)) !== 412) throw new ConditionalBackendQualificationError('Stale equivalent-result PATCH was not rejected with 412');
      if (await send(original, patch(document, current, forbidden)) !== 412) throw new ConditionalBackendQualificationError('Stale matching non-noop PATCH was not rejected with 412');
      const failure = await send(fresh, patch(document, forbidden, old, current));
      if (failure !== 409 && failure !== 412) throw new ConditionalBackendQualificationError('Missing deletion did not fail atomically');
      const verify = await options.fetch(document, { redirect: 'error', headers: { Accept: 'text/turtle' } });
      const facts = new Parser({ baseIRI: document }).parse(await readResponse(verify));
      if (verify.status !== 200 || verify.headers.has('content-range') || facts.length !== 1 || facts[0].object.value !== current) throw new ConditionalBackendQualificationError('Failed conditional patch changed the representation');
      // DELETE cleanup itself must enforce stale versions, not merely PATCH.
      const staleDelete = await options.fetch(document, { method: 'DELETE', redirect: 'error', headers: { 'If-Match': original } });
      await readResponse(staleDelete);
      if (staleDelete.status !== 412) throw new ConditionalBackendQualificationError('Stale probe cleanup was not rejected with 412');
      qualified = true; ownedEtag = fresh; ownedValue = current;
      const backend = new StrictIfMatchN3Backend(options.fetch, scope);
      Object.freeze(backend);
      return backend;
    } catch (error) {
      if (creationAttempted && error instanceof Error) Object.assign(error, { probeDocument: document, probeRetained: true });
      throw error;
    } finally {
      // Failed/unknown conformance cannot authorize cleanup, even for a created probe.
      // Never refresh to a foreign version or let cleanup mask the original failure.
      if (created && qualified) {
        try {
          const check = await options.fetch(document, { redirect: 'error', headers: { Accept: 'text/turtle' } });
          const text = await readResponse(check);
          const facts = new Parser({ baseIRI: document }).parse(text);
          if (check.status !== 200 || check.headers.has('content-range') || check.headers.get('etag') !== ownedEtag || facts.length !== 1 || facts[0].subject.value !== `${document}#probe` || facts[0].predicate.value !== 'https://example.org/conditional-probe/value' || facts[0].object.value !== ownedValue) {
            throw Object.assign(new ConditionalBackendQualificationError('Owned probe changed; cleanup refused'), { probeDocument: document, probeRetained: true });
          }
          const response = await options.fetch(document, { method: 'DELETE', redirect: 'error', headers: { 'If-Match': ownedEtag! } });
          await readResponse(response);
          if (!response.ok) throw Object.assign(new ConditionalBackendQualificationError(`Owned probe cleanup failed (${response.status})`), { probeDocument: document, probeRetained: true });
        } catch (error) {
          if (error instanceof Error) Object.assign(error, { probeDocument: document, probeRetained: true });
          throw error;
        }
      }
    }
  }
  async execute(input: ConditionalPatch, context: ConditionalWriteContext): Promise<ConditionalWriteResult> {
    if (context.authenticatedFetch !== this.fetch) return { status: 'unsupported', reason: 'Conditional transport does not match the snapshot session' };
    if (!within(input.documentIri, this.scope) || !strongEtag(input.etag)) return { status: 'unsupported', reason: 'Resource is outside qualified scope or has no strong version' };
    let response: Response;
    try {
      response = await this.fetch(input.documentIri, { method: 'PATCH', redirect: 'error', headers: { 'Content-Type': 'text/n3', 'If-Match': input.etag }, body: input.body });
    } catch (cause) { return { status: 'unknown', documentIri: input.documentIri, cause }; }
    if (response.status === 401 || response.status === 403) await readResponse(response);
    try { await response.arrayBuffer(); } catch (cause) {
      return { status: 'unknown', documentIri: input.documentIri, cause };
    }
    if (response.status === 409 || response.status === 412) return { status: 'conflict', documentIri: input.documentIri, httpStatus: response.status };
    if (response.ok) return { status: 'applied', documentIri: input.documentIri, etag: response.headers.get('etag') || undefined };
    return { status: 'unknown', documentIri: input.documentIri, cause: new ConditionalHttpError(response.status, 'Conditional write returned an unclassified response') };
  }
}
