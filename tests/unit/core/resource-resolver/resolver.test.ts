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
    it('should extract id from subject URI', () => {
      // 默认模板 {id}.ttl，反向解析得 id
      const resolver = new DocumentResourceResolver('http://localhost:3000/test/');
      const table = podTable('items', {
        id: id(),
      }, {
        base: '/.data/items/',
        type: 'https://example.org/Item',
        namespace: ns,
      });

      // base = http://localhost:3000/test/.data/items/
      // subject = http://localhost:3000/test/.data/items/item-123.ttl
      // 默认模板 {id}.ttl → id = item-123
      const parsedId = resolver.parseId(table, 'http://localhost:3000/test/.data/items/item-123.ttl');
      expect(parsedId).toBe('item-123');
    });

    it('should extract id including fragment from subject URI', () => {
      const resolver = new DocumentResourceResolver('http://localhost:3000/test/');
      const table = podTable('items', {
        id: id(),
      }, {
        base: '/.data/items/',
        subjectTemplate: '{id}.ttl#it',
        type: 'https://example.org/Item',
        namespace: ns,
      });

      // 模板 {id}.ttl#it → id = item-123
      const parsedId = resolver.parseId(table, 'http://localhost:3000/test/.data/items/item-123.ttl#it');
      expect(parsedId).toBe('item-123');
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
  });

  describe('parseId()', () => {
    it('should extract fragment as id', () => {
      // 默认模板 #{id}，反向解析得 id (不含 #)
      const resolver = new FragmentResourceResolver('http://localhost:3000/test/');
      const table = podTable('tags', {
        id: id(),
      }, {
        base: '/.data/tags.ttl',
        type: 'https://example.org/Tag',
        namespace: ns,
      });

      // base = http://localhost:3000/test/.data/tags.ttl
      // subject = http://localhost:3000/test/.data/tags.ttl#my-tag
      // 默认模板 #{id} → id = my-tag
      const parsedId = resolver.parseId(table, 'http://localhost:3000/test/.data/tags.ttl#my-tag');
      expect(parsedId).toBe('my-tag');
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

      // subject = base 时，relativePath 为空，无法匹配模板
      const parsedId = resolver.parseId(table, 'http://localhost:3000/test/.data/tags.ttl');
      expect(parsedId).toBe('');
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
