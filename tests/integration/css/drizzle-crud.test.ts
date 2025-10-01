import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { drizzle } from '../../../src/driver';
import {
  podTable,
  string,
  int,
  date,
  and,
  gte,
  inArray,
  or,
  not,
  like,
  isNull,
  notInArray,
  eq,
  ne,
  lt,
  count,
  avg,
  max
} from '../../../src/index';
import type { SolidDatabase } from '../../../src/driver';
import type { Session } from '@inrupt/solid-client-authn-node';
import { createTestSession, ensureContainer } from './helpers';

const containerPath = `/drizzle-tests/${Date.now()}/`;

const profileTable = podTable('profiles', {
  id: string('id').primaryKey(),
  name: string('name').notNull(),
  age: int('age'),
  createdAt: date('createdAt').notNull()
}, {
  containerPath,
  rdfClass: 'https://schema.org/Person',
  autoRegister: false
});

describe('CSS integration: drizzle CRUD', () => {
  let session: Session;
  let db: SolidDatabase;
  let containerUrl: string;
  let resourceUrl: string;

  beforeAll(async () => {
    session = await createTestSession();
    db = drizzle(session);
    containerUrl = await ensureContainer(session, containerPath);
    resourceUrl = `${containerUrl}${profileTable.config.name}.ttl`;
  }, 120_000);

  afterAll(async () => {
    if (resourceUrl) {
      await session.fetch(resourceUrl, { method: 'DELETE' }).catch(() => undefined);
    }
    if (containerUrl) {
      await session.fetch(containerUrl, { method: 'DELETE' }).catch(() => undefined);
    }
    if (session) {
      await session.logout().catch(() => undefined);
    }
  });

  test('performs insert/select/update/delete against a live pod', async () => {
    expect(session.info.isLoggedIn).toBe(true);
    expect(session.info.webId).toBeDefined();

    const recordId = `profile-${Date.now()}`;
    const insertedName = 'Alice Example';
    const updatedName = 'Alice Updated';

    await db.insert(profileTable).values({
      id: recordId,
      name: insertedName,
      age: 30,
      createdAt: new Date()
    });

    const afterInsert = await db
      .select()
      .from(profileTable)
      .where({ id: recordId });

    expect(afterInsert).toHaveLength(1);
    expect(afterInsert[0]?.name).toBe(insertedName);

    await db
      .update(profileTable)
      .set({ name: updatedName, age: 31 })
      .where({ id: recordId });

    const afterUpdate = await db
      .select()
      .from(profileTable)
      .where({ id: recordId });

    expect(afterUpdate).toHaveLength(1);
    expect(afterUpdate[0]?.name).toBe(updatedName);
    expect(Number(afterUpdate[0]?.age)).toBe(31);

    await db
      .delete(profileTable)
      .where({ id: recordId });

    const afterDelete = await db
      .select()
      .from(profileTable)
      .where({ id: recordId });

    expect(afterDelete).toHaveLength(0);
  });

  test('supports select modifiers with ordering, limits, and distinct', async () => {
    await session.fetch(resourceUrl, { method: 'DELETE' }).catch(() => undefined);

    const batchBase = `profile-batch-${Date.now()}`;
    const batchRecords = [
      { id: `${batchBase}-1`, name: 'Batch Alpha', age: 22, createdAt: new Date(Date.now() - 3_000) },
      { id: `${batchBase}-2`, name: 'Batch Beta', age: 27, createdAt: new Date(Date.now() - 2_000) },
      { id: `${batchBase}-3`, name: 'Batch Gamma', age: 31, createdAt: new Date(Date.now() - 1_000) }
    ];

    await db.insert(profileTable).values(batchRecords);

    const orderedByAgeDesc = await db
      .select({ name: profileTable.name, age: profileTable.age })
      .from(profileTable)
      .orderBy(profileTable.age, 'desc');

    expect(orderedByAgeDesc.map((row) => row.name)).toEqual([
      'Batch Gamma',
      'Batch Beta',
      'Batch Alpha'
    ]);

    const youngest = await db
      .select({ name: profileTable.name })
      .from(profileTable)
      .orderBy(profileTable.age, 'asc')
      .limit(1);

    expect(youngest).toHaveLength(1);
    expect(youngest[0]?.name).toBe('Batch Alpha');

    const distinctAges = await db
      .select({ age: profileTable.age })
      .from(profileTable)
      .distinct()
      .orderBy(profileTable.age, 'asc');

    expect(distinctAges.map((row) => Number(row.age))).toEqual([22, 27, 31]);

    const offsetSelection = await db
      .select({ name: profileTable.name })
      .from(profileTable)
      .orderBy(profileTable.age, 'asc')
      .offset(1)
      .limit(1);

    expect(offsetSelection).toHaveLength(1);
    expect(offsetSelection[0]?.name).toBe('Batch Beta');

    const filtered = await db
      .select()
      .from(profileTable)
      .where({ age: 27 });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.name).toBe('Batch Beta');

    const conditionFiltered = await db
      .select({ name: profileTable.name })
      .from(profileTable)
      .where(
        and(
          gte(profileTable.age, 27),
          inArray(profileTable.name, ['Batch Beta', 'Batch Gamma'])
        )
      )
      .orderBy(profileTable.age, 'asc');

    expect(conditionFiltered.map((row) => row.name)).toEqual([
      'Batch Beta',
      'Batch Gamma'
    ]);

    await session.fetch(resourceUrl, { method: 'DELETE' }).catch(() => undefined);
  });

  test('supports advanced where clauses with like/or/not/null semantics', async () => {
    await session.fetch(resourceUrl, { method: 'DELETE' }).catch(() => undefined);

    const batchBase = `profile-search-${Date.now()}`;
    const now = Date.now();
    const records = [
      { id: `${batchBase}-1`, name: 'Search Alpha', age: 20, createdAt: new Date(now - 5_000) },
      { id: `${batchBase}-2`, name: 'Search Beta', age: 25, createdAt: new Date(now - 4_000) },
      { id: `${batchBase}-3`, name: 'Search Gamma', age: 30, createdAt: new Date(now - 3_000) },
      { id: `${batchBase}-4`, name: 'Other Delta', createdAt: new Date(now - 2_000) }
    ];

    await db.insert(profileTable).values(records);

    const likeMatches = await db
      .select({ name: profileTable.name })
      .from(profileTable)
      .where(like(profileTable.name, 'search%'))
      .orderBy(profileTable.name, 'asc');

    expect(likeMatches.map((row) => row.name)).toEqual([
      'Search Alpha',
      'Search Beta',
      'Search Gamma'
    ]);

    const orMatches = await db
      .select({ name: profileTable.name, age: profileTable.age })
      .from(profileTable)
      .where(or(eq(profileTable.age, 20), eq(profileTable.age, 30)))
      .orderBy(profileTable.age, 'asc');

    expect(orMatches.map((row) => row.name)).toEqual(['Search Alpha', 'Search Gamma']);

    const notMatches = await db
      .select({ name: profileTable.name })
      .from(profileTable)
      .where(not(eq(profileTable.name, 'Search Beta')))
      .orderBy(profileTable.name, 'asc');

    expect(notMatches.map((row) => row.name)).toContain('Search Alpha');
    expect(notMatches.map((row) => row.name)).not.toContain('Search Beta');

    const nullMatches = await db
      .select({ name: profileTable.name })
      .from(profileTable)
      .where(isNull(profileTable.age));

    expect(nullMatches).toHaveLength(1);
    expect(nullMatches[0]?.name).toBe('Other Delta');

    const notNullMatches = await db
      .select({ name: profileTable.name })
      .from(profileTable)
      .where(not(isNull(profileTable.age)))
      .orderBy(profileTable.name, 'asc');

    expect(notNullMatches.map((row) => row.name)).toEqual([
      'Search Alpha',
      'Search Beta',
      'Search Gamma'
    ]);

    const notInMatches = await db
      .select({ name: profileTable.name })
      .from(profileTable)
      .where(
        notInArray(profileTable.name, ['Search Beta', 'Search Gamma'])
      )
      .orderBy(profileTable.name, 'asc');

    expect(notInMatches.map((row) => row.name)).toEqual([
      'Other Delta',
      'Search Alpha'
    ]);

    const notEqualMatches = await db
      .select({ name: profileTable.name })
      .from(profileTable)
      .where(ne(profileTable.age, 25))
      .orderBy(profileTable.name, 'asc');

    expect(notEqualMatches.map((row) => row.name)).toEqual([
      'Search Alpha',
      'Search Gamma'
    ]);

    await session.fetch(resourceUrl, { method: 'DELETE' }).catch(() => undefined);
  });

  test('supports aggregate selections with count and numeric reducers', async () => {
    await session.fetch(resourceUrl, { method: 'DELETE' }).catch(() => undefined);

    const batchBase = `profile-summary-${Date.now()}`;
    const records = [
      { id: `${batchBase}-1`, name: 'Aggregate Alpha', age: 21, createdAt: new Date(Date.now() - 4_000) },
      { id: `${batchBase}-2`, name: 'Aggregate Beta', age: 29, createdAt: new Date(Date.now() - 3_000) },
      { id: `${batchBase}-3`, name: 'Aggregate Gamma', age: 42, createdAt: new Date(Date.now() - 2_000) },
      { id: `${batchBase}-4`, name: 'Aggregate Missing', createdAt: new Date(Date.now() - 1_000) }
    ];

    await db.insert(profileTable).values(records);

    const aggregates = await db
      .select({
        total: count(),
        withAge: count(profileTable.age),
        maxAge: max(profileTable.age),
        avgAge: avg(profileTable.age)
      })
      .from(profileTable)
      .where(like(profileTable.name, 'Aggregate%'));

    expect(aggregates).toHaveLength(1);
    const summary = aggregates[0];

    expect(summary?.total).toBe(4);
    expect(summary?.withAge).toBe(3);
    expect(Number(summary?.maxAge)).toBe(42);
    expect(Number(summary?.avgAge)).toBeCloseTo((21 + 29 + 42) / 3, 5);

    await session.fetch(resourceUrl, { method: 'DELETE' }).catch(() => undefined);
  });

  test('supports joins across tables', async () => {
    const timestamp = Date.now();
    const usersPath = `/drizzle-tests/users-${timestamp}/`;
    const postsPath = `/drizzle-tests/posts-${timestamp}/`;

    const usersTable = podTable('users', {
      id: string('id').primaryKey(),
      name: string('name').notNull()
    }, {
      containerPath: usersPath,
      rdfClass: 'https://schema.org/Person',
      autoRegister: false
    });

    const postsTable = podTable('posts', {
      id: string('id').primaryKey(),
      title: string('title').notNull(),
      authorId: string('authorId').notNull()
    }, {
      containerPath: postsPath,
      rdfClass: 'https://schema.org/CreativeWork',
      autoRegister: false
    });

    const usersContainer = await ensureContainer(session, usersPath);
    const postsContainer = await ensureContainer(session, postsPath);
    const usersResource = `${usersContainer}${usersTable.config.name}.ttl`;
    const postsResource = `${postsContainer}${postsTable.config.name}.ttl`;

    try {
      await db.insert(usersTable).values([
        { id: 'user-1', name: 'Alice Author' },
        { id: 'user-2', name: 'Bob Writer' }
      ]);

      await db.insert(postsTable).values([
        { id: 'post-1', title: 'Solid Intro', authorId: 'user-1' },
        { id: 'post-2', title: 'SPARQL Tricks', authorId: 'user-2' },
        { id: 'post-3', title: 'No Author Yet', authorId: 'user-999' }
      ]);

      const innerJoined = await db
        .select({ title: postsTable.title, authorName: usersTable.name })
        .from(postsTable)
        .innerJoin(usersTable, { 'posts.authorId': 'users.id' })
        .orderBy(postsTable.title, 'asc');

      expect(innerJoined).toEqual([
        { title: 'Solid Intro', authorName: 'Alice Author' },
        { title: 'SPARQL Tricks', authorName: 'Bob Writer' }
      ]);

      const leftJoined = await db
        .select({ title: postsTable.title, authorName: usersTable.name })
        .from(postsTable)
        .leftJoin(usersTable, { 'posts.authorId': 'users.id' })
        .orderBy(postsTable.id, 'asc');

      expect(leftJoined).toEqual([
        { title: 'Solid Intro', authorName: 'Alice Author' },
        { title: 'SPARQL Tricks', authorName: 'Bob Writer' },
        { title: 'No Author Yet', authorName: undefined }
      ]);
    } finally {
      await session.fetch(postsResource, { method: 'DELETE' }).catch(() => undefined);
      await session.fetch(usersResource, { method: 'DELETE' }).catch(() => undefined);
      await session.fetch(postsContainer, { method: 'DELETE' }).catch(() => undefined);
      await session.fetch(usersContainer, { method: 'DELETE' }).catch(() => undefined);
    }
  });

  test('supports group by with aggregates', async () => {
    await session.fetch(resourceUrl, { method: 'DELETE' }).catch(() => undefined);

    const batchBase = `profile-group-${Date.now()}`;
    const now = Date.now();
    const records = [
      { id: `${batchBase}-1`, name: 'Group Alpha', age: 30, createdAt: new Date(now - 3_000) },
      { id: `${batchBase}-2`, name: 'Group Beta', age: 30, createdAt: new Date(now - 2_000) },
      { id: `${batchBase}-3`, name: 'Group Gamma', age: 40, createdAt: new Date(now - 1_000) }
    ];

    await db.insert(profileTable).values(records);

    const grouped = await db
      .select({ age: profileTable.age, total: count() })
      .from(profileTable)
      .groupBy(profileTable.age)
      .orderBy(profileTable.age, 'asc');

    expect(grouped.map((row) => ({ age: Number(row.age), total: Number(row.total) }))).toEqual([
      { age: 30, total: 2 },
      { age: 40, total: 1 }
    ]);

    await session.fetch(resourceUrl, { method: 'DELETE' }).catch(() => undefined);
  });

  test('supports complex updates with logical conditions', async () => {
    await session.fetch(resourceUrl, { method: 'DELETE' }).catch(() => undefined);

    const batchBase = `profile-update-${Date.now()}`;
    const records = [
      { id: `${batchBase}-1`, name: 'Update Alpha', age: 20, createdAt: new Date() },
      { id: `${batchBase}-2`, name: 'Update Beta', age: 25, createdAt: new Date() },
      { id: `${batchBase}-3`, name: 'Update Gamma', age: 30, createdAt: new Date() }
    ];

    await db.insert(profileTable).values(records);

    await db
      .update(profileTable)
      .set({ age: 99 })
      .where(or(eq(profileTable.name, 'Update Alpha'), eq(profileTable.name, 'Update Gamma')));

    const afterUpdate = await db
      .select({ name: profileTable.name, age: profileTable.age })
      .from(profileTable)
      .where(inArray(profileTable.name, ['Update Alpha', 'Update Beta', 'Update Gamma']))
      .orderBy(profileTable.name, 'asc');

    expect(afterUpdate.map(({ name, age }) => ({ name, age: Number(age) }))).toEqual([
      { name: 'Update Alpha', age: 99 },
      { name: 'Update Beta', age: 25 },
      { name: 'Update Gamma', age: 99 }
    ]);

    await session.fetch(resourceUrl, { method: 'DELETE' }).catch(() => undefined);
  });

  test('supports complex updates with nested logical conditions', async () => {
    await session.fetch(resourceUrl, { method: 'DELETE' }).catch(() => undefined);

    const batchBase = `profile-nested-update-${Date.now()}`;
    const records = [
      { id: `${batchBase}-1`, name: 'Nested Alpha', age: 15, createdAt: new Date() },
      { id: `${batchBase}-2`, name: 'Nested Beta', age: 35, createdAt: new Date() },
      { id: `${batchBase}-3`, name: 'Nested Gamma', age: 45, createdAt: new Date() }
    ];

    await db.insert(profileTable).values(records);

    await db
      .update(profileTable)
      .set({ age: 77 })
      .where(
        and(
          or(eq(profileTable.name, 'Nested Beta'), eq(profileTable.name, 'Nested Gamma')),
          gte(profileTable.age, 30)
        )
      );

    const afterUpdate = await db
      .select({ name: profileTable.name, age: profileTable.age })
      .from(profileTable)
      .where(inArray(profileTable.name, ['Nested Alpha', 'Nested Beta', 'Nested Gamma']))
      .orderBy(profileTable.name, 'asc');

    expect(afterUpdate.map(({ name, age }) => ({ name, age: Number(age) }))).toEqual([
      { name: 'Nested Alpha', age: 15 },
      { name: 'Nested Beta', age: 77 },
      { name: 'Nested Gamma', age: 77 }
    ]);

    await session.fetch(resourceUrl, { method: 'DELETE' }).catch(() => undefined);
  });

  test('supports complex deletes with logical conditions', async () => {
    await session.fetch(resourceUrl, { method: 'DELETE' }).catch(() => undefined);

    const batchBase = `profile-delete-${Date.now()}`;
    const records = [
      { id: `${batchBase}-1`, name: 'Delete Alpha', age: 20, createdAt: new Date() },
      { id: `${batchBase}-2`, name: 'Delete Beta', age: 25, createdAt: new Date() },
      { id: `${batchBase}-3`, name: 'Delete Gamma', age: 30, createdAt: new Date() }
    ];

    await db.insert(profileTable).values(records);

    await db
      .delete(profileTable)
      .where(or(eq(profileTable.name, 'Delete Alpha'), eq(profileTable.name, 'Delete Gamma')));

    const remaining = await db
      .select({ name: profileTable.name })
      .from(profileTable)
      .where(inArray(profileTable.name, ['Delete Alpha', 'Delete Beta', 'Delete Gamma']))
      .orderBy(profileTable.name, 'asc');

    expect(remaining.map((row) => row.name)).toEqual(['Delete Beta']);

    await session.fetch(resourceUrl, { method: 'DELETE' }).catch(() => undefined);
  });

  test('supports complex deletes with nested logical conditions', async () => {
    await session.fetch(resourceUrl, { method: 'DELETE' }).catch(() => undefined);

    const batchBase = `profile-nested-delete-${Date.now()}`;
    const records = [
      { id: `${batchBase}-1`, name: 'Nested Delete Alpha', age: 18, createdAt: new Date() },
      { id: `${batchBase}-2`, name: 'Nested Delete Beta', age: 28, createdAt: new Date() },
      { id: `${batchBase}-3`, name: 'Nested Delete Gamma', age: 48, createdAt: new Date() }
    ];

    await db.insert(profileTable).values(records);

    await db
      .delete(profileTable)
      .where(
        or(
          and(eq(profileTable.name, 'Nested Delete Alpha'), lt(profileTable.age, 20)),
          and(eq(profileTable.name, 'Nested Delete Gamma'), gte(profileTable.age, 40))
        )
      );

    const remaining = await db
      .select({ name: profileTable.name })
      .from(profileTable)
      .where(inArray(profileTable.name, ['Nested Delete Alpha', 'Nested Delete Beta', 'Nested Delete Gamma']))
      .orderBy(profileTable.name, 'asc');

    expect(remaining.map((row) => row.name)).toEqual(['Nested Delete Beta']);

    await session.fetch(resourceUrl, { method: 'DELETE' }).catch(() => undefined);
  });

});
