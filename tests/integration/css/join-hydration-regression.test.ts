import { beforeAll, describe, expect, it } from 'vitest';
import { drizzle, podTable, string, eq, and, asc } from '../../../src';
import { createTestSession, ensureContainer } from './helpers';

describe('Join hydration regression', () => {
  let session: any;
  let containerUrl: string;

  beforeAll(async () => {
    session = await createTestSession({ shared: false });
    containerUrl = await ensureContainer(session, `join-hydration/${Date.now()}/`);
  }, 60_000);

  it('preserves array-typed base columns across duplicated join rows', async () => {
    const Members = podTable('JoinMembers', {
      id: string('id').primaryKey(),
      name: string('name').predicate('http://schema.org/name').notNull(),
      tags: string('tags').array().predicate('http://schema.org/keywords'),
    }, {
      base: `${containerUrl}members/`,
      sparqlEndpoint: `${containerUrl}members/-/sparql`,
      type: 'http://schema.org/Person',
      subjectTemplate: '{id}.ttl',
    });

    const Posts = podTable('JoinPosts', {
      id: string('id').primaryKey(),
      memberId: string('memberId').predicate('http://schema.org/author').notNull(),
      title: string('title').predicate('http://schema.org/headline').notNull(),
    }, {
      base: `${containerUrl}posts/`,
      sparqlEndpoint: `${containerUrl}posts/-/sparql`,
      type: 'http://schema.org/Article',
      subjectTemplate: '{id}.ttl',
    });

    const db = drizzle(session);

    await db.insert(Members).values([
      { id: 'member-1', name: 'Alice', tags: ['solid', 'rdf'] },
      { id: 'member-2', name: 'Bob', tags: ['pod'] },
    ]);

    await db.insert(Posts).values([
      { id: 'post-1', memberId: 'member-1', title: 'First Post' },
      { id: 'post-2', memberId: 'member-1', title: 'Second Post' },
      { id: 'post-3', memberId: 'member-2', title: 'Bob Post' },
    ]);

    const rows = await db.select({
      member: Members,
      post: Posts,
    })
      .from(Members)
      .leftJoin(Posts, eq(Members.id, Posts.memberId))
      .orderBy(asc(Members.name), asc(Posts.title));

    const normalizedRows = rows.map((row) => ({
      ...row,
      member: row.member
        ? {
            ...row.member,
            tags: Array.isArray(row.member.tags) ? [...row.member.tags].sort() : row.member.tags,
          }
        : row.member,
    }));

    expect(normalizedRows).toEqual([
      {
        member: { id: 'member-1', name: 'Alice', tags: ['rdf', 'solid'] },
        post: { id: 'post-1', memberId: 'member-1', title: 'First Post' },
      },
      {
        member: { id: 'member-1', name: 'Alice', tags: ['rdf', 'solid'] },
        post: { id: 'post-2', memberId: 'member-1', title: 'Second Post' },
      },
      {
        member: { id: 'member-2', name: 'Bob', tags: ['pod'] },
        post: { id: 'post-3', memberId: 'member-2', title: 'Bob Post' },
      },
    ]);
  }, 30_000);

  it('preserves array-typed columns in flat projections during join hydration', async () => {
    const Members = podTable('JoinMembersFlat', {
      id: string('id').primaryKey(),
      name: string('name').predicate('http://schema.org/name').notNull(),
      tags: string('tags').array().predicate('http://schema.org/keywords'),
    }, {
      base: `${containerUrl}members-flat/`,
      sparqlEndpoint: `${containerUrl}members-flat/-/sparql`,
      type: 'http://schema.org/Person',
      subjectTemplate: '{id}.ttl',
    });

    const Posts = podTable('JoinPostsFlat', {
      id: string('id').primaryKey(),
      memberId: string('memberId').predicate('http://schema.org/author').notNull(),
      title: string('title').predicate('http://schema.org/headline').notNull(),
    }, {
      base: `${containerUrl}posts-flat/`,
      sparqlEndpoint: `${containerUrl}posts-flat/-/sparql`,
      type: 'http://schema.org/Article',
      subjectTemplate: '{id}.ttl',
    });

    const db = drizzle(session);

    await db.insert(Members).values([
      { id: 'flat-member-1', name: 'Carol', tags: ['array', 'join'] },
      { id: 'flat-member-2', name: 'Dave', tags: ['single'] },
    ]);

    await db.insert(Posts).values([
      { id: 'flat-post-1', memberId: 'flat-member-1', title: 'Carol Post 1' },
      { id: 'flat-post-2', memberId: 'flat-member-1', title: 'Carol Post 2' },
      { id: 'flat-post-3', memberId: 'flat-member-2', title: 'Dave Post' },
    ]);

    const rows = await db.select({
      memberName: Members.name,
      memberTags: Members.tags,
      postTitle: Posts.title,
    })
      .from(Members)
      .leftJoin(Posts, eq(Members.id, Posts.memberId))
      .orderBy(asc(Members.name), asc(Posts.title));

    const normalizedRows = rows.map((row) => ({
      ...row,
      memberTags: Array.isArray(row.memberTags) ? [...row.memberTags].sort() : row.memberTags,
    }));

    expect(normalizedRows).toEqual([
      { memberName: 'Carol', memberTags: ['array', 'join'], postTitle: 'Carol Post 1' },
      { memberName: 'Carol', memberTags: ['array', 'join'], postTitle: 'Carol Post 2' },
      { memberName: 'Dave', memberTags: ['single'], postTitle: 'Dave Post' },
    ]);
  }, 30_000);

  it('rejects under-specified join-on-id against multi-variable templates', async () => {
    const Posts = podTable('JoinLocatorPosts', {
      id: string('id').primaryKey(),
      chatId: string('chatId').predicate('http://schema.org/isPartOf'),
      title: string('title').predicate('http://schema.org/headline').notNull(),
      messageId: string('messageId').predicate('http://schema.org/identifier'),
    }, {
      base: `${containerUrl}locator-posts.ttl`,
      type: 'http://schema.org/Article',
      subjectTemplate: '#{id}',
    });

    const Messages = podTable('JoinLocatorMessages', {
      id: string('id').primaryKey(),
      chatId: string('chatId').predicate('http://schema.org/isPartOf').notNull(),
      body: string('body').predicate('http://schema.org/text').notNull(),
    }, {
      base: `${containerUrl}locator-messages/`,
      type: 'http://schema.org/Message',
      subjectTemplate: '{chatId}/messages.ttl#{id}',
    });

    const db = drizzle(session);

    await db.insert(Posts).values([
      { id: 'locator-post-1', chatId: 'chat-1', title: 'Locator Post 1', messageId: 'msg-1' },
      { id: 'locator-post-2', chatId: 'chat-2', title: 'Locator Post 2', messageId: 'msg-2' },
      { id: 'locator-post-3', chatId: 'chat-3', title: 'Locator Post 3', messageId: 'msg-missing' },
    ]);

    await db.insert(Messages).values([
      { id: 'msg-1', chatId: 'chat-1', body: 'Hello from chat 1' },
      { id: 'msg-2', chatId: 'chat-2', body: 'Hello from chat 2' },
    ]);

    await expect(
      db.select({
        postTitle: Posts.title,
        messageBody: Messages.body,
      })
        .from(Posts)
        .leftJoin(Messages, eq(Posts.messageId, Messages.id))
        .orderBy(asc(Posts.title))
    ).rejects.toThrow(/locator variable\(s\) \[chatId\] are missing/i);
  }, 30_000);

  it('joins multi-variable templates when all locator variables are provided', async () => {
    const Posts = podTable('JoinExactPosts', {
      id: string('id').primaryKey(),
      chatId: string('chatId').predicate('http://schema.org/isPartOf'),
      title: string('title').predicate('http://schema.org/headline').notNull(),
      messageId: string('messageId').predicate('http://schema.org/identifier'),
    }, {
      base: `${containerUrl}exact-posts.ttl`,
      type: 'http://schema.org/Article',
      subjectTemplate: '#{id}',
    });

    const Messages = podTable('JoinExactMessages', {
      id: string('id').primaryKey(),
      chatId: string('chatId').predicate('http://schema.org/isPartOf').notNull(),
      body: string('body').predicate('http://schema.org/text').notNull(),
    }, {
      base: `${containerUrl}exact-messages/`,
      type: 'http://schema.org/Message',
      subjectTemplate: '{chatId}/messages.ttl#{id}',
    });

    const db = drizzle(session);

    await db.insert(Posts).values([
      { id: 'exact-post-1', chatId: 'chat-1', title: 'Exact Post 1', messageId: 'msg-1' },
      { id: 'exact-post-2', chatId: 'chat-2', title: 'Exact Post 2', messageId: 'msg-2' },
      { id: 'exact-post-3', chatId: 'chat-3', title: 'Exact Post 3', messageId: 'msg-missing' },
    ]);

    await db.insert(Messages).values([
      { id: 'msg-1', chatId: 'chat-1', body: 'Exact hello 1' },
      { id: 'msg-2', chatId: 'chat-2', body: 'Exact hello 2' },
    ]);

    const rows = await db.select({
      postTitle: Posts.title,
      messageBody: Messages.body,
    })
      .from(Posts)
      .leftJoin(Messages, and(
        eq(Posts.messageId, Messages.id),
        eq(Posts.chatId, Messages.chatId),
      ))
      .orderBy(asc(Posts.title));

    expect(rows).toEqual([
      { postTitle: 'Exact Post 1', messageBody: 'Exact hello 1' },
      { postTitle: 'Exact Post 2', messageBody: 'Exact hello 2' },
      { postTitle: 'Exact Post 3', messageBody: undefined },
    ]);
  }, 30_000);
});
