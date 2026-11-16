/**
 * Executes the builder's generated collection query on a real Comunica engine
 * over an in-memory quad store.
 *
 * This is not a network mock: the exact SPARQL text produced for a directory
 * collection is parsed and executed by Comunica's SPARQL 1.1 engine. It proves
 * the shape is valid and that graph<->subject binding happens before
 * ORDER BY/LIMIT, so a foreign same-type triple cannot truncate the collection.
 */
import { describe, expect, it } from 'vitest';
import { DataFactory, Store } from 'n3';
// Use the repo's declared Comunica dependency (peer/dev), not a transitive one.
import { QueryEngine } from '@comunica/query-sparql-solid';
import { SelectBuilder } from '../../../../src/core/sparql/builder/select-builder';
import { id, podTable, string } from '../../../../src/core/schema';
import { UriResolverImpl } from '../../../../src/core/uri';
import {
  resolveDirectoryResourceMetadataLayout,
  toExplicitMetadataGraphSpec,
} from '../../../../src/core/resource-resolver/directory-layout';

const { defaultGraph, literal, namedNode, quad } = DataFactory;
const FOAF_NAME = 'http://xmlns.com/foaf/0.1/name';
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const FOAF_AGENT = 'http://xmlns.com/foaf/0.1/Agent';
const podBase = 'https://pod.example/alice/';
const agentsBase = `${podBase}agents/`;

function agentTable() {
  return podTable('agent_comunica', {
    id: id('id').default('{key}/'),
    name: string('name').predicate(FOAF_NAME).notNull(),
  }, {
    base: '/agents/',
    type: FOAF_AGENT,
    namespace: { prefix: 'foaf', uri: 'http://xmlns.com/foaf/0.1/' },
    autoRegister: false,
  });
}

async function run(query: string, store: Store) {
  const engine = new QueryEngine();
  const bindings = await engine.queryBindings(query, { sources: [store] });
  const rows = await bindings.toArray();
  return rows.map((binding) => ({
    subject: binding.get('subject')?.value,
    name: binding.get('name')?.value,
    metadataGraph: binding.get('metadataGraph')?.value,
  }));
}

describe('directory metadata collection query on real Comunica', () => {
  it('returns own facets and ignores foreign metadata in the same namespace', async () => {
    const store = new Store();
    const own = `${agentsBase}key-1/`;
    const foreign = `${agentsBase}key-2/`;
    store.addQuad(quad(namedNode(own), namedNode(RDF_TYPE), namedNode(FOAF_AGENT), namedNode(`meta:${own}`)));
    store.addQuad(quad(namedNode(own), namedNode(FOAF_NAME), literal('Own'), namedNode(`meta:${own}`)));
    store.addQuad(quad(namedNode(own), namedNode(FOAF_NAME), literal('Foreign'), namedNode(`meta:${foreign}`)));

    const table = agentTable();
    const layout = resolveDirectoryResourceMetadataLayout(table, agentsBase)!;
    const query = new SelectBuilder(
      { foaf: 'http://xmlns.com/foaf/0.1/' },
      new UriResolverImpl(podBase),
    ).convertSimpleSelect(
      { table },
      undefined,
      undefined,
      false,
      toExplicitMetadataGraphSpec(layout),
    ).query;

    const rows = await run(query, store);

    expect(rows).toEqual([{ subject: own, name: 'Own', metadataGraph: `meta:${own}` }]);
  });

  it('does not let a foreign lexicographically-earlier row eat LIMIT 1', async () => {
    const store = new Store();
    const own = `${agentsBase}key-1/`;
    const foreign = `${agentsBase}key-2/`;
    // 'AAAA foreign' sorts before 'Own'; a post-execution filter with LIMIT 1
    // would return an empty collection.
    store.addQuad(quad(namedNode(own), namedNode(RDF_TYPE), namedNode(FOAF_AGENT), namedNode(`meta:${own}`)));
    store.addQuad(quad(namedNode(own), namedNode(FOAF_NAME), literal('AAAA foreign'), namedNode(`meta:${foreign}`)));
    store.addQuad(quad(namedNode(own), namedNode(FOAF_NAME), literal('Own'), namedNode(`meta:${own}`)));

    const table = agentTable();
    const layout = resolveDirectoryResourceMetadataLayout(table, agentsBase)!;
    const query = new SelectBuilder(
      { foaf: 'http://xmlns.com/foaf/0.1/' },
      new UriResolverImpl(podBase),
    ).convertSimpleSelect(
      { table, limit: 1, orderBy: [{ column: 'name', direction: 'asc' }] },
      undefined,
      undefined,
      false,
      toExplicitMetadataGraphSpec(layout),
    ).query;

    const rows = await run(query, store);

    expect(rows.map((row) => row.name)).toEqual(['Own']);
  });

  it('keeps ordinary document queries free of metadata rows', async () => {
    const store = new Store();
    const doc = 'https://pod.example/alice/notes/n1.ttl';
    // Ordinary document reads use the un-named/data-graph query shape.
    store.addQuad(quad(namedNode(doc), namedNode(RDF_TYPE), namedNode('https://schema.org/Note'), defaultGraph()));
    store.addQuad(quad(namedNode(doc), namedNode('https://schema.org/title'), literal('Note'), defaultGraph()));

    const table = podTable('note_comunica', {
      id: id('id').default('{key}.ttl'),
      title: string('title').predicate('https://schema.org/title'),
    }, {
      base: '/notes/',
      type: 'https://schema.org/Note',
      namespace: { prefix: 'schema', uri: 'https://schema.org/' },
      autoRegister: false,
    });

    const query = new SelectBuilder(
      { schema: 'https://schema.org/' },
      new UriResolverImpl(podBase),
    ).convertSimpleSelect({ table }, undefined, undefined, false).query;

    const rows = await run(query, store);

    expect(rows).toEqual([{ subject: doc, name: undefined, metadataGraph: undefined }]);
    expect(query).not.toContain('metadataGraph');
  });
});
