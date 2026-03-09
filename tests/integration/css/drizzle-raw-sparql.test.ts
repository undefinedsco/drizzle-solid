/**
 * Raw SPARQL escape hatch integration tests.
 */

import { beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle } from '../../../src/driver';
import {
  podTable,
  string,
} from '../../../src/index';
import type { SolidDatabase } from '../../../src/driver';
import type { Session } from '@inrupt/solid-client-authn-node';
import { buildTestPodUrl, createTestSession, ensureContainer } from './helpers';

const runId = Date.now();
const containerPath = `/drizzle-raw-sparql-${runId}/`;
const resourceUrl = `${buildTestPodUrl(containerPath)}people.ttl`;

vi.setConfig({ testTimeout: 60_000 });

const People = podTable('RawSparqlPeople', {
  id: string('id').primaryKey().predicate('http://schema.org/identifier'),
  name: string('name').notNull().predicate('http://schema.org/name'),
}, {
  type: 'http://schema.org/Person',
  base: resourceUrl,
  subjectTemplate: '#{id}',
});

describe('Raw SPARQL escape hatch', () => {
  let session: Session;
  let db: SolidDatabase;

  beforeAll(async () => {
    session = await createTestSession();
    db = drizzle(session, { debug: true });
    await db.dialect.connect();
    await ensureContainer(session, containerPath);

    await db.insert(People).values([
      { id: 'user-1', name: 'Alice' },
      { id: 'user-2', name: 'Bob' },
    ]);

    db.dialect.addSource(resourceUrl);
  }, 120_000);

  test('db.execute should run raw SELECT SPARQL queries', async () => {
    const rows = await db.execute(`
      PREFIX schema: <http://schema.org/>
      SELECT ?id ?name
      WHERE {
        ?subject a schema:Person ;
          schema:identifier ?id ;
          schema:name ?name .
        FILTER (?id IN ("user-1", "user-2"))
      }
      ORDER BY ?name
    `);

    expect(rows).toEqual([
      { id: 'user-1', name: 'Alice' },
      { id: 'user-2', name: 'Bob' },
    ]);
  });
});
