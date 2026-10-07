import { Parser } from 'n3';
import { updateExactResource } from '../../../examples/utils/conditional-resource';
import { describe, it, expect } from 'vitest';
import { drizzle, object, podTable, string } from '../../../src';
import { compileProperties } from '../../../src/core/conditional-writes/compiler';
import { readResourceSnapshot } from '../../../src/core/conditional-writes/snapshot';
const document = 'https://pod.example/messages.ttl';
const ns = 'https://example.test/';
const table = podTable('messages', { id: string('id').primaryKey().predicate(`${ns}id`), metadata: object('metadata').predicate(`${ns}metadata`), title: string('title').predicate(`${ns}title`) }, { base: document, type: `${ns}Message`, namespace: { prefix: 'm', uri: ns }, subjectTemplate: '#{id}' });
const text = `<${document}#one> <${ns}id> "one"; <${ns}title> "old"; <${ns}unknown> "bonjour"@fr; <${ns}metadata> _:meta. _:meta <${ns}roles> "owner"; <${ns}protocols> '{"matrix":{"eventId":"old"},"other":41}'^^<http://www.w3.org/2001/XMLSchema#json>. <${document}#two> <${ns}id> "two"; <${ns}title> "neighbor".`;
function transport(body = text, etag = '"version"') { const calls: string[] = []; const fetcher = (async(input: RequestInfo | URL) => { calls.push(String(input)); return new Response(body, { headers: { etag } }); }) as typeof fetch; return { calls, fetcher }; }
describe('exact conditional compiler', () => {
  it('uses one exact GET, freezes complete terms and preserves language', async() => {
    const { calls, fetcher } = transport(); const snapshot = await readResourceSnapshot(table, `${document}#one`, fetcher);
    expect(calls).toEqual([document]); expect(snapshot.quads.length).toBe(8); expect(Object.isFrozen(snapshot.quads[0].object)).toBe(true);
    expect(snapshot.quads.some(q => q.object.termType === 'Literal' && q.object.language === 'fr')).toBe(true);
  });
  it('nested JSON patch preserves roles and unknown JSON keys with anchored blank variables', async() => {
    const snapshot = await readResourceSnapshot(table, `${document}#one`, transport().fetcher);
    const compiled = compileProperties(snapshot, table, { metadata: { protocols: { matrix: { eventId: 'current' } } } });
    expect(compiled.body).toContain('solid:deletes'); expect(compiled.body).toContain('solid:inserts'); expect(compiled.body).toContain('?b0');
    expect(compiled.body).toContain('other'); expect(compiled.body).toContain('current');
    const mutations = compiled.body.split('solid:where')[0]; expect(mutations).not.toContain('roles'); expect(mutations).not.toContain('unknown'); expect(mutations).not.toContain('#two');
  });
  it('nested JSON Date updates serialize ISO values while preserving siblings', async() => {
    const snapshot = await readResourceSnapshot(table, `${document}#one`, transport().fetcher);
    const date = new Date('2026-10-05T02:00:00.000Z');
    const patch = compileProperties(snapshot, table, { metadata: { protocols: { matrix: { eventId: date } } } });
    expect(patch.body).toContain('solid:inserts');
    expect(patch.body).toContain(date.toISOString());
    expect(patch.body).toContain('other');
  });
  it('snapshot authorization status survives broken response bodies', async() => {
    for (const status of [401, 403]) {
      const fetcher = (async() => new Response(new ReadableStream({ start(controller) { controller.error(new Error('body interrupted')); } }), { status })) as typeof fetch;
      await expect(readResourceSnapshot(table, `${document}#one`, fetcher)).rejects.toMatchObject({ status });
    }
  });
  it('valid JSON own keys are inserted as data while unselected siblings survive', async() => {
    const snapshot = await readResourceSnapshot(table, `${document}#one`, transport().fetcher);
    const partial = JSON.parse('{"matrix":{"__proto__":{"flag":"exact"},"constructor":{"kind":"own"},"toString":"selected"}}');
    const patch = compileProperties(snapshot, table, { metadata: { protocols: partial } });
    const parsed = new Parser({ format: 'N3' }).parse(patch.body);
    const insertion = parsed.find(q => q.graph.termType === 'DefaultGraph' && q.predicate.value === 'http://www.w3.org/ns/solid/terms#inserts');
    expect(insertion).toBeDefined();
    const protocols = parsed.find(q => q.graph.equals(insertion!.object) && q.predicate.value === `${ns}protocols`);
    expect(protocols).toBeDefined();
    const decoded = JSON.parse(protocols!.object.value);
    expect(Object.prototype.hasOwnProperty.call(decoded.matrix, '__proto__')).toBe(true);
    expect(decoded).toEqual(JSON.parse('{"matrix":{"eventId":"old","__proto__":{"flag":"exact"},"constructor":{"kind":"own"},"toString":"selected"},"other":41}'));
  });
  it('existing JSON own keys merge and remove only selected members', async() => {
    const original = JSON.parse('{"matrix":{"eventId":"old","__proto__":{"flag":"old","keep":7}},"other":41}');
    const body = `<${document}#one> <${ns}metadata> _:meta. _:meta <${ns}protocols> ${JSON.stringify(JSON.stringify(original))}^^<http://www.w3.org/2001/XMLSchema#json>.`;
    const snapshot = await readResourceSnapshot(table, `${document}#one`, transport(body).fetcher);
    const patch = compileProperties(snapshot, table, { metadata: { protocols: JSON.parse('{"matrix":{"__proto__":{"flag":null,"next":"current"}}}') } });
    const parsed = new Parser({ format: 'N3' }).parse(patch.body);
    const insertion = parsed.find(q => q.graph.termType === 'DefaultGraph' && q.predicate.value === 'http://www.w3.org/ns/solid/terms#inserts');
    const protocols = parsed.find(q => q.graph.equals(insertion!.object) && q.predicate.value === `${ns}protocols`)!;
    expect(JSON.parse(protocols.object.value)).toEqual(JSON.parse('{"matrix":{"eventId":"old","__proto__":{"keep":7,"next":"current"}},"other":41}'));
  });
  it('deletes exact subject and owned metadata while leaving neighbor assertions', async() => {
    const snapshot = await readResourceSnapshot(table, `${document}#one`, transport().fetcher);
    const patch = compileProperties(snapshot, table, undefined); expect(patch.body).toContain('roles'); expect(patch.body).toContain('bonjour'); expect(patch.body).not.toContain('#two');
  });
  it('rejects shared inline nodes before dispatch', async() => {
    const snapshot = await readResourceSnapshot(table, `${document}#one`, transport(`${text} <${document}#two> <${ns}metadata> _:meta.`).fetcher);
    expect(() => compileProperties(snapshot, table, { metadata: { roles: 'member' } })).toThrow('Shared');
  });
  it('absent inline empty/undefined/null-only partials create no empty child', async() => {
    const snapshot = await readResourceSnapshot(table, `${document}#one`, transport(`<${document}#one> <${ns}title> "old".`).fetcher);
    for (const metadata of [{}, { protocols: undefined }, { protocols: {} }, { protocols: null }, { protocols: { matrix: { eventId: null } } }, { protocols: { matrix: { eventId: undefined } } }]) {
      const patch = compileProperties(snapshot, table, { metadata });
      expect(patch.body.split('solid:where')[0]).not.toContain(`${ns}metadata`);
    }
  });
  it('rejects inverse properties instead of using a dummy resource identity', async() => {
    const inverseTable = podTable('inverse', { id: string('id').primaryKey(), ref: string('ref').predicate(`${ns}ref`).inverse() }, { base: document, type: `${ns}Message` });
    const snapshot = await readResourceSnapshot(inverseTable, `${document}#one`, transport().fetcher);
    expect(() => compileProperties(snapshot, inverseTable, { ref: `${document}#two` })).toThrow('inverse');
  });
  it('rejects HTTP partial snapshots even when the fragment is valid RDF', async() => {
    for (const status of [200, 206]) {
      const partial = (async() => new Response(text, { status, headers: { etag: '"version"', 'content-range': 'bytes 0-50/500' } })) as typeof fetch;
      await expect(readResourceSnapshot(table, `${document}#one`, partial)).rejects.toThrow('complete');
    }
  });
  it('weak versions cannot produce snapshots', async() => { await expect(readResourceSnapshot(table, `${document}#one`, transport(text, 'W/"version"').fetcher)).rejects.toThrow('strong'); });
  it('minimal example performs one snapshot read and keeps unqualified writes unsupported', async() => {
    const { calls, fetcher } = transport();
    const db = drizzle({ info: { isLoggedIn: true, webId: 'https://pod.example/profile#me' }, fetch: fetcher }, { resourcePreparation: 'off' });
    expect((await updateExactResource(db, table, `${document}#one`, { metadata: { protocols: { matrix: { eventId: 'new' } } } })).status).toBe('unsupported');
    expect(calls).toEqual([document]);
  });
  it('unqualified terminal is unsupported with no preparation or mutation; rejects forged/exact mismatches', async() => {
    const { calls, fetcher } = transport(); const db = drizzle({ info: { isLoggedIn: true, webId: 'https://pod.example/profile#me' }, fetch: fetcher }, { resourcePreparation: 'off' });
    const snapshot = await db.readResourceSnapshot(table, `${document}#one`);
    expect((await db.update(table).set({ title: 'new' }).whereByIri(`${document}#one`).executeConditional({ snapshot })).status).toBe('unsupported'); expect(calls).toEqual([document]);
    await expect(db.delete(table).whereByIri(`${document}#two`).executeConditional({ snapshot })).rejects.toThrow('Snapshot');
    await expect(db.delete(table).whereByIri(`${document}#one`).executeConditional({ snapshot: { ...snapshot } })).rejects.toThrow('Snapshot');
  });
});
