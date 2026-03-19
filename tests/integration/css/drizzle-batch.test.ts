/**
 * Drizzle ORM BATCH Tests
 * Adapted from Drizzle ORM parity selection for Solid dialect.
 */

import { beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle } from '../../../src/driver';
import {
  podTable,
  string,
  eq,
  inArray,
} from '../../../src/index';
import type { SolidDatabase } from '../../../src/driver';
import type { Session } from '@inrupt/solid-client-authn-node';
import { buildTestPodUrl, createTestSession, ensureContainer } from './helpers';

const timestamp = Date.now();
const containerPath = `/drizzle-batch-${timestamp}/`;

vi.setConfig({ testTimeout: 60_000 });

describe('Drizzle ORM BATCH Tests', () => {
  let session: Session;
  let db: SolidDatabase<{ batchItems: typeof BatchTable }>;

  const BatchTable = podTable('BatchTest', {
    id: string('id').primaryKey().predicate('http://schema.org/identifier'),
    name: string('name').notNull().predicate('http://schema.org/name'),
    status: string('status').predicate('http://schema.org/status'),
  }, {
    type: 'http://schema.org/Thing',
    base: `${buildTestPodUrl(containerPath)}data.ttl`,
    subjectTemplate: '#{id}',
  });

  beforeAll(async () => {
    session = await createTestSession();
    db = drizzle(session, { debug: true, schema: { batchItems: BatchTable } });
    await ensureContainer(session, containerPath);
  }, 120_000);

  test('Batch INSERT', async () => {
    const results = await db.batch([
      db.insert(BatchTable).values({ id: 'insert-1', name: 'Alpha', status: 'new' }),
      db.insert(BatchTable).values({ id: 'insert-2', name: 'Beta', status: 'new' }),
    ] as const);

    expect(results).toHaveLength(2);
    expect(results[0]).toHaveLength(1);
    expect(results[1]).toHaveLength(1);

    const rows = await db.select().from(BatchTable)
      .where(inArray(BatchTable.name, ['Alpha', 'Beta']));

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.id).sort()).toEqual(['insert-1', 'insert-2']);
  });

  test('Batch UPDATE', async () => {
    await db.insert(BatchTable).values([
      { id: 'update-1', name: 'Update One', status: 'pending' },
      { id: 'update-2', name: 'Update Two', status: 'pending' },
    ]);

    const results = await db.batch([
      db.updateByLocator(BatchTable, { id: 'update-1' }, { status: 'done' }),
      db.updateByLocator(BatchTable, { id: 'update-2' }, { status: 'done' }),
    ] as const);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ id: 'update-1', status: 'done' });
    expect(results[1]).toMatchObject({ id: 'update-2', status: 'done' });

    const rows = await db.select().from(BatchTable)
      .where(inArray(BatchTable.name, ['Update One', 'Update Two']));

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === 'done')).toBe(true);
  });

  test('Batch DELETE', async () => {
    await db.insert(BatchTable).values([
      { id: 'delete-1', name: 'Delete One', status: 'active' },
      { id: 'delete-2', name: 'Delete Two', status: 'active' },
    ]);

    const results = await db.batch([
      db.deleteByLocator(BatchTable, { id: 'delete-1' }),
      db.deleteByLocator(BatchTable, { id: 'delete-2' }),
    ] as const);

    expect(results).toHaveLength(2);
    expect(results).toEqual([true, true]);

    const rows = await db.select().from(BatchTable)
      .where(inArray(BatchTable.name, ['Delete One', 'Delete Two']));

    expect(rows).toHaveLength(0);
  });

  test('Mixed batch operations', async () => {
    await db.insert(BatchTable).values({
      id: 'mixed-existing',
      name: 'Existing',
      status: 'pending',
    });

    const results = await db.batch([
      db.insert(BatchTable).values({ id: 'mixed-new', name: 'New Item', status: 'new' }),
      db.updateByLocator(BatchTable, { id: 'mixed-existing' }, { status: 'updated' }),
      db.select().from(BatchTable).where(inArray(BatchTable.name, ['Existing', 'New Item'])),
    ] as const);

    expect(results).toHaveLength(3);
    expect(results[0]).toHaveLength(1);
    expect(results[1]).toMatchObject({ id: 'mixed-existing', status: 'updated' });
    expect(results[2]).toHaveLength(2);

    const finalRows = results[2];
    expect(finalRows.some((row) => row.id === 'mixed-new' && row.status === 'new')).toBe(true);
    expect(finalRows.some((row) => row.id === 'mixed-existing' && row.status === 'updated')).toBe(true);
  });

  test('Batch INSERT with returning should preserve sequential result shapes', async () => {
    const results = await db.batch([
      db.insert(BatchTable).values({ id: 'batch-return-1', name: 'Return One', status: 'queued' })
        .returning({ id: BatchTable.id, status: BatchTable.status }),
      db.insert(BatchTable).values({ id: 'batch-return-2', name: 'Return Two', status: 'queued' }),
      db.select().from(BatchTable)
        .where(inArray(BatchTable.name, ['Return One', 'Return Two'])),
    ] as const);

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual([{ id: 'batch-return-1', status: 'queued' }]);
    expect(results[1]).toHaveLength(1);
    expect(results[2].map((row) => row.id).sort()).toEqual(['batch-return-1', 'batch-return-2']);
  });

  test('Batch DELETE with returning should expose pre-delete snapshots', async () => {
    await db.insert(BatchTable).values([
      { id: 'batch-delete-return-1', name: 'Delete Return One', status: 'active' },
      { id: 'batch-delete-return-2', name: 'Delete Return Two', status: 'active' },
    ]);

    const results = await db.batch([
      db.delete(BatchTable).where(eq(BatchTable.name, 'Delete Return One'))
        .returning({ id: BatchTable.id, name: BatchTable.name }),
      db.delete(BatchTable).where(eq(BatchTable.name, 'Delete Return Two'))
        .returning({ id: BatchTable.id, status: BatchTable.status }),
    ] as const);

    expect(results).toEqual([
      [{ id: 'batch-delete-return-1', name: 'Delete Return One' }],
      [{ id: 'batch-delete-return-2', status: 'active' }],
    ]);

    const rows = await db.select().from(BatchTable)
      .where(inArray(BatchTable.name, ['Delete Return One', 'Delete Return Two']));

    expect(rows).toHaveLength(0);
  });



  test('Batch query facade should support findMany + findFirst together', async () => {
    await db.insert(BatchTable).values([
      { id: 'batch-query-1', name: 'Batch Query One', status: 'queued' },
      { id: 'batch-query-2', name: 'Batch Query Two', status: 'ready' },
    ]);

    const results = await db.batch([
      db.query.batchItems.findMany({
        where: { name: ['Batch Query One', 'Batch Query Two'] },
        orderBy: { column: BatchTable.name, direction: 'asc' },
      }),
      db.query.batchItems.findFirst({ where: { name: 'Batch Query Two' } }),
    ] as const);

    expect(results[0].map((row) => row.id)).toEqual(['batch-query-1', 'batch-query-2']);
    expect(results[1]).toMatchObject({ id: 'batch-query-2', name: 'Batch Query Two', status: 'ready' });
  });

  test('Batch should support insert + findMany + findFirst in one sequence', async () => {
    const results = await db.batch([
      db.insert(BatchTable).values({ id: 'batch-query-3', name: 'Batch Query Three', status: 'new' }),
      db.query.batchItems.findMany({ where: { name: ['Batch Query Three'] } }),
      db.query.batchItems.findFirst({ where: { name: 'Batch Query Three' } }),
    ] as const);

    expect(results[0]).toHaveLength(1);
    expect(results[1]).toEqual([
      expect.objectContaining({ id: 'batch-query-3', name: 'Batch Query Three', status: 'new' }),
    ]);
    expect(results[2]).toMatchObject({ id: 'batch-query-3', name: 'Batch Query Three', status: 'new' });
  });

});
