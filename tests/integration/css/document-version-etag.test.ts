import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { createTestSession, ensureContainer, resetSharedSession } from './helpers';

const sha256 = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex');

const TOKEN = /^"(dv1)\.([0-9a-f]{64})\.(text_turtle)\.([0-9a-f]{64})"$/u;

/**
 * Real-CSS conformance for the authority document version on the Local file-authoritative
 * complete-Turtle lane. Proves the delivered bytes ARE the protected authority bytes (the ETag
 * byte digest equals sha256 of the response body), that HEAD/304 reuse the same token, and that a
 * valid-shape forged representation suffix is rejected with 412.
 */
describe('authority document version ETag (real CSS)', () => {
  let session: Awaited<ReturnType<typeof createTestSession>>;
  let container: string;
  const predicate = 'https://example.org/value';
  beforeAll(async () => {
    session = await createTestSession();
    container = await ensureContainer(session, `integration/etag-doc-version-${randomUUID()}/`);
  });
  afterAll(async () => { await resetSharedSession(); });

  function patchBody(url: string, old: string, next: string): string {
    const term = `<${url}#record> <${predicate}>`;
    return `@prefix solid: <http://www.w3.org/ns/solid/terms#>.\n_:patch a solid:InsertDeletePatch; solid:where { ${term} "${old}". }; solid:deletes { ${term} "${old}". }; solid:inserts { ${term} "${next}". }.`;
  }
  async function put(url: string, body: string): Promise<void> {
    const r = await session.fetch(url, { method: 'PUT', headers: { 'Content-Type': 'text/turtle', 'If-None-Match': '*' }, body });
    expect(r.ok).toBe(true);
  }
  async function get(url: string): Promise<{ status: number; etag: string; body: string }> {
    const r = await session.fetch(url, { headers: { Accept: 'text/turtle', 'Cache-Control': 'no-cache' } });
    expect(r.status).toBe(200);
    return { status: r.status, etag: r.headers.get('etag') ?? '', body: await r.text() };
  }
  async function head(url: string, ifNoneMatch?: string): Promise<Response> {
    return await session.fetch(url, { method: 'HEAD', headers: { Accept: 'text/turtle', ...(ifNoneMatch ? { 'If-None-Match': ifNoneMatch } : {}) } });
  }
  async function patch(url: string, version: string, old: string, next: string): Promise<number> {
    const r = await session.fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'text/n3', 'If-Match': version }, body: patchBody(url, old, next) });
    await r.text();
    return r.status;
  }

  it('binds the delivered body bytes and document state to the returned version', async () => {
    const url = `${container}identity.ttl`;
    await put(url, `<${url}#record> <${predicate}> "old" .\n<${url}#neighbor> <${predicate}> "untouched" .`);
    const { etag, body } = await get(url);
    console.log(JSON.stringify({ case: 'identity', url, etag }));
    const match = TOKEN.exec(etag);
    expect(match, `etag ${etag}`).not.toBeNull();
    const [, , stateHash, repId, byteDigest] = match!;
    expect(repId).toBe('text_turtle');
    // The delivered representation bytes must be exactly the protected authority bytes.
    expect(sha256(body)).toBe(byteDigest);
    // The document state digest must be derived from the same protected input (layout + rep + bytes).
    expect(stateHash).toBe(sha256(JSON.stringify({ v: '1', path: url, rep: 'text/turtle', body: byteDigest })));
    // The internal version predicate must never leak into the delivered representation.
    expect(body).not.toContain('urn:undefineds:xpod:documentVersion');
    expect(body).not.toContain('dv1.');
    // A repeated read of the same protected state yields the identical token (no freshness flapping).
    const repeat = await get(url);
    expect(repeat.etag).toBe(etag);
    expect(repeat.body).toBe(body);
    // A different resource layout must not share the same document state.
    const twinUrl = `${container}twin.ttl`;
    await put(twinUrl, `<${twinUrl}#record> <${predicate}> "old" .`);
    const twin = await get(twinUrl);
    const twinMatch = TOKEN.exec(twin.etag);
    expect(twinMatch, `twin etag ${twin.etag}`).not.toBeNull();
    expect(twinMatch![2]).not.toBe(stateHash);
  });

  it('returns the same version for HEAD and answers a matching If-None-Match with 304', async () => {
    const url = `${container}conditional.ttl`;
    await put(url, `<${url}#record> <${predicate}> "old" .`);
    const { etag, body } = await get(url);
    const header = await head(url);
    expect(header.status).toBe(200);
    expect(header.headers.get('etag')).toBe(etag);
    expect(await header.text()).toBe('');
    const notModified = await head(url, etag);
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get('etag')).toBe(etag);
    expect(body).not.toContain('dv1.');
  });

  it('rejects a valid-shape forged representation suffix, then accepts the exact token', async () => {
    const url = `${container}forged.ttl`;
    await put(url, `<${url}#record> <${predicate}> "old" .\n<${url}#neighbor> <${predicate}> "untouched" .`);
    const { etag } = await get(url);
    const [, prefix, stateHash, repId] = TOKEN.exec(etag)!;
    const forged = `"${prefix}.${stateHash}.${repId}.${'0'.repeat(64)}"`;
    expect(await patch(url, forged, 'old', 'forged')).toBe(412);
    // A malformed / non-token validator is also refused, not silently accepted.
    expect(await patch(url, '"not-a-document-version"', 'old', 'bad')).toBe(412);
    // The exact prepared token is accepted and advances the version.
    expect(await patch(url, etag, 'old', 'current')).toBeLessThan(300);
    const next = await get(url);
    expect(next.etag).not.toBe(etag);
    expect(next.etag).toMatch(TOKEN);
    expect(next.body).toContain('"current"');
  });
});
