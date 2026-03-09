/**
 * Scenario: Chat Application (Document mode with date variables)
 *
 * This scenario tests a common Solid chat pattern where:
 * - Chat rooms are stored as individual documents with #this subject
 * - Messages are stored in date-partitioned files with fragment subjects
 * - Template: Chat = {id}/index.ttl#this, Message = {chatId}/{yyyy}/{MM}/{dd}/messages.ttl#{id}
 *
 * Related bug: Ensure SPARQL results preserve @id for proper URI resolution
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { drizzle } from '../../../../src/driver';
import { podTable, string, datetime, uri } from '../../../../src/core/schema';
import { createTestSession, ensureContainer } from '../../css/helpers';
import type { Session } from '@inrupt/solid-client-authn-node';
import type { SolidDatabase } from '../../../../src/driver';

vi.setConfig({ testTimeout: 60_000 });

/**
 * Schema Definition
 *
 * Mimics a real-world Solid chat application
 */
const namespace = {
  prefix: 'udfs',
  uri: 'https://undefineds.co/ns#',
};

const predicates = {
  LongChat: 'http://www.w3.org/ns/pim/meeting#LongChat',
  Message: 'http://www.w3.org/ns/pim/meeting#Message',
  has_container: 'http://rdfs.org/sioc/ns#has_container',
  content: 'http://rdfs.org/sioc/ns#content',
  maker: 'http://xmlns.com/foaf/0.1/maker',
  modified: 'http://purl.org/dc/terms/modified',
  title: 'http://purl.org/dc/terms/title',
};

const containerPath = `/integration/scenarios/chat-${Date.now()}/`;

// Chat schema - each chat is a folder with index.ttl#this as subject
const chatTable = podTable('chats', {
  id: string('id').primaryKey(),
  title: string('title').predicate(predicates.title),
  author: uri('author').predicate(predicates.maker),
  createdAt: datetime('createdAt').predicate(`${namespace.uri}createdAt`),
  updatedAt: datetime('updatedAt').predicate(predicates.modified),
}, {
  base: containerPath,
  type: predicates.LongChat,
  namespace,
  subjectTemplate: '{id}/index.ttl#this',
  sparqlEndpoint: `${containerPath}-/sparql`,
});

// Message schema - messages in date-partitioned files with fragment subjects
const messageTable = podTable('messages', {
  id: string('id').primaryKey(),
  chatId: string('chatId').predicate(predicates.has_container),
  maker: uri('maker').predicate(predicates.maker),
  content: string('content').predicate(predicates.content),
  createdAt: datetime('createdAt').predicate(`${namespace.uri}createdAt`),
}, {
  base: containerPath,
  type: predicates.Message,
  namespace,
  subjectTemplate: '{chatId}/{yyyy}/{MM}/{dd}/messages.ttl#{id}',
  sparqlEndpoint: `${containerPath}-/sparql`,
});

