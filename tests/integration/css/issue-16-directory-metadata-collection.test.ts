/**
 * Issue #16 — directory-resource collection SELECT over the explicit metadata facet.
 *
 * Real in-process Xpod/CSS runtime, real LDP writes, no fetch mocks.
 *
 * Shape under test: an Agent Home is a directory resource (`/agents/{key}/`).
 * The container document only holds containment triples; the resource's own RDF
 * lives in the server-managed auxiliary `.meta` document, stored in the named
 * graph `meta:{containerIRI}`.
 *
 * Control (must pass): reading that metadata graph explicitly returns the
 * Agent's name. This proves the Pod stores and serves the facet.
 *
 * Desired (issue #16): the generic collection SELECT built for a directory
 * layout binds `GRAPH ?metadataGraph`, bounded to `meta:{collectionBase}`, and
 * verifies the graph belongs to its subject. It must return the Agent as a row
 * with the shared required fields, while an ordinary document table and an
 * exact-by-IRI read keep their current semantics.
 *
 * The ORM emits the canonical single wire shape:
 *   GRAPH ?metadataGraph { ... }
 *   FILTER(STRSTARTS(STR(?metadataGraph), "meta:<base>"))
 *   FILTER(STR(?subject) = STRAFTER(STR(?metadataGraph), "meta:"))
 * Variable names are structural; the Pod-side reader must not depend on
 * literal `?resource`/`?metadataGraph` names.
 *
 * Until the Pod-wide read path serves that shape end to end (xpod#208 plus the
 * native ABI flag gap), the desired collection assertions stay RED on purpose.
 * They are not skipped, mocked, or relaxed to match the defect.
 *
 * Runtime selection: with XPOD_JOINT_RUNTIME_FILE set, this suite runs against
 * an externally owned Gateway (see tests/integration/css/helpers.ts); otherwise
 * it uses the in-process runtime as before.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from '../../../src/driver';
import { id, podTable, string, timestamp } from '../../../src/core/schema';
import { createTestSession, ensureContainer } from './helpers';

const FOAF = 'http://xmlns.com/foaf/0.1/';
const DCT = 'http://purl.org/dc/terms/';

describe('Issue #16: directory-resource collection SELECT reads the explicit metadata facet', () => {
  let session: any;
  let podBase: string;
  let agentsBase: string;
  let agentTable: ReturnType<typeof podTable>;
  const runId = `meta-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const agentKeys = [`${runId}-a`, `${runId}-b`];

  const agentUrl = (key: string) => `${agentsBase}${key}/`;
  const metaUrl = (key: string) => `${agentUrl(key)}.meta`;

  beforeAll(async () => {
    session = await createTestSession({ shared: false });
    podBase = session.info.webId.split('profile')[0];
    // A unique collection namespace per run: the assertion can then compare the
    // WHOLE collection result without inheriting rows from earlier runs.
    agentsBase = `${podBase}agents-${runId}/`;

    await ensureContainer(session, `agents-${runId}/`);
    // A second table proves ordinary document reads are untouched.
    const notesBase = `${podBase}notes-${runId}/`;
    await ensureContainer(session, `notes-${runId}/`);
    void notesBase;

    for (const key of agentKeys) {
      const containerResponse = await session.fetch(agentUrl(key), {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/turtle',
          Link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
        },
      });
      expect(containerResponse.ok, `create ${agentUrl(key)} -> ${containerResponse.status}`).toBe(true);
    }

    // Real .meta auxiliary write: only app-owned created is client-writable;
    // dcterms:modified is server-owned and must never be sent (409).
    const created = new Date();
    for (const [index, key] of agentKeys.entries()) {
      const response = await session.fetch(metaUrl(key), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/sparql-update' },
        // The shared Agent contract declares `rdf:type foaf:Agent`; write it
        // exactly as app-side creation does, so the table's required type
        // pattern is satisfied.
        body: `INSERT DATA { <${agentUrl(key)}> a <${FOAF}Agent>; <${FOAF}name> "Agent ${index}"; <${DCT}created> "${created.toISOString()}"^^<http://www.w3.org/2001/XMLSchema#dateTime> . }`,
      });
      expect(response.status, `patch ${metaUrl(key)} body`).toBeLessThan(300);
    }

    agentTable = podTable('agent_meta_collection', {
      id: id('id').default('{key}/'),
      name: string('name').predicate(`${FOAF}name`).notNull(),
      createdAt: timestamp('createdAt').predicate(`${DCT}created`),
    }, {
      base: `/agents-${runId}/`,
      type: `${FOAF}Agent`,
      sparqlEndpoint: `/agents-${runId}/-/sparql`,
      autoRegister: false,
    });
  }, 180_000);

  afterAll(async () => {
    for (const key of agentKeys) {
      await session?.fetch?.(agentUrl(key), { method: 'DELETE' }).catch(() => undefined);
    }
    await session?.fetch?.(agentsBase, { method: 'DELETE' }).catch(() => undefined);
  }, 60_000);

  function makeDb() {
    return drizzle(session, {
      podUrl: podBase,
      resourcePreparation: 'off',
      schema: { agent: agentTable },
    });
  }

  it('control: the explicit metadata graph holds the Agent name on the real Pod', async () => {
    const db = makeDb();
    const graph = `meta:${agentUrl(agentKeys[0])}`;
    const query = {
      type: 'SELECT' as const,
      query: `SELECT ?name WHERE { GRAPH <${graph}> { <${agentUrl(agentKeys[0])}> <${FOAF}name> ?name } }`,
      prefixes: {},
    };

    const rows = await (db as any).getDialect().getSPARQLExecutor().executeQueryWithSource(
      query,
      `${agentsBase}-/sparql`,
      'sparql',
    );

    // The deployed embedded engine currently returns no rows for a named
    // metadata graph through this endpoint (the graph listing only exposes the
    // data graph). Record that precisely instead of pretending it passed.
    expect(rows.map((row: any) => row.name), 'explicit GRAPH <meta:...> read').toEqual(['Agent 0']);
  }, 60_000);

  it('desired: a fresh collection SELECT returns the directory Agents with required fields', async () => {
    const db = makeDb();
    const rows = await db.select().from(agentTable);

    // Desired contract, asserted on a namespace this run owns exclusively:
    // exactly the created directory resources, each with required fields.
    expect(rows.map((row: any) => row.name).sort()).toEqual(['Agent 0', 'Agent 1']);
    for (const row of rows as any[]) {
      expect(row.id.endsWith('/')).toBe(true);
      expect(row.subject).toBe(`${agentsBase}${row.id}`);
      // The metadata graph IS the row's own facet, never a foreign subject's.
      expect(row.metadataGraph).toBe(`meta:${row.subject}`);
      expect(row.createdAt).toBeInstanceOf(Date);
      expect(Number.isNaN(row.createdAt.getTime())).toBe(false);
    }
  }, 60_000);

  it('desired: a fresh client sees the row after another directory Agent is created', async () => {
    const key = `${runId}-c`;
    agentKeys.push(key);
    const containerResponse = await session.fetch(agentUrl(key), {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/turtle',
        Link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
      },
    });
    expect(containerResponse.ok).toBe(true);
    const metaResponse = await session.fetch(metaUrl(key), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/sparql-update' },
      body: `INSERT DATA { <${agentUrl(key)}> a <${FOAF}Agent>; <${FOAF}name> "Agent fresh"; <${DCT}created> "${new Date().toISOString()}"^^<http://www.w3.org/2001/XMLSchema#dateTime> . }`,
    });
    expect(metaResponse.status).toBeLessThan(300);

    // A brand-new database instance: no cached rows, no earlier query result.
    const freshDb = makeDb();
    const rows = await freshDb.select().from(agentTable);
    expect(rows.map((row: any) => row.name)).toContain('Agent fresh');
  }, 90_000);

  it('keeps exact-by-IRI reads on the concrete directory resource', async () => {
    const db = makeDb();
    const iri = agentUrl(agentKeys[0]);
    const found = await db.findByIri(agentTable, iri);
    expect(found, `findByIri(${iri})`).not.toBeNull();
    expect((found as any).name).toBe('Agent 0');
  }, 60_000);

  it('keeps ordinary document collection SELECT free of metadata rows', async () => {
    const notesBase = `${podBase}notes-${runId}/`;
    const docUrl = `${notesBase}n1.ttl`;
    const docResponse = await session.fetch(docUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/turtle' },
      body: `@prefix schema: <https://schema.org/> . <${docUrl}> a schema:Note; schema:title "Plain note" .`,
    });
    expect(docResponse.ok).toBe(true);

    const noteTable = podTable('note_meta_control', {
      id: id('id').default('{key}.ttl'),
      title: string('title').predicate('https://schema.org/title'),
    }, {
      base: `/notes-${runId}/`,
      type: 'https://schema.org/Note',
      sparqlEndpoint: `/notes-${runId}/-/sparql`,
      autoRegister: false,
    });

    const db = drizzle(session, {
      podUrl: podBase,
      resourcePreparation: 'off',
      schema: { note: noteTable },
    });
    const rows = await db.select().from(noteTable);
    expect(rows.map((row: any) => row.title)).toEqual(['Plain note']);
    await session.fetch(notesBase, { method: 'DELETE' }).catch(() => undefined);
  }, 90_000);
});
