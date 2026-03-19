
import { describe, it, expect, vi } from 'vitest';
import { UriResolverImpl } from '../../../../src/core/uri/resolver';
import { DocumentResourceResolver } from '../../../../src/core/resource-resolver/document-resolver';
import { podTable, uri, string } from '../../../../src/core/schema';
import { eq } from '../../../../src/core/query-conditions';

describe('Subject Template Link & Query Handling', () => {
  const baseUri = 'https://pod.example.org';
  const uriResolver = new UriResolverImpl(baseUri);
  const resourceResolver = new DocumentResourceResolver(baseUri);

  // Define a linked table
  const Chat = podTable('chat', {
    id: uri('id').primaryKey(),
  }, {
    base: '/data/chats/',
    subjectTemplate: '{id}',
    type: 'http://example.org/Chat',
  });

  // Define a table using the link in template
  // Case 1: Hierarchical structure with link
  const Message = podTable('message', {
    id: string('id').primaryKey(),
    chatId: uri('chatId').predicate('http://example.org/chat').link(Chat),
  }, {
    base: '/data/messages/',
    subjectTemplate: '{chatId}/{id}.ttl',
    type: 'http://example.org/Message',
  });

  describe('Path Generation (INSERT)', () => {
    it('should resolve subject correctly when passing a slug for link column', () => {
      const record = {
        id: 'msg-1',
        chatId: 'chat-1'
      };
      const subject = uriResolver.resolveSubject(Message, record);
      expect(subject).toBe('https://pod.example.org/data/messages/chat-1/msg-1.ttl');
    });

    it('should resolve subject correctly when passing a full URI for link column', () => {
      const record = {
        id: 'msg-1',
        chatId: 'https://pod.example.org/data/chats/chat-1'
      };
      const subject = uriResolver.resolveSubject(Message, record);
      expect(subject).toBe('https://pod.example.org/data/messages/chat-1/msg-1.ttl');
    });
  });

  describe('Query Optimization (SELECT)', () => {
    it('should reject document-mode collection reads without exact target', async () => {
      const mockListContainer = vi.fn().mockResolvedValue([]);
      
      // Query: WHERE chatId = 'chat-1'
      const condition = eq(Message.columns.chatId, 'chat-1');

      await expect(
        resourceResolver.resolveSelectSources(
          Message, 
          'https://pod.example.org/data/messages/', 
          condition, 
          mockListContainer
        )
      ).rejects.toThrow(/Document-mode collection queries over plain LDP are not supported/i);

      expect(mockListContainer).not.toHaveBeenCalled();
    });

    it('should reject document-mode collection mutations without exact target', async () => {
      const condition = eq(Message.columns.chatId, 'chat-1');

      await expect(
        resourceResolver.resolveSubjectsForMutation(
          Message,
          condition,
          vi.fn().mockResolvedValue([]),
          vi.fn().mockResolvedValue([]),
        )
      ).rejects.toThrow(/Document-mode collection mutations over plain LDP are not supported/i);
    });
  });
});
