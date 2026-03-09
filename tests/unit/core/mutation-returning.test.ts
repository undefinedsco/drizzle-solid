import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { podTable, string, int } from '@src/index';
import { UriResolverImpl } from '@src/core/uri/resolver';
import { InsertQueryBuilder } from '@src/core/query-builders/insert-query-builder';
import { UpdateQueryBuilder } from '@src/core/query-builders/update-query-builder';
import { DeleteQueryBuilder } from '@src/core/query-builders/delete-query-builder';

const Users = podTable('users', {
  id: string('id').primaryKey().predicate('https://schema.org/identifier'),
  name: string('name').predicate('https://schema.org/name'),
  age: int('age').predicate('https://schema.org/age'),
}, {
  base: 'https://pod.example/users.ttl',
  type: 'https://schema.org/Person',
  subjectTemplate: '#{id}',
});

describe('Mutation builders returning()', () => {
  const resolver = new UriResolverImpl('https://pod.example/');
  const execute = vi.fn();
  const executeSql = vi.fn();
  const selectCalls: Array<{ where?: unknown; whereByIri?: unknown }> = [];
  let selectResponses: Array<Record<string, any>[]> = [];

  const createSelectBuilder = (rows: Record<string, any>[]) => {
    const builder: any = {
      from: () => builder,
      where: (where: unknown) => {
        selectCalls.push({ where });
        return builder;
      },
      whereByIri: (iri: unknown) => {
        selectCalls.push({ whereByIri: iri });
        return builder;
      },
      then: (resolve: (value: Record<string, any>[]) => unknown) => resolve(rows),
    };
    return builder;
  };

  const session: any = {
    execute,
    executeSql,
    select: () => createSelectBuilder(selectResponses.shift() ?? []),
    getDialect: () => ({
      getUriResolver: () => resolver,
      getWebId: () => 'https://pod.example/profile/card#me',
      getAuthenticatedFetch: () => fetch,
    }),
  };

  beforeEach(() => {
    execute.mockReset();
    executeSql.mockReset();
    execute.mockResolvedValue([{ success: true }]);
    selectCalls.length = 0;
    selectResponses = [];
  });

  it('insert returning() should fetch inserted rows by subject IRI', async () => {
    selectResponses = [[
      { '@id': 'https://pod.example/users.ttl#user-1', id: 'user-1', name: 'Alice', age: 20 },
    ]];

    const rows = await new InsertQueryBuilder(session, Users)
      .values({ id: 'user-1', name: 'Alice', age: 20 })
      .returning();

    expect(selectCalls).toEqual([
      { whereByIri: ['https://pod.example/users.ttl#user-1'] },
    ]);
    expect(rows).toEqual([
      { '@id': 'https://pod.example/users.ttl#user-1', id: 'user-1', name: 'Alice', age: 20 },
    ]);
  });

  it('insert returning(partial) should project selected fields', async () => {
    selectResponses = [[
      { '@id': 'https://pod.example/users.ttl#user-2', id: 'user-2', name: 'Bob', age: 30 },
    ]];

    const rows = await new InsertQueryBuilder(session, Users)
      .values({ id: 'user-2', name: 'Bob', age: 30 })
      .returning({ id: Users.id, name: Users.name });

    expect(rows).toEqual([{ id: 'user-2', name: 'Bob' }]);
  });

  it('update returning() should fetch updated rows after mutation', async () => {
    selectResponses = [
      [{ '@id': 'https://pod.example/users.ttl#user-3', id: 'user-3', name: 'Carol', age: 25 }],
      [{ '@id': 'https://pod.example/users.ttl#user-3', id: 'user-3', name: 'Caroline', age: 25 }],
    ];

    const rows = await new UpdateQueryBuilder(session, Users)
      .set({ name: 'Caroline' })
      .where({ id: 'user-3' })
      .returning();

    expect(selectCalls[0]?.where).toBeTruthy();
    expect(selectCalls[1]).toEqual({ whereByIri: ['https://pod.example/users.ttl#user-3'] });
    expect(rows).toEqual([
      { '@id': 'https://pod.example/users.ttl#user-3', id: 'user-3', name: 'Caroline', age: 25 },
    ]);
  });

  it('update returning(partial) should project updated fields', async () => {
    selectResponses = [
      [{ '@id': 'https://pod.example/users.ttl#user-4', id: 'user-4', name: 'Dan', age: 40 }],
      [{ '@id': 'https://pod.example/users.ttl#user-4', id: 'user-4', name: 'Dan', age: 41 }],
    ];

    const rows = await new UpdateQueryBuilder(session, Users)
      .set({ age: 41 })
      .where({ id: 'user-4' })
      .returning({ id: Users.id, age: Users.age });

    expect(rows).toEqual([{ id: 'user-4', age: 41 }]);
  });

  it('delete returning() should return pre-delete snapshots', async () => {
    selectResponses = [[
      { '@id': 'https://pod.example/users.ttl#user-5', id: 'user-5', name: 'Eve', age: 35 },
    ]];

    const rows = await new DeleteQueryBuilder(session, Users)
      .where({ id: 'user-5' })
      .returning();

    expect(selectCalls[0]?.where).toBeTruthy();
    expect(rows).toEqual([
      { '@id': 'https://pod.example/users.ttl#user-5', id: 'user-5', name: 'Eve', age: 35 },
    ]);
  });

  it('delete returning(partial) should project pre-delete snapshots', async () => {
    selectResponses = [[
      { '@id': 'https://pod.example/users.ttl#user-6', id: 'user-6', name: 'Frank', age: 29 },
    ]];

    const rows = await new DeleteQueryBuilder(session, Users)
      .where({ id: 'user-6' })
      .returning({ id: Users.id, name: Users.name });

    expect(rows).toEqual([{ id: 'user-6', name: 'Frank' }]);
  });

  it('insert returning() should reject raw SQL inserts', async () => {
    await expect(
      new InsertQueryBuilder(session, Users)
        .values(sql`INSERT DATA { <https://pod.example/users.ttl#raw-insert> <https://schema.org/name> "Raw" }`)
        .returning()
        .execute()
    ).rejects.toThrow('returning() is not supported for raw SQL insert in Solid dialect');

    expect(executeSql).not.toHaveBeenCalled();
  });

  it('update returning() should reject raw SQL updates', async () => {
    await expect(
      new UpdateQueryBuilder(session, Users)
        .set(sql`DELETE WHERE { ?s ?p ?o }`)
        .returning()
        .execute()
    ).rejects.toThrow('returning() is not supported for raw SQL update in Solid dialect');

    expect(executeSql).not.toHaveBeenCalled();
  });

  it('delete returning() should reject raw SQL deletes', async () => {
    await expect(
      new DeleteQueryBuilder(session, Users)
        .where(sql`DELETE WHERE { ?s ?p ?o }`)
        .returning()
        .execute()
    ).rejects.toThrow('returning() is not supported for raw SQL delete in Solid dialect');

    expect(executeSql).not.toHaveBeenCalled();
  });
});
