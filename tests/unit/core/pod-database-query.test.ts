import { describe, it, expect, beforeEach } from 'vitest';
import { PodDatabase } from '@src/core/pod-database';
import { PodTable, PodStringColumn } from '@src/core/schema';
import { SCHEMA_INRUPT as SCHEMA } from '@inrupt/vocab-common-rdf';

const mockTable = new PodTable('users', {
  id: new PodStringColumn('id', { primaryKey: true }),
  name: new PodStringColumn('name')
}, {
  base: 'https://pod.example/users.ttl',
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
      whereByIri: (iri: any) => {
        captured.whereByIri = iri;
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

    db = new PodDatabase({
      getResolver: () => ({
        resolveSubject: (_table: any, record: Record<string, unknown>) => `https://pod.example/users.ttl#${String(record.id)}`,
      }),
    } as any, fakeSession, { users: mockTable });
  });

  it('findMany 应该委托到 select/where 管道', async () => {
    const rows = await db.query.users.findMany({ where: { name: 'Alice' } });
    expect(captured.selectCalled).toBe(true);
    expect(captured.where).toEqual({ name: 'Alice' });
    expect(rows).toEqual([{ id: '1', name: 'Alice' }]);
  });

  it('findFirst 应该返回首行或 null', async () => {
    const row = await db.query.users.findFirst();
    expect(row?.id).toBe('1');
  });

  it('findByLocator 应该走 exact-target locator 查找', async () => {
    const row = await db.query.users.findByLocator({ id: '1' });
    expect(row?.id).toBe('1');
    expect(captured.whereByIri).toBe('https://pod.example/users.ttl#1');
  });

  it('findByIri 应该识别绝对 IRI', async () => {
    const row = await db.query.users.findByIri('https://pod.example/users.ttl#1');
    expect(row?.name).toBe('Alice');
    expect(captured.whereByIri).toBe('https://pod.example/users.ttl#1');
  });
});
