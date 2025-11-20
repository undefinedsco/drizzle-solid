import { describe, it, expectTypeOf } from 'vitest';
import { podTable, string } from '@src/index';
import { PodAsyncSession } from '@src/core/pod-session';
import { PodDialect } from '@src/core/pod-dialect';

const mockDialect = {
  query: () => Promise.resolve([]),
  registerTable: async () => undefined,
  isConnected: () => true,
  getConfig: () => ({}),
  connect: async () => undefined,
  disconnect: async () => undefined
} as unknown as PodDialect;

const mockTable = podTable('demo', {
  id: string('id').primaryKey().predicate('https://schema.org/identifier'),
  name: string('name').predicate('https://schema.org/name')
}, {
  base: 'idp:///demo.ttl',
  rdfClass: 'https://schema.org/Thing',
  namespace: { prefix: 'schema', uri: 'https://schema.org/' }
});

describe('PodAsyncSession builder typing', () => {
  it('returns inferred row type when select().from(table)', () => {
    const session = new PodAsyncSession(mockDialect);
    const builder = session.select().from(mockTable);
    type Rows = Awaited<ReturnType<typeof builder['execute']>>;

    expectTypeOf<Rows>().toEqualTypeOf<Array<{
      id: string;
      name: string;
    }>>();
  });

  it('accepts inferred data types for insert() and update()', () => {
    const session = new PodAsyncSession(mockDialect);
    const insertBuilder = session.insert(mockTable);
    const updateBuilder = session.update(mockTable);

    type InsertArg = Parameters<typeof insertBuilder['values']>[0];
    type UpdateArg = Parameters<typeof updateBuilder['set']>[0];

    expectTypeOf<InsertArg>().toEqualTypeOf<
      Array<{ id?: string; name?: string }> | { id?: string; name?: string }
    >();

    expectTypeOf<UpdateArg>().toEqualTypeOf<{ id?: string; name?: string }>();
  });
});
