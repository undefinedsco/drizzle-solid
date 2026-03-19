import { describe, it, expect, beforeAll } from 'vitest';
import { drizzle, podTable, string } from '../../../src';
import { createTestSession, ensureContainer } from './helpers';

const SCHEMA = {
  chatId: 'http://schema.org/chatId',
  text: 'http://schema.org/text',
};

describe('Issue #4: multi-variable template queries', () => {
  let session: any;
  let containerUrl: string;

  beforeAll(async () => {
    session = await createTestSession();
    containerUrl = await ensureContainer(session, `integration/${Date.now()}/`);
  });

  it('should query by full URI without requiring template variables separately', async () => {
    const Message = podTable(
      'Message',
      {
        id: string('id').primaryKey(),
        chatId: string('chatId').predicate(SCHEMA.chatId),
        content: string('content').predicate(SCHEMA.text),
      },
      {
        base: `${containerUrl}messages/`,
        type: 'http://example.org/Message',
        subjectTemplate: '{chatId}/messages.ttl#{id}',
      },
    );

    const db = drizzle(session, { schema: { Message } });

    await db.insert(Message).values({
      id: 'msg-123',
      chatId: 'chat-1',
      content: 'hello issue 4',
    });

    const fullUri = `${containerUrl}messages/chat-1/messages.ttl#msg-123`;
    const row = await db.findByIri(Message, fullUri);

    expect(row?.id).toBe('msg-123');
    expect(row?.chatId).toBe('chat-1');
    expect(row?.content).toBe('hello issue 4');
    expect(row?.['@id']).toBe(fullUri);
  });

  it('should fail clearly when only short id is provided', async () => {
    const Message = podTable(
      'MessageShortId',
      {
        id: string('id').primaryKey(),
        chatId: string('chatId').predicate(SCHEMA.chatId),
        content: string('content').predicate(SCHEMA.text),
      },
      {
        base: `${containerUrl}messages-short/`,
        type: 'http://example.org/Message',
        subjectTemplate: '{chatId}/messages.ttl#{id}',
      },
    );

    const db = drizzle(session, { schema: { Message } });

    await expect(async () => {
      await db.findByLocator(Message, { id: 'msg-123' });
    }).rejects.toThrow(/Missing \[chatId\]/i);
  });
});
