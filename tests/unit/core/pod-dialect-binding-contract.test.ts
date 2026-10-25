/**
 * Review F1/F2/F3 regressions, driven by the REAL public builders.
 *
 * F1: an ordinary column whose name merely ends with `@id` (external@id) is a
 *     filter, never the RDF subject. The collection stays bound; whereByIri
 *     stays exact.
 * F2: INSERT/UPDATE/DELETE never evaluate the collection-SELECT resolver, so a
 *     throwing resolver cannot break canonical LDP writes.
 * F3: a bound SELECT mutates no shared table state (endpoint/base/template);
 *     a resolver-declined table keeps baseline discovery.
 */
import { describe, expect, it, vi } from 'vitest';
import { drizzle } from '@src/driver';
import { eq } from '@src/core/query-conditions';
import { id, podTable, string } from '@src/core/schema';

const ROOM_A = 'https://example.com/alice/.data/notes/room-a/';
const ROOM_B = 'https://example.com/alice/.data/notes/room-b/';
const BASE = 'https://example.com/alice/.data/notes/';
const IRI_B = `${ROOM_B}index.ttl#this`;

const notes = podTable('notes', {
  id: id('id'),
  title: string('title').predicate('https://schema.org/name'),
  ['external@id']: string('external@id').predicate('https://example.com/externalId'),
  ['note@id']: string('note@id').predicate('https://example.com/noteId'),
}, {
  base: BASE,
  type: 'https://example.com/Note',
  sparqlEndpoint: `${BASE}-/sparql`,
});

function sessionStub() {
  return {
    info: { isLoggedIn: true, webId: 'https://example.com/alice/profile/card#me' },
    fetch: vi.fn(async () => new Response('', { status: 200 })),
  };
}

function createDb(option?: unknown) {
  return drizzle(sessionStub() as any, {
    schema: { notes },
    podUrl: 'https://example.com/alice/',
    resourcePreparation: 'off',
    ...(option === undefined ? {} : { sparqlEndpoint: option as any }),
  });
}

function captureSources(db: any) {
  const dialect: any = db.dialect;
  const calls: Array<{ source: string; type: string }> = [];
  dialect.sparqlExecutor.executeQueryWithSource = vi.fn(
    async (_q: unknown, source: string, type = 'auto') => {
      calls.push({ source, type });
      return [];
    },
  );
  dialect.sparqlExecutor.queryContainer = vi.fn(async (source: string) => {
    calls.push({ source, type: 'ldp-container' });
    return [];
  });
  return calls;
}

describe('F1 — only the canonical subject operand is exact', () => {
  it('keeps a suffixed ordinary column filter on the bound collection endpoint', async () => {
    const db = createDb(`${ROOM_A}-/sparql`);
    const calls = captureSources(db);

    await db.select().from(notes).where(eq((notes as any)['external@id'], IRI_B));

    expect(calls).toHaveLength(1);
    expect(calls[0].source).toBe(`${ROOM_A}-/sparql`);
    expect(calls[0].type).toBe('sparql');
  });

  it('treats a note@id filter as a collection query too', async () => {
    const db = createDb(`${ROOM_A}-/sparql`);
    const calls = captureSources(db);

    await db.select().from(notes).where(eq((notes as any)['note@id'], IRI_B));

    expect(calls[0].source).toBe(`${ROOM_A}-/sparql`);
  });

  it('still routes the real whereByIri subject to the concrete document', async () => {
    const db = createDb(`${ROOM_A}-/sparql`);
    const calls = captureSources(db);

    await db.select().from(notes).whereByIri(IRI_B);

    expect(calls).toHaveLength(1);
    expect(calls[0].source).toBe(`${ROOM_B}index.ttl`);
  });

  it('rejects a plain object that carries extra predicates', async () => {
    const db = createDb(`${ROOM_A}-/sparql`);
    const calls = captureSources(db);
    const dialect: any = db.dialect;

    await dialect.query({
      type: 'select',
      table: notes,
      where: { '@id': IRI_B, title: 'not-exact' },
      plan: { baseTable: notes, baseAlias: 'notes' },
    });

    expect(calls[0].source).toBe(`${ROOM_A}-/sparql`);
  });
});

