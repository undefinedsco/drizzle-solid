/**
 * Issue #13 review D2: exact-by-IRI through the REAL builder path.
 *
 * These tests drive `db.select().from(t).whereByIri(iri)` (which produces a
 * BinaryExpression condition, not a plain `{ '@id' }` object) and assert the
 * FINAL SPARQL source URL handed to the executor, not just mock arguments.
 */
import { describe, expect, it, vi } from 'vitest';
import { drizzle } from '@src/driver';
import { id, podTable, string } from '@src/core/schema';

const ROOM_A = 'https://example.com/alice/.data/chat/matrix-a/';
const ROOM_B = 'https://example.com/alice/.data/chat/matrix-b/';
const TABLE_BASE = 'https://example.com/alice/.data/chat/';

const chatTable = podTable('chat', {
  id: id('id'),
  title: string('title').predicate('https://schema.org/name'),
}, {
  base: TABLE_BASE,
  type: 'https://schema.org/Thing',
  sparqlEndpoint: `${TABLE_BASE}-/sparql`,
});

function createDb(boundEndpoint?: string | ((table: typeof chatTable) => string | undefined)) {
  const session: any = {
    info: { isLoggedIn: true, webId: 'https://example.com/alice/profile/card#me' },
    fetch: vi.fn(),
  };
  return drizzle(session, {
    schema: { chat: chatTable },
    podUrl: 'https://example.com/alice/',
    resourcePreparation: 'off',
    ...(boundEndpoint === undefined ? {} : { sparqlEndpoint: boundEndpoint as any }),
  });
}

function captureSources(db: any) {
  const dialect: any = db.dialect;
  const calls: Array<{ source: string; type: string }> = [];
  dialect.sparqlExecutor.executeQueryWithSource = vi.fn(
    async (_query: unknown, source: string, type = 'auto') => {
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

describe('exact-by-IRI builder path is never widened by a collection binding', () => {
  it('builds a BinaryExpression condition (documents the real shape)', async () => {
    const db = createDb(`${ROOM_A}-/sparql`);
    const dialect: any = db.dialect;
    let where: any;
    dialect.query = async (op: any) => {
      where = op.where;
      return [];
    };

    await db.select().from(chatTable).whereByIri(`${ROOM_B}index.ttl#this`);

    expect(where.type).toBe('binary_expr');
    expect(where.operator).toBe('=');
    expect(String(where.left?.name ?? where.left)).toContain('@id');
    expect(where.right).toBe(`${ROOM_B}index.ttl#this`);
    expect(where['@id']).toBeUndefined();
  });

  it('sends the concrete document, not the bound room endpoint', async () => {
    const db = createDb(`${ROOM_A}-/sparql`);
    const calls = captureSources(db);

    await db.select().from(chatTable).whereByIri(`${ROOM_B}index.ttl#this`);

    expect(calls).toHaveLength(1);
    expect(calls[0].source).toBe(`${ROOM_B}index.ttl`);
    expect(calls[0].source).not.toBe(`${ROOM_A}-/sparql`);
  });

  it('keeps exact reads on the document even when the binding resolves to a room', async () => {
    const db = createDb(() => `${ROOM_A}-/sparql`);
    const calls = captureSources(db);

    await db.select().from(chatTable).whereByIri(`${ROOM_B}index.ttl#this`);

    expect(calls[0].source).toBe(`${ROOM_B}index.ttl`);
  });

  it('still binds collection SELECT to the room endpoint', async () => {
    const db = createDb(`${ROOM_A}-/sparql`);
    const calls = captureSources(db);

    await db.select().from(chatTable);

    expect(calls[0].source).toBe(`${ROOM_A}-/sparql`);
    expect(calls[0].type).toBe('sparql');
  });

  it('honors findByIri fallback exactness against a sibling room', async () => {
    const db = createDb(`${ROOM_A}-/sparql`);
    const dialect: any = db.dialect;
    const sources: string[] = [];

    // Force the fallback path (no direct-document fast path read).
    (db as any).readPredicateObjectRowsFromDocument = async () => undefined;
    dialect.executeOnResource = async (url: string) => {
      sources.push(url);
      return [];
    };
    const selectSources = captureSources(db);

    await db.findByIri(chatTable, `${ROOM_B}index.ttl#this`);

    const attempted = [...sources, ...selectSources.map((entry) => entry.source)];
    expect(attempted).toContain(`${ROOM_B}index.ttl`);
    expect(attempted).not.toContain(`${ROOM_A}-/sparql`);
  });
});

describe('exact preflight selects in update/delete are not widened either', () => {
  it('routes the update exact preflight to the concrete document', async () => {
    const db = createDb(`${ROOM_A}-/sparql`);
    const calls = captureSources(db);
    const dialect: any = db.dialect;
    dialect.executeOnResource = async () => [];

    // returning() is what triggers the exact preflight SELECT.
    const updateQuery = db.update(chatTable)
      .set({ title: 'Changed' })
      .whereByIri(`${ROOM_B}index.ttl#this`)
      .returning();
    await (updateQuery as any).then?.(() => undefined, () => undefined)
      ?? (updateQuery as any).catch?.(() => undefined);

    const sources = calls.map((entry) => entry.source);
    expect(sources).toContain(`${ROOM_B}index.ttl`);
    expect(sources).not.toContain(`${ROOM_A}-/sparql`);
  });

  it('routes the delete exact preflight to the concrete document', async () => {
    const db = createDb(`${ROOM_A}-/sparql`);
    const calls = captureSources(db);
    const dialect: any = db.dialect;
    dialect.executeOnResource = async () => [];

    const deleteQuery = (db.delete(chatTable) as any)
      .whereByIri(`${ROOM_B}index.ttl#this`)
      .returning();
    await (deleteQuery as any).then?.(() => undefined, () => undefined)
      ?? (deleteQuery as any).catch?.(() => undefined);

    const sources = calls.map((entry) => entry.source);
    expect(sources).toContain(`${ROOM_B}index.ttl`);
    expect(sources).not.toContain(`${ROOM_A}-/sparql`);
  });
});
