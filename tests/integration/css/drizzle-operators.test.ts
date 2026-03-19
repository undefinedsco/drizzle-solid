/**
 * Drizzle ORM OPERATORS Tests
 * Auto-generated from Drizzle ORM SQLite tests
 * Generated on: 2026-03-05T15:20:30.904Z
 */

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle } from '../../../src/driver';
import {
  podTable,
  string,
  char,
  int,
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  and,
  or,
  not,
  like,
  inArray,
  notInArray,
} from '../../../src/index';
import type { SolidDatabase } from '../../../src/driver';
import type { Session } from '@inrupt/solid-client-authn-node';
import { buildTestPodUrl, createTestSession, ensureContainer } from './helpers';

const timestamp = Date.now();
const containerPath = `/drizzle-operators-${timestamp}/`;

vi.setConfig({ testTimeout: 60_000 });

describe('Drizzle ORM OPERATORS Tests', () => {
  let session: Session;
  let db: SolidDatabase;

  // Define test table
  const TestTable = podTable('OperatorTest', {
    id: string('id').primaryKey().predicate('http://schema.org/identifier'),
    name: string('name').notNull().predicate('http://schema.org/name'),
    value: int('value').predicate('http://schema.org/value'),
  }, {
    type: 'http://schema.org/Thing',
    base: `${buildTestPodUrl(containerPath)}data.ttl`,
    subjectTemplate: '#{id}',
  });

  const CharTable = podTable('OperatorCharTest', {
    id: string('id').primaryKey().predicate('http://schema.org/identifier'),
    token: char('token').predicate('https://example.org/ns#token'),
  }, {
    type: 'http://schema.org/Thing',
    base: `${buildTestPodUrl(containerPath)}char.ttl`,
    subjectTemplate: '#{id}',
  });

  beforeAll(async () => {
    session = await createTestSession();
    db = drizzle(session, { debug: true });
    await ensureContainer(session, containerPath);

    // Insert test data
    await db.insert(TestTable).values([
      { id: 'test-1', name: 'Item One', value: 10 },
      { id: 'test-2', name: 'Item Two', value: 20 },
      { id: 'test-3', name: 'Item Three', value: 30 },
      { id: 'test-4', name: 'Test Item', value: 40 },
      { id: 'test-5', name: 'Another', value: 50 },
    ]);
  }, 120_000);

  afterAll(async () => {
    // Cleanup
  });

  test('eq operator - fragment mode', async () => {
    const results = await db.select().from(TestTable)
      .where(eq(TestTable.name, 'Item One'));

    expect(results).toBeDefined();
    expect(results.length).toBe(1);
    expect(results[0]).toHaveProperty('id', 'test-1');
  });

  test('eq operator - document mode', async () => {
    const results = await db.select().from(TestTable)
      .where(eq(TestTable.value, 20));

    expect(results).toBeDefined();
    expect(results.length).toBe(1);
    expect(results[0]).toHaveProperty('id', 'test-2');
  });

  test('ne operator - fragment mode', async () => {
    const results = await db.select().from(TestTable)
      .where(ne(TestTable.name, 'Item One'));

    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.name !== 'Item One')).toBe(true);
  });

  test('gt operator - fragment mode', async () => {
    const results = await db.select().from(TestTable)
      .where(gt(TestTable.value, 25));

    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.value! > 25)).toBe(true);
  });

  test('gte operator - fragment mode', async () => {
    const results = await db.select().from(TestTable)
      .where(gte(TestTable.value, 30));

    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.value! >= 30)).toBe(true);
  });

  test('lt operator - fragment mode', async () => {
    const results = await db.select().from(TestTable)
      .where(lt(TestTable.value, 25));

    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.value! < 25)).toBe(true);
  });

  test('lte operator - fragment mode', async () => {
    const results = await db.select().from(TestTable)
      .where(lte(TestTable.value, 20));

    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.value! <= 20)).toBe(true);
  });

  test('and operator - fragment mode', async () => {
    const results = await db.select().from(TestTable)
      .where(and(
        gt(TestTable.value, 15),
        lt(TestTable.value, 35)
      ));

    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.value! > 15 && r.value! < 35)).toBe(true);
  });

  test('or operator - fragment mode', async () => {
    const results = await db.select().from(TestTable)
      .where(or(
        eq(TestTable.name, 'Item One'),
        eq(TestTable.name, 'Another')
      ));

    expect(results).toBeDefined();
    expect(results.length).toBe(2);
  });

  test('not operator - fragment mode', async () => {
    const results = await db.select().from(TestTable)
      .where(not(eq(TestTable.name, 'Item One')));

    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.name !== 'Item One')).toBe(true);
  });

  test('inArray operator - fragment mode', async () => {
    const results = await db.select().from(TestTable)
      .where(inArray(TestTable.name, ['Item One', 'Item Two', 'Item Three']));

    expect(results).toBeDefined();
    expect(results.length).toBe(3);
  });

  test('notInArray operator - fragment mode', async () => {
    const results = await db.select().from(TestTable)
      .where(notInArray(TestTable.name, ['Item One', 'Item Two']));

    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => !['test-1', 'test-2'].includes(r.id))).toBe(true);
  });

  test('like operator - fragment mode', async () => {
    const results = await db.select().from(TestTable)
      .where(like(TestTable.name, '%Item%'));

    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
  });

  test('combined operators - complex query', async () => {
    const results = await db.select().from(TestTable)
      .where(and(
        or(
          eq(TestTable.name, 'Item One'),
          like(TestTable.name, '%Test%')
        ),
        gte(TestTable.value, 10)
      ));

    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
  });

  test('multiple WHERE conditions', async () => {
    const results = await db.select().from(TestTable)
      .where(and(
        gt(TestTable.value, 15),
        lt(TestTable.value, 45),
      ));

    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.value! > 15 && r.value! < 45)).toBe(true);
  });

  test('eq with number value', async () => {
    const results = await db.select().from(TestTable)
      .where(eq(TestTable.value, 30));

    expect(results).toBeDefined();
    expect(results.length).toBe(1);
    expect(results[0].value).toBe(30);
  });

  test('ne with number value', async () => {
    const results = await db.select().from(TestTable)
      .where(ne(TestTable.value, 30));

    expect(results).toBeDefined();
    expect(results.every(r => r.value !== 30)).toBe(true);
  });

  test('between values using AND', async () => {
    const results = await db.select().from(TestTable)
      .where(and(
        gte(TestTable.value, 20),
        lte(TestTable.value, 40)
      ));

    expect(results).toBeDefined();
    expect(results.every(r => r.value! >= 20 && r.value! <= 40)).toBe(true);
  });

  test('OR with multiple conditions', async () => {
    const results = await db.select().from(TestTable)
      .where(or(
        lt(TestTable.value, 15),
        gt(TestTable.value, 45)
      ));

    expect(results).toBeDefined();
    expect(results.every(r => r.value! < 15 || r.value! > 45)).toBe(true);
  });

  test('NOT with GT operator', async () => {
    const results = await db.select().from(TestTable)
      .where(not(gt(TestTable.value, 30)));

    expect(results).toBeDefined();
    expect(results.every(r => r.value! <= 30)).toBe(true);
  });

  test('inArray with single value', async () => {
    const results = await db.select().from(TestTable)
      .where(inArray(TestTable.name, ['Item Three']));

    expect(results).toBeDefined();
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('test-3');
  });

  test('empty result set', async () => {
    const results = await db.select().from(TestTable)
      .where(eq(TestTable.name, 'non-existent-item'));

    expect(results).toBeDefined();
    expect(results.length).toBe(0);
  });

  test('like with start pattern', async () => {
    const results = await db.select().from(TestTable)
      .where(like(TestTable.name, 'Item%'));

    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.name.startsWith('Item'))).toBe(true);
  });

  test('like with end pattern', async () => {
    const results = await db.select().from(TestTable)
      .where(like(TestTable.name, '%One'));

    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
  });

  test('complex nested conditions', async () => {
    const results = await db.select().from(TestTable)
      .where(or(
        and(
          eq(TestTable.name, 'Item One'),
          gte(TestTable.value, 10)
        ),
        and(
          eq(TestTable.name, 'Item Two'),
          lte(TestTable.value, 30)
        )
      ));

    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
  });

  test('inArray with empty array', async () => {
    const results = await db.select().from(TestTable)
      .where(inArray(TestTable.name, []));

    expect(results).toBeDefined();
    expect(results.length).toBe(0);
  });

  test('notInArray with empty array', async () => {
    const results = await db.select().from(TestTable)
      .where(notInArray(TestTable.name, []));

    expect(results).toBeDefined();
    expect(results.length).toBe(5);
    expect(results.map((row) => row.id).sort()).toEqual(['test-1', 'test-2', 'test-3', 'test-4', 'test-5']);
  });

  test('char update', async () => {
    await db.insert(CharTable).values({
      id: 'char-update-1',
      token: 'A',
    });

    await db.updateByLocator(CharTable, { id: 'char-update-1' }, { token: 'B' });

    const record = await db.findByLocator(CharTable, { id: 'char-update-1' });
    expect(record).not.toBeNull();
    expect(record?.token).toBe('B');
  });

  test('char delete', async () => {
    await db.insert(CharTable).values({
      id: 'char-delete-1',
      token: 'Z',
    });

    await db.delete(CharTable)
      .where(eq(CharTable.token, 'Z'));

    const record = await db.findByLocator(CharTable, { id: 'char-delete-1' });
    expect(record).toBeNull();
  });
});
