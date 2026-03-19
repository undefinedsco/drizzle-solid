import { describe, expect, it, vi } from 'vitest';
import { podTable, string, alias, eq, asc } from '@src/index';
import { SelectQueryBuilder } from '@src/core/query-builders/select-query-builder';

const Users = podTable('Users', {
  id: string('id').primaryKey().predicate('https://schema.org/identifier'),
  name: string('name').predicate('https://schema.org/name'),
  managerId: string('managerId').predicate('https://schema.org/manager'),
}, {
  base: 'https://pod.example/users.ttl',
  type: 'https://schema.org/Person',
  subjectTemplate: '#{id}',
});

const Managers = alias(Users, 'Managers');

describe('alias()', () => {
  it('should create an aliased table with cloned columns', () => {
    expect(Managers).not.toBe(Users);
    expect(Managers.config.name).toBe('Managers');
    expect(Managers.config.base).toBe(Users.config.base);
    expect(Managers.name).not.toBe(Users.name);
    expect(Managers.name.table).toBe(Managers);
    expect(Users.name.table).toBe(Users);
  });

  it('should reject empty alias names', () => {
    expect(() => alias(Users, '   ')).toThrow('alias() requires a non-empty alias name');
  });
});

describe('SelectQueryBuilder alias joins', () => {
  const execute = vi.fn().mockResolvedValue([
    { subject: 'https://pod.example/users.ttl#user-1', id: 'user-1', name: 'Alice', managerId: 'user-3' },
    { subject: 'https://pod.example/users.ttl#user-2', id: 'user-2', name: 'Bob', managerId: 'user-3' },
    { subject: 'https://pod.example/users.ttl#user-3', id: 'user-3', name: 'Charlie', managerId: undefined },
  ]);
  const joinRows = [
    { subject: 'https://pod.example/users.ttl#user-1', id: 'user-1', name: 'Alice', managerId: 'user-3' },
    { subject: 'https://pod.example/users.ttl#user-2', id: 'user-2', name: 'Bob', managerId: 'user-3' },
    { subject: 'https://pod.example/users.ttl#user-3', id: 'user-3', name: 'Charlie', managerId: undefined },
  ];

  const createSelectBuilder = (rows: Record<string, any>[]) => {
    const builder: any = {
      from: () => builder,
      where: () => builder,
      applyInternalQueryCondition: () => builder,
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


  it('should support grouped projections with aliased tables', async () => {
    const rows = await new SelectQueryBuilder(session, {
      user: {
        id: Users.id,
        name: Users.name,
      },
      manager: {
        id: Managers.id,
        name: Managers.name,
      },
    })
      .from(Users)
      .leftJoin(Managers, eq(Users.managerId, Managers.id))
      .orderBy(asc(Users.name));

    expect(rows).toEqual([
      { user: { id: 'user-1', name: 'Alice' }, manager: { id: 'user-3', name: 'Charlie' } },
      { user: { id: 'user-2', name: 'Bob' }, manager: { id: 'user-3', name: 'Charlie' } },
      { user: { id: 'user-3', name: 'Charlie' }, manager: null },
    ]);
  });

  it('should support whole-table grouped projections with null joined rows', async () => {
    const rows = await new SelectQueryBuilder(session, {
      user: Users,
      manager: Managers,
    })
      .from(Users)
      .leftJoin(Managers, eq(Users.managerId, Managers.id))
      .orderBy(asc(Users.name));

    expect(rows).toEqual([
      {
        user: { id: 'user-1', name: 'Alice', managerId: 'user-3' },
        manager: { id: 'user-3', name: 'Charlie', managerId: undefined },
      },
      {
        user: { id: 'user-2', name: 'Bob', managerId: 'user-3' },
        manager: { id: 'user-3', name: 'Charlie', managerId: undefined },
      },
      {
        user: { id: 'user-3', name: 'Charlie', managerId: undefined },
        manager: null,
      },
    ]);
  });

  it('should support self joins with aliased tables', async () => {
    const rows = await new SelectQueryBuilder(session, {
      userName: Users.name,
      managerName: Managers.name,
    })
      .from(Users)
      .leftJoin(Managers, eq(Users.managerId, Managers.id))
      .orderBy(asc(Users.name));

    expect(rows).toEqual([
      { userName: 'Alice', managerName: 'Charlie' },
      { userName: 'Bob', managerName: 'Charlie' },
      { userName: 'Charlie', managerName: undefined },
    ]);
  });
});
