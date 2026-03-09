/**
 * EXISTS / NOT EXISTS parity tests for Solid-native raw SPARQL graph patterns.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle } from '../../../src/driver';
import {
  podTable,
  string,
  asc,
  exists,
  notExists,
} from '../../../src/index';
import type { SolidDatabase } from '../../../src/driver';
import type { Session } from '@inrupt/solid-client-authn-node';
import { buildTestPodUrl, createTestSession, ensureContainer } from './helpers';

const runId = Date.now();
const containerPath = `/drizzle-exists-${runId}/`;

vi.setConfig({ testTimeout: 60_000 });

describe('EXISTS / NOT EXISTS parity tests', () => {
  let session: Session;
  let db: SolidDatabase;

  const Users = podTable('ExistsUser', {
    id: string('id').primaryKey().predicate('http://schema.org/identifier'),
    name: string('name').predicate('http://schema.org/name'),
    managerId: string('managerId').predicate('https://schema.org/manager'),
  }, {
    type: 'http://schema.org/Person',
    base: `${buildTestPodUrl(containerPath)}data.ttl`,
    subjectTemplate: '#{id}',
  });

  beforeAll(async () => {
    session = await createTestSession();
    db = drizzle(session, { debug: true });
    await ensureContainer(session, containerPath);

    await db.insert(Users).values([
      { id: 'user-1', name: 'Alice', managerId: 'user-3' },
      { id: 'user-2', name: 'Bob', managerId: 'user-3' },
      { id: 'user-3', name: 'Charlie' },
    ]);
  }, 120_000);

  afterAll(async () => {
    // Cleanup
  });

  test('EXISTS should keep rows whose graph matches the pattern', async () => {
    const results = await db.select({
      id: Users.id,
      name: Users.name,
    })
      .from(Users)
      .where(exists('?subject <https://schema.org/manager> ?manager .'))
      .orderBy(asc(Users.name));

    expect(results).toEqual([
      { id: 'user-1', name: 'Alice' },
      { id: 'user-2', name: 'Bob' },
    ]);
  });

  test('NOT EXISTS should keep rows whose graph does not match the pattern', async () => {
    const results = await db.select({
      id: Users.id,
      name: Users.name,
    })
      .from(Users)
      .where(notExists('?subject <https://schema.org/manager> ?manager .'))
      .orderBy(asc(Users.name));

    expect(results).toEqual([
      { id: 'user-3', name: 'Charlie' },
    ]);
  });
});
