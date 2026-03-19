/**
 * Drizzle-style query facade integration tests.
 */

import { beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle } from '../../../src/driver';
import {
  podTable,
  string,
  uri,
  relations,
  eq,
} from '../../../src/index';
import type { SolidDatabase } from '../../../src/driver';
import type { Session } from '@inrupt/solid-client-authn-node';
import { buildTestPodUrl, createTestSession, ensureContainer } from './helpers';

const runId = Date.now();
const containerPath = `/drizzle-query-api-${runId}/`;

vi.setConfig({ testTimeout: 60_000 });

const Users = podTable('users', {
  id: string('id').primaryKey().predicate('http://schema.org/identifier'),
  name: string('name').notNull().predicate('http://schema.org/name'),
}, {
  type: 'http://schema.org/Person',
  base: `${buildTestPodUrl(containerPath)}users.ttl`,
  subjectTemplate: '#{id}',
});

const Posts = podTable('posts', {
  id: string('id').primaryKey().predicate('http://schema.org/identifier'),
  author: uri('author').notNull().predicate('http://schema.org/author').link(Users),
  title: string('title').notNull().predicate('http://schema.org/headline'),
}, {
  type: 'http://schema.org/Article',
  base: `${buildTestPodUrl(containerPath)}posts.ttl`,
  subjectTemplate: '#{id}',
});

relations(Users, ({ many }) => ({
  posts: many(Posts),
}));

describe('Drizzle query facade integration', () => {
  let session: Session;
  let db: SolidDatabase<{ users: typeof Users; posts: typeof Posts }>;

  beforeAll(async () => {
    session = await createTestSession();
    db = drizzle(session, {
      debug: true,
      schema: { users: Users, posts: Posts },
    });
    await ensureContainer(session, containerPath);

    await db.insert(Users).values([
      { id: 'user-1', name: 'Alice' },
      { id: 'user-2', name: 'Bob' },
      { id: 'user-3', name: 'Cara' },
    ]);

    await db.insert(Posts).values([
      { id: 'post-1', author: 'user-1', title: 'Alice First' },
      { id: 'post-2', author: 'user-1', title: 'Alice Second' },
      { id: 'post-3', author: 'user-2', title: 'Bob Post' },
    ]);
  }, 120_000);

  test('query.findMany should support where/orderBy/limit/offset', async () => {
    const rows = await db.query.users.findMany({
      where: { name: ['Alice', 'Bob', 'Cara'] },
      orderBy: { column: Users.name, direction: 'asc' },
      limit: 2,
      offset: 1,
    });

    expect(rows.map((row) => row.name)).toEqual(['Bob', 'Cara']);
  });

  test('query.findFirst should respect orderBy', async () => {
    const row = await db.query.users.findFirst({
      orderBy: { column: Users.name, direction: 'desc' },
    });

    expect(row).toMatchObject({ id: 'user-3', name: 'Cara' });
  });

  test('query.findByLocator should resolve template-based exact target', async () => {
    const row = await db.query.users.findByLocator({ id: 'user-2' });

    expect(row).toMatchObject({ id: 'user-2', name: 'Bob' });
  });

  test('query.findByIri should resolve absolute subject IRI', async () => {
    const row = await db.query.users.findByIri(
      `${buildTestPodUrl(containerPath)}users.ttl#user-1`,
    );

    expect(row).toMatchObject({ id: 'user-1', name: 'Alice' });
  });

  test('query.count should support where filters', async () => {
    const count = await db.query.posts.count({ where: eq(Posts.author, 'user-1') });

    expect(count).toBe(2);
  });

  test('query.findMany with relations should eager load referenced rows', async () => {
    const rows = await db.query.users.findMany({
      with: { posts: true },
      orderBy: { column: Users.name, direction: 'asc' },
    });

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ id: 'user-1', name: 'Alice' });
    expect(Array.isArray((rows[0] as any).posts)).toBe(true);
    expect((rows[0] as any).posts.map((post: any) => post.title).sort()).toEqual([
      'Alice First',
      'Alice Second',
    ]);
    expect((rows[1] as any).posts.map((post: any) => post.title)).toEqual(['Bob Post']);
    expect((rows[2] as any).posts).toEqual([]);
  });

  test('query.findMany should filter by non-selected columns', async () => {
    const rows = await db.query.users.findMany({
      columns: { name: Users.name },
      where: { name: 'Bob' },
    });

    expect(rows).toEqual([{ name: 'Bob' }]);
  });

  test('query.findMany with relations should support where/orderBy/limit', async () => {
    const rows = await db.query.users.findMany({
      with: { posts: true },
      where: { name: ['Alice', 'Bob'] },
      orderBy: { column: Users.name, direction: 'desc' },
      limit: 1,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'user-2', name: 'Bob' });
    expect((rows[0] as any).posts.map((post: any) => post.title)).toEqual(['Bob Post']);
  });

  test('query.findFirst with relations should support where and eager loading', async () => {
    const row = await db.query.users.findFirst({
      with: { posts: true },
      where: { name: 'Alice' },
      orderBy: { column: Users.name, direction: 'asc' },
    });

    expect(row).toMatchObject({ id: 'user-1', name: 'Alice' });
    expect((row as any)?.posts.map((post: any) => post.title).sort()).toEqual([
      'Alice First',
      'Alice Second',
    ]);
  });

  test('query.findFirst with relations should return null when no rows match', async () => {
    const row = await db.query.users.findFirst({
      with: { posts: true },
      where: { name: 'Missing User' },
    });

    expect(row).toBeNull();
  });

  test('query.findMany with relations should support base partial selection + where', async () => {
    const rows = await db.query.users.findMany({
      columns: { name: Users.name },
      with: { posts: true },
      where: { name: 'Alice' },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Alice' });
    expect((rows[0] as any).posts.map((post: any) => post.title).sort()).toEqual([
      'Alice First',
      'Alice Second',
    ]);
  });

  test('query.findFirst with relations should support orderBy', async () => {
    const row = await db.query.users.findFirst({
      with: { posts: true },
      orderBy: { column: Users.name, direction: 'desc' },
    });

    expect(row).toMatchObject({ id: 'user-3', name: 'Cara' });
    expect((row as any)?.posts).toEqual([]);
  });

  test('query.findFirst with relations should support base partial selection + where', async () => {
    const row = await db.query.users.findFirst({
      columns: { name: Users.name },
      with: { posts: true },
      where: { name: 'Alice' },
    });

    expect(row).toMatchObject({ name: 'Alice' });
    expect((row as any)?.posts.map((post: any) => post.title).sort()).toEqual([
      'Alice First',
      'Alice Second',
    ]);
  });
});
