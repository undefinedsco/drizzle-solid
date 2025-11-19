import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle } from '../../../src/driver';
import { SCHEMA_INRUPT as SCHEMA } from '@inrupt/vocab-common-rdf';
import {
  podTable,
  string,
  int,
  date,
  and,
  or,
  inArray,
  eq,
  gte,
  lt
} from '../../../src/index';
import type { SolidDatabase } from '../../../src/driver';
import type { Session } from '@inrupt/solid-client-authn-node';
import { createTestSession, ensureContainer } from './helpers';

const containerPath = `/drizzle-tests-complex/${Date.now()}/`;
const schemaNamespace = { prefix: SCHEMA.PREFIX, uri: SCHEMA.NAMESPACE };

vi.setConfig({ testTimeout: 60_000 });

const profileTable = podTable('profiles', {
  id: string('id').primaryKey().predicate('https://schema.org/identifier'),
  name: string('name').notNull().predicate('https://schema.org/name'),
  age: int('age').predicate('https://schema.org/age'),
  createdAt: date('createdAt').notNull().predicate('https://schema.org/dateCreated')
}, {
  base: `${containerPath}profiles.ttl`,
  rdfClass: 'https://schema.org/Person',
  namespace: schemaNamespace
});

describe('CSS integration: complex logical CRUD', () => {
  let session: Session;
  let db: SolidDatabase;
  let containerUrl: string;
  let resourceUrl: string;

  beforeAll(async () => {
    session = await createTestSession();
    db = drizzle(session);
    containerUrl = await ensureContainer(session, containerPath);
    resourceUrl = `${containerUrl}profiles.ttl`;
    await db.init(profileTable);
  }, 120_000);

  afterAll(async () => {
    if (resourceUrl) {
      await session.fetch(resourceUrl, { method: 'DELETE' }).catch(() => undefined);
    }
    if (containerUrl) {
      await session.fetch(containerUrl, { method: 'DELETE' }).catch(() => undefined);
    }
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