describe('Scenario: Chat Application', () => {
  let session: Session;
  let db: SolidDatabase;
  let containerUrl: string;
  let webId: string;

  beforeAll(async () => {
    session = await createTestSession();
    db = drizzle(session);
    containerUrl = await ensureContainer(session, containerPath);
    webId = session.info.webId!;
    await db.init(chatTable);
    await db.init(messageTable);
  }, 120_000);

  afterAll(async () => {
    // Clean up - delete recursively (nested folders)
    const cleanupPaths = [
      `${containerUrl}my-chat-room/`,
      `${containerUrl}work-chat/`,
      containerUrl,
    ];
    for (const path of cleanupPaths) {
      await session.fetch(path, { method: 'DELETE' }).catch(() => undefined);
    }
  });

  describe('Chat CRUD', () => {
    it('should create a chat room with nested folder structure', async () => {
      const chatId = 'my-chat-room';

      await db.insert(chatTable).values({
        id: chatId,
        title: 'My Chat Room',
        author: webId,
        createdAt: new Date(),
      });

      // Verify the file was created at correct location: {id}/index.ttl
      const resourceUrl = `${containerUrl}${chatId}/index.ttl`;
      const response = await session.fetch(resourceUrl);
      expect(response.ok).toBe(true);

      const content = await response.text();
      // Subject should be #this
      expect(content).toContain('#this');
      expect(content).toContain('My Chat Room');
    });

    it('should select chat and preserve @id with full URI', async () => {
      const chats = await db.select().from(chatTable);

      expect(chats.length).toBeGreaterThan(0);

      const chat = chats.find((c: any) => c.id === 'my-chat-room');
      expect(chat).toBeDefined();
      expect(chat.title).toBe('My Chat Room');

      // Verify @id is the full URI (the bug fix)
      expect(chat['@id']).toContain('http');
      expect(chat['@id']).toContain('my-chat-room/index.ttl#this');

      // ID should be extracted correctly (not 'this')
      expect(chat.id).toBe('my-chat-room');
    });

    it('should update chat title', async () => {
      const { eq } = await import('../../../../src/index');

      await db.update(chatTable)
        .set({ title: 'My Updated Chat Room' })
        .where(eq(chatTable.id, 'my-chat-room'));

      const updated = await db.select().from(chatTable);
      const chat = updated.find((c: any) => c.id === 'my-chat-room');

      expect(chat).toBeDefined();
      expect(chat.title).toBe('My Updated Chat Room');
    });
  });

  describe('Message CRUD with date partitioning', () => {
    it('should create a message with date-partitioned path', async () => {
      await db.insert(messageTable).values({
        id: 'msg-001',
        chatId: 'my-chat-room',
        maker: webId,
        content: 'Hello, this is my first message!',
        createdAt: new Date(),
      });

      // Get today's date parts for verification (use UTC to match URI resolver)
      const now = new Date();
      const yyyy = now.getUTCFullYear();
      const MM = String(now.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(now.getUTCDate()).padStart(2, '0');

      // Verify the file was created at date-partitioned location
      const messageResourceUrl = `${containerUrl}my-chat-room/${yyyy}/${MM}/${dd}/messages.ttl`;
      const response = await session.fetch(messageResourceUrl);
      expect(response.ok).toBe(true);

      const content = await response.text();
      expect(content).toContain('#msg-001');
      expect(content).toContain('Hello, this is my first message!');
    });

    it('should select message and preserve @id with full URI', async () => {
      const messages = await db.select().from(messageTable);

      expect(messages.length).toBeGreaterThan(0);

      const msg = messages.find((m: any) => m.id === 'msg-001');
      expect(msg).toBeDefined();
      expect(msg.content).toBe('Hello, this is my first message!');

      // Verify @id is the full URI with date path
      expect(msg['@id']).toContain('http');
      expect(msg['@id']).toContain('/messages.ttl#msg-001');

      // ID should be the fragment
      expect(msg.id).toBe('msg-001');
    });

    it('should create multiple messages in same day (same file)', async () => {
      await db.insert(messageTable).values({
        id: 'msg-002',
        chatId: 'my-chat-room',
        maker: webId,
        content: 'Second message in same chat',
        createdAt: new Date(),
      });

      await db.insert(messageTable).values({
        id: 'msg-003',
        chatId: 'my-chat-room',
        maker: webId,
        content: 'Third message',
        createdAt: new Date(),
      });

      const messages = await db.select().from(messageTable);
      const chatMessages = messages.filter((m: any) =>
        m['@id']?.includes('my-chat-room')
      );

      expect(chatMessages.length).toBeGreaterThanOrEqual(3);

      // All messages should have proper @id with date path
      for (const m of chatMessages) {
        expect(m['@id']).toContain('http');
        expect(m['@id']).toContain('/messages.ttl#');
      }
    });
  });

  describe('Multiple chats', () => {
    it('should create another chat and its messages', async () => {
      await db.insert(chatTable).values({
        id: 'work-chat',
        title: 'Work Discussion',
        author: webId,
        createdAt: new Date(),
      });

      await db.insert(messageTable).values({
        id: 'work-msg-001',
        chatId: 'work-chat',
        maker: webId,
        content: 'Let us discuss the project',
        createdAt: new Date(),
      });

      // Query all chats
      const allChats = await db.select().from(chatTable);
      expect(allChats.length).toBeGreaterThanOrEqual(2);

      // Query all messages
      const allMessages = await db.select().from(messageTable);
      expect(allMessages.length).toBeGreaterThanOrEqual(4);

      // Verify work chat message has correct path structure
      const workMsg = allMessages.find((m: any) => m.id === 'work-msg-001');
      expect(workMsg).toBeDefined();
      expect(workMsg['@id']).toContain('work-chat/');
      expect(workMsg['@id']).toContain('/messages.ttl#work-msg-001');
    });
  });

  describe('Delete operations', () => {
    it('should require explicit @id for deleting a date-partitioned message', async () => {
      const { eq } = await import('../../../../src/index');

      await expect(
        db.delete(messageTable)
          .where(eq(messageTable.id, 'msg-003'))
      ).rejects.toThrow('Use an explicit @id');
    });

    it('should delete a message by IRI', async () => {
      const messages = await db.select().from(messageTable);
      const target = messages.find((m: any) => m.id === 'msg-003');

      expect(target).toBeDefined();
      expect(target['@id']).toContain('/messages.ttl#msg-003');

      await db.deleteByIri(messageTable, target['@id']);

      const remaining = await db.select().from(messageTable);
      const deleted = remaining.find((m: any) => m.id === 'msg-003');
      expect(deleted).toBeUndefined();
    });

    it('should delete a chat', async () => {
      const { eq } = await import('../../../../src/index');

      await db.delete(chatTable)
        .where(eq(chatTable.id, 'work-chat'));

      const remaining = await db.select().from(chatTable);
      const deleted = remaining.find((c: any) => c.id === 'work-chat');
      expect(deleted).toBeUndefined();
    });
  });
});
