import { describe, it, expect, beforeAll } from 'vitest';
import { drizzle, podTable, string, uri, eq } from '../../../src';
import { createTestSession, ensureContainer } from './helpers';

const SIOC = { has_parent: 'http://rdfs.org/sioc/ns#has_parent' };
const SCHEMA = { name: 'http://schema.org/name', category: 'http://schema.org/category' };

describe('Issue #4: FILTER on optional/reference fields', () => {
  let session: any;
  let containerUrl: string;

  beforeAll(async () => {
    session = await createTestSession();
    containerUrl = await ensureContainer(session, `integration/${Date.now()}/`);
  });

  it('should return results when filtering on optional uri reference field with plain id', async () => {
    const Chat = podTable(
      'Chat',
      {
        id: string('id').primaryKey(),
        title: string('title').predicate(SCHEMA.name),
      },
      {
        base: `${containerUrl}chats/`,
        type: 'http://example.org/Chat',
        subjectTemplate: '{id}.ttl',
      },
    );

    const Thread = podTable(
      'Thread',
      {
        id: string('id').primaryKey(),
        chatId: uri('chatId').predicate(SIOC.has_parent).reference('Chat').notNull(),
        title: string('title').predicate(SCHEMA.name),
      },
      {
        base: `${containerUrl}threads/`,
        type: 'http://example.org/Thread',
        subjectTemplate: '{id}.ttl',
      },
    );

    const db = drizzle(session, { schema: { Chat, Thread } });

    // Insert a chat
    await db.insert(Chat).values({
      id: 'chat-1',
      title: 'Test Chat',
    });

    // Insert threads with reference to chat (using plain id, not full URI)
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
    // drizzle-solid should resolve 'chat-1' to full URI via reference()
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
        base: `${containerUrl}posts/`,
        type: 'http://example.org/Post',
        subjectTemplate: '{id}.ttl',
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
});
