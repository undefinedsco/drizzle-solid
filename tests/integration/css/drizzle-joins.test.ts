/**
 * Drizzle ORM JOINS parity tests
 * Adapted from upstream Drizzle selection for Solid dialect.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle } from '../../../src/driver';
import {
  podTable,
  string,
  alias,
  eq,
  asc,
} from '../../../src/index';
import type { SolidDatabase } from '../../../src/driver';
import type { Session } from '@inrupt/solid-client-authn-node';
import { buildTestPodUrl, createTestSession, ensureContainer } from './helpers';

const runId = Date.now();
const containerPath = `/drizzle-joins-${runId}/`;

vi.setConfig({ testTimeout: 60_000 });

describe('Drizzle ORM JOINS parity tests', () => {
  let session: Session;
  let db: SolidDatabase;

  const Users = podTable('Users', {
    id: string('id').primaryKey().predicate('http://schema.org/identifier'),
    name: string('name').notNull().predicate('http://schema.org/name'),
    managerId: string('managerId').predicate('http://schema.org/manager'),
  }, {
    type: 'http://schema.org/Person',
    base: `${buildTestPodUrl(containerPath)}users.ttl`,
    subjectTemplate: '#{id}',
  });

  const Managers = alias(Users, 'Managers');

  const Posts = podTable('Posts', {
    id: string('id').primaryKey().predicate('http://schema.org/identifier'),
    userId: string('userId').notNull().predicate('http://schema.org/author'),
    title: string('title').notNull().predicate('http://schema.org/title'),
  }, {
    type: 'http://schema.org/Article',
    base: `${buildTestPodUrl(containerPath)}posts.ttl`,
    subjectTemplate: '#{id}',
  });

  beforeAll(async () => {
    session = await createTestSession();
    db = drizzle(session, { debug: true });
    await ensureContainer(session, containerPath);
    await ensureContainer(session, `${containerPath}users/`);
    await ensureContainer(session, `${containerPath}posts/`);

    await db.insert(Users).values([
      { id: 'user-1', name: 'Alice', managerId: 'user-3' },
      { id: 'user-2', name: 'Bob', managerId: 'user-3' },
      { id: 'user-3', name: 'Charlie' },
    ]);

    await db.insert(Posts).values([
      { id: 'post-1', userId: 'user-1', title: 'First Post' },
      { id: 'post-2', userId: 'user-1', title: 'Second Post' },
      { id: 'post-3', userId: 'user-2', title: 'Bob Post' },
    ]);
  }, 120_000);

  afterAll(async () => {
    // Cleanup
  });

  test('LEFT JOIN should preserve unmatched base rows', async () => {
    const results = await db.select()
      .from(Users)
      .leftJoin(Posts, eq(Users.id, Posts.userId))
      .orderBy(asc(Users.name), asc(Posts.title));

    expect(results.map((row) => ({
      userId: row.id,
      userName: row.name,
      postId: row['Posts.id'],
      postTitle: row['Posts.title'],
    }))).toEqual([
      { userId: 'user-1', userName: 'Alice', postId: 'post-1', postTitle: 'First Post' },
      { userId: 'user-1', userName: 'Alice', postId: 'post-2', postTitle: 'Second Post' },
      { userId: 'user-2', userName: 'Bob', postId: 'post-3', postTitle: 'Bob Post' },
      { userId: 'user-3', userName: 'Charlie', postId: undefined, postTitle: undefined },
    ]);
  });

  test('INNER JOIN should only keep matched rows', async () => {
    const results = await db.select()
      .from(Users)
      .innerJoin(Posts, eq(Users.id, Posts.userId))
      .orderBy(asc(Users.name), asc(Posts.title));

    expect(results.map((row) => ({
      userId: row.id,
      userName: row.name,
      postId: row['Posts.id'],
      postTitle: row['Posts.title'],
    }))).toEqual([
      { userId: 'user-1', userName: 'Alice', postId: 'post-1', postTitle: 'First Post' },
      { userId: 'user-1', userName: 'Alice', postId: 'post-2', postTitle: 'Second Post' },
      { userId: 'user-2', userName: 'Bob', postId: 'post-3', postTitle: 'Bob Post' },
    ]);
  });

  test('JOIN with WHERE on base table', async () => {
    const results = await db.select()
      .from(Users)
      .leftJoin(Posts, eq(Users.id, Posts.userId))
      .where(eq(Users.name, 'Alice'))
      .orderBy(asc(Posts.title));

    expect(results.map((row) => ({
      userId: row.id,
      userName: row.name,
      postTitle: row['Posts.title'],
    }))).toEqual([
      { userId: 'user-1', userName: 'Alice', postTitle: 'First Post' },
      { userId: 'user-1', userName: 'Alice', postTitle: 'Second Post' },
    ]);
  });

  test('JOIN with WHERE on joined table', async () => {
    const results = await db.select()
      .from(Users)
      .leftJoin(Posts, eq(Users.id, Posts.userId))
      .where(eq(Posts.title, 'Bob Post'));

    expect(results.map((row) => ({
      userId: row.id,
      userName: row.name,
      postId: row['Posts.id'],
      postTitle: row['Posts.title'],
    }))).toEqual([
      { userId: 'user-2', userName: 'Bob', postId: 'post-3', postTitle: 'Bob Post' },
    ]);
  });

  test('JOIN with specific columns should expose flat projections', async () => {
    const results = await db.select({
      userId: Users.id,
      userName: Users.name,
      postId: Posts.id,
      postTitle: Posts.title,
    })
      .from(Users)
      .leftJoin(Posts, eq(Users.id, Posts.userId))
      .orderBy(asc(Users.name), asc(Posts.title));

    expect(results).toEqual([
      { userId: 'user-1', userName: 'Alice', postId: 'post-1', postTitle: 'First Post' },
      { userId: 'user-1', userName: 'Alice', postId: 'post-2', postTitle: 'Second Post' },
      { userId: 'user-2', userName: 'Bob', postId: 'post-3', postTitle: 'Bob Post' },
      { userId: 'user-3', userName: 'Charlie', postId: undefined, postTitle: undefined },
    ]);
  });

  test('JOIN with ORDER BY', async () => {
    const results = await db.select({
      userName: Users.name,
      postTitle: Posts.title,
    })
      .from(Users)
      .leftJoin(Posts, eq(Users.id, Posts.userId))
      .orderBy(asc(Users.name), asc(Posts.title));

    expect(results.map((row) => row.userName)).toEqual([
      'Alice',
      'Alice',
      'Bob',
      'Charlie',
    ]);
    expect(results.at(-1)).toEqual({
      userName: 'Charlie',
      postTitle: undefined,
    });
  });

  test('JOIN with LIMIT', async () => {
    const results = await db.select({
      userName: Users.name,
      postTitle: Posts.title,
    })
      .from(Users)
      .leftJoin(Posts, eq(Users.id, Posts.userId))
      .orderBy(asc(Users.name), asc(Posts.title))
      .limit(2);

    expect(results).toEqual([
      { userName: 'Alice', postTitle: 'First Post' },
      { userName: 'Alice', postTitle: 'Second Post' },
    ]);
  });




  test('JOIN with whole-table grouped projections should return nested table objects', async () => {
    const results = await db.select({
      user: Users,
      post: Posts,
    })
      .from(Users)
      .leftJoin(Posts, eq(Users.id, Posts.userId))
      .orderBy(asc(Users.name), asc(Posts.title));

    expect(results).toEqual([
      {
        user: { id: 'user-1', name: 'Alice', managerId: 'user-3' },
        post: { id: 'post-1', userId: 'user-1', title: 'First Post' },
      },
      {
        user: { id: 'user-1', name: 'Alice', managerId: 'user-3' },
        post: { id: 'post-2', userId: 'user-1', title: 'Second Post' },
      },
      {
        user: { id: 'user-2', name: 'Bob', managerId: 'user-3' },
        post: { id: 'post-3', userId: 'user-2', title: 'Bob Post' },
      },
      {
        user: { id: 'user-3', name: 'Charlie', managerId: undefined },
        post: null,
      },
    ]);
  });

  test('JOIN with alias partial projection should support filtering on aliased table', async () => {
    const results = await db.select({
      user: {
        id: Users.id,
        name: Users.name,
      },
      managerName: Managers.name,
    })
      .from(Users)
      .leftJoin(Managers, eq(Users.managerId, Managers.id))
      .where(eq(Managers.name, 'Charlie'))
      .orderBy(asc(Users.name));

    expect(results).toEqual([
      { user: { id: 'user-1', name: 'Alice' }, managerName: 'Charlie' },
      { user: { id: 'user-2', name: 'Bob' }, managerName: 'Charlie' },
    ]);
  });

  test('JOIN with grouped fields should return nested objects and null unmatched joins', async () => {
    const results = await db.select({
      user: {
        id: Users.id,
        name: Users.name,
      },
      post: {
        id: Posts.id,
        title: Posts.title,
      },
    })
      .from(Users)
      .leftJoin(Posts, eq(Users.id, Posts.userId))
      .orderBy(asc(Users.name), asc(Posts.title));

    expect(results).toEqual([
      { user: { id: 'user-1', name: 'Alice' }, post: { id: 'post-1', title: 'First Post' } },
      { user: { id: 'user-1', name: 'Alice' }, post: { id: 'post-2', title: 'Second Post' } },
      { user: { id: 'user-2', name: 'Bob' }, post: { id: 'post-3', title: 'Bob Post' } },
      { user: { id: 'user-3', name: 'Charlie' }, post: null },
    ]);
  });

  test('JOIN with whole-table grouped projections should support alias self-join', async () => {
    const results = await db.select({
      user: Users,
      manager: Managers,
    })
      .from(Users)
      .leftJoin(Managers, eq(Users.managerId, Managers.id))
      .orderBy(asc(Users.name));

    expect(results).toEqual([
      {
        user: { id: 'user-1', name: 'Alice', managerId: 'user-3' },
        manager: { id: 'user-3', name: 'Charlie', managerId: undefined },
      },
      {
        user: { id: 'user-2', name: 'Bob', managerId: 'user-3' },
        manager: { id: 'user-3', name: 'Charlie', managerId: undefined },
      },
      {
        user: { id: 'user-3', name: 'Charlie', managerId: undefined },
        manager: null,
      },
    ]);
  });

  test('SELF JOIN with alias should project manager rows', async () => {
    const results = await db.select({
      userName: Users.name,
      managerName: Managers.name,
    })
      .from(Users)
      .leftJoin(Managers, eq(Users.managerId, Managers.id))
      .orderBy(asc(Users.name));

    expect(results).toEqual([
      { userName: 'Alice', managerName: 'Charlie' },
      { userName: 'Bob', managerName: 'Charlie' },
      { userName: 'Charlie', managerName: undefined },
    ]);
  });

  test('CROSS JOIN should produce cartesian product rows', async () => {
    const results = await db.select()
      .from(Users)
      .crossJoin(Posts)
      .orderBy(asc(Users.name), asc(Posts.title));

    expect(results.map((row) => ({
      userId: row.id,
      userName: row.name,
      postId: row['Posts.id'],
      postTitle: row['Posts.title'],
    }))).toEqual([
      { userId: 'user-1', userName: 'Alice', postId: 'post-3', postTitle: 'Bob Post' },
      { userId: 'user-1', userName: 'Alice', postId: 'post-1', postTitle: 'First Post' },
      { userId: 'user-1', userName: 'Alice', postId: 'post-2', postTitle: 'Second Post' },
      { userId: 'user-2', userName: 'Bob', postId: 'post-3', postTitle: 'Bob Post' },
      { userId: 'user-2', userName: 'Bob', postId: 'post-1', postTitle: 'First Post' },
      { userId: 'user-2', userName: 'Bob', postId: 'post-2', postTitle: 'Second Post' },
      { userId: 'user-3', userName: 'Charlie', postId: 'post-3', postTitle: 'Bob Post' },
      { userId: 'user-3', userName: 'Charlie', postId: 'post-1', postTitle: 'First Post' },
      { userId: 'user-3', userName: 'Charlie', postId: 'post-2', postTitle: 'Second Post' },
    ]);
  });

  test('CROSS JOIN with projection + LIMIT should respect deferred ordering', async () => {
    const results = await db.select({
      userName: Users.name,
      postTitle: Posts.title,
    })
      .from(Users)
      .crossJoin(Posts)
      .orderBy(asc(Users.name), asc(Posts.title))
      .limit(4);

    expect(results).toEqual([
      { userName: 'Alice', postTitle: 'Bob Post' },
      { userName: 'Alice', postTitle: 'First Post' },
      { userName: 'Alice', postTitle: 'Second Post' },
      { userName: 'Bob', postTitle: 'Bob Post' },
    ]);
  });

});
