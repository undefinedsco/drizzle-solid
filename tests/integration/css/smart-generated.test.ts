/**
 * Smart Generated Tests
 * Curated executable coverage distilled from generated bug-pattern output.
 */

import { beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle } from '../../../src/driver';
import {
  podTable,
  string,
  int,
  datetime,
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  and,
  or,
} from '../../../src/index';
import type { SolidDatabase } from '../../../src/driver';
import type { Session } from '@inrupt/solid-client-authn-node';
import { buildTestPodUrl, createTestSession, ensureContainer } from './helpers';

const timestamp = Date.now();
const containerPath = `/smart-tests-${timestamp}/`;
const baseUrl = `${buildTestPodUrl(containerPath)}`;

vi.setConfig({ testTimeout: 60_000 });

describe('Smart Generated Tests', () => {
  let session: Session;
  let db: SolidDatabase;

  const FragmentTable = podTable('SmartFragment', {
    id: string('id').primaryKey().predicate('http://schema.org/identifier'),
    name: string('name').notNull().predicate('http://schema.org/name'),
  }, {
    base: `${baseUrl}fragment/index.ttl`,
    type: 'http://schema.org/Thing',
    subjectTemplate: '#{id}',
  });

  const DocumentTable = podTable('SmartDocument', {
    id: string('id').primaryKey().predicate('http://schema.org/identifier'),
    name: string('name').notNull().predicate('http://schema.org/name'),
  }, {
    base: `${baseUrl}document/`,
    type: 'http://schema.org/Thing',
    subjectTemplate: '{id}.ttl',
  });

  const OptionalTable = podTable('SmartOptional', {
    id: string('id').primaryKey().predicate('http://schema.org/identifier'),
    optionalField: string('optionalField').predicate('http://schema.org/description'),
    requiredField: string('requiredField').notNull().predicate('http://schema.org/name'),
  }, {
    base: `${baseUrl}optional/data.ttl`,
    type: 'http://schema.org/Thing',
    subjectTemplate: '#{id}',
  });

  const DateTable = podTable('SmartDateMessage', {
    id: string('id').primaryKey().predicate('http://schema.org/identifier'),
    chatId: string('chatId').notNull().predicate('http://schema.org/chatId'),
    content: string('content').notNull().predicate('http://schema.org/text'),
    createdAt: datetime('createdAt').notNull().predicate('http://schema.org/dateCreated'),
  }, {
    base: `${baseUrl}messages/`,
    type: 'http://schema.org/Message',
    subjectTemplate: '{chatId}/{yyyy}/{MM}/{dd}/{id}.ttl',
  });

  const MultiVarTable = podTable('SmartMultiVar', {
    id: string('id').primaryKey().predicate('http://schema.org/identifier'),
    chatId: string('chatId').notNull().predicate('http://schema.org/chatId'),
    name: string('name').notNull().predicate('http://schema.org/name'),
  }, {
    base: `${baseUrl}multi/`,
    type: 'http://schema.org/Thing',
    subjectTemplate: '{chatId}/{id}.ttl',
  });

  const NumericTable = podTable('SmartNumeric', {
    id: string('id').primaryKey().predicate('http://schema.org/identifier'),
    value: int('value').notNull().predicate('http://schema.org/value'),
    label: string('label').predicate('http://schema.org/name'),
  }, {
    base: `${baseUrl}numeric/data.ttl`,
    type: 'http://schema.org/Thing',
    subjectTemplate: '#{id}',
  });

  beforeAll(async () => {
    session = await createTestSession();
    db = drizzle(session, { debug: true });
    await ensureContainer(session, containerPath);
    await ensureContainer(session, `${containerPath}fragment/`);
    await ensureContainer(session, `${containerPath}document/`);
    await ensureContainer(session, `${containerPath}optional/`);
    await ensureContainer(session, `${containerPath}messages/`);
    await ensureContainer(session, `${containerPath}multi/`);
    await ensureContainer(session, `${containerPath}numeric/`);
  }, 120_000);

  test('Fragment mode basic CRUD', async () => {
    await db.insert(FragmentTable).values({ id: 'fragment-1', name: 'Test 1' });

    const inserted = await db.findByLocator(FragmentTable, { id: 'fragment-1' });
    expect(inserted).not.toBeNull();
    expect(inserted?.name).toBe('Test 1');

    await db.updateByLocator(FragmentTable, { id: 'fragment-1' }, { name: 'Updated' });

    const updated = await db.findByLocator(FragmentTable, { id: 'fragment-1' });
    expect(updated?.name).toBe('Updated');

    await db.deleteByLocator(FragmentTable, { id: 'fragment-1' });
    const deleted = await db.findByLocator(FragmentTable, { id: 'fragment-1' });
    expect(deleted).toBeNull();
  });

  test('Document mode full URI lookup works', async () => {
    await db.insert(DocumentTable).values({ id: 'document-1', name: 'Document 1' });

    const fullUri = `${baseUrl}document/document-1.ttl`;
    const record = await db.findByIri(DocumentTable, fullUri);

    expect(record).not.toBeNull();
    expect(record?.name).toBe('Document 1');
  });

  test('WHERE on optional column still returns rows', async () => {
    await db.insert(OptionalTable).values({
      id: 'optional-1',
      optionalField: 'value',
      requiredField: 'required',
    });

    const results = await db.select().from(OptionalTable)
      .where(eq(OptionalTable.optionalField, 'value'));

    expect(results).toHaveLength(1);
    expect(results[0].optionalField).toBe('value');
  });

  test('Date-partitioned document template can be resolved by IRI', async () => {
    await db.insert(DateTable).values({
      id: 'msg-1',
      chatId: 'chat-1',
      content: 'Hello',
      createdAt: new Date('2026-03-05T10:00:00Z'),
    });

    const fullUri = `${baseUrl}messages/chat-1/2026/03/05/msg-1.ttl`;
    const record = await db.findByIri(DateTable, fullUri);

    expect(record).not.toBeNull();
    expect(record?.content).toBe('Hello');
  });

  test('Query with only ID on multi-variable template should error', async () => {
    await db.insert(MultiVarTable).values({ id: 'multi-1', chatId: 'chat-1', name: 'Test' });

    await expect(async () => {
      await db.findByLocator(MultiVarTable, { id: 'multi-1' });
    }).rejects.toThrow(/requires a complete locator/);
  });

  test('Numeric operators support equality, range and OR logic', async () => {
    await db.insert(NumericTable).values([
      { id: 'num-1', value: 10, label: 'low' },
      { id: 'num-2', value: 20, label: 'mid' },
      { id: 'num-3', value: 30, label: 'high' },
    ]);

    const eqRows = await db.select().from(NumericTable).where(eq(NumericTable.value, 20));
    const neRows = await db.select().from(NumericTable).where(ne(NumericTable.value, 20));
    const rangeRows = await db.select().from(NumericTable)
      .where(and(gt(NumericTable.value, 10), lte(NumericTable.value, 30)));
    const orRows = await db.select().from(NumericTable)
      .where(or(lt(NumericTable.value, 15), gte(NumericTable.value, 30)));

    expect(eqRows).toHaveLength(1);
    expect(neRows).toHaveLength(2);
    expect(rangeRows.every((row) => row.value > 10 && row.value <= 30)).toBe(true);
    expect(orRows.every((row) => row.value < 15 || row.value >= 30)).toBe(true);
  });
});
