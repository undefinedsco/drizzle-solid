import { describe, it, expect, vi } from 'vitest';
import { PodAsyncSession } from '@src/core/pod-session';
import { podTable, id, string, timestamp, uri } from '@src/core/schema';
import { InsertQueryBuilder } from '@src/core/query-builders/insert-query-builder';
import { renderDefaultIdTemplate } from '@src/core/query-builders/default-id-template';

describe('ID Generation', () => {
  const mockDialect = {
    query: vi.fn().mockResolvedValue([]),
  } as any;

  const session = new PodAsyncSession(mockDialect);

  const users = podTable('users', {
    id: id(),
    name: string('name').predicate('http://schema.org/name')
  }, {
    base: '/data/users.ttl',
    type: 'http://schema.org/Person'
  });

  it('should not automatically generate bare ID if not provided', async () => {
    const insertBuilder = new InsertQueryBuilder(session, users);
    insertBuilder.values({ name: 'Alice' });
    
    // We access private method or property for testing, or check the generated plan
    // InsertQueryBuilder has toIR()
    const plan = insertBuilder.toIR();
    
    expect(plan.rows.length).toBe(1);
    const row = plan.rows[0];
    
    expect(row.name).toBe('Alice');
    expect(row.id).toBeUndefined();
  });

  it('should respect provided ID', async () => {
    const insertBuilder = new InsertQueryBuilder(session, users);
    insertBuilder.values({ id: 'manual-id', name: 'Bob' });
    
    const plan = insertBuilder.toIR();
    const row = plan.rows[0];
    
    expect(row.id).toBe('manual-id');
  });

  it('should use custom generator if configured', async () => {
    const customTable = podTable('custom', {
      id: id('id', { defaultValue: () => 'custom-id-123' }),
      name: string('name').predicate('http://schema.org/name')
    }, { base: '/data/custom.ttl', type: 'http://example.org/Test' });

    const insertBuilder = new InsertQueryBuilder(session, customTable);
    insertBuilder.values({ name: 'Charlie' });
    
    const plan = insertBuilder.toIR();
    expect(plan.rows[0].id).toBe('custom-id-123');
  });

  it('should render primary key string templates with key and date fields', () => {
    const messages = podTable('messages', {
      id: id('id').default('{thread.id[0:2]}/{yyyy}/{MM}/{dd}/messages.ttl#{key}'),
      thread: uri('thread').predicate('http://example.org/thread').notNull(),
      createdAt: timestamp('createdAt').predicate('http://schema.org/dateCreated')
    }, {
      base: '/.data/',
      type: 'http://example.org/Message'
    });

    const insertBuilder = new InsertQueryBuilder(session, messages);
    insertBuilder.values({
      thread: { id: 'chat/secretary/index.ttl#thread_1' } as any,
      createdAt: new Date(Date.UTC(2026, 4, 25, 1, 2, 3))
    });

    const row = insertBuilder.toIR().rows[0];
    expect(row.id).toMatch(/^chat\/secretary\/2026\/05\/25\/messages\.ttl#[A-Za-z0-9_-]+$/);
  });

  it('should keep explicit IDs exact without rendering templates', () => {
    const runs = podTable('runs', {
      id: id('id').default('{thread.id[0:2]}/{yyyy}/{MM}/{dd}/runs.ttl#{key}'),
      thread: uri('thread').predicate('http://example.org/thread').notNull(),
      createdAt: timestamp('createdAt').predicate('http://schema.org/dateCreated')
    }, {
      base: '/.data/',
      type: 'http://example.org/Run'
    });

    const insertBuilder = new InsertQueryBuilder(session, runs);
    insertBuilder.values({
      id: 'chat/custom/2026/05/25/runs.ttl#manual',
      thread: { id: 'chat/secretary/index.ttl#thread_1' } as any,
      createdAt: new Date(Date.UTC(2026, 4, 25, 1, 2, 3))
    });

    expect(insertBuilder.toIR().rows[0].id).toBe('chat/custom/2026/05/25/runs.ttl#manual');
  });

  it('should render path selectors with indexes and slices', () => {
    expect(renderDefaultIdTemplate('{run.id[0:5]}/runs.ttl#{key}', {
      key: 'step_1',
      row: {
        run: { id: 'chat/secretary/2026/05/25/runs.ttl#run_1' },
      },
    })).toBe('chat/secretary/2026/05/25/runs.ttl#step_1');

    expect(renderDefaultIdTemplate('task/{chat.id[1]}/{key}', {
      key: 'task_1',
      row: {
        chat: { id: 'chat/secretary/index.ttl#this' },
      },
    })).toBe('task/secretary/task_1');
  });

  it('should render link-aware id path selectors from strings', () => {
    const chat = podTable('chat', {
      id: id('id').default('{key}/index.ttl#this'),
      title: string('title').predicate('http://schema.org/name'),
    }, {
      base: '/.data/chat/',
      type: 'http://example.org/Chat',
    });
    const thread = podTable('thread', {
      id: id('id').default('chat/{chat.id[0]}/index.ttl#{key}'),
      chat: uri('chat').predicate('http://example.org/chat').link(chat),
    }, {
      base: '/.data/',
      type: 'http://example.org/Thread',
    });

    expect(renderDefaultIdTemplate('chat/{chat.id[0]}/index.ttl#{key}', {
      key: 'thread_1',
      row: { chat: 'secretary' },
      resource: thread,
    })).toBe('chat/secretary/index.ttl#thread_1');

    expect(renderDefaultIdTemplate('chat/{chat.id[0]}/index.ttl#{key}', {
      key: 'thread_1',
      row: { chat: '/.data/chat/secretary/index.ttl#this' },
      resource: thread,
    })).toBe('chat/secretary/index.ttl#thread_1');

    expect(renderDefaultIdTemplate('chat/{chat.id[0]}/index.ttl#{key}', {
      key: 'thread_1',
      row: { chat: 'https://pod.example/.data/chat/secretary/index.ttl#this' },
      resource: thread,
    })).toBe('chat/secretary/index.ttl#thread_1');
  });

  it('should reject {id} inside id default templates', () => {
    expect(() => renderDefaultIdTemplate('{yyyy}/{MM}/{dd}.ttl#{id}', {
      key: 'x',
      row: { createdAt: new Date(Date.UTC(2026, 4, 25)) },
    })).toThrow('{key}');
  });
});
