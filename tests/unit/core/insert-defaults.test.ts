import { describe, expect, it, vi } from 'vitest';
import { InsertQueryBuilder } from '@src/core/query-builders/insert-query-builder';
import { UriResolverImpl } from '@src/core/uri/resolver';
import { boolean, id, podTable, string, timestamp, uri } from '@src/index';

const chatTable = podTable('default_chats', {
  id: id('id').default((key) => `${key}/index.ttl#this`),
  title: string('title').predicate('https://schema.org/name'),
}, {
  base: '/.data/chat/',
  type: 'https://schema.org/Chat',
});

const messageTable = podTable('default_messages', {
  id: id('id').default((key, row) => {
    const chat = String(row?.chat ?? 'default/index.ttl#this');
    const chatDir = chat.match(/^(.+)\/index\.ttl#this$/)?.[1] ?? 'default';
    return `${chatDir}/messages.ttl#${key}`;
  }),
  chat: uri('chat').predicate('https://example.org/chat').link(chatTable).notNull(),
  status: string('status').predicate('https://example.org/status').notNull().default('sent'),
  flag: boolean('flag').predicate('https://example.org/flag').default(false),
  createdAt: timestamp('createdAt').predicate('https://schema.org/dateCreated').notNull().defaultNow(),
  content: string('content').predicate('https://schema.org/text').notNull(),
}, {
  base: '/.data/chat/',
  type: 'https://schema.org/Message',
});

describe('Insert defaults', () => {
  const resolver = new UriResolverImpl('https://pod.example/');
  const session: any = {
    execute: vi.fn().mockResolvedValue([]),
    executeSql: vi.fn(),
    select: vi.fn(),
    getDialect: () => ({
      getSPARQLConverter: () => undefined,
      getUriResolver: () => resolver,
    }),
  };

  it('passes a generated key and normalized row to contextual id defaults', () => {
    const row = new InsertQueryBuilder(session, messageTable)
      .values({ chat: 'room-a/index.ttl#this', content: 'hello' })
      .toIR()
      .rows[0];

    expect(row.chat).toBe('room-a/index.ttl#this');
    expect(row.status).toBe('sent');
    expect(row.flag).toBe(false);
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.id).toMatch(/^room-a\/messages\.ttl#[A-Za-z0-9_-]+$/);
  });

  it('keeps explicit complete ids instead of calling contextual defaults', () => {
    const defaultFn = vi.fn((key?: string) => `generated.ttl#${key}`);
    const explicitIdTable = podTable('explicit_id_defaults', {
      id: id('id').default(defaultFn),
      title: string('title').predicate('https://schema.org/name'),
    }, {
      base: '/.data/items/',
      type: 'https://schema.org/Thing',
    });

    const row = new InsertQueryBuilder(session, explicitIdTable)
      .values({ id: 'custom/path.ttl#this', title: 'Manual' })
      .toIR()
      .rows[0];

    expect(row.id).toBe('custom/path.ttl#this');
    expect(defaultFn).not.toHaveBeenCalled();
  });

  it('preserves no-arg default functions', () => {
    const tokenDefault = vi.fn(() => 'token-value');
    const noArgTable = podTable('no_arg_defaults', {
      id: id('id', { defaultValue: () => 'row-1.ttl#this' }),
      token: string('token').predicate('https://example.org/token').default(tokenDefault),
    }, {
      base: '/.data/no-arg/',
      type: 'https://schema.org/Thing',
    });

    const row = new InsertQueryBuilder(session, noArgTable)
      .values({})
      .toIR()
      .rows[0];

    expect(row.id).toBe('row-1.ttl#this');
    expect(row.token).toBe('token-value');
    expect(tokenDefault).toHaveBeenCalledTimes(1);
    expect(tokenDefault).toHaveBeenCalledWith();
  });

  it('uses default exact-id subject expansion for complete resource ids', () => {
    const row = new InsertQueryBuilder(session, messageTable)
      .values({ chat: 'room-b/index.ttl#this', content: 'hello' })
      .toIR()
      .rows[0];

    const subject = resolver.resolveSubject(messageTable, row as Record<string, unknown>);

    expect(subject).toBe(`https://pod.example/.data/chat/${row.id}`);
  });

  it('does not synthesize a bare primary key when id has no default', () => {
    const exactIdTable = podTable('exact_id_required', {
      id: id('id'),
      title: string('title').predicate('https://schema.org/name'),
    }, {
      base: '/.data/items/',
      type: 'https://schema.org/Thing',
    });

    const row = new InsertQueryBuilder(session, exactIdTable)
      .values({ title: 'Manual id required' })
      .toIR()
      .rows[0];

    expect(row.id).toBeUndefined();
    expect(exactIdTable.getSubjectTemplate()).toBeUndefined();
    expect(exactIdTable.hasCustomTemplate()).toBe(false);
  });
});
