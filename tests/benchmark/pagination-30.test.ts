/**
 * Pagination Benchmark - 30 records per page
 * 测试典型分页查询（一页30条）的性能
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { drizzle } from '../../src/driver';
import { createTestSession } from '../integration/css/helpers';
import { podTable, string, id, int } from '../../src/core/pod-table';
import { eq, gt, lt, and } from '../../src/core/query-conditions';

describe('Pagination Benchmark (30 records per page)', () => {
  let session: any;
  let podBase: string;
  let resourcePath: string;
  let sparqlEndpoint: string;
  let db: any;
  let sparqlTable: any;
  let fragmentTable: any;

  beforeAll(async () => {
    session = await createTestSession({ shared: false });
    podBase = session.info.webId.split('profile')[0];
    // 使用已有的 10k 数据集
    resourcePath = `${podBase}benchmark/large-dataset-10k.ttl`;
    sparqlEndpoint = `${resourcePath}/-/sparql`;
    
    db = drizzle(session);

    // SPARQL mode table
    sparqlTable = podTable('sparql-page', {
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
    fragmentTable = podTable('frag-page', {
      id: id(),
      name: string('name').predicate('http://schema.org/name'),
      category: string('category').predicate('http://schema.org/category'),
      value: int('value').predicate('http://schema.org/value'),
    }, {
      type: 'http://schema.org/BenchItem_10K',
      base: resourcePath,
      subjectTemplate: '#{id}',
    });

    // Warmup
    console.log('Warming up...');
    await db.select().from(sparqlTable).limit(1);
    await db.select().from(fragmentTable).limit(1);
    console.log('Warmup complete\n');
  }, 120000);

  it('SPARQL: Filter to get ~30 records (value > 9970)', async () => {
    const RUNS = 5;
    const times: number[] = [];

    console.log('=== SPARQL: Filter ~30 records (value > 9970) ===');

    for (let i = 0; i < RUNS; i++) {
      const start = performance.now();
      // 获取 value > 9970 的记录（约29条：9971-9999）
      const results = await db.select().from(sparqlTable)
        .where(gt(sparqlTable.columns.value, 9970));
      const duration = performance.now() - start;
      times.push(duration);
      console.log(`Run ${i + 1}: ${duration.toFixed(0)}ms (${results.length} records)`);
    }

    const avg = times.reduce((a, b) => a + b) / RUNS;
    console.log(`Average: ${avg.toFixed(2)}ms\n`);
  }, 120000);

  it('Fragment: Filter to get ~30 records (value > 9970)', async () => {
    const RUNS = 3; // Fragment 模式较慢，减少运行次数
    const times: number[] = [];

    console.log('=== Fragment: Filter ~30 records (value > 9970) ===');

    for (let i = 0; i < RUNS; i++) {
      const start = performance.now();
      const results = await db.select().from(fragmentTable)
        .where(gt(fragmentTable.columns.value, 9970));
      const duration = performance.now() - start;
      times.push(duration);
      console.log(`Run ${i + 1}: ${duration.toFixed(0)}ms (${results.length} records)`);
    }

    const avg = times.reduce((a, b) => a + b) / RUNS;
    console.log(`Average: ${avg.toFixed(2)}ms\n`);
  }, 300000);

  it('SPARQL vs Fragment: Paginate ~30 records comparison', async () => {
    console.log('=== Direct Comparison: ~30 records (value > 9970) ===\n');

    const RUNS = 5;
    const sparqlTimes: number[] = [];
    const fragTimes: number[] = [];
    let sparqlCount = 0;
    let fragCount = 0;

    for (let i = 0; i < RUNS; i++) {
      // SPARQL
      const s1 = performance.now();
      const r1 = await db.select().from(sparqlTable)
        .where(gt(sparqlTable.columns.value, 9970));
      sparqlTimes.push(performance.now() - s1);
      sparqlCount = r1.length;

      // Fragment (only 3 runs to save time)
      if (i < 3) {
        const s2 = performance.now();
        const r2 = await db.select().from(fragmentTable)
          .where(gt(fragmentTable.columns.value, 9970));
        fragTimes.push(performance.now() - s2);
        fragCount = r2.length;
      }
    }

    const avgSparql = sparqlTimes.reduce((a, b) => a + b) / sparqlTimes.length;
    const avgFrag = fragTimes.reduce((a, b) => a + b) / fragTimes.length;

    console.log('┌─────────────┬──────────────┬──────────────┐');
    console.log('│ Mode        │ Avg Time     │ Records      │');
    console.log('├─────────────┼──────────────┼──────────────┤');
    console.log(`│ SPARQL      │ ${avgSparql.toFixed(0).padStart(8)}ms  │ ${String(sparqlCount).padStart(5)}        │`);
    console.log(`│ Fragment    │ ${avgFrag.toFixed(0).padStart(8)}ms  │ ${String(fragCount).padStart(5)}        │`);
    console.log('├─────────────┼──────────────┼──────────────┤');
    console.log(`│ Speedup     │ ${(avgFrag / avgSparql).toFixed(1).padStart(8)}x   │              │`);
    console.log('└─────────────┴──────────────┴──────────────┘');
  }, 300000);

  it('Summary: Typical page load performance from 10k dataset', async () => {
    console.log('\n' + '='.repeat(60));
    console.log('PAGINATION BENCHMARK SUMMARY');
    console.log('='.repeat(60));
    console.log('Dataset: 10,000 records');
    console.log('Query: Filter to return ~30 records (value > 9970)');
    console.log('Use case: Typical pagination scenario');
    console.log('='.repeat(60));
  });
});
