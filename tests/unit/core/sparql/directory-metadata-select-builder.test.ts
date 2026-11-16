/**
 * Explicit metadata-facet binding in collection SELECT.
 *
 * The builder must emit one bounded, explicit `GRAPH ?metadataGraph` scope for
 * directory-resource collection reads. It must not add an implicit metadata
 * union to ordinary document SELECTs, must not use FROM, and must keep the
 * ordinary plan's join/order/limit/multivalue semantics intact.
 */
import { describe, expect, it } from 'vitest';
import { SelectBuilder } from '../../../../src/core/sparql/builder/select-builder';
import { podTable, id, string, integer } from '../../../../src/core/schema';
import { UriResolverImpl } from '../../../../src/core/uri';
import { toExplicitMetadataGraphSpec, resolveDirectoryResourceMetadataLayout } from '../../../../src/core/resource-resolver/directory-layout';

const ns = { prefix: 'ex', uri: 'https://example.org/' };
const FOAF_AGENT = 'http://xmlns.com/foaf/0.1/Agent';
const podBase = 'https://pod.example/alice/';

function agentLikeTable() {
  return podTable('agent', {
    id: id('id').default('{key}/'),
    name: string('name').predicate('http://xmlns.com/foaf/0.1/name').notNull(),
    rank: integer('rank').predicate('https://example.org/rank'),
  }, {
    base: '/agents/',
    type: FOAF_AGENT,
    namespace: ns,
    autoRegister: false,
  });
}

function ordinaryTable() {
  return podTable('note', {
    id: id('id').default('{key}.ttl'),
    title: string('title').predicate('https://schema.org/title'),
  }, {
    base: '/notes/',
    type: 'https://schema.org/Note',
    namespace: ns,
    autoRegister: false,
  });
}

function metadataSpec(table = agentLikeTable()) {
  const layout = resolveDirectoryResourceMetadataLayout(table, `${podBase}agents/`);
  expect(layout).not.toBeNull();
  return toExplicitMetadataGraphSpec(layout!);
}

describe('SelectBuilder explicit metadata graph binding', () => {
  const builder = new SelectBuilder({ foaf: 'http://xmlns.com/foaf/0.1/' }, new UriResolverImpl(podBase));

  it('wraps the collection BGP in GRAPH ?metadataGraph and bounds its namespace', () => {
    const table = agentLikeTable();
    const result = builder.convertSimpleSelect({ table }, undefined, undefined, false, metadataSpec(table));

    expect(result.query).toContain('GRAPH ?metadataGraph');
    expect(result.query).toContain('FILTER(STRSTARTS(STR(?metadataGraph), "meta:https://pod.example/alice/agents/"))');
    // Ownership is bound in-query, before ORDER BY/LIMIT, not only post-filtered.
    // Canonical single-contract shape: query-level STRSTARTS + STRAFTER binding.
    expect(result.query).toMatch(/FILTER\(\(?STR\(\?subject\)\)? = \(?STRAFTER\(STR\(\?metadataGraph\), "meta:"\)\)?\)/);
    expect(result.query).not.toContain('BIND(');
    expect(result.query).not.toContain('metadataGraphExpected');
    expect(result.query).toContain('SELECT ?subject');
    expect(result.query).toContain('?metadataGraph');
    expect(result.query).toContain('foaf:name');
    // The metadata facet is never reached through a FROM default dataset.
    expect(result.query).not.toMatch(/\bFROM\b/);
  });

  it('keeps the ordinary document query unchanged (no implicit metadata union)', () => {
    const table = ordinaryTable();
    const result = builder.convertSimpleSelect({ table }, undefined, undefined, false);

    expect(result.query).not.toContain('metadataGraph');
    expect(result.query).not.toMatch(/\bGRAPH\b/);
    expect(result.query).not.toMatch(/\bFROM\b/);
    expect(result.query).toContain('https://schema.org/title');
  });

  it('preserves limit and orderBy inside the metadata collection query', () => {
    const table = agentLikeTable();
    const result = builder.convertSimpleSelect({
      table,
      limit: 5,
      orderBy: [{ column: 'name', direction: 'asc' }],
    }, undefined, undefined, false, metadataSpec(table));

    expect(result.query).toContain('LIMIT 5');
    expect(result.query).toMatch(/ORDER BY\s+\(\?name\)/);
    expect(result.query).toContain('GRAPH ?metadataGraph');
    // Both binding filters precede the modifiers: LIMIT cannot truncate a
    // collection after a foreign row survived.
    const ownershipIndex = result.query.indexOf('STRAFTER(STR(?metadataGraph)');
    expect(ownershipIndex).toBeGreaterThan(-1);
    expect(ownershipIndex).toBeLessThan(result.query.indexOf('ORDER BY'));
    expect(ownershipIndex).toBeLessThan(result.query.indexOf('LIMIT 5'));
  });

  it('binds full plans without altering their projected columns', () => {
    const table = agentLikeTable();
    const plan: any = {
      baseTable: table,
      baseAlias: 'agent',
      selectAll: true,
      aliasToTable: new Map([['agent', table]]),
      tableToAlias: new Map([[table, 'agent']]),
    };

    const result = builder.convertSelectPlan(plan, undefined, undefined, false, metadataSpec(table));

    expect(result.query).toContain('GRAPH ?metadataGraph');
    expect(result.query).toContain('?name');
    expect(result.query).toContain('?rank');
    expect(result.query).toMatch(/FILTER\(STRSTARTS\(STR\(\?metadataGraph\), "meta:/);
    expect(result.query).toMatch(/FILTER\(\(?STR\(\?subject\)\)? = \(?STRAFTER\(STR\(\?metadataGraph\), "meta:"\)\)?\)/);
  });

  it('does not widen exact-by-IRI select plans', () => {
    const table = agentLikeTable();
    const plan: any = {
      baseTable: table,
      baseAlias: 'agent',
      selectAll: true,
      conditionTree: {
        type: 'binary_expr',
        left: { name: 'id' },
        operator: '=',
        right: `${podBase}agents/key-1/`,
      },
      aliasToTable: new Map([['agent', table]]),
      tableToAlias: new Map([[table, 'agent']]),
    };

    const result = builder.convertSelectPlan(plan, undefined, undefined, false);

    expect(result.query).not.toContain('metadataGraph');
    // Exact plans keep their pinned subject filter; no metadata graph appears.
    expect(result.query).toContain('FILTER(?subject = <https://pod.example/alice/agents/key-1/>)');
  });

  it('does not hardcode the graph variable name (structural alias support)', () => {
    const table = agentLikeTable();
    const layout = resolveDirectoryResourceMetadataLayout(table, `${podBase}agents/`)!;
    const renamed = { graphVariable: 'facetGraph', namespacePrefix: layout.metadataGraphPrefix };
    const result = builder.convertSimpleSelect({ table }, undefined, undefined, false, renamed);

    expect(result.query).toContain('GRAPH ?facetGraph');
    expect(result.query).toContain('STRSTARTS(STR(?facetGraph)');
    expect(result.query).toContain('STRAFTER(STR(?facetGraph)');
    expect(result.query).toContain('?facetGraph');
    // The subject variable is the plan's structural subject, not a rename.
    expect(result.query).toContain('FILTER((STR(?subject))');
  });
});
