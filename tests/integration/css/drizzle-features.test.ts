/**
 * Drizzle ORM FEATURES Tests
 * Auto-generated from Drizzle ORM SQLite tests
 * Generated on: 2026-03-05T15:20:30.905Z
 */

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle } from '../../../src/driver';
import {
  podTable,
  string,
  int,
  eq,
  gt,
  and,
  or,
  lte,
  gte,
  asc,
  desc,
  inArray,
} from '../../../src/index';
import type { SolidDatabase } from '../../../src/driver';
import type { Session } from '@inrupt/solid-client-authn-node';
import { buildTestPodUrl, createTestSession, ensureContainer } from './helpers';

const timestamp = Date.now();
const containerPath = `/drizzle-features-${timestamp}/`;

vi.setConfig({ testTimeout: 60_000 });

describe('Drizzle ORM FEATURES Tests', () => {
  let session: Session;
  let db: SolidDatabase;

  const TestTable = podTable('FeatureTest', {
    id: string('id').primaryKey().predicate('http://schema.org/identifier'),
    name: string('name').notNull().predicate('http://schema.org/name'),
    value: int('value').predicate('http://schema.org/value'),
  }, {
    type: 'http://schema.org/Thing',
    base: `${buildTestPodUrl(containerPath)}data.ttl`,
    subjectTemplate: '#{id}',
  });

  beforeAll(async () => {
    session = await createTestSession();
    db = drizzle(session, { debug: true });
    await ensureContainer(session, containerPath);

    // Insert test data
    await db.insert(TestTable).values([
      { id: 'item-1', name: 'Alpha', value: 30 },
      { id: 'item-2', name: 'Beta', value: 10 },
      { id: 'item-3', name: 'Gamma', value: 20 },
      { id: 'item-4', name: 'Delta', value: 40 },
      { id: 'item-5', name: 'Epsilon', value: 50 },
    ]);
  }, 120_000);

  afterAll(async () => {
    // Cleanup
  });

  test('ORDER BY asc', async () => {
    const results = await db.select().from(TestTable)
      .orderBy(asc(TestTable.name));

    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
    // Verify ascending order
    for (let i = 1; i < results.length; i++) {
      expect(results[i].name >= results[i-1].name).toBe(true);
    }
  });

  test('ORDER BY desc', async () => {
    const results = await db.select().from(TestTable)
      .orderBy(desc(TestTable.value));

    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
    // Verify descending order
    for (let i = 1; i < results.length; i++) {
      expect(results[i].value! <= results[i-1].value!).toBe(true);
    }
  });

  test('LIMIT', async () => {
    const results = await db.select().from(TestTable).limit(3);

    expect(results).toBeDefined();
    expect(results.length).toBe(3);
  });

  test('LIMIT 0', async () => {
    const results = await db.select().from(TestTable).limit(0);

    expect(results).toBeDefined();
    expect(results.length).toBe(0);
  });

  test('insert many + ORDER BY asc', async () => {
    await db.insert(TestTable).values([
      { id: 'feature-order-1', name: 'Omega', value: 70 },
      { id: 'feature-order-2', name: 'Eta', value: 60 },
    ]);

    const results = await db.select().from(TestTable)
      .where(inArray(TestTable.id, ['feature-order-1', 'feature-order-2']))
      .orderBy(asc(TestTable.name));

    expect(results).toHaveLength(2);
    expect(results.map((row) => row.name)).toEqual(['Eta', 'Omega']);
  });

  test('insert + select + ORDER BY desc', async () => {
    await db.insert(TestTable).values([
      { id: 'feature-order-3', name: 'Iota', value: 15 },
      { id: 'feature-order-4', name: 'Kappa', value: 95 },
    ]);

    const results = await db.select().from(TestTable)
      .where(inArray(TestTable.id, ['feature-order-3', 'feature-order-4']))
      .orderBy(desc(TestTable.value));

    expect(results).toHaveLength(2);
    expect(results.map((row) => row.id)).toEqual(['feature-order-4', 'feature-order-3']);
  });

  test('OFFSET', async () => {
    const allResults = await db.select().from(TestTable);
    const offsetResults = await db.select().from(TestTable).offset(2);

    expect(offsetResults).toBeDefined();
    expect(offsetResults.length).toBe(allResults.length - 2);
  });

  test('LIMIT + OFFSET', async () => {
    const results = await db.select().from(TestTable)
      .limit(2).offset(1);

    expect(results).toBeDefined();
    expect(results.length).toBe(2);
  });

  test('WHERE + ORDER BY', async () => {
    const results = await db.select().from(TestTable)
      .where(gt(TestTable.value, 15))
      .orderBy(asc(TestTable.value));

    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.value! > 15)).toBe(true);
  });

  test('WHERE + LIMIT', async () => {
    const results = await db.select().from(TestTable)
      .where(gt(TestTable.value, 10))
      .limit(2);

    expect(results).toBeDefined();
    expect(results.length).toBe(2);
    expect(results.every(r => r.value! > 10)).toBe(true);
  });

  test('Multiple WHERE with AND', async () => {
    const results = await db.select().from(TestTable)
      .where(and(
        gte(TestTable.value, 20),
        lte(TestTable.value, 40)
      ));

    expect(results).toBeDefined();
    expect(results.every(r => r.value! >= 20 && r.value! <= 40)).toBe(true);
  });

  test('ORDER BY with LIMIT', async () => {
    const results = await db.select().from(TestTable)
      .orderBy(desc(TestTable.value))
      .limit(3);

    expect(results).toBeDefined();
    expect(results.length).toBe(3);
  });

  test('WHERE + ORDER + LIMIT', async () => {
    const results = await db.select().from(TestTable)
      .where(gt(TestTable.value, 15))
      .orderBy(asc(TestTable.name))
      .limit(2);

    expect(results).toBeDefined();
    expect(results.length).toBe(2);
  });

  test('SELECT with OR conditions', async () => {
    const results = await db.select().from(TestTable)
      .where(or(
        eq(TestTable.name, 'Alpha'),
        eq(TestTable.name, 'Beta')
      ));

    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
  });

  test('ORDER BY multiple columns', async () => {
    const results = await db.select().from(TestTable)
      .orderBy(asc(TestTable.value), desc(TestTable.name));

    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
  });

  test('DISTINCT on projected value', async () => {
    await db.insert(TestTable).values([
      { id: 'distinct-1', name: 'Dup One', value: 200 },
      { id: 'distinct-2', name: 'Dup Two', value: 200 },
      { id: 'distinct-3', name: 'Dup Three', value: 300 },
    ]);

    const results = await db.select({ value: TestTable.value }).from(TestTable)
      .where(inArray(TestTable.id, ['distinct-1', 'distinct-2', 'distinct-3']))
      .distinct()
      .orderBy(asc(TestTable.value));

    expect(results).toEqual([{ value: 200 }, { value: 300 }]);
  });

  test('DISTINCT should deduplicate full rows within filtered subset', async () => {
    await db.insert(TestTable).values([
      { id: 'distinct-4', name: 'Same Name', value: 400 },
      { id: 'distinct-5', name: 'Same Name', value: 400 },
    ]);

    const results = await db.select({ name: TestTable.name, value: TestTable.value }).from(TestTable)
      .where(inArray(TestTable.id, ['distinct-4', 'distinct-5']))
      .distinct();

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ name: 'Same Name', value: 400 });
  });

  test('OFFSET without LIMIT', async () => {
    const results = await db.select().from(TestTable)
      .offset(3);

    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
  });
});
