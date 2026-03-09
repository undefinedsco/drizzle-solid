import { beforeEach, describe, expect, it, vi } from 'vitest';
import { podTable, string, asc } from '@src/index';
import { SelectQueryBuilder } from '@src/core/query-builders/select-query-builder';

const Users = podTable('Users', {
  id: string('id').primaryKey().predicate('https://schema.org/identifier'),
  name: string('name').predicate('https://schema.org/name'),
}, {
  base: 'https://pod.example/users.ttl',
  type: 'https://schema.org/Person',
  subjectTemplate: '#{id}',
});

const Categories = podTable('Categories', {
  id: string('id').primaryKey().predicate('https://schema.org/identifier'),
  label: string('label').predicate('https://schema.org/name'),
}, {
  base: 'https://pod.example/categories.ttl',
  type: 'https://schema.org/DefinedTerm',
  subjectTemplate: '#{id}',
});

describe('SelectQueryBuilder crossJoin()', () => {
  const execute = vi.fn();
  let joinRows: Record<string, any>[] = [];

  const createSelectBuilder = (rows: Record<string, any>[]) => {
    const builder: any = {
      from: () => builder,
      where: () => builder,
      then: (resolve: (value: Record<string, any>[]) => unknown) => resolve(rows),
    };
    return builder;
  };

  const session: any = {
    execute,
    executeSql: vi.fn(),
    getDialect: () => ({
      getPodUrl: () => 'https://pod.example/',
      getAuthenticatedFetch: () => fetch,
      getUriResolver: () => undefined,
      getTableRegistry: () => new Map(),
      getTableNameRegistry: () => new Map(),
    }),
    select: () => createSelectBuilder(joinRows),
  };

  beforeEach(() => {
    execute.mockReset();
    joinRows = [];
  });

  it('should produce a cartesian product without collapsing joined rows', async () => {
    execute.mockResolvedValue([
      { subject: 'https://pod.example/users.ttl#user-1', id: 'user-1', name: 'Alice' },
      { subject: 'https://pod.example/users.ttl#user-2', id: 'user-2', name: 'Bob' },
    ]);
    joinRows = [
      { subject: 'https://pod.example/categories.ttl#cat-1', id: 'cat-1', label: 'News' },
      { subject: 'https://pod.example/categories.ttl#cat-2', id: 'cat-2', label: 'Tech' },
    ];

    const rows = await new SelectQueryBuilder(session)
      .from(Users)
      .crossJoin(Categories)
      .orderBy(asc(Users.name), asc(Categories.label));

    expect(rows.map((row) => ({
      userId: row.id,
      userName: row.name,
      categoryId: row['Categories.id'],
      categoryLabel: row['Categories.label'],
    }))).toEqual([
      { userId: 'user-1', userName: 'Alice', categoryId: 'cat-1', categoryLabel: 'News' },
      { userId: 'user-1', userName: 'Alice', categoryId: 'cat-2', categoryLabel: 'Tech' },
      { userId: 'user-2', userName: 'Bob', categoryId: 'cat-1', categoryLabel: 'News' },
      { userId: 'user-2', userName: 'Bob', categoryId: 'cat-2', categoryLabel: 'Tech' },
    ]);
  });
});
