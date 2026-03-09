/**
 * 测试 SPARQL Filter 下推性能
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createTestSession, ensureContainer } from '../integration/css/helpers';

const TEST_PATH = 'benchmark/v2/';
const TOTAL_RECORDS = 500;
const FILTER_TARGET = 50;

function buildLargeDatasetTurtle() {
  const triples: string[] = [
    '@prefix schema: <http://schema.org/>.',
    '@prefix xsd: <http://www.w3.org/2001/XMLSchema#>.',
  ];

  for (let i = 0; i < TOTAL_RECORDS; i++) {
    const category = i < FILTER_TARGET ? 'target' : 'other';
    triples.push(`
<#item-${i}> a <http://schema.org/BenchItem_LargeDataset>;
  schema:identifier "${i}";
  schema:name "Item ${i}";
  schema:category "${category}";
  schema:value ${i * 10}.`);
  }

  return triples.join('\n');
}

describe('SPARQL Filter Pushdown Test', () => {
  let session: any;
  let podBase: string;
  let resourcePath: string;
  let sparqlEndpoint: string;

  beforeAll(async () => {
    session = await createTestSession({ shared: false });
    podBase = session.info.webId.split('profile')[0];
    await ensureContainer(session, TEST_PATH);

    resourcePath = `${podBase}${TEST_PATH}large-dataset.ttl`;
    sparqlEndpoint = `${resourcePath}/-/sparql`;

    const response = await session.fetch(resourcePath, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/turtle' },
      body: buildLargeDatasetTurtle(),
    });

    expect(response.ok).toBe(true);
    
    console.log('Testing SPARQL endpoint:', sparqlEndpoint);
  }, 60000);

  it('Direct SPARQL query comparison', async () => {
    // Query 1: Select ALL (只选2个字段减少传输)
    const queryAll = `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      SELECT ?subject ?category WHERE {
        GRAPH <${resourcePath}> {
          ?subject rdf:type <http://schema.org/BenchItem_LargeDataset>.
          ?subject <http://schema.org/category> ?category.
        }
      }
    `;

    // Query 2: Select with FILTER
    const queryFiltered = `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      SELECT ?subject ?category WHERE {
        GRAPH <${resourcePath}> {
          ?subject rdf:type <http://schema.org/BenchItem_LargeDataset>.
          ?subject <http://schema.org/category> ?category.
          FILTER(?category = "target")
        }
      }
    `;

    // Warmup
    await session.fetch(sparqlEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sparql-query', 'Accept': 'application/sparql-results+json' },
      body: queryAll
    });

    // Test: Multiple runs to get average
    console.log('\n=== SPARQL Filter Pushdown Test ===');
    
    const times1: number[] = [];
    const times2: number[] = [];
    let count1 = 0, count2 = 0;
    
    for (let i = 0; i < 5; i++) {
      const s1 = performance.now();
      const r1 = await (await session.fetch(sparqlEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sparql-query', 'Accept': 'application/sparql-results+json' },
        body: queryAll
      })).json();
      times1.push(performance.now() - s1);
      count1 = r1.results.bindings.length;

      const s2 = performance.now();
      const r2 = await (await session.fetch(sparqlEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sparql-query', 'Accept': 'application/sparql-results+json' },
        body: queryFiltered
      })).json();
      times2.push(performance.now() - s2);
      count2 = r2.results.bindings.length;
    }

    const avg1 = times1.reduce((a, b) => a + b) / times1.length;
    const avg2 = times2.reduce((a, b) => a + b) / times2.length;
    
    console.log(`SELECT ALL: ${count1} records, avg ${avg1.toFixed(2)}ms`);
    console.log(`SELECT FILTER: ${count2} records, avg ${avg2.toFixed(2)}ms`);
    console.log(`Speedup: ${(avg1 / avg2).toFixed(2)}x`);
    console.log(`Raw times ALL: ${times1.map(t => t.toFixed(0)).join(', ')}ms`);
    console.log(`Raw times FILTER: ${times2.map(t => t.toFixed(0)).join(', ')}ms`);

    expect(count1).toBe(TOTAL_RECORDS);
    expect(count2).toBe(FILTER_TARGET);
  }, 60000);
});
