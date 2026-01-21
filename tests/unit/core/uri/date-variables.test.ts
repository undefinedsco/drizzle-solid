import { describe, it, expect } from 'vitest';
import { podTable, string, uri as uriColumn } from '../../../../src/core/schema';
import { UriResolverImpl } from '../../../../src/core/uri';

describe('Date variables in subjectTemplate', () => {
  it('should support Java/ISO style date variables (yyyy, MM, dd)', () => {
    const UDFS_NAMESPACE = { prefix: 'udfs', uri: 'https://undefineds.co/ns#' };
    const Meeting = {
      LongChat: 'http://www.w3.org/ns/pim/meeting#LongChat',
      Message: 'http://www.w3.org/ns/pim/meeting#Message'
    };
    const SIOC = { has_container: 'http://rdfs.org/sioc/ns#has_container' };

    const Chat = podTable('Chat', {
      id: string('id').primaryKey(),
      title: string('title'),
    }, {
      base: '/.data/chat/',
      type: Meeting.LongChat,
      namespace: UDFS_NAMESPACE,
      subjectTemplate: '{id}/index.ttl#this',
    });

    const Message = podTable('Message', {
      id: string('id').primaryKey(),
      chatId: uriColumn('chatId').predicate(SIOC.has_container).inverse().reference(Chat),
      content: string('content'),
    }, {
      base: '/.data/chat/',
      type: Meeting.Message,
      namespace: UDFS_NAMESPACE,
      subjectTemplate: '{chatId}/{yyyy}/{MM}/{dd}/messages.ttl#{id}',
    });

    const resolver = new UriResolverImpl('http://localhost:4020/chatkit-test');

    // Test with Date object
    const testDate = new Date('2024-01-15T10:30:00Z');
    const record = {
      id: 'msg-1',
      chatId: 'chat-123',
      content: 'Test message',
      createdAt: testDate
    };

    const uri = resolver.resolveSubject(Message, record);

    console.log('=== Date Variable Test (Date object) ===');
    console.log('Input date:', testDate.toISOString());
    console.log('Generated URI:', uri);

    expect(uri).toContain('chat-123/2024/01/15/messages.ttl#msg-1');
  });

  it('should support ISO date string for createdAt', () => {
    const UDFS_NAMESPACE = { prefix: 'udfs', uri: 'https://undefineds.co/ns#' };
    const Meeting = {
      LongChat: 'http://www.w3.org/ns/pim/meeting#LongChat',
      Message: 'http://www.w3.org/ns/pim/meeting#Message'
    };
    const SIOC = { has_container: 'http://rdfs.org/sioc/ns#has_container' };

    const Chat = podTable('Chat', {
      id: string('id').primaryKey(),
      title: string('title'),
    }, {
      base: '/.data/chat/',
      type: Meeting.LongChat,
      namespace: UDFS_NAMESPACE,
      subjectTemplate: '{id}/index.ttl#this',
    });

    const Message = podTable('Message', {
      id: string('id').primaryKey(),
      chatId: uriColumn('chatId').predicate(SIOC.has_container).inverse().reference(Chat),
      content: string('content'),
    }, {
      base: '/.data/chat/',
      type: Meeting.Message,
      namespace: UDFS_NAMESPACE,
      subjectTemplate: '{chatId}/{yyyy}/{MM}/{dd}/messages.ttl#{id}',
    });

    const resolver = new UriResolverImpl('http://localhost:4020/chatkit-test');

    // Test with ISO date STRING (like xpod-api-server sends)
    const isoDateString = '2024-03-25T14:30:00.000Z';
    const record = {
      id: 'msg-2',
      chatId: 'chat_abc123',
      content: 'Test message with ISO string',
      createdAt: isoDateString  // ISO string, not Date object
    };

    const uri = resolver.resolveSubject(Message, record);

    console.log('=== Date Variable Test (ISO string) ===');
    console.log('Input createdAt:', isoDateString);
    console.log('Generated URI:', uri);
    console.log('Expected: .../chat_abc123/2024/03/25/messages.ttl#msg-2');

    // Should NOT fallback to row-xxxxx.ttl
    expect(uri).not.toContain('row-');
    expect(uri).toContain('chat_abc123/2024/03/25/messages.ttl#msg-2');
  });
});
