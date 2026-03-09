/**
 * Drizzle ORM returning() parity tests.
 */

import { beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle } from '../../../src/driver';
import {
  podTable,
  string,
  int,
  eq,
} from '../../../src/index';
import type { SolidDatabase } from '../../../src/driver';
import type { Session } from '@inrupt/solid-client-authn-node';
import { buildTestPodUrl, createTestSession, ensureContainer } from './helpers';

const runId = Date.now();
const containerPath = `/drizzle-returning-${runId}/`;

vi.setConfig({ testTimeout: 60_000 });

const Users = podTable('ReturningUsers', {
  id: string('id').primaryKey().predicate('http://schema.org/identifier'),
  name: string('name').notNull().predicate('http://schema.org/name'),
  age: int('age').predicate('http://schema.org/age'),
}, {
  type: 'http://schema.org/Person',
  base: `${buildTestPodUrl(containerPath)}users.ttl`,
  subjectTemplate: '#{id}',
});

const ArrayDocs = podTable('ReturningArrayDocs', {
  id: string('id').primaryKey().predicate('http://schema.org/identifier'),
  tags: string('tags').array().predicate('http://schema.org/keywords'),
}, {
  type: 'http://schema.org/CreativeWork',
  base: `${buildTestPodUrl(containerPath)}array-docs.ttl`,
  subjectTemplate: '#{id}',
});

describe('Drizzle ORM returning() parity', () => {
  let session: Session;
  let db: SolidDatabase;

  beforeAll(async () => {
    session = await createTestSession();
    db = drizzle(session, { debug: true });
    await ensureContainer(session, containerPath);
  }, 120_000);

  test('insert returning all fields', async () => {
    const rows = await db.insert(Users)
      .values({ id: 'ret-ins-1', name: 'Alice', age: 20 })
      .returning();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'ret-ins-1', name: 'Alice', age: 20 });
  });

  test('insert returning partial fields', async () => {
    const rows = await db.insert(Users)
      .values({ id: 'ret-ins-2', name: 'Bob', age: 30 })
      .returning({ id: Users.id, name: Users.name });

    expect(rows).toEqual([{ id: 'ret-ins-2', name: 'Bob' }]);
  });

  test('insert many returning all fields', async () => {
    const rows = await db.insert(Users)
      .values([
        { id: 'ret-ins-many-1', name: 'Ivy', age: 18 },
        { id: 'ret-ins-many-2', name: 'Jade', age: 19 },
      ])
      .returning();

    expect(rows).toHaveLength(2);
    expect(rows).toEqual([
      expect.objectContaining({ id: 'ret-ins-many-1', name: 'Ivy', age: 18 }),
      expect.objectContaining({ id: 'ret-ins-many-2', name: 'Jade', age: 19 }),
    ]);
  });

  test('update returning all fields', async () => {
    await db.insert(Users).values({ id: 'ret-upd-1', name: 'Carol', age: 25 });

    const rows = await db.update(Users)
      .set({ name: 'Caroline', age: 26 })
      .where(eq(Users.id, 'ret-upd-1'))
      .returning();

    expect(rows).toEqual([
      expect.objectContaining({ id: 'ret-upd-1', name: 'Caroline', age: 26 }),
    ]);
  });

  test('update returning partial fields', async () => {
    await db.insert(Users).values({ id: 'ret-upd-2', name: 'Dan', age: 40 });

    const rows = await db.update(Users)
      .set({ age: 41 })
      .where(eq(Users.id, 'ret-upd-2'))
      .returning({ id: Users.id, age: Users.age });

    expect(rows).toEqual([{ id: 'ret-upd-2', age: 41 }]);
  });

  test('delete returning all fields', async () => {
    await db.insert(Users).values({ id: 'ret-del-1', name: 'Eve', age: 35 });

    const rows = await db.delete(Users)
      .where(eq(Users.id, 'ret-del-1'))
      .returning();

    expect(rows).toEqual([
      expect.objectContaining({ id: 'ret-del-1', name: 'Eve', age: 35 }),
    ]);

    const remaining = await db.select().from(Users).where(eq(Users.id, 'ret-del-1'));
    expect(remaining).toEqual([]);
  });

  test('delete returning partial fields', async () => {
    await db.insert(Users).values({ id: 'ret-del-2', name: 'Frank', age: 29 });

    const rows = await db.delete(Users)
      .where(eq(Users.id, 'ret-del-2'))
      .returning({ id: Users.id, name: Users.name });

    expect(rows).toEqual([{ id: 'ret-del-2', name: 'Frank' }]);
  });

  test('insert with array values works', async () => {
    const rows = await db.insert(ArrayDocs)
      .values({ id: 'ret-array-ins-1', tags: ['alpha', 'beta'] })
      .returning({ id: ArrayDocs.id, tags: ArrayDocs.tags });

    expect(rows).toEqual([{ id: 'ret-array-ins-1', tags: ['alpha', 'beta'] }]);
  });

  test('update with array values works', async () => {
    await db.insert(ArrayDocs).values({ id: 'ret-array-upd-1', tags: ['draft'] });

    const rows = await db.update(ArrayDocs)
      .set({ tags: ['published', 'featured'] })
      .where(eq(ArrayDocs.id, 'ret-array-upd-1'))
      .returning({ id: ArrayDocs.id, tags: ArrayDocs.tags });

    expect(rows).toEqual([{ id: 'ret-array-upd-1', tags: ['published', 'featured'] }]);
  });
});
