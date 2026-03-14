import { beforeAll, describe, expect, test, vi } from 'vitest';
import { Parser } from 'n3';
import { drizzle, podTable, string, int, eq } from '../../../src';
import { createTestSession, ensureContainer } from './helpers';

const SCHEMA = {
  identifier: 'http://schema.org/identifier',
  value: 'http://schema.org/value',
  thing: 'http://schema.org/Thing',
};

vi.setConfig({ testTimeout: 60_000 });

describe('CSS investigation: LDP update regressions', () => {
  let session: any;
  let containerUrl: string;

  beforeAll(async () => {
    session = await createTestSession();
    containerUrl = await ensureContainer(session, `integration/${Date.now()}/`);
  });

  test('keeps only the latest integer literal after update', async () => {
    const Counter = createCounterTable(`${containerUrl}integer-update.ttl`, 'CounterInteger');
    const db = drizzle(session, { schema: { Counter } });

    await db.insert(Counter).values({
      id: 'counter-1',
      countValue: 20,
    });

    await db.update(Counter)
      .set({ countValue: 99 })
      .where(eq(Counter.id, 'counter-1'));

    const rows = await db.select()
      .from(Counter)
      .where(eq(Counter.id, 'counter-1'));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.countValue).toBe(99);

    const objects = await fetchPredicateObjects(
      session.fetch,
      Counter.config.base,
      Counter.resolveUri('counter-1'),
      SCHEMA.value,
    );

    expect(objects).toEqual(['99']);
  });

  test('survives rapid concurrent updates without leaving duplicate values', async () => {
    const Counter = createCounterTable(`${containerUrl}concurrent-update.ttl`, 'CounterConcurrent');
    const db = drizzle(session, { schema: { Counter } });

    await db.insert(Counter).values({
      id: 'counter-1',
      countValue: 1,
    });

    const nextValues = [2, 3, 4, 5, 6];
    const settled = await Promise.allSettled(
      nextValues.map((countValue) =>
        db.update(Counter)
          .set({ countValue })
          .where(eq(Counter.id, 'counter-1')),
      ),
    );

    expect(settled.every((result) => result.status === 'fulfilled')).toBe(true);

    const objects = await fetchPredicateObjects(
      session.fetch,
      Counter.config.base,
      Counter.resolveUri('counter-1'),
      SCHEMA.value,
    );

    expect(objects).toHaveLength(1);
    expect(nextValues.map(String)).toContain(objects[0]);
  });
});

function createCounterTable(base: string, name: string) {
  return podTable(name, {
    id: string('id').primaryKey().predicate(SCHEMA.identifier),
    countValue: int('countValue').predicate(SCHEMA.value),
  }, {
    type: SCHEMA.thing,
    base,
    subjectTemplate: '#{id}',
  });
}

async function fetchPredicateObjects(
  fetchFn: typeof fetch,
  resourceUrl: string,
  subject: string,
  predicate: string,
): Promise<string[]> {
  const response = await fetchFn(resourceUrl, {
    headers: { Accept: 'text/turtle' },
  });

  expect(response.ok).toBe(true);
  const turtle = await response.text();
  const parser = new Parser({ baseIRI: resourceUrl });
  const quads = parser.parse(turtle);

  return quads
    .filter((quad) =>
      quad.subject.termType === 'NamedNode'
      && quad.subject.value === subject
      && quad.predicate.termType === 'NamedNode'
      && quad.predicate.value === predicate,
    )
    .map((quad) => quad.object.value)
    .sort();
}
