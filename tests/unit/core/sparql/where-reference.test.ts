import { describe, it, expect } from 'vitest';
import { podTable, string, uri, datetime } from '../../../../src/core/schema';
import { eq } from '../../../../src/core/operators';
import { ExpressionBuilder } from '../../../../src/core/sparql/builder/expression-builder';
import { UriResolverImpl } from '../../../../src/core/uri';

describe('WHERE condition with link field', () => {
  it('should convert link value to full URI in WHERE clause', () => {
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
      chatId: uri('chatId').predicate(SIOC.has_container).inverse().link(Chat),
      content: string('content'),
    }, {
      base: '/.data/chat/',
      type: Meeting.Message,
      namespace: UDFS_NAMESPACE,
      subjectTemplate: '{chatId}/{yyyy}/{MM}/{dd}/messages.ttl#{id}',
    });

    // Create expression builder
    const resolver = new UriResolverImpl('http://localhost:4020/chatkit-test');
    const expressionBuilder = new ExpressionBuilder(resolver);

    // Build WHERE condition: eq(Message.chatId, 'chat-123')
    const condition = {
      type: 'binary_expr',
      operator: '=',
      left: Message.chatId,
      right: 'chat-123'
    };

    const whereClause = expressionBuilder.buildWhereClause(condition, Message);

    console.log('=== WHERE Condition Test ===');
    console.log('Input: eq(Message.chatId, "chat-123")');
    console.log('Generated WHERE clause:', whereClause);
    console.log('Expected: FILTER(?chatId = <http://localhost:4020/chatkit-test/.data/chat/chat-123/index.ttl#this>)');

    // Should convert 'chat-123' to full Chat URI
    expect(whereClause).toContain('chat-123/index.ttl#this');
    expect(whereClause).toContain('FILTER');
  });
});