describe('F2 — writes never evaluate the SELECT resolver', () => {
  it('does not call the resolver for INSERT even when it would throw', async () => {
    const resolver = vi.fn(() => {
      throw new Error('room binding unavailable');
    });
    const db = createDb(resolver);
    const dialect: any = db.dialect;

    // Discovery must actually find a location so it reaches endpoint probing,
    // which is where a SELECT resolver could otherwise be consulted.
    dialect.discovery.discover = vi.fn().mockResolvedValue([
      { container: 'https://example.com/alice/.data/write-discovered/' },
    ]);
    const optionsProbe = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    dialect.runtime.getFetch = () => optionsProbe;
    dialect.ensureContainerExists = vi.fn().mockResolvedValue(undefined);
    dialect.ensureResourceExists = vi.fn().mockResolvedValue(undefined);
    const ldpInsert = vi.fn().mockResolvedValue([
      { success: true, source: `${BASE}notes.ttl`, status: 201 },
    ]);
    dialect.strategyFactory.getLdpStrategy = () => ({ mode: 'ldp', executeSelect: vi.fn(), executeInsert: ldpInsert });
    dialect.getLdpStrategy = () => ({ mode: 'ldp', executeSelect: vi.fn(), executeInsert: ldpInsert });

    const table = podTable('writeNotes', {
      id: id('id'),
      title: string('title').predicate('https://schema.org/name'),
    }, {
      base: `${BASE}write/`,
      type: 'https://example.com/WriteNote',
      typeIndex: 'private',
    });

    const insertQuery: any = db.insert(table).values({ id: 'x', title: 'X' });
    await (insertQuery?.then?.((v: unknown) => v, () => undefined) ?? insertQuery);

    expect(resolver).not.toHaveBeenCalled();
  });

  it('still evaluates the resolver for SELECT (exactly once per query)', async () => {
    const resolver = vi.fn(() => `${ROOM_A}-/sparql`);
    const db = createDb(resolver);
    captureSources(db);
    (db as any).dialect.discovery.discover = vi.fn().mockResolvedValue([]);

    await db.select().from(notes);

    expect(resolver).toHaveBeenCalledTimes(1);
  });
});

describe('F3 — bound SELECT does not mutate shared table state', () => {
  function typeIndexTable() {
    return podTable('discoveredNotes', {
      id: id('id'),
      title: string('title').predicate('https://schema.org/name'),
    }, {
      base: BASE,
      type: 'https://example.com/DiscoveredNote',
      typeIndex: 'private',
      subjectTemplate: '{id}.ttl#it',
    });
  }

  it('leaves endpoint, base and subjectTemplate untouched when bound', async () => {
    const table = typeIndexTable();
    const before = {
      endpoint: table.getSparqlEndpoint(),
      base: table.config.base,
      template: table.getSubjectTemplate?.(),
    };

    const db = createDb(() => `${ROOM_A}-/sparql`);
    const dialect: any = db.dialect;
    captureSources(db);
    dialect.discovery.discover = vi.fn().mockResolvedValue([
      {
        container: 'https://example.com/alice/.data/discovered-elsewhere/',
        subjectTemplate: '{id}.ttl#other',
      },
    ]);

    await db.select().from(table);

    expect(table.getSparqlEndpoint()).toBe(before.endpoint);
    expect(table.config.base).toBe(before.base);
    expect(table.getSubjectTemplate?.()).toBe(before.template);
  });

  it('keeps two concurrently bound DBs isolated on the same table', async () => {
    const table = typeIndexTable();
    const dbA = createDb(() => `${ROOM_A}-/sparql`);
    const dbB = createDb(() => `${ROOM_B}-/sparql`);
    const callsA = captureSources(dbA);
    const callsB = captureSources(dbB);

    for (const db of [dbA, dbB]) {
      (db as any).dialect.discovery.discover = vi.fn().mockResolvedValue([
        { container: 'https://example.com/alice/.data/discovered-elsewhere/' },
      ]);
    }

    await Promise.all([
      dbA.select().from(table),
      dbB.select().from(table),
    ]);

    expect(callsA[0].source).toBe(`${ROOM_A}-/sparql`);
    expect(callsB[0].source).toBe(`${ROOM_B}-/sparql`);
    expect(table.config.base).toBe(BASE);
  });

  it('lets a declined table keep baseline discovery (base/template/endpoint)', async () => {
    const table = typeIndexTable();
    const db = createDb(() => undefined);
    const dialect: any = db.dialect;
    captureSources(db);
    const discovered = 'https://example.com/alice/.data/discovered/';
    dialect.discovery.discover = vi.fn().mockResolvedValue([
      { container: discovered, subjectTemplate: '{id}.ttl#it' },
    ]);
    const optionsProbe = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    dialect.runtime.getFetch = () => optionsProbe;

    await db.select().from(table);

    expect(table.config.base).toContain('discovered');
    expect(optionsProbe).toHaveBeenCalled();
  });
});

describe('F4 — protocol-relative binding is rejected', () => {
  it('throws instead of resolving //host against the Pod', () => {
    const db = createDb('//evil.example/sparql');
    const dialect: any = db.dialect;

    expect(() => dialect.resolveBoundSelectEndpoint(notes))
      .toThrow(/protocol-relative/);
  });

  it('still accepts absolute http(s) and Pod-relative input', () => {
    const absolute = createDb('https://other.example/sparql');
    const relative = createDb('/.data/notes/room-a/-/sparql');

    expect((absolute as any).dialect.resolveBoundSelectEndpoint(notes))
      .toBe('https://other.example/sparql');
    expect((relative as any).dialect.resolveBoundSelectEndpoint(notes))
      .toBe('https://example.com/alice/.data/notes/room-a/-/sparql');
  });
});
