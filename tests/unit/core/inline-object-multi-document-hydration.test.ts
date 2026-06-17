import { describe, expect, it, vi } from 'vitest';
import { SelectQueryBuilder } from '../../../src/core/query-builders/select-query-builder';
import { object, podTable, string } from '../../../src/core/schema';

const namespace = { prefix: 'ex', uri: 'https://example.org/ns#' };

const records = podTable('InlineMultiDocumentRecord', {
  id: string('id').primaryKey(),
  title: string('title').predicate('https://schema.org/name'),
  metadata: object('metadata').predicate(`${namespace.uri}metadata`),
}, {
  type: `${namespace.uri}Record`,
  base: 'https://pod.example/data/records/',
  namespace,
  subjectTemplate: '{id}/index.ttl#this',
});

describe('inline object hydration across document resources', () => {
  it('hydrates inline children from each parent document, not only the first document source', async () => {
    const firstParent = 'https://pod.example/data/records/one/index.ttl#this';
    const secondParent = 'https://pod.example/data/records/two/index.ttl#this';
    const firstChild = 'https://pod.example/data/records/one/index.ttl#metadata-1';
    const secondChild = 'https://pod.example/data/records/two/index.ttl#metadata-1';
    const sources: string[] = [];

    const executeQueryWithSource = vi.fn(async (_query: unknown, source: string) => {
      sources.push(source);
      if (source === 'https://pod.example/data/records/one/index.ttl') {
        return [{
          parent: firstParent,
          linkPred: `${namespace.uri}metadata`,
          child: firstChild,
          pred: `${namespace.uri}roomId`,
          obj: '!one:example',
        }];
      }
      if (source === 'https://pod.example/data/records/two/index.ttl') {
        return [{
          parent: secondParent,
          linkPred: `${namespace.uri}metadata`,
          child: secondChild,
          pred: `${namespace.uri}roomId`,
          obj: '!two:example',
        }];
      }
      return [];
    });

    const session = {
      execute: vi.fn(async () => [
        {
          '@id': firstParent,
          subject: firstParent,
          id: 'one/index.ttl#this',
          title: 'One',
          metadata: firstChild,
        },
        {
          '@id': secondParent,
          subject: secondParent,
          id: 'two/index.ttl#this',
          title: 'Two',
          metadata: secondChild,
        },
      ]),
      executeSql: vi.fn(),
      select: vi.fn(),
      getDialect: () => ({
        getSPARQLExecutor: () => ({ executeQueryWithSource }),
        getPodUrl: () => 'https://pod.example/',
      }),
    } as any;

    const rows = await new SelectQueryBuilder(session).from(records).execute();

    expect(sources).toEqual([
      'https://pod.example/data/records/one/index.ttl',
      'https://pod.example/data/records/two/index.ttl',
    ]);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        '@id': firstParent,
        metadata: expect.objectContaining({ roomId: '!one:example' }),
      }),
      expect.objectContaining({
        '@id': secondParent,
        metadata: expect.objectContaining({ roomId: '!two:example' }),
      }),
    ]));
  });
});
