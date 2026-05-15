import { describe, expect, it, vi } from 'vitest';
import { podTable, string, asc, eq, and, alias } from '@src/index';
import { SelectQueryBuilder } from '@src/core/query-builders/select-query-builder';

const Members = podTable('Members', {
  id: string('id').primaryKey().predicate('https://schema.org/identifier'),
  name: string('name').predicate('https://schema.org/name'),
  managerId: string('managerId').predicate('https://schema.org/manager'),
  tags: string('tags').array().predicate('https://schema.org/keywords'),
}, {
  base: 'https://pod.example/members.ttl',
  type: 'https://schema.org/Person',
  subjectTemplate: '#{id}',
});

const Managers = alias(Members, 'Managers');

const Posts = podTable('Posts', {
  id: string('id').primaryKey().predicate('https://schema.org/identifier'),
  memberId: string('memberId').predicate('https://schema.org/author'),
  title: string('title').predicate('https://schema.org/headline'),
}, {
  base: 'https://pod.example/posts.ttl',
  type: 'https://schema.org/Article',
  subjectTemplate: '#{id}',
});

const Messages = podTable('Messages', {
  id: string('id').primaryKey().predicate('https://schema.org/identifier'),
  chatId: string('chatId').predicate('https://schema.org/isPartOf'),
  body: string('body').predicate('https://schema.org/text'),
}, {
  base: 'https://pod.example/messages/',
  type: 'https://schema.org/Message',
  subjectTemplate: '{chatId}/messages.ttl#{id}',
});

const TransformedMessages = podTable('TransformedMessages', {
  id: string('id').primaryKey().predicate('https://schema.org/identifier'),
  chat: string('chat').predicate('https://schema.org/isPartOf'),
  body: string('body').predicate('https://schema.org/text'),
}, {
  base: 'https://pod.example/messages/',
  type: 'https://schema.org/Message',
  subjectTemplate: '{chat|id}/messages.ttl#{id}',
});

const MessageRefs = podTable('MessageRefs', {
  id: string('id').primaryKey().predicate('https://schema.org/identifier'),
  chatId: string('chatId').predicate('https://schema.org/isPartOf'),
  messageId: string('messageId').predicate('https://schema.org/mentions'),
  title: string('title').predicate('https://schema.org/headline'),
}, {
  base: 'https://pod.example/message-refs.ttl',
  type: 'https://schema.org/CreativeWork',
  subjectTemplate: '#{id}',
});

const TransformedMessageRefs = podTable('TransformedMessageRefs', {
  id: string('id').primaryKey().predicate('https://schema.org/identifier'),
  chat: string('chat').predicate('https://schema.org/isPartOf'),
  messageId: string('messageId').predicate('https://schema.org/mentions'),
  title: string('title').predicate('https://schema.org/headline'),
}, {
  base: 'https://pod.example/transformed-message-refs.ttl',
  type: 'https://schema.org/CreativeWork',
  subjectTemplate: '#{id}',
});

