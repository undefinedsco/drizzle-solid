/**
 * Issue #13: per-database collection SELECT endpoint binding.
 *
 * Live CSS/xpod acceptance: real LDP writes, real nested `/-/sparql` routes,
 * no fetch mocks. The shared table mirrors the real room-scoped shape of
 * `@undefineds.co/models` (`base: '/.data/chat/'`, `sparqlEndpoint:
 * '/.data/chat/-/sparql'`, ids like `<room>/index.ttl#this`) without importing
 * or modifying the models package.
 *
 * Proves:
 *  - collection SELECT can be bound to a narrower room endpoint per DB
 *  - two concurrent DBs on the SAME imported table stay isolated
 *  - the shared table's global endpoint is never mutated
 *  - exact-by-IRI reads still target the concrete document
 *  - INSERT keeps the canonical room LDP document
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from '../../../src/driver';
import { podTable, id, string } from '../../../src/core/schema';
import { createTestSession, ensureContainer } from './helpers';

const DC = 'http://purl.org/dc/terms/';
const MEETING = 'http://www.w3.org/ns/pim/meeting#';

describe('Issue #13: room-scoped SELECT endpoint binding', () => {
  let session: any;
  let podBase: string;
  let chatBase: string;
  let roomA: string;
  let roomB: string;
  let sharedTable: ReturnType<typeof podTable>;

  beforeAll(async () => {
    session = await createTestSession({ shared: false });
    podBase = session.info.webId.split('profile')[0];
    const runId = Date.now();
    chatBase = `${podBase}.data/matrix-select-${runId}/`;
    roomA = `${chatBase}matrix-a/`;
    roomB = `${chatBase}matrix-b/`;

    await ensureContainer(session, chatBase.replace(podBase, ''));
    await ensureContainer(session, roomA.replace(podBase, ''));
    await ensureContainer(session, roomB.replace(podBase, ''));

    // Real LDP documents in two sibling rooms, same shared schema/type.
    const writeRoom = async (roomUrl: string, title: string, description: string) => {
      const docUrl = `${roomUrl}index.ttl`;
      const response = await session.fetch(docUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/turtle' },
        body: `
          @prefix dc: <${DC}>.
          @prefix meeting: <${MEETING}>.
          <${docUrl}#this> a meeting:LongChat;
             dc:title "${title}";
             dc:description "${description}".
        `,
      });
      expect(response.ok).toBe(true);
    };
    await writeRoom(roomA, 'Room A', 'only A');
    await writeRoom(roomB, 'Room B', 'only B');

    // Shared table: same object reused by every DB below. It intentionally
    // carries the BROAD chat endpoint to prove per-DB binding overrides it.
    sharedTable = podTable('matrix_select_chat', {
      id: id('id'),
      title: string('title').predicate(`${DC}title`),
      description: string('description').predicate(`${DC}description`),
    }, {
      base: chatBase,
      type: `${MEETING}LongChat`,
      sparqlEndpoint: `${chatBase}-/sparql`,
      autoRegister: false,
    });
  }, 120_000);

  afterAll(async () => {
    await session?.fetch?.(chatBase, { method: 'DELETE' }).catch(() => undefined);
  });

  it('binds collection SELECT to a room endpoint without mutating the shared table', async () => {
    const roomDb = drizzle(session, {
      podUrl: podBase,
      sparqlEndpoint: `${roomA}-/sparql`,
      resourcePreparation: 'off',
      schema: { chat: sharedTable },
    });

    const rows = await roomDb.select().from(sharedTable);
    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe('Room A');
    expect(rows[0].id).toBe('matrix-a/index.ttl#this');
    expect(sharedTable.getSparqlEndpoint()).toBe(`${chatBase}-/sparql`);
  }, 60_000);

  it('keeps two concurrent DB instances on the same table isolated', async () => {
    const roomADb = drizzle(session, {
      podUrl: podBase,
      sparqlEndpoint: `${roomA}-/sparql`,
      resourcePreparation: 'off',
      schema: { chat: sharedTable },
    });
    const roomBDb = drizzle(session, {
      podUrl: podBase,
      sparqlEndpoint: `${roomB}-/sparql`,
      resourcePreparation: 'off',
      schema: { chat: sharedTable },
    });

    const [rowsA, rowsB] = await Promise.all([
      roomADb.select().from(sharedTable),
      roomBDb.select().from(sharedTable),
    ]);

    expect(rowsA.map((row: any) => row.title)).toEqual(['Room A']);
    expect(rowsB.map((row: any) => row.title)).toEqual(['Room B']);
    expect(sharedTable.getSparqlEndpoint()).toBe(`${chatBase}-/sparql`);
  }, 90_000);

  it('keeps exact-by-IRI reads on the concrete document', async () => {
    const roomDb = drizzle(session, {
      podUrl: podBase,
      sparqlEndpoint: `${roomA}-/sparql`,
      resourcePreparation: 'off',
      schema: { chat: sharedTable },
    });

    const iriB = `${roomB}index.ttl#this`;
    const found = await roomDb.findByIri(sharedTable, iriB);
    expect(found).not.toBeNull();
    expect(found?.title).toBe('Room B');
    // Exercise the executor/strategy path too: findByIri alone can succeed via
    // its direct-document fast path without proving the SELECT builder works.
    const selected = await roomDb.select().from(sharedTable).whereByIri(iriB);
    expect(selected.map((row: any) => row.title)).toEqual(['Room B']);
  }, 60_000);

  it('keeps writes on the canonical room LDP document', async () => {
    const roomDb = drizzle(session, {
      podUrl: podBase,
      sparqlEndpoint: `${roomA}-/sparql`,
      resourcePreparation: 'off',
      schema: { chat: sharedTable },
    });

    await roomDb.insert(sharedTable).values({
      id: 'matrix-a/new-room/index.ttl#this',
      title: 'New A',
      description: 'written through LDP',
    });

    const written = await session.fetch(`${roomA}new-room/index.ttl`, {
      headers: { Accept: 'text/turtle' },
    });
    expect(written.ok).toBe(true);
    expect(await written.text()).toContain('New A');

    const wrongRoom = await session.fetch(`${roomB}new-room/index.ttl`);
    expect(wrongRoom.status).toBe(404);
  }, 60_000);

  it('never falls back to the broader table endpoint when the bound route is empty', async () => {
    const roomDb = drizzle(session, {
      podUrl: podBase,
      // Real nested route that has no data. The local allow-all runtime answers
      // 200 with zero bindings; the guarantee under test is that the query is
      // NOT retried against the broader `chatBase/-/sparql` table endpoint,
      // which does hold Room A/B rows.
      sparqlEndpoint: `${chatBase}missing-room/-/sparql`,
      resourcePreparation: 'off',
      schema: { chat: sharedTable },
    });

    const rows = await roomDb.select().from(sharedTable);
    expect(rows).toEqual([]);
    // The broad table endpoint stays untouched and is not silently used.
    expect(sharedTable.getSparqlEndpoint()).toBe(`${chatBase}-/sparql`);
  }, 60_000);
});
