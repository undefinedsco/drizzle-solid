/** Owned file-backed protocol fixture: transport/compiler evidence, not CSS qualification. */
import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DataFactory, Parser, Writer } from 'n3';
import type { Quad } from '@rdfjs/types';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { drizzle, podTable, string, StrictIfMatchN3Backend } from '../../../src';
const { quad } = DataFactory;
let server: Server; let origin: string; let directory: string; let backend: StrictIfMatchN3Backend;
const versions = new Map<string, number>();
const requests: string[] = [];
const dropped = new Set<string>();
const droppedCreates = new Set<string>();
const foreignAfterStaleDelete = new Set<string>();
let denial = 0;
const qualificationDenials = new Map<string, { get: number; status: number }>();
const getCounts = new Map<string, number>();
const predicate = 'https://example.test/title';
function turtle(facts: Quad[]): string { return new Writer({ format: 'N-Triples' }).quadsToString(facts); }
beforeAll(async() => {
  mkdirSync('.test-data/conditional-writes', { recursive: true });
  directory = mkdtempSync(path.resolve('.test-data/conditional-writes/http-owner-'));
  server = createServer(async(request, response) => {
    const url = new URL(request.url!, origin); const file = path.join(directory, encodeURIComponent(url.pathname));
    requests.push(`${request.method} ${url.pathname}`);
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    const etag = `"v${versions.get(url.pathname) || 0}"`;
    if (request.method === 'GET') {
      const get = (getCounts.get(url.pathname) || 0) + 1; getCounts.set(url.pathname, get);
      const fault = qualificationDenials.get(url.pathname);
      if (fault?.get === get) { response.writeHead(fault.status, { 'Content-Type': 'text/html' }).end('<html>Unauthorized</html>'); return; }
      if (!existsSync(file)) { response.writeHead(404).end(); return; }
      response.writeHead(200, { ETag: etag, 'Content-Type': 'text/turtle' }).end(readFileSync(file)); return;
    }
    if (request.method === 'PUT') {
      if (existsSync(file) && request.headers['if-none-match'] === '*') { response.writeHead(412).end(); return; }
      writeFileSync(file, body); versions.set(url.pathname, 1); if (droppedCreates.delete(url.pathname)) { response.destroy(); return; } response.writeHead(201).end(); return;
    }
    if (denial) { const status = denial; denial = 0; response.writeHead(status).end(); return; }
    if (!existsSync(file)) { response.writeHead(404).end(); return; }
    if (request.headers['if-match'] !== etag) {
      if (request.method === 'DELETE' && foreignAfterStaleDelete.delete(url.pathname)) {
        writeFileSync(file, `<${url.href}#foreign> <${predicate}> "foreign-writer".`);
        versions.set(url.pathname, (versions.get(url.pathname) || 0) + 1);
      }
      response.writeHead(412).end(); return;
    }
    if (request.method === 'DELETE') { rmSync(file); versions.delete(url.pathname); response.writeHead(204).end(); return; }
    if (request.method !== 'PATCH') { response.writeHead(405).end(); return; }
    try {
      const parsed = new Parser({ format: 'N3', baseIRI: url.href }).parse(body);
      const facts = new Parser({ baseIRI: url.href }).parse(readFileSync(file, 'utf8'));
      const graph = (role: string): Quad[] => {
        const edge = parsed.find(q => q.graph.termType === 'DefaultGraph' && q.predicate.value === `http://www.w3.org/ns/solid/terms#${role}`);
        if (!edge) return [];
        return parsed.filter(q => q.graph.equals(edge.object)).map(q => quad(q.subject, q.predicate, q.object));
      };
      const deletes = graph('deletes'); const inserts = graph('inserts'); const where = graph('where');
      // This fixture deliberately supports ground graphs only. It is not a general CSS replacement.
      if ([...where, ...deletes, ...inserts].some(q => [q.subject, q.object].some(t => t.termType === 'Variable' || t.termType === 'BlankNode'))) throw new Error('Unsupported fixture graph');
      if (![...where, ...deletes].every(q => facts.some(fact => fact.equals(q)))) { response.writeHead(409).end(); return; }
      const next: Quad[] = facts.filter(q => !deletes.some(deleted => deleted.equals(q)));
      for (const inserted of inserts) if (!next.some(q => q.equals(inserted))) next.push(inserted);
      writeFileSync(file, turtle(next)); versions.set(url.pathname, (versions.get(url.pathname) || 0) + 1);
      if (dropped.delete(url.pathname)) { response.destroy(); return; }
      response.writeHead(204, { ETag: `"v${versions.get(url.pathname)}"` }).end();
    } catch { response.writeHead(400).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Owned listener missing');
  origin = `http://127.0.0.1:${address.port}`;
  backend = await StrictIfMatchN3Backend.qualify({ fetch, scope: `${origin}/`, probeDocument: `${origin}/unique-owned-probe.ttl` });
});
afterAll(async() => { if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); if (directory) rmSync(directory, { recursive: true, force: true }); });
async function resource(name: string) {
  const doc = `${origin}/${name}.ttl`; const iri = `${doc}#one`;
  const neighbors = Array.from({ length: 99 }, (_, index) => `<${doc}#neighbor-${index}> <${predicate}> "neighbor-${index}".`).join('\n');
  const initial = `<${iri}> <${predicate}> "old"; <https://example.test/unknown> "bonjour"@fr.\n${neighbors}`;
  expect((await fetch(doc, { method: 'PUT', body: initial })).status).toBe(201);
  const table = podTable('httpRecord', { id: string('id').primaryKey(), title: string('title').predicate(predicate) }, { base: doc, type: 'https://example.test/Record' });
  const db = drizzle({ info: { isLoggedIn: true, webId: `${origin}/profile#me` }, fetch }, { conditionalWriteBackend: backend, resourcePreparation: 'off' });
  return { doc, iri, table, db };
}
describe('qualified generic transport with owned file-backed HTTP fixture', () => {
  it('equivalent-result competitors have one applied and one conflict', async() => {
    const { doc, iri, table, db } = await resource('competitors'); const snapshot = await db.readResourceSnapshot(table, iri);
    const results = await Promise.all([1, 2].map(() => db.update(table).set({ title: 'current' }).whereByIri(iri).executeConditional({ snapshot })));
    expect(results.map(r => r.status).sort()).toEqual(['applied', 'conflict']);
    const facts = new Parser({ baseIRI: doc }).parse(await (await fetch(doc)).text());
    expect(facts.length).toBe(101); expect(facts.some(q => q.object.value === 'bonjour' && q.object.termType === 'Literal' && q.object.language === 'fr')).toBe(true);
  });
  it('update versus exact delete leaves all 99 neighbor records intact', async() => {
    const { doc, iri, table, db } = await resource('update-delete'); const snapshot = await db.readResourceSnapshot(table, iri);
    const results = await Promise.all([db.delete(table).whereByIri(iri).executeConditional({ snapshot }), db.update(table).set({ title: 'current' }).whereByIri(iri).executeConditional({ snapshot })]);
    expect(results.map(r => r.status).sort()).toEqual(['applied', 'conflict']);
    const facts = new Parser({ baseIRI: doc }).parse(await (await fetch(doc)).text()); expect(facts.filter(q => q.subject.value.includes('#neighbor-')).length).toBe(99);
  });
  it('applied persists once and remains applied when existing cache maintenance fails', async() => {
    const { doc, iri, table, db } = await resource('maintenance');
    const snapshot = await db.readResourceSnapshot(table, iri);
    const failure = new Error('existing cache maintenance failed');
    const invalidation = vi.spyOn(db.dialect.getSPARQLExecutor(), 'invalidateHttpCache').mockRejectedValue(failure);
    requests.length = 0;
    try {
      const result = await db.update(table).set({ title: 'current' }).whereByIri(iri).executeConditional({ snapshot });
      expect(result).toMatchObject({ status: 'applied', maintenanceErrors: [failure] });
      expect(invalidation).toHaveBeenCalledTimes(1); expect(invalidation).toHaveBeenCalledWith(doc);
      expect(requests).toEqual(['PATCH /maintenance.ttl']);
      const facts = new Parser({ baseIRI: doc }).parse(await (await fetch(doc)).text());
      expect(facts.some(q => q.object.value === 'current')).toBe(true);
    } finally { invalidation.mockRestore(); }
  });
  it('actual persisted commit with dropped response stays unknown and is never retried', async() => {
    const { doc, iri, table, db } = await resource('dropped'); const snapshot = await db.readResourceSnapshot(table, iri);
    requests.length = 0; dropped.add('/dropped.ttl');
    const result = await db.update(table).set({ title: 'current' }).whereByIri(iri).executeConditional({ snapshot }); expect(result.status).toBe('unknown');
    expect(requests).toEqual(['PATCH /dropped.ttl']);
    const facts = new Parser({ baseIRI: doc }).parse(await (await fetch(doc)).text()); expect(facts.some(q => q.object.value === 'current')).toBe(true); expect(result.status).toBe('unknown');
  });
  it('does not delete an unknown probe creation or overwrite an existing document', async() => {
    droppedCreates.add('/unknown-probe.ttl'); requests.length = 0;
    await expect(StrictIfMatchN3Backend.qualify({ fetch, scope: `${origin}/`, probeDocument: `${origin}/unknown-probe.ttl` })).rejects.toMatchObject({ probeRetained: true, probeDocument: `${origin}/unknown-probe.ttl` });
    expect(requests).toEqual(['GET /unknown-probe.ttl', 'PUT /unknown-probe.ttl']);
    expect((await fetch(`${origin}/unknown-probe.ttl`)).status).toBe(200);
    requests.length = 0;
    await expect(StrictIfMatchN3Backend.qualify({ fetch, scope: `${origin}/`, probeDocument: `${origin}/unknown-probe.ttl` })).rejects.toThrow('confirmed absent');
    expect(requests).toEqual(['GET /unknown-probe.ttl']);
  });
  it('refuses cleanup after another writer changes the confirmed probe', async() => {
    foreignAfterStaleDelete.add('/changed-probe.ttl'); requests.length = 0;
    await expect(StrictIfMatchN3Backend.qualify({ fetch, scope: `${origin}/`, probeDocument: `${origin}/changed-probe.ttl` })).rejects.toMatchObject({ probeRetained: true });
    expect(requests.filter(request => request === 'DELETE /changed-probe.ttl')).toHaveLength(1);
    expect(await (await fetch(`${origin}/changed-probe.ttl`)).text()).toContain('foreign-writer');
  });
  it('refuses a backend qualified with a different canonical session transport', async() => {
    const { iri, table } = await resource('different-session');
    const anotherFetch = ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init)) as typeof fetch;
    const db = drizzle({ info: { isLoggedIn: true, webId: `${origin}/another#me` }, fetch: anotherFetch }, { conditionalWriteBackend: backend, resourcePreparation: 'off' });
    const snapshot = await db.readResourceSnapshot(table, iri); requests.length = 0;
    expect((await db.update(table).set({ title: 'current' }).whereByIri(iri).executeConditional({ snapshot })).status).toBe('unsupported');
    expect(requests).toEqual([]);
  });
  it('preserves real authorization status at final verification and cleanup GET', async() => {
    for (const [name, get, status] of [['verify-auth', 8, 401], ['cleanup-auth', 9, 403]] as const) {
      qualificationDenials.set(`/${name}.ttl`, { get, status }); requests.length = 0;
      await expect(StrictIfMatchN3Backend.qualify({ fetch, scope: `${origin}/`, probeDocument: `${origin}/${name}.ttl` })).rejects.toMatchObject({ status, probeRetained: true });
      expect(requests.filter(request => request === `DELETE /${name}.ttl`)).toHaveLength(get === 8 ? 0 : 1);
      expect((await fetch(`${origin}/${name}.ttl`)).ok).toBe(true);
    }
  });
  it('authorization failures remain exceptions with no retry or mutation', async() => {
    const { iri, table, db } = await resource('denied'); const snapshot = await db.readResourceSnapshot(table, iri);
    for (const status of [401, 403]) { requests.length = 0; denial = status; await expect(db.update(table).set({ title: 'current' }).whereByIri(iri).executeConditional({ snapshot })).rejects.toMatchObject({ status }); expect(requests).toEqual(['PATCH /denied.ttl']); }
  });
});
