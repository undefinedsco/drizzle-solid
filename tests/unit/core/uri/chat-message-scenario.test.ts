import { describe, it, expect } from 'vitest';
import { podTable, string, datetime, uri } from '../../../../src/core/schema';
import { UriResolverImpl } from '../../../../src/core/uri';

const UDFS_NAMESPACE = { prefix: 'udfs', uri: 'https://undefineds.co/ns#' };
const Meeting = { LongChat: 'http://www.w3.org/ns/pim/meeting#LongChat', Message: 'http://www.w3.org/ns/pim/meeting#Message' };
const SIOC = { has_container: 'http://rdfs.org/sioc/ns#has_container', content: 'http://rdfs.org/sioc/ns#content' };
const FOAF = { maker: 'http://xmlns.com/foaf/0.1/maker' };

describe('Chat/Message scenario - fixed fragment with inverse reference', () => {
  // Chat schema - exactly as in xpod-api-server
  const Chat = podTable(
    'Chat',
    {
      id: string('id').primaryKey(),
      title: string('title'),
      author: uri('author'),
      status: string('status'),
      createdAt: datetime('createdAt'),
      updatedAt: datetime('updatedAt'),
    },
    {
      base: '/.data/chat/',
      type: Meeting.LongChat,
      namespace: UDFS_NAMESPACE,
      subjectTemplate: '{id}/index.ttl#this',
      sparqlEndpoint: '/.data/chat/-/sparql',
    },
  );

  // Message schema - exactly as in xpod-api-server
  const Message = podTable(
    'Message',
    {
      id: string('id').primaryKey(),
      chatId: uri('chatId').predicate(SIOC.has_container).inverse().reference(Chat),
      maker: uri('maker').predicate(FOAF.maker),
      role: string('role'),
      content: string('content').predicate(SIOC.content),
      status: string('status'),
      createdAt: datetime('createdAt'),
    },
    {
      base: '/.data/chat/',
      type: Meeting.Message,
      namespace: UDFS_NAMESPACE,
      subjectTemplate: '{chatId}/{yyyy}/{MM}/{dd}/messages.ttl#{id}',
      sparqlEndpoint: '/.data/chat/-/sparql',
    },
  );

  it('should extract Chat id from URI with fixed fragment #this', () => {
    const resolver = new UriResolverImpl('http://localhost:3000');

    // Chat URI: /.data/chat/chat-123/index.ttl#this
    const chatUri = 'http://localhost:3000/.data/chat/chat-123/index.ttl#this';
    const parsed = resolver.parseSubject(chatUri, Chat);

    console.log('Chat parsed:', parsed);

    expect(parsed?.id).toBe('chat-123');
    expect(parsed?.fragment).toBe('this');
  });

  it('should extract Message id from URI with dynamic fragment', () => {
    const resolver = new UriResolverImpl('http://localhost:3000');

    // Message URI: /.data/chat/chat-123/2024/01/15/messages.ttl#msg-1
    const messageUri = 'http://localhost:3000/.data/chat/chat-123/2024/01/15/messages.ttl#msg-1';
    const parsed = resolver.parseSubject(messageUri, Message);

    console.log('Message parsed:', parsed);

    expect(parsed?.id).toBe('msg-1');
    expect(parsed?.fragment).toBe('msg-1');
  });

  it('should extract chatId from relative URI reference in Message', () => {
    const resolver = new UriResolverImpl('http://localhost:3000');

    // In RDF, Message stores: sioc:has_container <../../../index.ttl#this>
    // When resolved from message location, this becomes the absolute Chat URI
    // Message location: http://localhost:3000/.data/chat/chat-123/2024/01/15/messages.ttl#msg-1
    // Relative ref: ../../../index.ttl#this
    // Resolved to: http://localhost:3000/.data/chat/chat-123/index.ttl#this

    const chatRefUri = 'http://localhost:3000/.data/chat/chat-123/index.ttl#this';
    const parsed = resolver.parseSubject(chatRefUri, Chat);

    console.log('Chat reference parsed:', parsed);

    // This should extract 'chat-123', not 'this'
    expect(parsed?.id).toBe('chat-123');
  });

  it('should handle cross-host Chat URI reference', () => {
    const resolver = new UriResolverImpl('http://localhost:3000');

    // SPARQL query might return URIs from different hosts
    const chatRefUri = 'http://example.com/.data/chat/chat-456/index.ttl#this';
    const parsed = resolver.parseSubject(chatRefUri, Chat);

    console.log('Cross-host Chat reference parsed:', parsed);

    // Should still extract 'chat-456' by matching path structure
    expect(parsed?.id).toBe('chat-456');
  });
});
