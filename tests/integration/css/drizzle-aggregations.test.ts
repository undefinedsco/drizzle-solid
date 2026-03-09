/**
 * Drizzle ORM AGGREGATIONS parity tests
 * Adapted from upstream Drizzle selection for Solid dialect.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle } from '../../../src/driver';
import {
  podTable,
  string,
  int,
  eq,
  gt,
  count,
  sum,
  avg,
  min,
  max,
  asc,
} from '../../../src/index';
import type { SolidDatabase } from '../../../src/driver';
import type { Session } from '@inrupt/solid-client-authn-node';
import { buildTestPodUrl, createTestSession, ensureContainer } from './helpers';

const runId = Date.now();
const containerPath = `/drizzle-aggregations-${runId}/`;

vi.setConfig({ testTimeout: 60_000 });

describe('Drizzle ORM AGGREGATIONS parity tests', () => {
  let session: Session;
  let db: SolidDatabase;

  const TestTable = podTable('AggregationTest', {
    id: string('id').primaryKey().predicate('http://schema.org/identifier'),
    category: string('category').notNull().predicate('http://schema.org/category'),
    amount: int('amount').predicate('http://schema.org/amount'),
    score: int('score').predicate('http://schema.org/score'),
    nullableMetric: int('nullableMetric').predicate('https://example.org/ns#nullableMetric'),
    nullOnly: int('nullOnly').predicate('https://example.org/ns#nullOnly'),
  }, {
    type: 'http://schema.org/Thing',
    base: `${buildTestPodUrl(containerPath)}data.ttl`,
    subjectTemplate: '#{id}',
  });

  beforeAll(async () => {
    session = await createTestSession();
    db = drizzle(session, { debug: true });
    await ensureContainer(session, containerPath);

    await db.insert(TestTable).values([
      { id: 'item-1', category: 'A', amount: 100, score: 85, nullableMetric: 2 },
      { id: 'item-2', category: 'B', amount: 200, score: 90 },
      { id: 'item-3', category: 'A', amount: 150, score: 75, nullableMetric: 4 },
      { id: 'item-4', category: 'C', amount: 300, score: 95 },
      { id: 'item-5', category: 'B', amount: 250, score: 80, nullableMetric: 4 },
    ]);
  }, 120_000);

  afterAll(async () => {
    // Cleanup
  });

  test('COUNT(*)', async () => {
    const results = await db.select({ count: count() }).from(TestTable);

    expect(results).toEqual([{ count: 5 }]);
  });

  test('COUNT(column)', async () => {
    const results = await db.select({
      idCount: count(TestTable.id),
      nullableMetricCount: count(TestTable.nullableMetric),
      nullOnlyCount: count(TestTable.nullOnly),
    }).from(TestTable);

    expect(results).toEqual([{
      idCount: 5,
      nullableMetricCount: 3,
      nullOnlyCount: 0,
    }]);
  });

  test('SUM', async () => {
    const results = await db.select({ total: sum(TestTable.amount) }).from(TestTable);

    expect(results).toEqual([{ total: 1000 }]);
  });

  test('AVG', async () => {
    const results = await db.select({ average: avg(TestTable.score) }).from(TestTable);

    expect(results).toEqual([{ average: 85 }]);
  });

  test('MIN', async () => {
    const results = await db.select({ minimum: min(TestTable.amount) }).from(TestTable);

    expect(results).toEqual([{ minimum: 100 }]);
  });

  test('MAX', async () => {
    const results = await db.select({ maximum: max(TestTable.score) }).from(TestTable);

    expect(results).toEqual([{ maximum: 95 }]);
  });

  test('Multiple aggregations', async () => {
    const results = await db.select({
      total: sum(TestTable.amount),
      average: avg(TestTable.score),
      minimum: min(TestTable.amount),
      maximum: max(TestTable.score),
      categoryCount: count(TestTable.category, { distinct: true }),
    }).from(TestTable);

    expect(results).toEqual([{
      total: 1000,
      average: 85,
      minimum: 100,
      maximum: 95,
      categoryCount: 3,
    }]);
  });

  test('COUNT with WHERE', async () => {
    const results = await db.select({ count: count() })
      .from(TestTable)
      .where(eq(TestTable.category, 'A'));

    expect(results).toEqual([{ count: 2 }]);
  });

  test('SUM with WHERE', async () => {
    const results = await db.select({ total: sum(TestTable.amount) })
      .from(TestTable)
      .where(gt(TestTable.score, 80));

    expect(results).toEqual([{ total: 600 }]);
  });

  test('GROUP BY category with COUNT', async () => {
    const results = await db.select({
      category: TestTable.category,
      count: count(TestTable.id),
    })
      .from(TestTable)
      .groupBy(TestTable.category)
      .orderBy(asc(TestTable.category));

    expect(results).toEqual([
      { category: 'A', count: 2 },
      { category: 'B', count: 2 },
      { category: 'C', count: 1 },
    ]);
  });

  test('GROUP BY category with SUM and AVG', async () => {
    const results = await db.select({
      category: TestTable.category,
      total: sum(TestTable.amount),
      average: avg(TestTable.score),
    })
      .from(TestTable)
      .groupBy(TestTable.category)
      .orderBy(asc(TestTable.category));

    expect(results).toEqual([
      { category: 'A', total: 250, average: 80 },
      { category: 'B', total: 450, average: 85 },
      { category: 'C', total: 300, average: 95 },
    ]);
  });

  test('GROUP BY field should deduplicate projected rows', async () => {
    const results = await db.select({
      category: TestTable.category,
    })
      .from(TestTable)
      .groupBy(TestTable.category)
      .orderBy(asc(TestTable.category));

    expect(results).toEqual([
      { category: 'A' },
      { category: 'B' },
      { category: 'C' },
    ]);
  });

  test('GROUP BY complex query should preserve ordered grouped rows', async () => {
    const results = await db.select({
      id: TestTable.id,
      category: TestTable.category,
    })
      .from(TestTable)
      .groupBy(TestTable.id, TestTable.category)
      .orderBy(asc(TestTable.category), asc(TestTable.id));

    expect(results).toEqual([
      { id: 'item-1', category: 'A' },
      { id: 'item-3', category: 'A' },
      { id: 'item-2', category: 'B' },
      { id: 'item-5', category: 'B' },
      { id: 'item-4', category: 'C' },
    ]);
  });

  test('HAVING should filter grouped aggregates by alias', async () => {
    const results = await db.select({
      category: TestTable.category,
      total: count(TestTable.id),
    })
      .from(TestTable)
      .groupBy(TestTable.category)
      .having(({ total }) => gt(total, 1))
      .orderBy(asc(TestTable.category));

    expect(results).toEqual([
      { category: 'A', total: 2 },
      { category: 'B', total: 2 },
    ]);
  });

  test('SUM DISTINCT should dedupe duplicate numeric values', async () => {
    const results = await db.select({
      total: sum(TestTable.nullableMetric, { distinct: true }),
    }).from(TestTable);

    expect(results).toEqual([{ total: 6 }]);
  });

  test('AVG DISTINCT should dedupe duplicate numeric values', async () => {
    const results = await db.select({
      average: avg(TestTable.nullableMetric, { distinct: true }),
    }).from(TestTable);

    expect(results).toEqual([{ average: 3 }]);
  });

  test('COUNT DISTINCT category', async () => {
    const results = await db.select({
      count: count(TestTable.category, { distinct: true }),
    }).from(TestTable);

    expect(results).toEqual([{ count: 3 }]);
  });

  test('aggregate functions should ignore nulls and return null for null-only columns', async () => {
    const results = await db.select({
      nullableCount: count(TestTable.nullableMetric),
      nullableSum: sum(TestTable.nullableMetric),
      nullableAvg: avg(TestTable.nullableMetric),
      nullableMin: min(TestTable.nullableMetric),
      nullableMax: max(TestTable.nullableMetric),
      nullOnlyCount: count(TestTable.nullOnly),
      nullOnlySum: sum(TestTable.nullOnly),
      nullOnlyAvg: avg(TestTable.nullOnly),
      nullOnlyMin: min(TestTable.nullOnly),
      nullOnlyMax: max(TestTable.nullOnly),
    }).from(TestTable);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      nullableCount: 3,
      nullableSum: 10,
      nullableMin: 2,
      nullableMax: 4,
      nullOnlyCount: 0,
      nullOnlySum: null,
      nullOnlyAvg: null,
      nullOnlyMin: null,
      nullOnlyMax: null,
    });
    expect(results[0]?.nullableAvg).toBeCloseTo(10 / 3, 10);
  });

  test('mixed aggregate and non-aggregate selections should require groupBy', async () => {
    await expect(
      db.select({
        category: TestTable.category,
        total: sum(TestTable.amount),
      }).from(TestTable)
    ).rejects.toThrow('Mixed aggregate and non-aggregate selections require groupBy columns');
  });
});
