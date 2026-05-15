/**
 * Resource Resolver Unit Tests
 * 
 * Tests for src/core/resource-resolver/*.ts
 * 
 * ResourceResolver handles:
 * - Container URL resolution
 * - Resource URL resolution  
 * - Subject URI generation
 * - Path resolution with Pod user paths
 */

import { describe, it, expect } from 'vitest';
import { DocumentResourceResolver } from '../../../../src/core/resource-resolver/document-resolver';
import { FragmentResourceResolver } from '../../../../src/core/resource-resolver/fragment-resolver';
import { podTable, string, id } from '../../../../src/core/schema';

const ns = { prefix: 'ex', uri: 'https://example.org/' };

describe('DocumentResourceResolver', () => {
  describe('getContainerUrl()', () => {
    it('should resolve path starting with / against Pod base with user path', () => {
      // Bug fix: paths like '/.data/providers/' should resolve to
      // 'http://localhost:3000/test/.data/providers/' not 'http://localhost:3000/.data/providers/'
      const resolver = new DocumentResourceResolver('http://localhost:3000/test/');
      const table = podTable('providers', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: '/.data/model-providers/',
        type: 'https://example.org/Provider',
        namespace: ns,
      });

      const containerUrl = resolver.getContainerUrl(table);
      expect(containerUrl).toBe('http://localhost:3000/test/.data/model-providers/');
    });

    it('should resolve path without leading / correctly', () => {
      const resolver = new DocumentResourceResolver('http://localhost:3000/alice/');
      const table = podTable('items', {
        id: id(),
        title: string('title').predicate('https://schema.org/title'),
      }, {
        base: '.data/items/',
        type: 'https://example.org/Item',
        namespace: ns,
      });

      const containerUrl = resolver.getContainerUrl(table);
      expect(containerUrl).toBe('http://localhost:3000/alice/.data/items/');
    });

    it('should handle Pod base without trailing slash', () => {
      const resolver = new DocumentResourceResolver('http://localhost:3000/bob');
      const table = podTable('docs', {
        id: id(),
      }, {
        base: '/.data/documents/',
        type: 'https://example.org/Document',
        namespace: ns,
      });

      const containerUrl = resolver.getContainerUrl(table);
      expect(containerUrl).toBe('http://localhost:3000/bob/.data/documents/');
    });

    it('should preserve absolute URLs as-is', () => {
      const resolver = new DocumentResourceResolver('http://localhost:3000/test/');
      const table = podTable('external', {
        id: id(),
      }, {
        base: 'https://other-server.com/data/items/',
        type: 'https://example.org/Item',
        namespace: ns,
      });

      const containerUrl = resolver.getContainerUrl(table);
      expect(containerUrl).toBe('https://other-server.com/data/items/');
    });

    it('should work with simple Pod URL (no user path)', () => {
      const resolver = new DocumentResourceResolver('http://localhost:3000/');
      const table = podTable('items', {
        id: id(),
      }, {
        base: '/data/items/',
        type: 'https://example.org/Item',
        namespace: ns,
      });

      const containerUrl = resolver.getContainerUrl(table);
      expect(containerUrl).toBe('http://localhost:3000/data/items/');
    });
  });

  describe('resolveSubject()', () => {
    it('should generate correct subject URI with user path', () => {
      // 用户传入简单 id: 'provider-123'，系统根据模板生成完整 URI
      const resolver = new DocumentResourceResolver('http://localhost:3000/test/');
      const table = podTable('providers', {
        id: id(),
      }, {
        base: '/.data/model-providers/',
        type: 'https://example.org/Provider',
        namespace: ns,
      });

      // 默认模板 {id}.ttl
      const subject = resolver.resolveSubject(table, { id: 'provider-123' });
      expect(subject).toBe('http://localhost:3000/test/.data/model-providers/provider-123.ttl');
    });

    it('should work with UUID ids', () => {
      const resolver = new DocumentResourceResolver('http://localhost:3000/alice/');
      const table = podTable('items', {
        id: id(),
      }, {
        base: '/.data/items/',
        type: 'https://example.org/Item',
        namespace: ns,
      });

      // 传入简单 id（UUID）
      const uuid = 'eda10d06-179e-47e9-9423-2db84542a097';
      const subject = resolver.resolveSubject(table, { id: uuid });
      expect(subject).toBe(`http://localhost:3000/alice/.data/items/${uuid}.ttl`);
    });

    it('should generate UUID when id is not provided', () => {
      const resolver = new DocumentResourceResolver('http://localhost:3000/test/');
      const table = podTable('items', {
        id: id(),
      }, {
        base: '/.data/items/',
        type: 'https://example.org/Item',
        namespace: ns,
      });

      // 默认生成 {uuid}.ttl 格式
      const subject = resolver.resolveSubject(table, {});
      expect(subject).toMatch(/^http:\/\/localhost:3000\/test\/\.data\/items\/[a-f0-9-]+\.ttl$/);
    });
  });

  describe('parseId()', () => {
    it('should extract template id from subject URI', () => {
      const resolver = new DocumentResourceResolver('http://localhost:3000/test/');
      const table = podTable('items', {
        id: id(),
      }, {
        base: '/.data/items/',
        type: 'https://example.org/Item',
        namespace: ns,
      });

      const parsedId = resolver.parseId(table, 'http://localhost:3000/test/.data/items/item-123.ttl');
      expect(parsedId).toBe('item-123.ttl');
    });

    it('should extract template id from document-fragment subject URI', () => {
      const resolver = new DocumentResourceResolver('http://localhost:3000/test/');
      const table = podTable('items', {
        id: id(),
      }, {
        base: '/.data/items/',
        subjectTemplate: '{id}.ttl#it',
        type: 'https://example.org/Item',
        namespace: ns,
      });

      const parsedId = resolver.parseId(table, 'http://localhost:3000/test/.data/items/item-123.ttl#it');
      expect(parsedId).toBe('item-123.ttl#it');
    });

    it('should resolve and parse date-bucketed fragment resource ids', () => {
      const resolver = new DocumentResourceResolver('http://localhost:3000/test/');
      const table = podTable('approvals', {
        id: id(),
      }, {
        base: '/.data/approvals/',
        subjectTemplate: '{yyyy}/{MM}/{dd}.ttl#{id}',
        type: 'https://example.org/Approval',
        namespace: ns,
      });

      const resourceId = '2026/05/07.ttl#approval_123';
      const subject = resolver.resolveSubject(table, { id: resourceId });

      expect(subject).toBe('http://localhost:3000/test/.data/approvals/2026/05/07.ttl#approval_123');
      expect(resolver.parseId(table, subject)).toBe('2026/05/07.ttl#approval_123');
    });

    it('should not treat fragment-only ids as complete resource ids for date-bucketed templates', () => {
      const resolver = new DocumentResourceResolver('http://localhost:3000/test/');
      const table = podTable('approvals', {
        id: id(),
      }, {
        base: '/.data/approvals/',
        subjectTemplate: '{yyyy}/{MM}/{dd}.ttl#{id}',
        type: 'https://example.org/Approval',
        namespace: ns,
      });

      expect(resolver.resolveSubject(table, { id: '#approval_123', createdAt: new Date('2026-05-07T00:00:00.000Z') }))
        .toBe('http://localhost:3000/test/.data/approvals/2026/05/07.ttl#approval_123');
    });

    it('should keep fragment-only resources working for fragment templates', () => {
      const resolver = new DocumentResourceResolver('http://localhost:3000/test/');
      const table = podTable('tags', {
        id: id(),
      }, {
        base: '/.data/tags.ttl',
        subjectTemplate: '#{id}',
        type: 'https://example.org/Tag',
        namespace: ns,
      });

      expect(resolver.resolveSubject(table, { id: '#tag-1' }))
        .toBe('http://localhost:3000/test/.data/tags.ttl#tag-1');
    });

  });

  describe('getResourceUrlForSubject()', () => {
    it('should return subject URI as-is for document mode', () => {
      const resolver = new DocumentResourceResolver('http://localhost:3000/test/');
      const url = resolver.getResourceUrlForSubject('http://localhost:3000/test/.data/items/item-1.ttl');
      expect(url).toBe('http://localhost:3000/test/.data/items/item-1.ttl');
    });
  });
});

