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

    const resourceId = 'chat-1/messages.ttl#msg-123';
    const fullUri = `${containerUrl}messages/${resourceId}`;
    const row = await db.findByIri(Message, fullUri);

    expect(row?.id).toBe(resourceId);
    expect(row?.chatId).toBe('chat-1');
    expect(row?.content).toBe('hello issue 4');
    expect(row?.['@id']).toBe(fullUri);

    const rowByResourceId = await db.findById(Message, resourceId);
    expect(rowByResourceId?.content).toBe('hello issue 4');
    expect(rowByResourceId?.['@id']).toBe(fullUri);
  });

  it('should query by naked local id without requiring callers to pass bucket variables', async () => {
    const Message = podTable(
      'MessageShortId',
      {
        id: string('id').primaryKey(),
        chatId: string('chatId').predicate(SCHEMA.chatId),
        content: string('content').predicate(SCHEMA.text),
      },
      {
        base: `${containerUrl}messages-short/`,
        sparqlEndpoint: `${containerUrl}messages-short/-/sparql`,
        type: 'http://example.org/Message',
        subjectTemplate: '{chatId}/messages.ttl#{id}',
      },
    );

    const db = drizzle(session, { schema: { Message } });

    await db.insert(Message).values({
      id: 'msg-123',
      chatId: 'chat-1',
      content: 'hello short id',
    });

    const fullUri = `${containerUrl}messages-short/chat-1/messages.ttl#msg-123`;
    const rowByShortId = await db.findById(Message, 'msg-123');

    expect(rowByShortId?.id).toBe('chat-1/messages.ttl#msg-123');
    expect(rowByShortId?.chatId).toBe('chat-1');
    expect(rowByShortId?.content).toBe('hello short id');
    expect(rowByShortId?.['@id']).toBe(fullUri);

    await expect(db.updateById(Message, 'msg-123', {
      content: 'hello short id updated',
    })).resolves.toMatchObject({
      content: 'hello short id updated',
    });

    await expect(db.findByResource(Message, 'msg-123')).resolves.toMatchObject({
      content: 'hello short id updated',
    });

    await expect(db.deleteById(Message, 'msg-123')).resolves.toBe(true);
    await expect(db.findById(Message, 'msg-123')).resolves.toBeNull();
  });
});
