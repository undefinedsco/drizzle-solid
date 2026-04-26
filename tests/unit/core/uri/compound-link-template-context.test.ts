import { describe, expect, it } from 'vitest';
import { eq } from '../../../../src/core/query-conditions';
import { podTable, string, uri } from '../../../../src/core/schema';
import { ExpressionBuilder } from '../../../../src/core/sparql/builder/expression-builder';
import { UpdateBuilder } from '../../../../src/core/sparql/builder/update-builder';
import { UriResolverImpl } from '../../../../src/core/uri';

const EX = {
  Chat: 'https://example.org/Chat',
  Thread: 'https://example.org/Thread',
  Message: 'https://example.org/Message',
  chat: 'https://example.org/chat',
  thread: 'https://example.org/thread',
  content: 'https://example.org/content',
};

const Chat = podTable('CompoundTemplateChat', {
  id: string('id').primaryKey(),
}, {
  base: '/data/chat/',
  type: EX.Chat,
  subjectTemplate: '{id}/index.ttl#this',
});

const Thread = podTable('CompoundTemplateThread', {
  id: string('id').primaryKey(),
  chat: uri('chat').predicate(EX.chat).link(Chat),
}, {
  base: '/data/chat/',
  type: EX.Thread,
  subjectTemplate: '{chat}/index.ttl#{id}',
});

const Message = podTable('CompoundTemplateMessage', {
  id: string('id').primaryKey(),
  chat: uri('chat').predicate(EX.chat).link(Chat),
  thread: uri('thread').predicate(EX.thread).link(Thread),
  content: string('content').predicate(EX.content),
}, {
  base: '/data/chat/',
  type: EX.Message,
  subjectTemplate: '{chat}/messages.ttl#{id}',
});

function createTableContext(baseUri: string) {
  return {
    baseUri,
    tableRegistry: new Map([
      [EX.Chat, [Chat]],
      [EX.Thread, [Thread]],
      [EX.Message, [Message]],
    ]),
    tableNameRegistry: new Map([
      [Chat.config.name, Chat],
      [Thread.config.name, Thread],
      [Message.config.name, Message],
    ]),
  };
}

describe('compound link template context', () => {
  it('resolves a short linked id using the current row when the target template needs another relation', () => {
    const baseUri = 'https://pod.example';
    const resolver = new UriResolverImpl(baseUri);
    const builder = new UpdateBuilder({}, resolver);
    builder.setTableContext(createTableContext(baseUri));

    const query = builder.convertInsert([
      {
        id: 'message-1',
        chat: 'chat-1',
        thread: 'thread-1',
        content: 'hello',
      },
    ], Message).query;

    expect(query).toContain('https://pod.example/data/chat/chat-1/index.ttl#thread-1');
    expect(query).not.toContain('{chat}');
  });

  it('falls back to a fragment suffix match for short-id where clauses without full locator context', () => {
    const baseUri = 'https://pod.example';
    const builder = new ExpressionBuilder(new UriResolverImpl(baseUri));
    builder.setTableContext(createTableContext(baseUri));

    const filter = builder.buildWhereClause(eq(Message.thread, 'thread-1'), Message);

    expect(filter).toBe('FILTER(STRENDS(STR(?thread), "#thread-1"))');
  });
});
