/**
 * Collection SELECT strategy wiring for directory-resource metadata facets.
 *
 * The strategy is the only place that decides to bind the explicit metadata
 * graph, and the only place that enforces graph<->subject ownership on the
 * returned rows. No network: a fake executor captures the generated query.
 */
import { describe, expect, it, vi } from 'vitest';
import { SparqlStrategy } from '../../../src/core/execution/sparql-strategy';
import { ASTToSPARQLConverter } from '../../../src/core/ast-to-sparql';
import { ResourceResolverFactoryImpl } from '../../../src/core/resource-resolver';
import { id, podTable, string } from '../../../src/core/schema';
import { UriResolverImpl } from '../../../src/core/uri';

const podBase = 'https://pod.example/alice/';
const ns = { prefix: 'ex', uri: 'https://example.org/' };
const FOAF_AGENT = 'http://xmlns.com/foaf/0.1/Agent';
const AGENTS_BASE = `${podBase}agents/`;
const SPARQL_ENDPOINT = `${AGENTS_BASE}-/sparql`;

function agentLikeTable() {
  return podTable('agent_strategy', {
    id: id('id').default('{key}/'),
    name: string('name').predicate('http://xmlns.com/foaf/0.1/name').notNull(),
  }, {
    base: '/agents/',
    type: FOAF_AGENT,
    namespace: ns,
    sparqlEndpoint: '/agents/-/sparql',
    autoRegister: false,
  });
}

function ordinaryTable() {
  return podTable('note_strategy', {
    id: id('id').default('{key}.ttl'),
    title: string('title').predicate('https://schema.org/title'),
  }, {
    base: '/notes/',
    type: 'https://schema.org/Note',
    namespace: ns,
    sparqlEndpoint: '/notes/-/sparql',
    autoRegister: false,
  });
}

function buildStrategy(resultRows: any[] = []) {
  const executeQueryWithSource = vi.fn().mockResolvedValue(resultRows);
  const resolverFactory = new ResourceResolverFactoryImpl(podBase);
  const strategy = new SparqlStrategy({
    sparqlExecutor: { executeQueryWithSource } as any,
    sparqlConverter: new ASTToSPARQLConverter(podBase, undefined, new UriResolverImpl(podBase)),
    sessionFetch: vi.fn() as any,
    podUrl: podBase,
    uriResolver: new UriResolverImpl(podBase),
    getResolver: (table) => resolverFactory.getResolver(table),
  });
  return { strategy, executeQueryWithSource };
}

function planFor(table: ReturnType<typeof podTable>) {
  return {
    baseTable: table,
    baseAlias: table.config.name,
    selectAll: true,
    aliasToTable: new Map([[table.config.name, table]]),
    tableToAlias: new Map([[table, table.config.name]]),
  } as any;
}

describe('SparqlStrategy directory-resource metadata collection read', () => {
  it('binds one explicit bounded metadata graph for a directory collection SELECT', async () => {
    const table = agentLikeTable();
    const { strategy, executeQueryWithSource } = buildStrategy();

    await strategy.executeSelect(planFor(table), AGENTS_BASE, SPARQL_ENDPOINT);

    expect(executeQueryWithSource).toHaveBeenCalledTimes(1);
    const [query] = executeQueryWithSource.mock.calls[0];
    const text = String(query.query);
    expect(text).toContain('GRAPH ?metadataGraph');
    expect(text).toContain(`FILTER(STRSTARTS(STR(?metadataGraph), "meta:${AGENTS_BASE}"))`);
    expect(text).toContain('?metadataGraph');
    // The endpoint default dataset is untouched.
    expect(text).not.toMatch(/\bFROM\b/);
    expect(text).not.toContain('meta:meta:');
  });

  it('leaves ordinary document collection SELECT untouched', async () => {
    const table = ordinaryTable();
    const { strategy, executeQueryWithSource } = buildStrategy();

    await strategy.executeSelect(planFor(table), `${podBase}notes/`, `${podBase}notes/-/sparql`);

    const text = String(executeQueryWithSource.mock.calls[0][0].query);
    expect(text).not.toContain('metadataGraph');
    expect(text).not.toMatch(/\bFROM\b/);
  });

  it('never binds metadata for exact-by-IRI reads', async () => {
    const table = agentLikeTable();
    const { strategy, executeQueryWithSource } = buildStrategy();
    const iri = `${AGENTS_BASE}key-1/`;

    await strategy.executeSelect(
      planFor(table),
      AGENTS_BASE,
      SPARQL_ENDPOINT,
      { exactResource: iri },
    );

    const [query, sourceUrl] = executeQueryWithSource.mock.calls[0];
    expect(String(query.query)).not.toContain('metadataGraph');
    // The concrete document stays the exact target.
    expect(sourceUrl).toBe(iri);
  });

  it('drops rows whose graph does not belong to their subject', async () => {
    const table = agentLikeTable();
    const own = `${AGENTS_BASE}key-1/`;
    const foreign = `${AGENTS_BASE}key-2/`;
    const { strategy } = buildStrategy([
      { subject: own, name: 'Own', metadataGraph: `meta:${own}` },
      { subject: own, name: 'Foreign', metadataGraph: `meta:${foreign}` },
      { subject: own, name: 'Data graph', metadataGraph: own },
      { subject: own, name: 'No graph', metadataGraph: undefined },
    ]);

    const rows = await strategy.executeSelect(planFor(table), AGENTS_BASE, SPARQL_ENDPOINT);

    expect(rows.map((row) => row.name)).toEqual(['Own']);
  });
});
