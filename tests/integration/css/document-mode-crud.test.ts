/**
 * Document Mode Integration Tests
 *
 * Plain-LDP document mode only supports exact-target APIs.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle } from '../../../src/driver';
import { SCHEMA_INRUPT as SCHEMA } from '@inrupt/vocab-common-rdf';
import {
  podTable,
  string,
  int,
  id,
  eq,
} from '../../../src/index';
import type { SolidDatabase } from '../../../src/driver';
import type { Session } from '@inrupt/solid-client-authn-node';
import { buildTestPodUrl, createTestSession, ensureContainer } from './helpers';

const timestamp = Date.now();
const containerPath = `/doc-mode-test-${timestamp}/`;
const usersPath = `${containerPath}users/`;
const schemaNamespace = { prefix: SCHEMA.PREFIX, uri: SCHEMA.NAMESPACE };

vi.setConfig({ testTimeout: 60_000 });

const usersTable = podTable('users', {
  id: id(),
  name: string('name').notNull().predicate('https://schema.org/name'),
  age: int('age').predicate('https://schema.org/age'),
}, {
  base: usersPath,
  type: 'https://schema.org/Person',
  namespace: schemaNamespace,
  typeIndex: undefined,
});

describe('CSS integration: Document Mode CRUD', () => {
  let session: Session;
  let db: SolidDatabase;
  const insertedIds = new Set<string>();

  const track = <T extends { id: string }>(record: T): T => {
    insertedIds.add(record.id);
    return record;
  };

  beforeAll(async () => {
    session = await createTestSession();
    db = drizzle(session);
    await ensureContainer(session, containerPath);
    await ensureContainer(session, usersPath);
    await db.init(usersTable);
  }, 120_000);

  afterAll(async () => {
    for (const userId of insertedIds) {
      await db.deleteByLocator(usersTable, { id: userId }).catch(() => undefined);
    }
  });

  test('INSERT should create individual .ttl files and support exact locator reads', async () => {
    const alice = track({
      id: `alice-${timestamp}`,
      name: 'Alice',
      age: 30,
    });

    await db.insert(usersTable).values(alice);

    const row = await db.findByLocator(usersTable, { id: alice.id });
    expect(row).toMatchObject(alice);

    const documentUrl = `${buildTestPodUrl(usersPath)}${alice.id}.ttl`;
    const turtle = await session.fetch(documentUrl, {
      method: 'GET',
      headers: { Accept: 'text/turtle' },
    }).then((res) => res.text());

    expect(turtle).toContain('Alice');
  });

  test('findByIri should resolve exact document URI', async () => {
    const bob = track({
      id: `bob-${timestamp}`,
      name: 'Bob',
      age: 25,
    });

    await db.insert(usersTable).values(bob);

    const iri = `${buildTestPodUrl(usersPath)}${bob.id}.ttl`;
    const row = await db.findByIri(usersTable, iri);

    expect(row).toMatchObject(bob);
    expect(row?.['@id']).toBe(iri);
  });

  test('collection reads should fail in plain-LDP document mode', async () => {
    await expect(db.select().from(usersTable)).rejects.toThrow(
      /Document-mode collection queries over plain LDP are not supported/i,
    );

    await expect(
      db.select().from(usersTable).where(eq(usersTable.name, 'Alice')),
    ).rejects.toThrow(/Document-mode collection queries over plain LDP are not supported/i);
  });

  test('updateByLocator should modify the exact document', async () => {
    const carol = track({
      id: `carol-${timestamp}`,
      name: 'Carol',
      age: 28,
    });

    await db.insert(usersTable).values(carol);
    await db.updateByLocator(usersTable, { id: carol.id }, { age: 29 });

    const row = await db.findByLocator(usersTable, { id: carol.id });
    expect(row?.age).toBe(29);
  });

  test('deleteByLocator should remove the exact document', async () => {
    const dave = track({
      id: `dave-${timestamp}`,
      name: 'Dave',
      age: 31,
    });

    await db.insert(usersTable).values(dave);
    expect(await db.findByLocator(usersTable, { id: dave.id })).toMatchObject(dave);

    await db.deleteByLocator(usersTable, { id: dave.id });
    insertedIds.delete(dave.id);

    expect(await db.findByLocator(usersTable, { id: dave.id })).toBeNull();
  });
});
