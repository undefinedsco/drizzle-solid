/**
 * Public-API regression: grouped/aggregate SELECT over a DIRECTORY table.
 *
 * Directory tables carry an explicit metadata-graph binding. That binding must
 * stay in WHERE (own-facet correlation) while the graph variable is NOT
 * projected for grouped plans: SPARQL rejects a projected variable that is
 * neither grouped nor aggregated (`Projection of ungrouped variable`).
 *
 * Grouping by the graph variable is deliberately rejected as a fix: it would
 * split identical rows into per-graph partitions and change public aggregate
 * results. The correct shape is unchanged grouping + WHERE-only correlation.
 *
 * The strategy's row guard must also not discard aggregate rows, which
 * legitimately have no graph/subject bindings.
 */
import { describe, expect, it, vi } from 'vitest';
import { SelectBuilder } from '../../../../src/core/sparql/builder/select-builder';
import { ASTToSPARQLConverter } from '../../../../src/core/ast-to-sparql';
import { SparqlStrategy } from '../../../../src/core/execution/sparql-strategy';
import { count } from '../../../../src/core/aggregates';
import { ResourceResolverFactoryImpl } from '../../../../src/core/resource-resolver';
import { id, podTable, string } from '../../../../src/core/schema';
import { UriResolverImpl } from '../../../../src/core/uri';

const podBase = 'https://pod.example/alice/';
const agentsBase = `${podBase}agents/`;
const FOAF_AGENT = 'http://xmlns.com/foaf/0.1/Agent';
const FOAF_NAME = 'http://xmlns.com/foaf/0.1/name';

function directoryTable() {
  return podTable('agent_groupby_meta', {
    id: id('id').default('{key}/'),
    name: string('name').predicate(FOAF_NAME).notNull(),
  }, {
    base: '/agents/',
    type: FOAF_AGENT,
    namespace: { prefix: 'foaf', uri: 'http://xmlns.com/foaf/0.1/' },
    sparqlEndpoint: '/agents/-/sparql',
    autoRegister: false,
  });
}

function groupedPlan(table: ReturnType<typeof directoryTable>, select: any) {
  return {
    baseTable: table,
    baseAlias: 'agent_groupby_meta',
    select,
    selectAll: false,
    groupBy: [{ column: 'name' }],
    aliasToTable: new Map([['agent_groupby_meta', table]]),
    tableToAlias: new Map([[table, 'agent_groupby_meta']]),
  } as any;
}

function metadataSpec(table: ReturnType<typeof directoryTable>) {
  const layout = {
    subjectTemplate: '{key}/',
    collectionBaseIri: agentsBase,
    metadataGraphPrefix: `meta:${agentsBase}`,
  };
  void table;
  return { graphVariable: 'metadataGraph', namespacePrefix: layout.metadataGraphPrefix };
}

