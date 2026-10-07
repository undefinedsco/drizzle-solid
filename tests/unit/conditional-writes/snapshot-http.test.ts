import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { podTable, string } from '../../../src';
import { readResourceSnapshot } from '../../../src/core/conditional-writes/snapshot';
let server: Server;
let origin: string;
const requests: string[] = [];
const table = podTable('httpSnapshot', { id: string('id').primaryKey() }, { base: 'https://unused.example/', type: 'https://example.test/Record' });
beforeAll(async() => {
  server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    const partial = request.url?.startsWith('/partial');
    response.writeHead(partial ? 206 : 200, { 'Content-Type': 'text/turtle', ETag: '"exact-version"', ...(partial ? { 'Content-Range': 'bytes 0-50/900' } : {}) });
    response.end(`<${origin}${request.url}#one> <https://example.test/p> "bonjour"@fr.`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing owned listener');
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async() => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
describe('snapshot over actual HTTP transport', () => {
  it('accepts a complete representation from one exact GET', async() => {
    requests.length = 0;
    const snapshot = await readResourceSnapshot(table, `${origin}/full.ttl#one`, fetch);
    expect(snapshot.etag).toBe('"exact-version"'); expect(requests).toEqual(['GET /full.ttl']);
    expect(snapshot.quads[0].object.termType).toBe('Literal');
  });
  it('refuses a syntactically valid partial representation', async() => {
    requests.length = 0;
    await expect(readResourceSnapshot(table, `${origin}/partial.ttl#one`, fetch)).rejects.toThrow('complete');
    expect(requests).toEqual(['GET /partial.ttl']);
  });
});
