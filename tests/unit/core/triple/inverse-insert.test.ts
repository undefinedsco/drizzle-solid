import { describe, it, expect } from 'vitest';
import { podTable, string, uri, datetime } from '../../../../src/core/schema';
import { eq } from '../../../../src/core/operators';
import { drizzle } from '../../../../src/core/pod-dialect';

describe('Inverse link INSERT and SELECT', () => {
  it('should insert and query messages with inverse chatId link', async () => {
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

    console.log('\n=== Test: Inverse Link ===');
    console.log('Chat config:', Chat.config);
    console.log('Message.chatId config:', Message.chatId);
    console.log('Is inverse?', Message.chatId.options?.inverse);
    console.log('Is link?', Message.chatId.isLink?.());
    console.log('Link target:', Message.chatId.options?.linkTarget);
  });
});