describe('join execution-path coverage', () => {
  const execute = vi.fn().mockResolvedValue([
    { subject: 'https://pod.example/members.ttl#member-1', id: 'member-1', name: 'Alice', tags: ['solid', 'rdf'] },
    { subject: 'https://pod.example/members.ttl#member-2', id: 'member-2', name: 'Bob', tags: ['pod'] },
  ]);

  const joinRows = [
    { subject: 'https://pod.example/posts.ttl#post-1', id: 'post-1', memberId: 'member-1', title: 'First Post' },
    { subject: 'https://pod.example/posts.ttl#post-2', id: 'post-2', memberId: 'member-1', title: 'Second Post' },
    { subject: 'https://pod.example/posts.ttl#post-3', id: 'post-3', memberId: 'member-2', title: 'Bob Post' },
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

  it('preserves array-typed base columns across duplicated join rows', async () => {
    const rows = await new SelectQueryBuilder(session, {
      member: Members,
      post: Posts,
    })
      .from(Members)
      .leftJoin(Posts, eq(Members.id, Posts.memberId))
      .orderBy(asc(Members.name), asc(Posts.title));

    expect(rows).toEqual([
      {
        member: { id: 'member-1', name: 'Alice', managerId: undefined, tags: ['solid', 'rdf'] },
        post: { id: 'post-1', memberId: 'member-1', title: 'First Post' },
      },
      {
        member: { id: 'member-1', name: 'Alice', managerId: undefined, tags: ['solid', 'rdf'] },
        post: { id: 'post-2', memberId: 'member-1', title: 'Second Post' },
      },
      {
        member: { id: 'member-2', name: 'Bob', managerId: undefined, tags: ['pod'] },
        post: { id: 'post-3', memberId: 'member-2', title: 'Bob Post' },
      },
    ]);
  });

  it('pushes join-on-id lookups down instead of scanning the whole joined table', async () => {
    const whereSpy = vi.fn();
    const managerRows = [
      { subject: 'https://pod.example/members.ttl#member-3', id: 'member-3', name: 'Carol', managerId: undefined, tags: ['lead'] },
      { subject: 'https://pod.example/members.ttl#member-4', id: 'member-4', name: 'Dan', managerId: undefined, tags: ['staff'] },
    ];
    const joinBuilder: any = {
      from: () => joinBuilder,
      where: (condition: unknown) => {
        whereSpy(condition);
        return joinBuilder;
      },
      applyInternalQueryCondition: (condition: unknown) => {
        whereSpy(condition);
        return joinBuilder;
      },
      then: (resolve: (value: Record<string, any>[]) => unknown) => resolve(managerRows),
    };

    const pushdownSession: any = {
      ...session,
      execute: vi.fn().mockResolvedValue([
        { subject: 'https://pod.example/members.ttl#member-1', id: 'member-1', name: 'Alice', managerId: 'member-3', tags: ['solid', 'rdf'] },
        { subject: 'https://pod.example/members.ttl#member-2', id: 'member-2', name: 'Bob', managerId: 'member-4', tags: ['pod'] },
      ]),
      select: () => joinBuilder,
    };

    await new SelectQueryBuilder(pushdownSession, {
      memberName: Members.name,
      managerName: Managers.name,
    })
      .from(Members)
      .leftJoin(Managers, eq(Members.managerId, Managers.id))
      .orderBy(asc(Members.name), asc(Managers.name));

    expect(whereSpy).toHaveBeenCalledTimes(1);
    expect(whereSpy.mock.calls[0]?.[0]).toMatchObject({
      type: 'binary_expr',
      operator: 'IN',
    });
    expect(whereSpy.mock.calls[0]?.[0]?.right).toEqual(['member-3', 'member-4']);
  });

  it('requires full locator variables for multi-variable join-on-id lookups', async () => {
    const selectCalls: Array<{ whereCondition?: unknown }> = [];

    const strictSession: any = {
      ...session,
      execute: vi.fn().mockResolvedValue(joinRows),
      select: () => {
        const state: { whereCondition?: unknown } = {};
        selectCalls.push(state);

        const builder: any = {
          from: () => builder,
          where: (condition: unknown) => {
            state.whereCondition = condition;
            return builder;
          },
          applyInternalQueryCondition: (condition: unknown) => {
            state.whereCondition = condition;
            return builder;
          },
          then: (_resolve: (value: Record<string, any>[]) => unknown, reject?: (reason: unknown) => unknown) =>
            Promise.reject(
              new Error(
                "Cannot resolve subjectTemplate '{chatId}/messages.ttl#{id}': missing required variable(s) [chatId] in query condition. Add eq(table.chatId, value) to your where clause."
              )
            ).then(_resolve, reject),
        };

        return builder;
      },
    };

    await expect(
      new SelectQueryBuilder(strictSession, {
        postTitle: Posts.title,
        messageBody: Messages.body,
      })
        .from(Posts)
        .leftJoin(Messages, eq(Posts.id, Messages.id))
        .orderBy(asc(Posts.title))
    ).rejects.toThrow(/locator variable\(s\) \[chatId\] are missing/i);

    expect(selectCalls).toHaveLength(0);
  });

  it('uses all locator conditions when joining multi-variable template tables by id', async () => {
    const whereCalls: unknown[] = [];
    const messageRows = [
      {
        subject: 'https://pod.example/messages/chat-1/messages.ttl#msg-1',
        id: 'msg-1',
        chatId: 'chat-1',
        body: 'Hello from chat 1',
      },
      {
        subject: 'https://pod.example/messages/chat-2/messages.ttl#msg-2',
        id: 'msg-2',
        chatId: 'chat-2',
        body: 'Hello from chat 2',
      },
    ];

    const evaluateWhere = (condition: any, row: Record<string, any>): boolean => {
      if (condition?.type === 'logical_expr' && condition.operator === 'AND') {
        return condition.expressions.every((expression: any) => evaluateWhere(expression, row));
      }
      if (condition?.type === 'binary_expr' && condition.operator === '=') {
        const leftName = condition.left?.name;
        return leftName ? row[leftName] === condition.right : false;
      }
      return false;
    };

    const exactSession: any = {
      ...session,
      execute: vi.fn().mockResolvedValue([
        { subject: 'https://pod.example/message-refs.ttl#ref-1', id: 'ref-1', chatId: 'chat-1', messageId: 'msg-1', title: 'Ref 1' },
        { subject: 'https://pod.example/message-refs.ttl#ref-2', id: 'ref-2', chatId: 'chat-2', messageId: 'msg-2', title: 'Ref 2' },
      ]),
      select: () => {
        let whereCondition: unknown;

        const builder: any = {
          from: () => builder,
          where: (condition: unknown) => {
            whereCondition = condition;
            whereCalls.push(condition);
            return builder;
          },
          applyInternalQueryCondition: (condition: unknown) => {
            whereCondition = condition;
            whereCalls.push(condition);
            return builder;
          },
          then: (resolve: (value: Record<string, any>[]) => unknown) =>
            resolve(messageRows.filter((row) => evaluateWhere(whereCondition, row))),
        };

        return builder;
      },
    };

    const rows = await new SelectQueryBuilder(exactSession, {
      refTitle: MessageRefs.title,
      messageBody: Messages.body,
    })
      .from(MessageRefs)
      .leftJoin(Messages, and(
        eq(MessageRefs.messageId, Messages.id),
        eq(MessageRefs.chatId, Messages.chatId),
      ))
      .orderBy(asc(MessageRefs.title));

    expect(whereCalls).toHaveLength(2);
    expect(whereCalls[0]).toMatchObject({
      type: 'logical_expr',
      operator: 'AND',
    });
    expect(rows).toEqual([
      { refTitle: 'Ref 1', messageBody: 'Hello from chat 1' },
      { refTitle: 'Ref 2', messageBody: 'Hello from chat 2' },
    ]);
  });

  it('uses transformed locator field names when joining template-scoped ids', async () => {
    const whereCalls: unknown[] = [];
    const messageRows = [
      {
        subject: 'https://pod.example/messages/chat-1/messages.ttl#msg-1',
        id: 'msg-1',
        chat: 'chat-1',
        body: 'Hello from transformed chat 1',
      },
      {
        subject: 'https://pod.example/messages/chat-2/messages.ttl#msg-2',
        id: 'msg-2',
        chat: 'chat-2',
        body: 'Hello from transformed chat 2',
      },
    ];

    const evaluateWhere = (condition: any, row: Record<string, any>): boolean => {
      if (condition?.type === 'logical_expr' && condition.operator === 'AND') {
        return condition.expressions.every((expression: any) => evaluateWhere(expression, row));
      }
      if (condition?.type === 'binary_expr' && condition.operator === '=') {
        const leftName = condition.left?.name;
        return leftName ? row[leftName] === condition.right : false;
      }
      return false;
    };

    const exactSession: any = {
      ...session,
      execute: vi.fn().mockResolvedValue([
        { subject: 'https://pod.example/transformed-message-refs.ttl#ref-1', id: 'ref-1', chat: 'chat-1', messageId: 'msg-1', title: 'Ref 1' },
        { subject: 'https://pod.example/transformed-message-refs.ttl#ref-2', id: 'ref-2', chat: 'chat-2', messageId: 'msg-2', title: 'Ref 2' },
      ]),
      select: () => {
        let whereCondition: unknown;

        const builder: any = {
          from: () => builder,
          where: (condition: unknown) => {
            whereCondition = condition;
            whereCalls.push(condition);
            return builder;
          },
          applyInternalQueryCondition: (condition: unknown) => {
            whereCondition = condition;
            whereCalls.push(condition);
            return builder;
          },
          then: (resolve: (value: Record<string, any>[]) => unknown) =>
            resolve(messageRows.filter((row) => evaluateWhere(whereCondition, row))),
        };

        return builder;
      },
    };

    const rows = await new SelectQueryBuilder(exactSession, {
      refTitle: TransformedMessageRefs.title,
      messageBody: TransformedMessages.body,
    })
      .from(TransformedMessageRefs)
      .leftJoin(TransformedMessages, and(
        eq(TransformedMessageRefs.messageId, TransformedMessages.id),
        eq(TransformedMessageRefs.chat, TransformedMessages.chat),
      ))
      .orderBy(asc(TransformedMessageRefs.title));

    expect(whereCalls).toHaveLength(2);
    expect(whereCalls[0]).toMatchObject({
      type: 'logical_expr',
      operator: 'AND',
    });
    expect(rows).toEqual([
      { refTitle: 'Ref 1', messageBody: 'Hello from transformed chat 1' },
      { refTitle: 'Ref 2', messageBody: 'Hello from transformed chat 2' },
    ]);
  });
});
