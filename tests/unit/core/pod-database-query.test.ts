import { describe, it, expect, beforeEach } from 'vitest';
import { PodDatabase } from '@src/core/pod-database';
import { PodTable, PodStringColumn } from '@src/core/pod-table';
import { SCHEMA_INRUPT as SCHEMA } from '@inrupt/vocab-common-rdf';

const mockTable = new PodTable('users', {
  id: new PodStringColumn('id', { primaryKey: true }),
  name: new PodStringColumn('name')
}, {
  base: 'idp:///users.ttl',
  type: 'https://schema.org/Person',
  namespace: { prefix: SCHEMA.PREFIX, uri: SCHEMA.NAMESPACE }
});

describe('PodDatabase query facade', () => {
  let captured: Record<string, any>;
  let db: PodDatabase;

  beforeEach(() => {
    captured = {};
    const mockRows = [{ id: '1', name: 'Alice' }];
    const builder: any = {
      from: () => builder,
      where: (where: any) => {
        captured.where = where;
        return builder;
      },
      orderBy: (..._args: any[]) => builder,
      limit: (_v: any) => builder,
      offset: (_v: any) => builder,
      then: (resolve: any) => resolve(mockRows)
    };

    const fakeSession = {
      select: (_cols?: any) => {
        captured.selectCalled = true;
        return builder;
      }
    } as any;

    db = new PodDatabase({} as any, fakeSession, { users: mockTable });
  });

  it('findMany 应该委托到 select/where 管道', async () => {
    const rows = await db.query.users.findMany({ where: { id: '1' } });
    expect(captured.selectCalled).toBe(true);
    expect(captured.where).toEqual({ id: '1' });
    expect(rows).toEqual([{ id: '1', name: 'Alice' }]);
  });

  it('findFirst 应该返回首行或 null', async () => {
    const row = await db.query.users.findFirst();
    expect(row?.id).toBe('1');
  });

  it('findById 应该使用 id 过滤', async () => {
    const row = await db.query.users.findById('1');
    expect(row?.id).toBe('1');
  });

  it('findByIRI 应该识别绝对 IRI', async () => {
    const row = await db.query.users.findByIRI('https://pod.example/users.ttl#1');
    expect(row?.name).toBe('Alice');
  });
});