describe('FragmentResourceResolver', () => {
  describe('getResourceUrl()', () => {
    it('should resolve path starting with / against Pod base with user path', () => {
      const resolver = new FragmentResourceResolver('http://localhost:3000/test/');
      const table = podTable('tags', {
        id: id(),
      }, {
        base: '/.data/tags.ttl',
        type: 'https://example.org/Tag',
        namespace: ns,
      });

      const resourceUrl = resolver.getResourceUrl(table);
      expect(resourceUrl).toBe('http://localhost:3000/test/.data/tags.ttl');
    });

    it('should resolve path without leading / correctly', () => {
      const resolver = new FragmentResourceResolver('http://localhost:3000/alice/');
      const table = podTable('bookmarks', {
        id: id(),
      }, {
        base: 'data/bookmarks.ttl',
        type: 'https://example.org/Bookmark',
        namespace: ns,
      });

      const resourceUrl = resolver.getResourceUrl(table);
      expect(resourceUrl).toBe('http://localhost:3000/alice/data/bookmarks.ttl');
    });

    it('should handle Pod base without trailing slash', () => {
      const resolver = new FragmentResourceResolver('http://localhost:3000/bob');
      const table = podTable('notes', {
        id: id(),
      }, {
        base: '/.data/notes.ttl',
        type: 'https://example.org/Note',
        namespace: ns,
      });

      const resourceUrl = resolver.getResourceUrl(table);
      expect(resourceUrl).toBe('http://localhost:3000/bob/.data/notes.ttl');
    });
  });

  describe('getContainerUrl()', () => {
    it('should derive container URL from resource URL', () => {
      const resolver = new FragmentResourceResolver('http://localhost:3000/test/');
      const table = podTable('tags', {
        id: id(),
      }, {
        base: '/.data/tags.ttl',
        type: 'https://example.org/Tag',
        namespace: ns,
      });

      const containerUrl = resolver.getContainerUrl(table);
      expect(containerUrl).toBe('http://localhost:3000/test/.data/');
    });
  });

  describe('resolveSubject()', () => {
    it('should generate fragment URI with correct base', () => {
      // 用户传入 id: 'tag-123' (不带#)，系统自动加上
      const resolver = new FragmentResourceResolver('http://localhost:3000/test/');
      const table = podTable('tags', {
        id: id(),
      }, {
        base: '/.data/tags.ttl',
        type: 'https://example.org/Tag',
        namespace: ns,
      });

      const subject = resolver.resolveSubject(table, { id: 'tag-123' });
      expect(subject).toBe('http://localhost:3000/test/.data/tags.ttl#tag-123');
    });

    it('should generate UUID fragment when id is not provided', () => {
      const resolver = new FragmentResourceResolver('http://localhost:3000/test/');
      const table = podTable('tags', {
        id: id(),
      }, {
        base: '/.data/tags.ttl',
        type: 'https://example.org/Tag',
        namespace: ns,
      });

      // 默认生成 #{uuid} 格式
      const subject = resolver.resolveSubject(table, {});
      expect(subject).toMatch(/^http:\/\/localhost:3000\/test\/\.data\/tags\.ttl#[a-f0-9-]+$/);
    });

    it('should apply fragment templates to slash-qualified business ids', () => {
      const resolver = new FragmentResourceResolver('http://localhost:3000/test/');
      const table = podTable('ai-models', {
        id: id(),
      }, {
        base: '/settings/ai/models.ttl',
        subjectTemplate: '#{id}',
        type: 'https://example.org/Model',
        namespace: ns,
      });

      const subject = resolver.resolveSubject(table, { id: 'undefineds/linx' });

      expect(subject).toBe('http://localhost:3000/test/settings/ai/models.ttl#undefineds/linx');
      expect(resolver.parseId(table, subject)).toBe('models.ttl#undefineds/linx');
    });
  });

  describe('parseId()', () => {
    it('should extract fragment template id without #', () => {
      const resolver = new FragmentResourceResolver('http://localhost:3000/test/');
      const table = podTable('tags', {
        id: id(),
      }, {
        base: '/.data/tags.ttl',
        type: 'https://example.org/Tag',
        namespace: ns,
      });

      const parsedId = resolver.parseId(table, 'http://localhost:3000/test/.data/tags.ttl#my-tag');
      expect(parsedId).toBe('tags.ttl#my-tag');
    });

    it('should return empty string when subject equals base', () => {
      const resolver = new FragmentResourceResolver('http://localhost:3000/test/');
      const table = podTable('tags', {
        id: id(),
      }, {
        base: '/.data/tags.ttl',
        type: 'https://example.org/Tag',
        namespace: ns,
      });

      const parsedId = resolver.parseId(table, 'http://localhost:3000/test/.data/tags.ttl');
      expect(parsedId).toBe('tags.ttl');
    });
  });

  describe('getResourceUrlForSubject()', () => {
    it('should strip fragment from subject URI', () => {
      const resolver = new FragmentResourceResolver('http://localhost:3000/test/');
      const url = resolver.getResourceUrlForSubject('http://localhost:3000/test/.data/tags.ttl#tag-1');
      expect(url).toBe('http://localhost:3000/test/.data/tags.ttl');
    });

    it('should return as-is when no fragment', () => {
      const resolver = new FragmentResourceResolver('http://localhost:3000/test/');
      const url = resolver.getResourceUrlForSubject('http://localhost:3000/test/.data/tags.ttl');
      expect(url).toBe('http://localhost:3000/test/.data/tags.ttl');
    });
  });
});

describe('resolveSelectSources() - multi-variable templates', () => {
  it('should throw error when id provided but other template variables missing', async () => {
    const resolver = new DocumentResourceResolver('http://localhost:3000/test/');
    const table = podTable('threads', {
      id: id(),
      chatId: string('chatId').predicate('https://schema.org/chatId'),
      content: string('content').predicate('https://schema.org/text'),
    }, {
      base: '/.data/chats/',
      subjectTemplate: '{chatId}/index.ttl#{id}',
      type: 'https://example.org/Thread',
      namespace: ns,
    });

    // Condition with only id, missing chatId (using binary_expr format)
    const condition = {
      type: 'binary_expr',
      left: { type: 'column_ref', name: 'id' },
      operator: '=',
      right: 'thread_abc123'
    };

    // Should throw error instead of silently falling back to container scan
    await expect(
      resolver.resolveSelectSources(
        table,
        'http://localhost:3000/test/.data/chats/',
        condition
      )
    ).rejects.toThrow(/missing required variable.*chatId/);
  });

  it('should use fast path when all template variables are present', async () => {
    const resolver = new DocumentResourceResolver('http://localhost:3000/test/');
    const table = podTable('threads', {
      id: id(),
      chatId: string('chatId').predicate('https://schema.org/chatId'),
      content: string('content').predicate('https://schema.org/text'),
    }, {
      base: '/.data/chats/',
      subjectTemplate: '{chatId}/index.ttl#{id}',
      type: 'https://example.org/Thread',
      namespace: ns,
    });

    // Condition with both id and chatId (using logical_expr format)
    const condition = {
      type: 'logical_expr',
      operator: 'AND',
      expressions: [
        {
          type: 'binary_expr',
          left: { type: 'column_ref', name: 'id' },
          operator: '=',
          right: 'thread_abc123'
        },
        {
          type: 'binary_expr',
          left: { type: 'column_ref', name: 'chatId' },
          operator: '=',
          right: 'chat1'
        }
      ]
    };

    const sources = await resolver.resolveSelectSources(
      table,
      'http://localhost:3000/test/.data/chats/',
      condition
    );

    // Should resolve to specific container without needing listContainer
    expect(sources).toEqual([
      'http://localhost:3000/test/.data/chats/chat1/index.ttl',
    ]);
  });

  it('should use fast path for simple single-variable templates', async () => {
    const resolver = new DocumentResourceResolver('http://localhost:3000/test/');
    const table = podTable('items', {
      id: id(),
      name: string('name').predicate('https://schema.org/name'),
    }, {
      base: '/.data/items/',
      subjectTemplate: '{id}.ttl#it',
      type: 'https://example.org/Item',
      namespace: ns,
    });

    // Condition with only id (using binary_expr format)
    const condition = {
      type: 'binary_expr',
      left: { type: 'column_ref', name: 'id' },
      operator: '=',
      right: 'item-123'
    };

    const sources = await resolver.resolveSelectSources(
      table,
      'http://localhost:3000/test/.data/items/',
      condition
    );

    // Should use fast path and resolve directly
    expect(sources).toEqual([
      'http://localhost:3000/test/.data/items/item-123.ttl',
    ]);
  });

  it('should recognize alias-qualified exact @id conditions', async () => {
    const resolver = new DocumentResourceResolver('http://localhost:3000/test/');
    const table = podTable('messages', {
      id: id(),
      chatId: string('chatId').predicate('https://schema.org/chatId'),
      content: string('content').predicate('https://schema.org/text'),
    }, {
      base: '/.data/messages/',
      subjectTemplate: '{chatId}/messages.ttl#{id}',
      type: 'https://example.org/Message',
      namespace: ns,
    });

    const condition = {
      type: 'binary_expr',
      left: 'messages.@id',
      operator: '=',
      right: 'http://localhost:3000/test/.data/messages/chat-1/messages.ttl#msg-123',
    };

    const sources = await resolver.resolveSelectSources(
      table,
      'http://localhost:3000/test/.data/messages/',
      condition
    );

    expect(sources).toEqual([
      'http://localhost:3000/test/.data/messages/chat-1/messages.ttl',
    ]);
  });

  it('should recognize alias-qualified template variables', async () => {
    const resolver = new DocumentResourceResolver('http://localhost:3000/test/');
    const table = podTable('threads', {
      id: id(),
      chatId: string('chatId').predicate('https://schema.org/chatId'),
      content: string('content').predicate('https://schema.org/text'),
    }, {
      base: '/.data/chats/',
      subjectTemplate: '{chatId}/index.ttl#{id}',
      type: 'https://example.org/Thread',
      namespace: ns,
    });

    const condition = {
      type: 'logical_expr',
      operator: 'AND',
      expressions: [
        {
          type: 'binary_expr',
          left: 'threads.id',
          operator: '=',
          right: 'thread_abc123'
        },
        {
          type: 'binary_expr',
          left: 'threads.chatId',
          operator: '=',
          right: 'chat1'
        }
      ]
    };

    const sources = await resolver.resolveSelectSources(
      table,
      'http://localhost:3000/test/.data/chats/',
      condition
    );

    expect(sources).toEqual([
      'http://localhost:3000/test/.data/chats/chat1/index.ttl',
    ]);
  });

  it('should reject non-exact collection reads in document mode LDP', async () => {
    const resolver = new DocumentResourceResolver('http://localhost:3000/test/');
    const table = podTable('messages', {
      id: id(),
      chatId: string('chatId').predicate('https://schema.org/chatId'),
      content: string('content').predicate('https://schema.org/text'),
    }, {
      base: '/.data/messages/',
      subjectTemplate: '{chatId}/messages.ttl#{id}',
      type: 'https://example.org/Message',
      namespace: ns,
    });

    const condition = {
      type: 'binary_expr',
      left: { type: 'column_ref', name: 'chatId' },
      operator: '=',
      right: 'chat-1',
    };

    await expect(
      resolver.resolveSelectSources(
        table,
        'http://localhost:3000/test/.data/messages/',
        condition,
      )
    ).rejects.toThrow(/Document-mode collection queries over plain LDP are not supported/i);
  });

  it('should reject non-exact collection mutations in document mode LDP', async () => {
    const resolver = new DocumentResourceResolver('http://localhost:3000/test/');
    const table = podTable('messages', {
      id: id(),
      chatId: string('chatId').predicate('https://schema.org/chatId'),
      content: string('content').predicate('https://schema.org/text'),
    }, {
      base: '/.data/messages/',
      subjectTemplate: '{chatId}/messages.ttl#{id}',
      type: 'https://example.org/Message',
      namespace: ns,
    });

    const condition = {
      type: 'binary_expr',
      left: { type: 'column_ref', name: 'chatId' },
      operator: '=',
      right: 'chat-1',
    };

    await expect(
      resolver.resolveSubjectsForMutation(
        table,
        condition,
        async () => [],
        async () => [],
      )
    ).rejects.toThrow(/Document-mode collection mutations over plain LDP are not supported/i);
  });
});

describe('Edge cases', () => {
  it('should handle deeply nested user paths', () => {
    const resolver = new DocumentResourceResolver('http://localhost:3000/org/team/user/');
    const table = podTable('items', {
      id: id(),
    }, {
      base: '/.private/app/data/items/',
      type: 'https://example.org/Item',
      namespace: ns,
    });

    const containerUrl = resolver.getContainerUrl(table);
    expect(containerUrl).toBe('http://localhost:3000/org/team/user/.private/app/data/items/');
  });

  it('should handle root base path', () => {
    const resolver = new DocumentResourceResolver('http://localhost:3000/user/');
    const table = podTable('root', {
      id: id(),
    }, {
      base: '/',
      type: 'https://example.org/Root',
      namespace: ns,
    });

    const containerUrl = resolver.getContainerUrl(table);
    expect(containerUrl).toBe('http://localhost:3000/user/');
  });

  it('should handle empty base path with table name fallback', () => {
    const resolver = new FragmentResourceResolver('http://localhost:3000/user/');
    const table = podTable('default', {
      id: id(),
    }, {
      base: '/default.ttl',  // base is required, use table name as filename
      type: 'https://example.org/Item',
      namespace: ns,
    });

    const resourceUrl = resolver.getResourceUrl(table);
    expect(resourceUrl).toBe('http://localhost:3000/user/default.ttl');
  });
});


describe('resolveSubjectsForMutation() - explicit @id QueryCondition', () => {
  it('should accept QueryCondition-based @id filters without scanning', async () => {
    const resolver = new DocumentResourceResolver('http://localhost:3000/test/');
    const table = podTable('messages', {
      id: id(),
      chatId: string('chatId').predicate('https://schema.org/chatId'),
      content: string('content').predicate('https://schema.org/text'),
    }, {
      base: '/.data/chats/',
      subjectTemplate: '{chatId}/index.ttl#{id}',
      type: 'https://example.org/Message',
      namespace: ns,
    });

    const condition = {
      type: 'binary_expr',
      left: { type: 'column_ref', name: '@id' },
      operator: 'IN',
      right: ['http://localhost:3000/test/.data/chats/chat1/index.ttl#thread_abc123'],
    };

    const subjects = await resolver.resolveSubjectsForMutation(
      table,
      condition as any,
      async () => {
        throw new Error('should not scan subjects');
      },
      async () => {
        throw new Error('should not list containers');
      }
    );

    expect(subjects).toEqual([
      'http://localhost:3000/test/.data/chats/chat1/index.ttl#thread_abc123',
    ]);
  });
});
