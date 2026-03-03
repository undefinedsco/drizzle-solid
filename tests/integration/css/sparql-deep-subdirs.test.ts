import { describe, it, expect, beforeAll } from 'vitest';
import { drizzle, podTable, string, datetime, uri } from '../../../src';
import { createTestSession, ensureContainer } from './helpers';

const FOAF = { maker: 'http://xmlns.com/foaf/0.1/maker' };
const SIOC = { content: 'http://rdfs.org/sioc/ns#content' };
const Meeting = { Message: 'http://www.w3.org/ns/pim/meeting#Message' };
const UDFS_NAMESPACE = 'https://undefineds.co/ns#';

describe('Issue #3: SPARQL endpoint with deep subdirectories', () => {
  let session: any;
  let containerUrl: string;

  beforeAll(async () => {
    session = await createTestSession();
    containerUrl = await ensureContainer(session, `integration/${Date.now()}/`);
  });

  it('should query data in date-partitioned subdirectories', async () => {
    const Message = podTable(
      'Message',
      {
        id: string('id').primaryKey(),
        chatId: string('chatId'),
        threadId: string('threadId'),
        maker: uri('maker').predicate(FOAF.maker),
        role: string('role'),
        content: string('content').predicate(SIOC.content),
        createdAt: datetime('createdAt'),
      },
      {
        base: `${containerUrl}chat/`,
        type: Meeting.Message,
        namespace: { prefix: 'udfs', uri: UDFS_NAMESPACE },
        subjectTemplate: '{chatId}/{yyyy}/{MM}/{dd}/messages.ttl#{id}',
        sparqlEndpoint: `${containerUrl}chat/-/sparql`,
      },
    );

    const db = drizzle(session, { schema: { message: Message } });

    // Insert message with date-based path
    const now = new Date('2026-03-03T10:00:00Z');
    await db.insert(Message).values({
      id: 'msg-123',
      chatId: 'default',
      threadId: 'thread-abc',
      role: 'user',
      content: 'Hello from deep directory',
      createdAt: now,
    });

    // Query should find the message
    const messages = await db.select().from(Message);

    console.log('Query result:', messages);
    expect(messages.length).toBeGreaterThanOrEqual(1);
    if (messages.length > 0) {
      expect(messages[0].content).toBe('Hello from deep directory');
    }
  });
});
