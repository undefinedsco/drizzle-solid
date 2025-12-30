/**
 * Benchmark: 批量读写性能测试
 * 
 * 测试场景：
 * 1. 批量插入 (Document Mode vs Fragment Mode vs SPARQL Mode)
 * 2. 批量读取
 * 3. 大数据量过滤 (从 N 条中过滤 M 条)
 * 4. 批量更新/删除
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from '../../src/driver';
import { createTestSession, ensureContainer } from '../integration/css/helpers';
import { podTable, string, id, int } from '../../src/core/pod-table';
import { eq, inArray, like, gt } from '../../src/core/query-conditions';

interface BenchmarkResult {
  operation: string;
  mode: string;
  scenario: string;
  totalRecords: number;
  targetRecords: number;
  totalTimeMs: number;
  avgTimePerItemMs: number;
  itemsPerSecond: number;
}

const results: BenchmarkResult[] = [];

function formatResults(results: BenchmarkResult[]) {
  console.log('\n' + '='.repeat(120));
  console.log('BENCHMARK RESULTS');
  console.log('='.repeat(120));
  
  const grouped = results.reduce((acc, r) => {
    const key = `${r.operation}-${r.mode}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {} as Record<string, BenchmarkResult[]>);

  for (const [key, items] of Object.entries(grouped)) {
    console.log(`\n${key}:`);
    console.log('-'.repeat(100));
    console.log('| Scenario                    | Total/Target | Total Time (ms) | Avg/Item (ms) | Items/Second |');
    console.log('|-----------------------------|--------------|-----------------|---------------|--------------|');
    for (const r of items) {
      const scenario = r.scenario.padEnd(27);
      const records = `${r.totalRecords}/${r.targetRecords}`.padStart(12);
      console.log(`| ${scenario} | ${records} | ${r.totalTimeMs.toFixed(2).padStart(15)} | ${r.avgTimePerItemMs.toFixed(3).padStart(13)} | ${r.itemsPerSecond.toFixed(1).padStart(12)} |`);
    }
  }
  console.log('\n' + '='.repeat(120));
}

describe('Batch Operations Benchmark', () => {
  let session: any;
  let podBase: string;
  const testPath = 'benchmark/v2/';

  beforeAll(async () => {
    session = await createTestSession({ shared: false });
    podBase = session.info.webId.split('profile')[0];
    
    // Cleanup
    try {
      await session.fetch(`${podBase}${testPath}`, { method: 'DELETE' });
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (e) {}
    
    await ensureContainer(session, testPath);
  }, 60000);

  afterAll(async () => {
    formatResults(results);
    
    try {
      await session.fetch(`${podBase}${testPath}`, { method: 'DELETE' });
    } catch (e) {}
  });

  describe('INSERT Performance', () => {
    it('Fragment Mode - 100 records', async () => {
      const db = drizzle(session);
      const resourcePath = `${podBase}${testPath}frag-insert-100.ttl`;
      
      const table = podTable('frag-100', {
        id: id(),
        name: string('name').predicate('http://schema.org/name'),
        value: int('value').predicate('http://schema.org/value'),
      }, {
        type: 'http://schema.org/BenchItem_FragInsert100',
        base: resourcePath,
        subjectTemplate: '#{id}',
      });

      const items = Array.from({ length: 100 }, (_, i) => ({
        id: `item-${i}`,
        name: `Item ${i}`,
        value: i * 100,
      }));

      // Cleanup
      try { await session.fetch(resourcePath, { method: 'DELETE' }); } catch (e) {}

      const start = performance.now();
      await db.insert(table).values(items);
      const totalTime = performance.now() - start;

      results.push({
        operation: 'INSERT',
        mode: 'Fragment',
        scenario: 'Batch insert',
        totalRecords: 100,
        targetRecords: 100,
        totalTimeMs: totalTime,
        avgTimePerItemMs: totalTime / 100,
        itemsPerSecond: (100 / totalTime) * 1000,
      });

      console.log(`[Fragment INSERT 100] ${totalTime.toFixed(2)}ms (${(totalTime/100).toFixed(3)}ms/item)`);
    }, 60000);

    it('SPARQL Mode - 100 records', async () => {
      const db = drizzle(session);
      const resourcePath = `${podBase}${testPath}sparql-insert-100.ttl`;
      const sparqlEndpoint = `${resourcePath}/-/sparql`;
      
      const table = podTable('sparql-100', {
        id: id(),
        name: string('name').predicate('http://schema.org/name'),
        value: int('value').predicate('http://schema.org/value'),
      }, {
        type: 'http://schema.org/BenchItem_SparqlInsert100',
        base: resourcePath,
        subjectTemplate: '#{id}',
        sparqlEndpoint: sparqlEndpoint,
      });

      const items = Array.from({ length: 100 }, (_, i) => ({
        id: `item-${i}`,
        name: `Item ${i}`,
        value: i * 100,
      }));

      // Cleanup
      try { await session.fetch(resourcePath, { method: 'DELETE' }); } catch (e) {}

      const start = performance.now();
      await db.insert(table).values(items);
      const totalTime = performance.now() - start;

      results.push({
        operation: 'INSERT',
        mode: 'SPARQL',
        scenario: 'Batch insert',
        totalRecords: 100,
        targetRecords: 100,
        totalTimeMs: totalTime,
        avgTimePerItemMs: totalTime / 100,
        itemsPerSecond: (100 / totalTime) * 1000,
      });

      console.log(`[SPARQL INSERT 100] ${totalTime.toFixed(2)}ms (${(totalTime/100).toFixed(3)}ms/item)`);
    }, 60000);
  });

  describe('SELECT Performance - Large Dataset Filter', () => {
    const TOTAL_RECORDS = 500;  // 先用 500 测试，避免太慢
    const FILTER_TARGET = 50;

    it('Setup: Create large dataset (Fragment Mode)', async () => {
      const resourcePath = `${podBase}${testPath}large-dataset.ttl`;
      
      // 直接用 Turtle 写入大量数据，比逐条插入快
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

      const start = performance.now();
      const response = await session.fetch(resourcePath, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/turtle' },
        body: triples.join('\n'),
      });
      const totalTime = performance.now() - start;

      expect(response.ok).toBe(true);
      console.log(`[Setup] Created ${TOTAL_RECORDS} records in ${totalTime.toFixed(2)}ms`);
    }, 120000);

    it('Fragment Mode - SELECT all from large dataset', async () => {
      const db = drizzle(session);
      const resourcePath = `${podBase}${testPath}large-dataset.ttl`;

      const table = podTable('large-frag', {
        id: id(),
        name: string('name').predicate('http://schema.org/name'),
        category: string('category').predicate('http://schema.org/category'),
        value: int('value').predicate('http://schema.org/value'),
      }, {
        type: 'http://schema.org/BenchItem_LargeDataset',
        base: resourcePath,
        subjectTemplate: '#{id}',
      });

      const start = performance.now();
      const result = await db.select().from(table);
      const totalTime = performance.now() - start;

      results.push({
        operation: 'SELECT',
        mode: 'Fragment',
        scenario: 'Select all',
        totalRecords: TOTAL_RECORDS,
        targetRecords: result.length,
        totalTimeMs: totalTime,
        avgTimePerItemMs: totalTime / result.length,
        itemsPerSecond: (result.length / totalTime) * 1000,
      });

      console.log(`[Fragment SELECT ALL] ${result.length} records in ${totalTime.toFixed(2)}ms`);
      expect(result.length).toBe(TOTAL_RECORDS);
    }, 120000);

    it('Fragment Mode - Filter 50 from large dataset', async () => {
      const db = drizzle(session);
      const resourcePath = `${podBase}${testPath}large-dataset.ttl`;

      const table = podTable('large-frag-filter', {
        id: id(),
        name: string('name').predicate('http://schema.org/name'),
        category: string('category').predicate('http://schema.org/category'),
        value: int('value').predicate('http://schema.org/value'),
      }, {
        type: 'http://schema.org/BenchItem_LargeDataset',
        base: resourcePath,
        subjectTemplate: '#{id}',
      });

      const start = performance.now();
      const result = await db.select().from(table).where(eq(table.columns.category, 'target'));
      const totalTime = performance.now() - start;

      results.push({
        operation: 'SELECT',
        mode: 'Fragment',
        scenario: `Filter ${FILTER_TARGET} from ${TOTAL_RECORDS}`,
        totalRecords: TOTAL_RECORDS,
        targetRecords: result.length,
        totalTimeMs: totalTime,
        avgTimePerItemMs: totalTime / result.length,
        itemsPerSecond: (result.length / totalTime) * 1000,
      });

      console.log(`[Fragment FILTER] ${result.length} records in ${totalTime.toFixed(2)}ms`);
      expect(result.length).toBe(FILTER_TARGET);
    }, 120000);

    it('SPARQL Mode - SELECT all from large dataset', async () => {
      const db = drizzle(session);
      const resourcePath = `${podBase}${testPath}large-dataset.ttl`;
      const sparqlEndpoint = `${resourcePath}/-/sparql`;

      const table = podTable('large-sparql', {
        id: id(),
        name: string('name').predicate('http://schema.org/name'),
        category: string('category').predicate('http://schema.org/category'),
        value: int('value').predicate('http://schema.org/value'),
      }, {
        type: 'http://schema.org/BenchItem_LargeDataset',
        base: resourcePath,
        subjectTemplate: '#{id}',
        sparqlEndpoint: sparqlEndpoint,
      });

      const start = performance.now();
      const result = await db.select().from(table);
      const totalTime = performance.now() - start;

      results.push({
        operation: 'SELECT',
        mode: 'SPARQL',
        scenario: 'Select all',
        totalRecords: TOTAL_RECORDS,
        targetRecords: result.length,
        totalTimeMs: totalTime,
        avgTimePerItemMs: totalTime / result.length,
        itemsPerSecond: (result.length / totalTime) * 1000,
      });

      console.log(`[SPARQL SELECT ALL] ${result.length} records in ${totalTime.toFixed(2)}ms`);
      expect(result.length).toBe(TOTAL_RECORDS);
    }, 120000);

    it('SPARQL Mode - Filter 50 from large dataset', async () => {
      const db = drizzle(session);
      const resourcePath = `${podBase}${testPath}large-dataset.ttl`;
      const sparqlEndpoint = `${resourcePath}/-/sparql`;

      const table = podTable('large-sparql-filter', {
        id: id(),
        name: string('name').predicate('http://schema.org/name'),
        category: string('category').predicate('http://schema.org/category'),
        value: int('value').predicate('http://schema.org/value'),
      }, {
        type: 'http://schema.org/BenchItem_LargeDataset',
        base: resourcePath,
        subjectTemplate: '#{id}',
        sparqlEndpoint: sparqlEndpoint,
      });

      const start = performance.now();
      const result = await db.select().from(table).where(eq(table.columns.category, 'target'));
      const totalTime = performance.now() - start;

      results.push({
        operation: 'SELECT',
        mode: 'SPARQL',
        scenario: `Filter ${FILTER_TARGET} from ${TOTAL_RECORDS}`,
        totalRecords: TOTAL_RECORDS,
        targetRecords: result.length,
        totalTimeMs: totalTime,
        avgTimePerItemMs: totalTime / result.length,
        itemsPerSecond: (result.length / totalTime) * 1000,
      });

      console.log(`[SPARQL FILTER] ${result.length} records in ${totalTime.toFixed(2)}ms`);
      expect(result.length).toBe(FILTER_TARGET);
    }, 120000);

    it('SPARQL Mode - Filter by value range (gt)', async () => {
      const db = drizzle(session);
      const resourcePath = `${podBase}${testPath}large-dataset.ttl`;
      const sparqlEndpoint = `${resourcePath}/-/sparql`;

      const table = podTable('large-sparql-range', {
        id: id(),
        name: string('name').predicate('http://schema.org/name'),
        category: string('category').predicate('http://schema.org/category'),
        value: int('value').predicate('http://schema.org/value'),
      }, {
        type: 'http://schema.org/BenchItem_LargeDataset',
        base: resourcePath,
        subjectTemplate: '#{id}',
        sparqlEndpoint: sparqlEndpoint,
      });

      // 查询 value > 4500 (应该返回约 50 条)
      const threshold = (TOTAL_RECORDS - FILTER_TARGET) * 10;
      
      const start = performance.now();
      const result = await db.select().from(table).where(gt(table.columns.value, threshold));
      const totalTime = performance.now() - start;

      results.push({
        operation: 'SELECT',
        mode: 'SPARQL',
        scenario: `Range filter (value > ${threshold})`,
        totalRecords: TOTAL_RECORDS,
        targetRecords: result.length,
        totalTimeMs: totalTime,
        avgTimePerItemMs: totalTime / Math.max(result.length, 1),
        itemsPerSecond: (Math.max(result.length, 1) / totalTime) * 1000,
      });

      console.log(`[SPARQL RANGE] ${result.length} records in ${totalTime.toFixed(2)}ms`);
    }, 120000);
  });

  describe('UPDATE Performance', () => {
    it('SPARQL Mode - Update 50 records', async () => {
      const db = drizzle(session);
      const resourcePath = `${podBase}${testPath}sparql-update.ttl`;
      const sparqlEndpoint = `${resourcePath}/-/sparql`;
      
      // Setup: create records first
      const items = Array.from({ length: 50 }, (_, i) => ({
        id: `update-${i}`,
        name: `Item ${i}`,
        value: i * 100,
      }));

      const setupTriples = [
        '@prefix schema: <http://schema.org/>.',
        '@prefix xsd: <http://www.w3.org/2001/XMLSchema#>.',
      ];
      for (const item of items) {
        setupTriples.push(`
<#${item.id}> a <http://schema.org/BenchItem_SparqlUpdate>;
  schema:identifier "${item.id}";
  schema:name "${item.name}";
  schema:value ${item.value}.`);
      }

      await session.fetch(resourcePath, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/turtle' },
        body: setupTriples.join('\n'),
      });

      const table = podTable('sparql-update', {
        id: id(),
        name: string('name').predicate('http://schema.org/name'),
        value: int('value').predicate('http://schema.org/value'),
      }, {
        type: 'http://schema.org/BenchItem_SparqlUpdate',
        base: resourcePath,
        subjectTemplate: '#{id}',
        sparqlEndpoint: sparqlEndpoint,
      });

      const start = performance.now();
      await db.update(table)
        .set({ value: 9999 })
        .where(inArray(table.columns.id, items.map(i => i.id)));
      const totalTime = performance.now() - start;

      results.push({
        operation: 'UPDATE',
        mode: 'SPARQL',
        scenario: 'Batch update',
        totalRecords: 50,
        targetRecords: 50,
        totalTimeMs: totalTime,
        avgTimePerItemMs: totalTime / 50,
        itemsPerSecond: (50 / totalTime) * 1000,
      });

      console.log(`[SPARQL UPDATE 50] ${totalTime.toFixed(2)}ms (${(totalTime/50).toFixed(3)}ms/item)`);
    }, 120000);
  });

  describe('DELETE Performance', () => {
    it('SPARQL Mode - Delete 50 records', async () => {
      const db = drizzle(session);
      const resourcePath = `${podBase}${testPath}sparql-delete.ttl`;
      const sparqlEndpoint = `${resourcePath}/-/sparql`;
      
      // Setup
      const items = Array.from({ length: 50 }, (_, i) => ({
        id: `delete-${i}`,
        name: `Item ${i}`,
        value: i * 100,
      }));

      const setupTriples = [
        '@prefix schema: <http://schema.org/>.',
        '@prefix xsd: <http://www.w3.org/2001/XMLSchema#>.',
      ];
      for (const item of items) {
        setupTriples.push(`
<#${item.id}> a <http://schema.org/BenchItem_SparqlDelete>;
  schema:identifier "${item.id}";
  schema:name "${item.name}";
  schema:value ${item.value}.`);
      }

      await session.fetch(resourcePath, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/turtle' },
        body: setupTriples.join('\n'),
      });

      const table = podTable('sparql-delete', {
        id: id(),
        name: string('name').predicate('http://schema.org/name'),
        value: int('value').predicate('http://schema.org/value'),
      }, {
        type: 'http://schema.org/BenchItem_SparqlDelete',
        base: resourcePath,
        subjectTemplate: '#{id}',
        sparqlEndpoint: sparqlEndpoint,
      });

      const start = performance.now();
      await db.delete(table)
        .where(inArray(table.columns.id, items.map(i => i.id)));
      const totalTime = performance.now() - start;

      results.push({
        operation: 'DELETE',
        mode: 'SPARQL',
        scenario: 'Batch delete',
        totalRecords: 50,
        targetRecords: 50,
        totalTimeMs: totalTime,
        avgTimePerItemMs: totalTime / 50,
        itemsPerSecond: (50 / totalTime) * 1000,
      });

      console.log(`[SPARQL DELETE 50] ${totalTime.toFixed(2)}ms (${(totalTime/50).toFixed(3)}ms/item)`);
    }, 120000);

    it('Fragment Mode (LDP) - Delete 50 records', async () => {
      const db = drizzle(session);
      const resourcePath = `${podBase}${testPath}frag-delete.ttl`;
      
      // Setup
      const items = Array.from({ length: 50 }, (_, i) => ({
        id: `delete-${i}`,
        name: `Item ${i}`,
        value: i * 100,
      }));

      const setupTriples = [
        '@prefix schema: <http://schema.org/>.',
        '@prefix xsd: <http://www.w3.org/2001/XMLSchema#>.',
      ];
      for (const item of items) {
        setupTriples.push(`
<#${item.id}> a <http://schema.org/BenchItem_FragDelete>;
  schema:identifier "${item.id}";
  schema:name "${item.name}";
  schema:value ${item.value}.`);
      }

      await session.fetch(resourcePath, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/turtle' },
        body: setupTriples.join('\n'),
      });

      const table = podTable('frag-delete', {
        id: id(),
        name: string('name').predicate('http://schema.org/name'),
        value: int('value').predicate('http://schema.org/value'),
      }, {
        type: 'http://schema.org/BenchItem_FragDelete',
        base: resourcePath,
        subjectTemplate: '#{id}',
      });

      const start = performance.now();
      try {
        await db.delete(table)
          .where(inArray(table.columns.id, items.map(i => i.id)));
      } catch (e: any) {
        console.log(`[Fragment DELETE] Error: ${e.message}`);
      }
      const totalTime = performance.now() - start;

      results.push({
        operation: 'DELETE',
        mode: 'Fragment',
        scenario: 'Batch delete',
        totalRecords: 50,
        targetRecords: 50,
        totalTimeMs: totalTime,
        avgTimePerItemMs: totalTime / 50,
        itemsPerSecond: (50 / totalTime) * 1000,
      });

      console.log(`[Fragment DELETE 50] ${totalTime.toFixed(2)}ms (${(totalTime/50).toFixed(3)}ms/item)`);
    }, 120000);
  });
});
