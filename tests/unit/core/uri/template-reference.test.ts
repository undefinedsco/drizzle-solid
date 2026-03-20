
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
    subjectTemplate: '{id}/index.ttl#this',
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

  const Thread = podTable('thread', {
    id: string('id').primaryKey(),
    chat: uri('chat').predicate('http://example.org/chat').link(Chat),
  }, {
    base: '/data/threads/',
    subjectTemplate: '{chat|id}/index.ttl#{id}',
    type: 'http://example.org/Thread',
  });

  const SlugEntry = podTable('slug-entry', {
    id: string('id').primaryKey(),
    title: string('title').predicate('http://example.org/title'),
  }, {
    base: '/data/slug-demo/',
    subjectTemplate: '{title|slug}/index.ttl#{id}',
    type: 'http://example.org/Entry',
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
        chatId: 'https://pod.example.org/data/chats/chat-1/index.ttl#this'
      };
      const subject = uriResolver.resolveSubject(Message, record);
      expect(subject).toBe('https://pod.example.org/data/messages/chat-1/msg-1.ttl');
    });

    it('should resolve subject correctly when template uses |id transform', () => {
      const record = {
        id: 'thread-1',
        chat: 'https://pod.example.org/data/chats/chat-1/index.ttl#this',
      };

      const subject = uriResolver.resolveSubject(Thread, record);
      expect(subject).toBe('https://pod.example.org/data/threads/chat-1/index.ttl#thread-1');
    });

    it('should resolve subject correctly when template uses |slug transform', () => {
      const record = {
        id: 'entry-1',
        title: 'Hello LinX / 世界',
      };

      const subject = uriResolver.resolveSubject(SlugEntry, record);
      expect(subject).toBe('https://pod.example.org/data/slug-demo/hello-linx-世界/index.ttl#entry-1');
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

    it('should resolve exact target sources when template uses |id transform', async () => {
      const condition = {
        type: 'logical_expr',
        operator: 'AND',
        expressions: [
          {
            type: 'binary_expr',
            left: { type: 'column_ref', name: 'id' },
            operator: '=',
            right: 'thread-1',
          },
          {
            type: 'binary_expr',
            left: { type: 'column_ref', name: 'chat' },
            operator: '=',
            right: 'https://pod.example.org/data/chats/chat-1/index.ttl#this',
          },
        ],
      };

      const sources = await resourceResolver.resolveSelectSources(
        Thread,
        'https://pod.example.org/data/threads/',
        condition,
      );

      expect(sources).toEqual([
        'https://pod.example.org/data/threads/chat-1/index.ttl',
      ]);
    });

    it('should resolve exact target sources when template uses |slug transform', async () => {
      const condition = {
        type: 'logical_expr',
        operator: 'AND',
        expressions: [
          {
            type: 'binary_expr',
            left: { type: 'column_ref', name: 'id' },
            operator: '=',
            right: 'entry-1',
          },
          {
            type: 'binary_expr',
            left: { type: 'column_ref', name: 'title' },
            operator: '=',
            right: 'Hello LinX / 世界',
          },
        ],
      };

      const sources = await resourceResolver.resolveSelectSources(
        SlugEntry,
        'https://pod.example.org/data/slug-demo/',
        condition,
      );

      expect(sources).toEqual([
        'https://pod.example.org/data/slug-demo/hello-linx-世界/index.ttl',
      ]);
    });
  });
});