describe('directory GROUP BY aggregate (public query shape)', () => {
  const builder = new SelectBuilder({ foaf: 'http://xmlns.com/foaf/0.1/' }, new UriResolverImpl(podBase));

  it('does not project the metadata graph variable for a grouped count', () => {
    const table = directoryTable();
    const result = builder.convertSelectPlan(
      groupedPlan(table, { name: table.columns.name, total: count(table.columns.name) }),
      undefined,
      undefined,
      false,
      metadataSpec(table),
    );

    expect(result.query).toContain('GROUP BY ?name');
    // Illegal projection must be gone...
    expect(result.query).not.toMatch(/SELECT[^{]*\?metadataGraph/);
    // ...while own-facet correlation stays in WHERE.
    expect(result.query).toContain('GRAPH ?metadataGraph');
    expect(result.query).toContain('FILTER(STRSTARTS(STR(?metadataGraph)');
    expect(result.query).toContain('STRAFTER(STR(?metadataGraph), "meta:")');
    // And the result no longer advertises a projected graph binding.
    expect(result.metadataGraphVariable).toBeUndefined();
  });

  it('never groups by the metadata graph (partitions must not change)', () => {
    const table = directoryTable();
    const result = builder.convertSelectPlan(
      groupedPlan(table, { name: table.columns.name, total: count(table.columns.name) }),
      undefined,
      undefined,
      false,
      metadataSpec(table),
    );

    expect(result.query).not.toMatch(/GROUP BY[^\n]*\?metadataGraph/);
    expect(result.query).toMatch(/GROUP BY\s+\?name\b/);
  });

  it('keeps projecting the graph for plain ungrouped collection reads', () => {
    const table = directoryTable();
    const result = builder.convertSimpleSelect(
      { table },
      undefined,
      undefined,
      false,
      metadataSpec(table),
    );

    expect(result.query).toContain('?metadataGraph');
    expect(result.metadataGraphVariable).toBe('metadataGraph');
  });
});

describe('directory grouped aggregates use the client-side aggregate path', () => {
  /**
   * The Pod-side reader requires the metadata graph variable to be projected,
   * which is illegal inside SPARQL GROUP BY. Grouping by the graph instead would
   * change public partitions. Directory tables therefore aggregate client-side
   * from correlated own-facet rows; ordinary tables keep SPARQL GROUP BY.
   */
  function sessionFor(table: ReturnType<typeof directoryTable>, rows: Record<string, any>[]) {
    return {
      execute: vi.fn().mockResolvedValue(rows),
      executeSql: vi.fn(),
      getDialect: () => ({
        getPodUrl: () => podBase,
        getAuthenticatedFetch: () => fetch,
        getUriResolver: () => undefined,
        getTableRegistry: () => new Map(),
        getTableNameRegistry: () => new Map(),
      }),
      select: () => ({ from: () => ({}) }),
    } as any;
  }

  it('aggregates in the client and preserves duplicate-name grouping', async () => {
    const { SelectQueryBuilder } = await import('../../../../src/core/query-builders/select-query-builder');
    const table = directoryTable();
    // Own-facet rows only (the strategy already dropped foreign ones).
    const rows = [
      { subject: `${agentsBase}a/`, name: 'Dup', metadataGraph: `meta:${agentsBase}a/` },
      { subject: `${agentsBase}b/`, name: 'Dup', metadataGraph: `meta:${agentsBase}b/` },
      { subject: `${agentsBase}c/`, name: 'Solo', metadataGraph: `meta:${agentsBase}c/` },
    ];
    const session = sessionFor(table, rows);

    const result = await new SelectQueryBuilder(session, {
      name: table.columns.name,
      total: count(table.columns.name),
    }).from(table).groupBy(table.name);

    expect(result).toEqual([{ name: 'Dup', total: 2 }, { name: 'Solo', total: 1 }]);
  });

  it('COUNT(*) also aggregates in the client for directory tables', async () => {
    const { SelectQueryBuilder } = await import('../../../../src/core/query-builders/select-query-builder');
    const table = directoryTable();
    const rows = [
      { subject: `${agentsBase}a/`, name: 'Dup', metadataGraph: `meta:${agentsBase}a/` },
      { subject: `${agentsBase}b/`, name: 'Dup', metadataGraph: `meta:${agentsBase}b/` },
    ];
    const session = sessionFor(table, rows);

    const result = await new SelectQueryBuilder(session, {
      name: table.columns.name,
      total: count(),
    }).from(table).groupBy(table.name);

    expect(result).toEqual([{ name: 'Dup', total: 2 }]);
  });
});

describe('directory aggregate rows survive the strategy row guard', () => {
  it('does not discard aggregate rows that have no graph/subject binding', async () => {
    const table = directoryTable();
    const resolverFactory = new ResourceResolverFactoryImpl(podBase);
    const executeQueryWithSource = vi.fn().mockResolvedValue([
      { name: 'Dup', total: 2 },
      { name: 'Solo', total: 1 },
    ]);

    const strategy = new SparqlStrategy({
      sparqlExecutor: { executeQueryWithSource } as any,
      sparqlConverter: new ASTToSPARQLConverter(podBase, undefined, new UriResolverImpl(podBase)),
      sessionFetch: vi.fn() as any,
      podUrl: podBase,
      uriResolver: new UriResolverImpl(podBase),
      getResolver: (t) => resolverFactory.getResolver(t),
    });

    const rows = await strategy.executeSelect(
      groupedPlan(table, { name: table.columns.name, total: count(table.columns.name) }),
      agentsBase,
      `${agentsBase}-/sparql`,
    );

    const sent = String(executeQueryWithSource.mock.calls[0][0].query);
    expect(sent).toContain('GROUP BY ?name');
    expect(sent).not.toMatch(/SELECT[^{]*\?metadataGraph/);
    // The aggregate result must reach the caller unchanged.
    expect(rows).toEqual([{ name: 'Dup', total: 2 }, { name: 'Solo', total: 1 }]);
  });

  it('still drops foreign graph rows for plain ungrouped collection reads', async () => {
    const table = directoryTable();
    const own = `${agentsBase}key-1/`;
    const foreign = `${agentsBase}key-2/`;
    const resolverFactory = new ResourceResolverFactoryImpl(podBase);
    const executeQueryWithSource = vi.fn().mockResolvedValue([
      { subject: own, name: 'Own', metadataGraph: `meta:${own}` },
      { subject: own, name: 'Foreign', metadataGraph: `meta:${foreign}` },
    ]);

    const strategy = new SparqlStrategy({
      sparqlExecutor: { executeQueryWithSource } as any,
      sparqlConverter: new ASTToSPARQLConverter(podBase, undefined, new UriResolverImpl(podBase)),
      sessionFetch: vi.fn() as any,
      podUrl: podBase,
      uriResolver: new UriResolverImpl(podBase),
      getResolver: (t) => resolverFactory.getResolver(t),
    });

    const rows = await strategy.executeSelect(
      { ...groupedPlan(table, undefined), groupBy: undefined, selectAll: true } as any,
      agentsBase,
      `${agentsBase}-/sparql`,
    );

    expect(rows.map((row: any) => row.name)).toEqual(['Own']);
  });
});
