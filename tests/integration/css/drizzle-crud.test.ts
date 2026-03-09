/**
 * Drizzle ORM CRUD Tests
 * Auto-generated from Drizzle ORM SQLite tests
 * Generated on: 2026-03-05T15:20:30.902Z
 */

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle } from '../../../src/driver';
import {
  podTable,
  string,
  int,
  eq,
  and,
  or,
} from '../../../src/index';
import type { SolidDatabase } from '../../../src/driver';
import type { Session } from '@inrupt/solid-client-authn-node';
import { buildTestPodUrl, createTestSession, ensureContainer } from './helpers';

const timestamp = Date.now();
const containerPath = `/drizzle-crud-${timestamp}/`;

vi.setConfig({ testTimeout: 60_000 });

describe('Drizzle ORM CRUD Tests', () => {
  let session: Session;
  let db: SolidDatabase;

  // Define test tables
  const FragmentTable = podTable('FragmentTest', {
    id: string('id').primaryKey().predicate('http://schema.org/identifier'),
    name: string('name').notNull().predicate('http://schema.org/name'),
    value: int('value').predicate('http://schema.org/value'),
  }, {
    type: 'http://schema.org/Thing',
    base: `${buildTestPodUrl(containerPath)}fragment/index.ttl`,
    subjectTemplate: '#{id}',
  });

  const DocumentTable = podTable('DocumentTest', {
    id: string('id').primaryKey().predicate('http://schema.org/identifier'),
    name: string('name').notNull().predicate('http://schema.org/name'),
    value: int('value').predicate('http://schema.org/value'),
  }, {
    type: 'http://schema.org/Thing',
    base: `${buildTestPodUrl(containerPath)}document/`,
    subjectTemplate: '{id}.ttl',
  });

  const MultiVarTable = podTable('MultiVarTest', {
    id: string('id').primaryKey().predicate('http://schema.org/identifier'),
    chatId: string('chatId').notNull().predicate('http://schema.org/chatId'),
    name: string('name').notNull().predicate('http://schema.org/name'),
    value: int('value').predicate('http://schema.org/value'),
  }, {
    type: 'http://schema.org/Thing',
    base: `${buildTestPodUrl(containerPath)}multivar/`,
    subjectTemplate: '{chatId}/{id}.ttl',
  });

  beforeAll(async () => {
    session = await createTestSession();
    db = drizzle(session, { debug: true });
    await ensureContainer(session, containerPath);
    await ensureContainer(session, `${containerPath}fragment/`);
    await ensureContainer(session, `${containerPath}document/`);
    await ensureContainer(session, `${containerPath}multivar/`);
  }, 120_000);

  afterAll(async () => {
    // Cleanup
  });

  test('select all fields - fragment mode', async () => {
    // Insert test data
    await db.insert(FragmentTable).values({
      id: 'test-1',
      name: 'Test Item 1',
      value: 100,
    });

    // Select all fields
    const results = await db.select().from(FragmentTable);

    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('id');
    expect(results[0]).toHaveProperty('name');
    expect(results[0]).toHaveProperty('value');
  });

  test('select all fields - document mode', async () => {
    // Insert test data
    await db.insert(DocumentTable).values({
      id: 'test-1',
      name: 'Test Item 1',
      value: 100,
    });

    // Select all fields
    const results = await db.select().from(DocumentTable);

    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('id');
    expect(results[0]).toHaveProperty('name');
    expect(results[0]).toHaveProperty('value');
  });

  test('select all fields - multi-var mode', async () => {
    // Insert test data
    await db.insert(MultiVarTable).values({
      id: 'test-1',
      chatId: 'chat-1',
      name: 'Test Item 1',
      value: 100,
    });

    // Multi-variable templates require all path variables for deterministic lookup
    const results = await db.select().from(MultiVarTable)
      .where(and(
        eq(MultiVarTable.chatId, 'chat-1'),
        eq(MultiVarTable.id, 'test-1')
      ));

    expect(results).toBeDefined();
    expect(results.length).toBe(1);
    expect(results[0]).toHaveProperty('id', 'test-1');
    expect(results[0]).toHaveProperty('chatId', 'chat-1');
    expect(results[0]).toHaveProperty('name', 'Test Item 1');
    expect(results[0]).toHaveProperty('value', 100);
  });

  test('select partial fields - fragment mode', async () => {
    // Insert test data
    await db.insert(FragmentTable).values({
      id: 'test-2',
      name: 'Test Item 2',
      value: 200,
    });

    // Select partial fields
    const results = await db.select({
      id: FragmentTable.id,
      name: FragmentTable.name
    }).from(FragmentTable).where(eq(FragmentTable.id, 'test-2'));

    expect(results).toBeDefined();
    expect(results.length).toBe(1);
    expect(results[0]).toHaveProperty('id', 'test-2');
    expect(results[0]).toHaveProperty('name', 'Test Item 2');
    expect(results[0]).not.toHaveProperty('value');
  });

  test('select partial fields - document mode', async () => {
    // Insert test data
    await db.insert(DocumentTable).values({
      id: 'test-2',
      name: 'Test Item 2',
      value: 200,
    });

    // Select partial fields
    const results = await db.select({
      id: DocumentTable.id,
      name: DocumentTable.name
    }).from(DocumentTable).where(eq(DocumentTable.id, 'test-2'));

    expect(results).toBeDefined();
    expect(results.length).toBe(1);
    expect(results[0]).toHaveProperty('id', 'test-2');
    expect(results[0]).toHaveProperty('name', 'Test Item 2');
    expect(results[0]).not.toHaveProperty('value');
  });

  test('insert many + select - fragment mode', async () => {
    await db.insert(FragmentTable).values([
      { id: 'bulk-1', name: 'Bulk Item 1', value: 11 },
      { id: 'bulk-2', name: 'Bulk Item 2', value: 22 },
    ]);

    const results = await db.select().from(FragmentTable)
      .where(or(
        eq(FragmentTable.id, 'bulk-1'),
        eq(FragmentTable.id, 'bulk-2')
      ));

    expect(results).toHaveLength(2);
    expect(results.map((row) => row.id).sort()).toEqual(['bulk-1', 'bulk-2']);
  });

  test('insert + select - fragment mode', async () => {
    await db.insert(FragmentTable).values({
      id: 'single-insert-1',
      name: 'Single Insert Item',
      value: 321,
    });

    const results = await db.select().from(FragmentTable)
      .where(eq(FragmentTable.id, 'single-insert-1'));

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: 'single-insert-1',
      name: 'Single Insert Item',
      value: 321,
    });
  });

  test('insert many + select - document mode', async () => {
    await db.insert(DocumentTable).values([
      { id: 'doc-bulk-1', name: 'Document Bulk 1', value: 101 },
      { id: 'doc-bulk-2', name: 'Document Bulk 2', value: 202 },
    ]);

    const results = await db.select().from(DocumentTable)
      .where(or(
        eq(DocumentTable.id, 'doc-bulk-1'),
        eq(DocumentTable.id, 'doc-bulk-2')
      ));

    expect(results).toHaveLength(2);
    expect(results.map((row) => row.id).sort()).toEqual(['doc-bulk-1', 'doc-bulk-2']);
  });

  test('insert many + select - multi-var mode', async () => {
    await db.insert(MultiVarTable).values([
      { id: 'multi-bulk-1', chatId: 'chat-bulk', name: 'Multi Bulk 1', value: 501 },
      { id: 'multi-bulk-2', chatId: 'chat-bulk', name: 'Multi Bulk 2', value: 502 },
    ]);

    const results = await db.select().from(MultiVarTable)
      .where(eq(MultiVarTable.chatId, 'chat-bulk'));

    expect(results).toHaveLength(2);
    expect(results.map((row) => row.id).sort()).toEqual(['multi-bulk-1', 'multi-bulk-2']);
  });

  test('select partial fields - multi-var mode', async () => {
    // Insert test data
    await db.insert(MultiVarTable).values({
      id: 'test-2',
      chatId: 'chat-1',
      name: 'Test Item 2',
      value: 200,
    });

    // Select partial fields
    const results = await db.select({
      id: MultiVarTable.id,
      name: MultiVarTable.name
    }).from(MultiVarTable).where(and(
      eq(MultiVarTable.chatId, 'chat-1'),
      eq(MultiVarTable.id, 'test-2')
    ));

    expect(results).toBeDefined();
    expect(results.length).toBe(1);
    expect(results[0]).toHaveProperty('id', 'test-2');
    expect(results[0]).toHaveProperty('name', 'Test Item 2');
    expect(results[0]).not.toHaveProperty('value');
  });

  test('insert single row - fragment mode', async () => {
    // Insert single row
    await db.insert(FragmentTable).values({
      id: 'insert-1',
      name: 'Inserted Item',
      value: 300,
    });

    // Verify insertion
    const results = await db.select().from(FragmentTable).where(eq(FragmentTable.id, 'insert-1'));

    expect(results).toBeDefined();
    expect(results.length).toBe(1);
    expect(results[0]).toHaveProperty('id', 'insert-1');
    expect(results[0]).toHaveProperty('name', 'Inserted Item');
    expect(results[0]).toHaveProperty('value', 300);
  });

  test('insert single row - document mode', async () => {
    // Insert single row
    await db.insert(DocumentTable).values({
      id: 'insert-1',
      name: 'Inserted Item',
      value: 300,
    });

    // Verify insertion
    const results = await db.select().from(DocumentTable).where(eq(DocumentTable.id, 'insert-1'));

    expect(results).toBeDefined();
    expect(results.length).toBe(1);
    expect(results[0]).toHaveProperty('id', 'insert-1');
    expect(results[0]).toHaveProperty('name', 'Inserted Item');
    expect(results[0]).toHaveProperty('value', 300);
  });

  test('insert single row - multi-var mode', async () => {
    // Insert single row
    await db.insert(MultiVarTable).values({
      id: 'insert-1',
      chatId: 'chat-2',
      name: 'Inserted Item',
      value: 300,
    });

    // Verify insertion
    const results = await db.select().from(MultiVarTable)
      .where(and(
        eq(MultiVarTable.chatId, 'chat-2'),
        eq(MultiVarTable.id, 'insert-1')
      ));

    expect(results).toBeDefined();
    expect(results.length).toBe(1);
    expect(results[0]).toHaveProperty('id', 'insert-1');
    expect(results[0]).toHaveProperty('chatId', 'chat-2');
    expect(results[0]).toHaveProperty('name', 'Inserted Item');
    expect(results[0]).toHaveProperty('value', 300);
  });

  test('insert multiple rows - fragment mode', async () => {
    // Insert multiple rows
    await db.insert(FragmentTable).values([
      { id: 'multi-1', name: 'Multi Item 1', value: 400 },
      { id: 'multi-2', name: 'Multi Item 2', value: 500 },
    ]);

    // Verify insertions
    const results = await db.select().from(FragmentTable)
      .where(or(
        eq(FragmentTable.id, 'multi-1'),
        eq(FragmentTable.id, 'multi-2')
      ));

    expect(results).toBeDefined();
    expect(results.length).toBe(2);
  });

  test('insert multiple rows - document mode', async () => {
    // Insert multiple rows
    await db.insert(DocumentTable).values([
      { id: 'multi-1', name: 'Multi Item 1', value: 400 },
      { id: 'multi-2', name: 'Multi Item 2', value: 500 },
    ]);

    // Verify insertions
    const results = await db.select().from(DocumentTable)
      .where(or(
        eq(DocumentTable.id, 'multi-1'),
        eq(DocumentTable.id, 'multi-2')
      ));

    expect(results).toBeDefined();
    expect(results.length).toBe(2);
  });

  test('insert multiple rows - multi-var mode', async () => {
    // Insert multiple rows
    await db.insert(MultiVarTable).values([
      { id: 'multi-1', chatId: 'chat-3', name: 'Multi Item 1', value: 400 },
      { id: 'multi-2', chatId: 'chat-3', name: 'Multi Item 2', value: 500 },
    ]);

    // Verify insertions
    const results = await db.select().from(MultiVarTable)
      .where(and(
        eq(MultiVarTable.chatId, 'chat-3'),
        or(
          eq(MultiVarTable.id, 'multi-1'),
          eq(MultiVarTable.id, 'multi-2')
        )
      ));

    expect(results).toBeDefined();
    expect(results.length).toBe(2);
  });

  test('update with where - fragment mode', async () => {
    // Insert test data
    await db.insert(FragmentTable).values({
      id: 'update-1',
      name: 'Original Name',
      value: 600,
    });

    // Update
    await db.update(FragmentTable)
      .set({ name: 'Updated Name' })
      .where(eq(FragmentTable.id, 'update-1'));

    // Verify update
    const results = await db.select().from(FragmentTable)
      .where(eq(FragmentTable.id, 'update-1'));

    expect(results).toBeDefined();
    expect(results.length).toBe(1);
    expect(results[0]).toHaveProperty('name', 'Updated Name');
  });

  test('update with where - document mode', async () => {
    // Insert test data
    await db.insert(DocumentTable).values({
      id: 'update-1',
      name: 'Original Name',
      value: 600,
    });

    // Update
    await db.update(DocumentTable)
      .set({ name: 'Updated Name' })
      .where(eq(DocumentTable.id, 'update-1'));

    // Verify update
    const results = await db.select().from(DocumentTable)
      .where(eq(DocumentTable.id, 'update-1'));

    expect(results).toBeDefined();
    expect(results.length).toBe(1);
    expect(results[0]).toHaveProperty('name', 'Updated Name');
  });

  test('update with where - multi-var mode', async () => {
    // Insert test data
    await db.insert(MultiVarTable).values({
      id: 'update-1',
      chatId: 'chat-4',
      name: 'Original Name',
      value: 600,
    });

    // Update
    await db.update(MultiVarTable)
      .set({ name: 'Updated Name' })
      .where(and(
        eq(MultiVarTable.chatId, 'chat-4'),
        eq(MultiVarTable.id, 'update-1')
      ));

    // Verify update
    const results = await db.select().from(MultiVarTable)
      .where(and(
        eq(MultiVarTable.chatId, 'chat-4'),
        eq(MultiVarTable.id, 'update-1')
      ));

    expect(results).toBeDefined();
    expect(results.length).toBe(1);
    expect(results[0]).toHaveProperty('name', 'Updated Name');
  });

  test('delete with where - fragment mode', async () => {
    // Insert test data
    await db.insert(FragmentTable).values({
      id: 'delete-1',
      name: 'To Be Deleted',
      value: 700,
    });

    // Delete
    await db.delete(FragmentTable)
      .where(eq(FragmentTable.id, 'delete-1'));

    // Verify deletion
    const results = await db.select().from(FragmentTable)
      .where(eq(FragmentTable.id, 'delete-1'));

    expect(results).toBeDefined();
    expect(results.length).toBe(0);
  });

  test('delete with where - document mode', async () => {
    // Insert test data
    await db.insert(DocumentTable).values({
      id: 'delete-1',
      name: 'To Be Deleted',
      value: 700,
    });

    // Delete
    await db.delete(DocumentTable)
      .where(eq(DocumentTable.id, 'delete-1'));

    // Verify deletion
    const results = await db.select().from(DocumentTable)
      .where(eq(DocumentTable.id, 'delete-1'));

    expect(results).toBeDefined();
    expect(results.length).toBe(0);
  });

  test('delete with where - multi-var mode', async () => {
    // Insert test data
    await db.insert(MultiVarTable).values({
      id: 'delete-1',
      chatId: 'chat-5',
      name: 'To Be Deleted',
      value: 700,
    });

    // Delete
    await db.delete(MultiVarTable)
      .where(and(
        eq(MultiVarTable.chatId, 'chat-5'),
        eq(MultiVarTable.id, 'delete-1')
      ));

    // Verify deletion
    const results = await db.select().from(MultiVarTable)
      .where(and(
        eq(MultiVarTable.chatId, 'chat-5'),
        eq(MultiVarTable.id, 'delete-1')
      ));

    expect(results).toBeDefined();
    expect(results.length).toBe(0);
  });

  test('update multiple fields - fragment mode', async () => {
    await db.insert(FragmentTable).values({
      id: 'update-multi-1',
      name: 'Original',
      value: 100,
    });

    await db.update(FragmentTable)
      .set({ name: 'Updated', value: 200 })
      .where(eq(FragmentTable.id, 'update-multi-1'));

    const results = await db.select().from(FragmentTable)
      .where(eq(FragmentTable.id, 'update-multi-1'));

    expect(results[0].name).toBe('Updated');
    expect(results[0].value).toBe(200);
  });

  test('insert and select with null value', async () => {
    await db.insert(FragmentTable).values({
      id: 'null-test-1',
      name: 'Null Test',
      value: null,
    });

    const results = await db.select().from(FragmentTable)
      .where(eq(FragmentTable.id, 'null-test-1'));

    expect(results).toBeDefined();
    expect(results[0].value).toBeUndefined();
  });
});
