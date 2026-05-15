import { describe, it, expect, beforeEach } from 'vitest';
import { PodDatabase } from '@src/core/pod-database';
import { PodAsyncSession } from '@src/core/pod-session';
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

const bucketedTable = new PodTable('bucketed_users', {
  id: new PodStringColumn('id', { primaryKey: true }),
  name: new PodStringColumn('name')
}, {
  base: 'https://pod.example/users/',
  type: 'https://schema.org/Person',
  namespace: { prefix: SCHEMA.PREFIX, uri: SCHEMA.NAMESPACE },
  subjectTemplate: '{yyyy}/{MM}/{dd}.ttl#{id}',
  sparqlEndpoint: 'https://pod.example/users/-/sparql',
});

describe('PodDatabase query facade', () => {
  let captured: Record<string, any>;
  let db: PodDatabase;
  let fakeSession: any;

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

    fakeSession = {
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

  it('findById 应该走 exact-target id 查找', async () => {
    const row = await db.query.users.findById('#1');
    expect(row?.id).toBe('1');
    expect(captured.whereByIri).toBe('https://pod.example/users.ttl#1');
  });

  it('find 应该走 resource-target 查找，避免调用者重复传表对象', async () => {
    const row = await db.query.users.find('1');
    expect(row?.id).toBe('1');
    expect(captured.whereByIri).toBe('https://pod.example/users.ttl#1');
  });

  it('findByIri 应该识别绝对 IRI', async () => {
    const row = await db.query.users.findByIri('https://pod.example/users.ttl#1');
    expect(row?.name).toBe('Alice');
    expect(captured.whereByIri).toBe('https://pod.example/users.ttl#1');
  });

  it('findById 应该用短 id 先查 subject 再 exact-target 读取多槽位资源', async () => {
    const dbWithLookup = new PodDatabase({
      resolveTableResource: () => ({
        mode: 'sparql',
        endpoint: 'https://pod.example/users/-/sparql',
      }),
      getResolver: () => ({
        resolveSubject: (_table: any, record: Record<string, unknown>) => `https://pod.example/users/${String(record.id)}`,
        getResourceUrl: () => 'https://pod.example/users/',
      }),
      executeOnResource: async (source: string, query: any) => {
        if (source.endsWith('/-/sparql')) {
          captured.shortIdQuery = query.query;
          return [
            { subject: 'https://pod.example/users/2026/05/14.ttl#10' },
            { subject: 'https://pod.example/users/2026/05/14.ttl#1' },
          ];
        }
        captured.exactReadSource = source;
        return [
          { p: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type', o: 'https://schema.org/Person' },
          { p: 'http://schema.org/name', o: 'Alice' },
        ];
      },
    } as any, fakeSession, { bucketed: bucketedTable });

    const row = await dbWithLookup.query.bucketed.findById('1');

    expect(row?.id).toBe('2026/05/14.ttl#1');
    expect(row?.['@id']).toBe('https://pod.example/users/2026/05/14.ttl#1');
    expect(captured.shortIdQuery).toContain('CONTAINS(STR(?subject), "1")');
    expect(captured.shortIdQuery).not.toContain('STRENDS(');
    expect(captured.shortIdQuery).not.toContain('GRAPH ?g');
    expect(captured.exactReadSource).toBe('https://pod.example/users/2026/05/14.ttl');
  });

  it('findById 应该在 subject sidecar 尚未同步时回退到同进程写入索引', async () => {
    const insertedRows = [
      {
        id: '1',
        name: 'Alice',
        createdAt: new Date('2026-05-14T00:00:00.000Z'),
      },
    ];
    const insertResults = [{
      success: true,
      source: 'https://pod.example/users/2026/05/14.ttl',
    }];
    const indexedSubjects = new Map<string, string>();
    const dialect = {
      resolveTableResource: () => ({
        mode: 'sparql',
        endpoint: 'https://pod.example/users/-/sparql',
      }),
      getResolver: () => ({
        resolveSubject: (_table: any, record: Record<string, unknown>) =>
          `https://pod.example/users/2026/05/14.ttl#${String(record.id)}`,
        getResourceUrl: (subject: string) => subject.split('#')[0],
        parseId: (_table: any, subject: string) => subject.replace('https://pod.example/users/', ''),
      }),
      getUriResolver: () => ({
        resolveSubject: (_table: any, record: Record<string, unknown>) =>
          `https://pod.example/users/2026/05/14.ttl#${String(record.id)}`,
      } as any),
      executeOnResource: async (source: string, query: any) => {
        if (source.endsWith('/-/sparql')) {
          captured.shortIdQuery = query.query;
          return [];
        }
        captured.exactReadSource = source;
        return [
          { p: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type', o: 'https://schema.org/Person' },
          { p: 'http://schema.org/name', o: 'Alice' },
        ];
      },
      query: async (operation: any) => {
        captured.operation = operation.type;
        return insertResults;
      },
      registerResourceSubject: (_table: any, subject: string) => {
        indexedSubjects.set(subject.split('#').at(-1) ?? '', subject);
      },
      lookupIndexedResourceSubject: (_table: any, id: string) => indexedSubjects.get(id) ?? null,
      getResourcePreparationMode: () => 'off',
      isConnected: () => true,
    } as any;
    const session = new PodAsyncSession(dialect);
    const dbWithIndex = new PodDatabase(dialect, session, { bucketed: bucketedTable });

    await dbWithIndex.insert(bucketedTable).values(insertedRows[0] as any).execute();
    const row = await dbWithIndex.query.bucketed.findById('1');

    expect(row?.name).toBe('Alice');
    expect(captured.shortIdQuery).toContain('CONTAINS(STR(?subject), "1")');
    expect(captured.exactReadSource).toBe('https://pod.example/users/2026/05/14.ttl');
  });
});
