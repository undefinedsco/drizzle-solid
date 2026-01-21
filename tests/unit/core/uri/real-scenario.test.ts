import { describe, it, expect } from 'vitest';
import { UriResolverImpl } from '../../../../src/core/uri';
import { podTable, string } from '../../../../src/core/schema';

describe('Real-world Chat scenario', () => {
  it('should extract correct ID from actual Pod URI', () => {
    const UDFS_NAMESPACE = { prefix: 'udfs', uri: 'https://undefineds.co/ns#' };
    const Meeting = { LongChat: 'http://www.w3.org/ns/pim/meeting#LongChat' };

    const Chat = podTable('Chat', {
      id: string('id').primaryKey(),
      title: string('title'),
    }, {
      base: '/.data/chat/',
      type: Meeting.LongChat,
      namespace: UDFS_NAMESPACE,
      subjectTemplate: '{id}/index.ttl#this',
    });

    // Real scenario: resolver initialized with one Pod URL
    const resolver = new UriResolverImpl('http://localhost:3000/alice');

    // But URI comes from SPARQL query with actual Pod URL
    const actualUri = 'http://localhost:4020/chatkit-test/.data/chat/chat_mkjzw5vr0plmj0k7/index.ttl#this';

    const parsed = resolver.parseSubject(actualUri, Chat);

    console.log('=== Real Scenario Test ===');
    console.log('Resolver podUrl:', 'http://localhost:3000/alice');
    console.log('Actual URI:', actualUri);
    console.log('Parsed result:', parsed);
    console.log('Expected id:', 'chat_mkjzw5vr0plmj0k7');
    console.log('Actual id:', parsed?.id);

    expect(parsed?.id).toBe('chat_mkjzw5vr0plmj0k7');
  });
});
