/**
 * Document Mode Integration Tests
 *
 * Tests CRUD operations with document mode (base ends with /)
 * Each record gets its own .ttl file: /users/alice.ttl, /users/bob.ttl
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
  inArray
} from '../../../src/index';
import type { SolidDatabase } from '../../../src/driver';
import type { Session } from '@inrupt/solid-client-authn-node';
import { createTestSession, ensureContainer } from './helpers';

const timestamp = Date.now();
const containerPath = `/doc-mode-test-${timestamp}/`;
const usersPath = `${containerPath}users/`;
const schemaNamespace = { prefix: SCHEMA.PREFIX, uri: SCHEMA.NAMESPACE };

vi.setConfig({ testTimeout: 60_000 });

// Document mode table: base ends with /
const usersTable = podTable('users', {
  id: id(),  // @id predicate - derived from filename
  name: string('name').notNull().predicate('https://schema.org/name'),
  age: int('age').predicate('https://schema.org/age'),
}, {
  base: usersPath,  // Document mode!
  type: 'https://schema.org/Person',
  namespace: schemaNamespace,
  typeIndex: undefined
});

describe('CSS integration: Document Mode CRUD', () => {
  let session: Session;
  let db: SolidDatabase;

  beforeAll(async () => {
    session = await createTestSession();
    db = drizzle(session);
    await ensureContainer(session, containerPath);
    await ensureContainer(session, usersPath);
    await db.init(usersTable);
  }, 120_000);

  afterAll(async () => {
    // Cleanup: delete test resources
    try {
      const users = await db.select().from(usersTable);
      for (const user of users) {
        if (user.id) {
          await db.delete(usersTable).where({ id: user.id });
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  test('INSERT should create individual .ttl files', async () => {
    const alice = {
      id: `alice-${timestamp}`,
      name: 'Alice',
      age: 30,
    };

    await db.insert(usersTable).values(alice);

    // Verify by SELECT
    const users = await db.select().from(usersTable);
    const found = users.find(u => u.name === 'Alice');

    expect(found).toBeDefined();
    expect(found?.id).toBe(`alice-${timestamp}`);
    expect(found?.name).toBe('Alice');
    expect(found?.age).toBe(30);
  });

  test('SELECT with id = should work in document mode', async () => {
    // Insert another user
    const bob = {
      id: `bob-${timestamp}`,
      name: 'Bob',
      age: 25,
    };
    await db.insert(usersTable).values(bob);

    // Select by id
    const results = await db.select().from(usersTable).where(eq(usersTable.columns.id as any, `bob-${timestamp}`));

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Bob');
  });

  test('SELECT with id IN should work in document mode', async () => {
    const results = await db.select().from(usersTable).where(
      inArray(usersTable.columns.id as any, [`alice-${timestamp}`, `bob-${timestamp}`])
    );

    expect(results.length).toBeGreaterThanOrEqual(2);
    const names = results.map(r => r.name);
    expect(names).toContain('Alice');
    expect(names).toContain('Bob');
  });

  test('UPDATE should modify correct document', async () => {
    await db.update(usersTable)
      .set({ age: 31 })
      .where({ id: `alice-${timestamp}` });

    // Allow time for update to propagate
    await new Promise(resolve => setTimeout(resolve, 500));

    const results = await db.select().from(usersTable).where(eq(usersTable.columns.id as any, `alice-${timestamp}`));

    expect(results).toHaveLength(1);
    expect(results[0].age).toBe(31);
  });

  test('DELETE should remove correct document', async () => {
    // Insert a user to delete
    const carol = {
      id: `carol-${timestamp}`,
      name: 'Carol',
      age: 28,
    };
    await db.insert(usersTable).values(carol);

    // Verify inserted
    let results = await db.select().from(usersTable).where(eq(usersTable.columns.id as any, `carol-${timestamp}`));
    expect(results).toHaveLength(1);

    // Delete
    await db.delete(usersTable).where({ id: `carol-${timestamp}` });

    // Allow time for delete to propagate
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify deleted
    results = await db.select().from(usersTable).where(eq(usersTable.columns.id as any, `carol-${timestamp}`));
    expect(results).toHaveLength(0);
  });

  test('id should be correctly extracted from document URI', async () => {
    const users = await db.select().from(usersTable);

    // All users should have id extracted from filename
    for (const user of users) {
      expect(user.id).toBeDefined();
      expect(typeof user.id).toBe('string');
      expect(user.id.length).toBeGreaterThan(0);
      // id should NOT contain .ttl extension
      expect(user.id).not.toContain('.ttl');
      // id should NOT be a full URI
      expect(user.id).not.toContain('http');
    }
  });
});
