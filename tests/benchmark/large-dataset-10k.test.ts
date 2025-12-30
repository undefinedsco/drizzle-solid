/**
 * Large Dataset Benchmark (10000 records)
 * 测试大规模数据集的性能
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from '../../src/driver';
import { createTestSession } from '../integration/css/helpers';
import { podTable, string, id, int } from '../../src/core/pod-table';
import { eq, gt } from '../../src/core/query-conditions';

describe('Large Dataset Benchmark (10000 records)', () => {
  let session: any;
  let podBase: string;
  let resourcePath: string;
  let sparqlEndpoint: string;
  let db: any;
  let sparqlTable: any;
  let fragmentTable: any;
  let dataInserted = false;

  beforeAll(async () => {
    session = await createTestSession({ shared: false });
    podBase = session.info.webId.split('profile')[0];
    resourcePath = `${podBase}benchmark/large-dataset-10k.ttl`;
    sparqlEndpoint = `${resourcePath}/-/sparql`;
    
    db = drizzle(session);

    // SPARQL mode table
    sparqlTable = podTable('sparql-10k', {
      id: id(),
      name: string('name').predicate('http://schema.org/name'),
      category: string('category').predicate('http://schema.org/category'),
      value: int('value').predicate('http://schema.org/value'),
    }, {
      type: 'http://schema.org/BenchItem_10K',
      base: resourcePath,
      subjectTemplate: '#{id}',
      sparqlEndpoint: sparqlEndpoint,
    });

    // Fragment mode table (no SPARQL endpoint)
    fragmentTable = podTable('frag-10k', {
      id: id(),
      name: string('name').predicate('http://schema.org/name'),
      category: string('category').predicate('http://schema.org/category'),
      value: int('value').predicate('http://schema.org/value'),
    }, {
      type: 'http://schema.org/BenchItem_10K',
      base: resourcePath,
      subjectTemplate: '#{id}',
    });

  }, 300000);

  it('should prepare 10000 records', async () => {
    // Check if data already exists
    console.log('\n=== Checking existing data ===');
    const existing = await db.select().from(sparqlTable).limit(1);
    
    if (existing.length > 0) {
      console.log('Data already exists, skipping insert');
      dataInserted = true;
      return;
    }

    console.log('\n=== Preparing 10000 records ===');
    const TOTAL_RECORDS = 10000;
    const BATCH_SIZE = 500;
    const categories = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    
    const startTime = performance.now();
    let totalInserted = 0;

    for (let batch = 0; batch < TOTAL_RECORDS / BATCH_SIZE; batch++) {
      const records = [];
      for (let i = 0; i < BATCH_SIZE; i++) {
        const idx = batch * BATCH_SIZE + i;
        records.push({
          id: `item-${String(idx).padStart(5, '0')}`,
          name: `Item ${idx}`,
          category: categories[idx % categories.length],
          value: idx,
        });
      }

      console.log(`Inserting batch ${batch + 1}/${TOTAL_RECORDS / BATCH_SIZE} (${records.length} records)...`);
      await db.insert(sparqlTable).values(records);
      totalInserted += records.length;
    }

    const duration = performance.now() - startTime;
    console.log(`\n=== Insert complete ===`);
    console.log(`Total records: ${totalInserted}`);
    console.log(`Total time: ${(duration / 1000).toFixed(2)}s`);
    console.log(`Average: ${(duration / totalInserted).toFixed(2)}ms per record`);
    console.log(`Throughput: ${(totalInserted / (duration / 1000)).toFixed(0)} records/sec`);

    dataInserted = true;
    expect(totalInserted).toBe(TOTAL_RECORDS);
  }, 600000);

  it('should benchmark SPARQL SELECT ALL (10000 records)', async () => {
    if (!dataInserted) {
      console.log('Skipping - data not ready');
      return;
    }

    const RUNS = 3;
    const times: number[] = [];

    console.log('\n=== SPARQL SELECT ALL (10000 records) ===');

    // Warmup
    await db.select().from(sparqlTable);

    for (let i = 0; i < RUNS; i++) {
      const start = performance.now();
      const results = await db.select().from(sparqlTable);
      const duration = performance.now() - start;
      times.push(duration);
      console.log(`Run ${i + 1}: ${duration.toFixed(2)}ms (${results.length} records)`);
    }

    const avg = times.reduce((a, b) => a + b) / RUNS;
    console.log(`Average: ${avg.toFixed(2)}ms`);
  }, 300000);

  it('should benchmark SPARQL Filter (50 from 10000)', async () => {
    if (!dataInserted) {
      console.log('Skipping - data not ready');
      return;
    }

    const RUNS = 5;
    const times: number[] = [];

    console.log('\n=== SPARQL Filter category=A (1000/10000) ===');

    // Warmup
    await db.select().from(sparqlTable).where(eq(sparqlTable.columns.category, 'A'));

    for (let i = 0; i < RUNS; i++) {
      const start = performance.now();
      const results = await db.select().from(sparqlTable)
        .where(eq(sparqlTable.columns.category, 'A'));
      const duration = performance.now() - start;
      times.push(duration);
      console.log(`Run ${i + 1}: ${duration.toFixed(2)}ms (${results.length} records)`);
    }

    const avg = times.reduce((a, b) => a + b) / RUNS;
    console.log(`Average: ${avg.toFixed(2)}ms`);
    console.log(`Expected ~1000 records (10% of 10000)`);
  }, 300000);

  it('should benchmark SPARQL Range Filter (50 from 10000)', async () => {
    if (!dataInserted) {
      console.log('Skipping - data not ready');
      return;
    }

    const RUNS = 5;
    const times: number[] = [];

    console.log('\n=== SPARQL Range Filter value>9950 (50/10000) ===');

    // Warmup
    await db.select().from(sparqlTable).where(gt(sparqlTable.columns.value, 9950));

    for (let i = 0; i < RUNS; i++) {
      const start = performance.now();
      const results = await db.select().from(sparqlTable)
        .where(gt(sparqlTable.columns.value, 9950));
      const duration = performance.now() - start;
      times.push(duration);
      console.log(`Run ${i + 1}: ${duration.toFixed(2)}ms (${results.length} records)`);
    }

    const avg = times.reduce((a, b) => a + b) / RUNS;
    console.log(`Average: ${avg.toFixed(2)}ms`);
    console.log(`Expected ~49 records (value 9951-9999)`);
  }, 300000);

  it('should compare SPARQL vs Fragment mode (1000 records filter)', async () => {
    if (!dataInserted) {
      console.log('Skipping - data not ready');
      return;
    }

    console.log('\n=== SPARQL vs Fragment: Filter category=A (1000/10000) ===');

    // Warmup both
    await db.select().from(sparqlTable).where(eq(sparqlTable.columns.category, 'A'));
    await db.select().from(fragmentTable).where(eq(fragmentTable.columns.category, 'A'));

    const RUNS = 3;
    const sparqlTimes: number[] = [];
    const fragTimes: number[] = [];

    for (let i = 0; i < RUNS; i++) {
      // SPARQL
      const s1 = performance.now();
      const r1 = await db.select().from(sparqlTable)
        .where(eq(sparqlTable.columns.category, 'A'));
      sparqlTimes.push(performance.now() - s1);

      // Fragment
      const s2 = performance.now();
      const r2 = await db.select().from(fragmentTable)
        .where(eq(fragmentTable.columns.category, 'A'));
      fragTimes.push(performance.now() - s2);

      console.log(`Run ${i + 1}: SPARQL ${sparqlTimes[i].toFixed(0)}ms (${r1.length}), Fragment ${fragTimes[i].toFixed(0)}ms (${r2.length})`);
    }

    const avgSparql = sparqlTimes.reduce((a, b) => a + b) / RUNS;
    const avgFrag = fragTimes.reduce((a, b) => a + b) / RUNS;

    console.log(`\nSPARQL Average: ${avgSparql.toFixed(2)}ms`);
    console.log(`Fragment Average: ${avgFrag.toFixed(2)}ms`);
    console.log(`SPARQL is ${(avgFrag / avgSparql).toFixed(2)}x faster`);
  }, 600000);

  it('should display summary', async () => {
    console.log('\n' + '='.repeat(80));
    console.log('LARGE DATASET BENCHMARK SUMMARY (10000 records)');
    console.log('='.repeat(80));
    console.log('Tests run with warmup and multiple iterations');
    console.log('Data: 10000 records with 10 categories');
    console.log('Filter tests: category=A returns ~1000 records (10%)');
    console.log('='.repeat(80));
  });
});
