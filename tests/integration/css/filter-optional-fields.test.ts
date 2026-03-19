import { describe, it, expect, beforeAll } from 'vitest';
import { drizzle, podTable, string, uri, eq, and, inArray } from '../../../src';
import { createTestSession, ensureContainer } from './helpers';

const SIOC = { has_parent: 'http://rdfs.org/sioc/ns#has_parent' };
const SCHEMA = { name: 'http://schema.org/name', category: 'http://schema.org/category' };

describe('Issue #4: FILTER on optional/link fields', () => {
  let session: any;
  let containerUrl: string;

  beforeAll(async () => {
    session = await createTestSession();
    containerUrl = await ensureContainer(session, `integration/${Date.now()}/`);
  });

  it('should return results when filtering on optional uri link field with plain id', async () => {
    const Chat = podTable(
      'Chat',
      {
        id: string('id').primaryKey(),
        title: string('title').predicate(SCHEMA.name),
      },
      {
        base: `${containerUrl}chats.ttl`,
        type: 'http://example.org/Chat',
        subjectTemplate: '#{id}',
      },
    );

    const Thread = podTable(
      'Thread',
      {
        id: string('id').primaryKey(),
        chatId: uri('chatId').predicate(SIOC.has_parent).link('Chat').notNull(),
        title: string('title').predicate(SCHEMA.name),
      },
      {
        base: `${containerUrl}threads.ttl`,
        type: 'http://example.org/Thread',
        subjectTemplate: '#{id}',
      },
    );

    const db = drizzle(session, { schema: { Chat, Thread } });

    // Insert a chat
    await db.insert(Chat).values({
      id: 'chat-1',
      title: 'Test Chat',
    });

    // Insert threads with link to chat (using plain id, not full URI)
    await db.insert(Thread).values([
      {
        id: 'thread-1',
        chatId: 'chat-1',
        title: 'Thread 1',
      },
      {
        id: 'thread-2',
        chatId: 'chat-1',
        title: 'Thread 2',
      },
    ]);

    // Query threads by chatId using plain id
    // drizzle-solid should resolve 'chat-1' to full URI via link()
    const threads = await db.select()
      .from(Thread)
      .where(eq(Thread.chatId, 'chat-1'));

    console.log('Query result:', threads);
    expect(threads.length).toBe(2);
    expect(threads[0].title).toMatch(/Thread [12]/);
    expect(threads[1].title).toMatch(/Thread [12]/);
  });

  it('should return results when filtering on optional string field', async () => {
    const Post = podTable(
      'Post',
      {
        id: string('id').primaryKey(),
        title: string('title').predicate(SCHEMA.name),
        category: string('category').predicate(SCHEMA.category),
      },
      {
        base: `${containerUrl}posts.ttl`,
        type: 'http://example.org/Post',
        subjectTemplate: '#{id}',
      },
    );

    const db = drizzle(session, { schema: { post: Post } });

    // Insert posts with and without category
    await db.insert(Post).values([
      {
        id: 'post-1',
        title: 'Post 1',
        category: 'tech',
      },
      {
        id: 'post-2',
        title: 'Post 2',
        category: 'tech',
      },
      {
        id: 'post-3',
        title: 'Post 3',
        // no category
      },
    ]);

    // Query posts by category (optional field)
    const techPosts = await db.select()
      .from(Post)
      .where(eq(Post.category, 'tech'));

    console.log('Tech posts:', techPosts);
    expect(techPosts.length).toBe(2);
    expect(techPosts.every(p => p.category === 'tech')).toBe(true);
  });

  it('should return results when filtering on optional uri link field with inArray and plain ids', async () => {
    const Chat = podTable(
      'ChatInArray',
      {
        id: string('id').primaryKey(),
        title: string('title').predicate(SCHEMA.name),
      },
      {
        base: `${containerUrl}chats-in-array.ttl`,
        type: 'http://example.org/Chat',
        subjectTemplate: '#{id}',
      },
    );

    const Thread = podTable(
      'ThreadInArray',
      {
        id: string('id').primaryKey(),
        chatId: uri('chatId').predicate(SIOC.has_parent).link(Chat),
        title: string('title').predicate(SCHEMA.name),
      },
      {
        base: `${containerUrl}threads-in-array.ttl`,
        type: 'http://example.org/Thread',
        subjectTemplate: '#{id}',
      },
    );

    const db = drizzle(session, { schema: { Chat, Thread } });

    await db.insert(Chat).values([
      { id: 'chat-a', title: 'Chat A' },
      { id: 'chat-b', title: 'Chat B' },
    ]);

    await db.insert(Thread).values([
      { id: 'thread-a', chatId: 'chat-a', title: 'Thread A' },
      { id: 'thread-b', chatId: 'chat-b', title: 'Thread B' },
      { id: 'thread-c', title: 'Thread Without Chat' },
    ]);

    const threads = await db.select()
      .from(Thread)
      .where(inArray(Thread.chatId, ['chat-a', 'chat-b']));

    expect(threads).toHaveLength(2);
    expect(threads.map((row) => row.title).sort()).toEqual(['Thread A', 'Thread B']);
  });

  it('should keep inArray(id) plus optional field filter correct', async () => {
    const Post = podTable(
      'PostCombinedFilter',
      {
        id: string('id').primaryKey(),
        title: string('title').predicate(SCHEMA.name),
        category: string('category').predicate(SCHEMA.category),
      },
      {
        base: `${containerUrl}posts-combined.ttl`,
        type: 'http://example.org/Post',
        subjectTemplate: '#{id}',
      },
    );

    const db = drizzle(session, { schema: { Post } });

    await db.insert(Post).values([
      { id: 'combined-1', title: 'Combined 1', category: 'tech' },
      { id: 'combined-2', title: 'Combined 2', category: 'tech' },
      { id: 'combined-3', title: 'Combined 3' },
    ]);

    const rows = await db.select()
      .from(Post)
      .where(and(
        inArray(Post.title, ['Combined 1', 'Combined 2', 'Combined 3']),
        eq(Post.category, 'tech'),
      ));

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.id).sort()).toEqual(['combined-1', 'combined-2']);
  });
});
