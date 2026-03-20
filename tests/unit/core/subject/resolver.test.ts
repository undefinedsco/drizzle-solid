/**
 * SubjectResolver Unit Tests
 */

import { SubjectResolverImpl } from '../../../../src/core/subject';
import { podTable, string, id, uri } from '../../../../src/core/schema';

// 测试用命名空间
const ns = { prefix: 'schema', uri: 'https://schema.org/' };

describe('SubjectResolver', () => {
  let resolver: SubjectResolverImpl;

  beforeEach(() => {
    resolver = new SubjectResolverImpl('https://pod.example');
  });

  describe('getResourceMode', () => {
    it('should infer document mode from container path (ends with /)', () => {
      const table = podTable('users', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: '/data/users/',
        type: 'https://schema.org/Person',
        namespace: ns,
      });

      expect(resolver.getResourceMode(table)).toBe('document');
    });

    it('should infer fragment mode from file path (ends with .ttl)', () => {
      const table = podTable('tags', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: '/data/tags.ttl',
        type: 'https://schema.org/Tag',
        namespace: ns,
      });

      expect(resolver.getResourceMode(table)).toBe('fragment');
    });

    it('should set default subjectTemplate for document mode tables', () => {
      const table = podTable('users', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: '/data/users/',
        type: 'https://schema.org/Person',
        namespace: ns,
      });

      // Document mode 默认模板
      expect(table.getSubjectTemplate()).toBe('{id}.ttl');
    });

    it('should set default subjectTemplate for fragment mode tables', () => {
      const table = podTable('tags', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: '/data/tags.ttl',
        type: 'https://schema.org/Tag',
        namespace: ns,
      });

      expect(table.getSubjectTemplate()).toBe('#{id}');
    });

    it('should respect explicit pattern starting with #', () => {
      const table = podTable('users', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: '/data/users/',
        subjectTemplate: '#{id}',
        type: 'https://schema.org/Person',
        namespace: ns,
      });

      expect(resolver.getResourceMode(table)).toBe('fragment');
    });

    it('should respect explicit pattern with .ttl', () => {
      const table = podTable('users', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: '/data/users.ttl',
        subjectTemplate: '{id}.ttl',
        type: 'https://schema.org/Person',
        namespace: ns,
      });

      expect(resolver.getResourceMode(table)).toBe('document');
    });
  });

  describe('getDefaultPattern', () => {
    it('should return {id}.ttl for document mode', () => {
      const table = podTable('users', {
        id: id(),
      }, {
        base: '/data/users/',
        type: 'https://schema.org/Person',
        namespace: ns,
      });

      expect(resolver.getDefaultPattern(table)).toBe('{id}.ttl');
    });

    it('should return #{id} for fragment mode', () => {
      const table = podTable('tags', {
        id: id(),
      }, {
        base: '/data/tags.ttl',
        type: 'https://schema.org/Tag',
        namespace: ns,
      });

      expect(resolver.getDefaultPattern(table)).toBe('#{id}');
    });
  });

  describe('resolve - document mode', () => {
    it('should generate document URI with {id}.ttl pattern', () => {
      const table = podTable('users', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: '/data/users/',
        type: 'https://schema.org/Person',
        namespace: ns,
      });

      const uri = resolver.resolve(table, { id: 'alice', name: 'Alice' });

      expect(uri).toBe('https://pod.example/data/users/alice.ttl');
    });

    it('should handle custom pattern', () => {
      const table = podTable('users', {
        id: id(),
        slug: string('slug').predicate('https://schema.org/identifier'),
      }, {
        base: '/data/users/',
        subjectTemplate: '{slug}.ttl',
        type: 'https://schema.org/Person',
        namespace: ns,
      });

      const uri = resolver.resolve(table, { id: '123', slug: 'alice-smith' });

      expect(uri).toBe('https://pod.example/data/users/alice-smith.ttl');
    });

    it('should handle |slug transform in subjectTemplate', () => {
      const table = podTable('entries', {
        id: id(),
        title: string('title').predicate('https://schema.org/headline'),
      }, {
        base: '/data/entries/',
        subjectTemplate: '{title|slug}.ttl',
        type: 'https://schema.org/CreativeWork',
        namespace: ns,
      });

      const subject = resolver.resolve(table, { id: '123', title: 'Hello LinX / 世界' });

      expect(subject).toBe('https://pod.example/data/entries/hello-linx-世界.ttl');
    });

    it('should handle |id transform in subjectTemplate', () => {
      const chatTable = podTable('chats', {
        id: id(),
      }, {
        base: '/data/chats/',
        subjectTemplate: '{id}/index.ttl#this',
        type: 'https://schema.org/Conversation',
        namespace: ns,
      });

      const table = podTable('threads', {
        id: id(),
        chat: uri('chat').predicate('https://schema.org/isPartOf').link(chatTable),
      }, {
        base: '/data/threads/',
        subjectTemplate: '{chat|id}/index.ttl#{id}',
        type: 'https://schema.org/Comment',
        namespace: ns,
      });

      const subject = resolver.resolve(table, {
        id: 'thread-1',
        chat: 'https://pod.example/data/chats/chat-1/index.ttl#this',
      });

      expect(subject).toBe('https://pod.example/data/threads/chat-1/index.ttl#thread-1');
    });

    it('should handle time variables', () => {
      const table = podTable('posts', {
        id: id(),
        slug: string('slug').predicate('https://schema.org/identifier'),
        createdAt: string('createdAt').predicate('https://schema.org/dateCreated'),
      }, {
        base: '/data/posts/',
        subjectTemplate: '{yyyy}/{MM}/{slug}.ttl',
        type: 'https://schema.org/BlogPosting',
        namespace: ns,
      });

      const uri = resolver.resolve(table, {
        id: '123',
        slug: 'hello-world',
        createdAt: '2025-03-15T10:00:00Z',
      });

      expect(uri).toBe('https://pod.example/data/posts/2025/03/hello-world.ttl');
    });
  });

  describe('resolve - fragment mode', () => {
    it('should generate fragment URI', () => {
      const table = podTable('tags', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: '/data/tags.ttl',
        type: 'https://schema.org/Tag',
        namespace: ns,
      });

      const uri = resolver.resolve(table, { id: 'tag-1', name: 'Tech' });

      expect(uri).toBe('https://pod.example/data/tags.ttl#tag-1');
    });

    it('should handle explicit fragment pattern', () => {
      const table = podTable('items', {
        id: id(),
      }, {
        base: '/data/items.ttl',
        subjectTemplate: '#item-{id}',
        type: 'https://example.org/Item',
        namespace: ns,
      });

      const uri = resolver.resolve(table, { id: '42' });

      expect(uri).toBe('https://pod.example/data/items.ttl#item-42');
    });
  });

  describe('resolve - singleton mode', () => {
    it('should handle #me singleton', () => {
      const table = podTable('profile', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: '/profile/card',
        subjectTemplate: '#me',
        type: 'https://schema.org/Person',
        namespace: ns,
      });

      const uri = resolver.resolve(table, { id: 'ignored', name: 'Alice' });

      expect(uri).toBe('https://pod.example/profile/card#me');
    });

    it('should handle #this singleton', () => {
      const table = podTable('doc', {
        id: id(),
      }, {
        base: '/profile/card',
        subjectTemplate: '#this',
        type: 'http://xmlns.com/foaf/0.1/PersonalProfileDocument',
        namespace: ns,
      });

      const uri = resolver.resolve(table, { id: 'ignored' });

      expect(uri).toBe('https://pod.example/profile/card#this');
    });
  });

  describe('isSingleton', () => {
    it('should return true for #me', () => {
      const table = podTable('profile', {
        id: id(),
      }, {
        base: '/profile/card',
        subjectTemplate: '#me',
        type: 'https://schema.org/Person',
        namespace: ns,
      });

      expect(resolver.isSingleton(table)).toBe(true);
    });

    it('should return true for pattern without variables', () => {
      const table = podTable('config', {
        id: id(),
      }, {
        base: '/settings/app.ttl',
        subjectTemplate: '#config',
        type: 'https://example.org/Config',
        namespace: ns,
      });

      expect(resolver.isSingleton(table)).toBe(true);
    });

    it('should return false for pattern with variables', () => {
      const table = podTable('users', {
        id: id(),
      }, {
        base: '/data/users/',
        subjectTemplate: '{id}.ttl',
        type: 'https://schema.org/Person',
        namespace: ns,
      });

      expect(resolver.isSingleton(table)).toBe(false);
    });
  });

  describe('parse', () => {
    it('should parse document URI', () => {
      const table = podTable('users', {
        id: id(),
      }, {
        base: '/data/users/',
        type: 'https://schema.org/Person',
        namespace: ns,
      });

      // 默认模板 {id}.ttl，URI 不带 fragment
      const result = resolver.parse('https://pod.example/data/users/alice.ttl', table);

      expect(result).not.toBeNull();
      expect(result!.uri).toBe('https://pod.example/data/users/alice.ttl');
      expect(result!.resourceUrl).toBe('https://pod.example/data/users/alice.ttl');
      expect(result!.fragment).toBeUndefined();
      expect(result!.id).toBe('alice');
      expect(result!.mode).toBe('document');
    });

    it('should parse fragment URI', () => {
      const table = podTable('tags', {
        id: id(),
      }, {
        base: '/data/tags.ttl',
        type: 'https://schema.org/Tag',
        namespace: ns,
      });

      const result = resolver.parse('https://pod.example/data/tags.ttl#tag-1', table);

      expect(result).not.toBeNull();
      expect(result!.uri).toBe('https://pod.example/data/tags.ttl#tag-1');
      expect(result!.resourceUrl).toBe('https://pod.example/data/tags.ttl');
      expect(result!.fragment).toBe('tag-1');
      // 默认模板 #{id}，所以 id = tag-1
      expect(result!.id).toBe('tag-1');
      expect(result!.mode).toBe('fragment');
    });

    it('should parse document URI with #it fragment (document mode)', () => {
      // {id}.ttl#it 模式: 每个用户一个文件，但主体 URI 带 #it fragment
      const table = podTable('users', {
        id: id(),
      }, {
        base: '/data/users/',
        subjectTemplate: '{id}.ttl#it',
        type: 'https://schema.org/Person',
        namespace: ns,
      });

      const result = resolver.parse('https://pod.example/data/users/alice.ttl#it', table);

      expect(result).not.toBeNull();
      expect(result!.uri).toBe('https://pod.example/data/users/alice.ttl#it');
      expect(result!.resourceUrl).toBe('https://pod.example/data/users/alice.ttl');
      expect(result!.fragment).toBe('it');
      // 模板 {id}.ttl#it，反向解析得 id = alice
      expect(result!.id).toBe('alice');
      expect(result!.mode).toBe('document');
    });

    it('should parse document URI with #me fragment (document mode)', () => {
      // {id}.ttl#me 模式: 每个用户一个文件，主体 URI 带 #me fragment
      const table = podTable('profiles', {
        id: id(),
      }, {
        base: '/data/profiles/',
        subjectTemplate: '{id}.ttl#me',
        type: 'https://schema.org/Person',
        namespace: ns,
      });

      const result = resolver.parse('https://pod.example/data/profiles/bob.ttl#me', table);

      expect(result).not.toBeNull();
      expect(result!.uri).toBe('https://pod.example/data/profiles/bob.ttl#me');
      expect(result!.resourceUrl).toBe('https://pod.example/data/profiles/bob.ttl');
      expect(result!.fragment).toBe('me');
      // 模板 {id}.ttl#me，反向解析得 id = bob
      expect(result!.id).toBe('bob');
      expect(result!.mode).toBe('document');
    });
  });

  describe('getResourceUrl', () => {
    it('should return full URL for document URI', () => {
      const url = resolver.getResourceUrl('https://pod.example/data/users/alice.ttl');
      expect(url).toBe('https://pod.example/data/users/alice.ttl');
    });

    it('should strip fragment for fragment URI', () => {
      const url = resolver.getResourceUrl('https://pod.example/data/tags.ttl#tag-1');
      expect(url).toBe('https://pod.example/data/tags.ttl');
    });
  });

  describe('resolveInlineChild', () => {
    it('should generate fragment URI for inline child', () => {
      const uri = resolver.resolveInlineChild(
        'https://pod.example/data/users/alice.ttl',
        'address',
        { street: '123 Main St' },
        0
      );

      expect(uri).toBe('https://pod.example/data/users/alice.ttl#address-1');
    });

    it('should use explicit @id from inline object', () => {
      const uri = resolver.resolveInlineChild(
        'https://pod.example/data/users/alice.ttl',
        'address',
        { '@id': 'https://pod.example/addresses/1', street: '123 Main St' },
        0
      );

      expect(uri).toBe('https://pod.example/addresses/1');
    });

    it('should use explicit id from inline object', () => {
      const uri = resolver.resolveInlineChild(
        'https://pod.example/data/users/alice.ttl',
        'address',
        { id: 'https://pod.example/addresses/2', street: '456 Oak Ave' },
        0
      );

      expect(uri).toBe('https://pod.example/addresses/2');
    });

    it('should increment index for multiple inline objects', () => {
      const uri1 = resolver.resolveInlineChild(
        'https://pod.example/data/users/alice.ttl',
        'phones',
        { number: '123' },
        0
      );
      const uri2 = resolver.resolveInlineChild(
        'https://pod.example/data/users/alice.ttl',
        'phones',
        { number: '456' },
        1
      );

      expect(uri1).toBe('https://pod.example/data/users/alice.ttl#phones-1');
      expect(uri2).toBe('https://pod.example/data/users/alice.ttl#phones-2');
    });

    it('should handle parent URI with existing fragment', () => {
      const uri = resolver.resolveInlineChild(
        'https://pod.example/data/tags.ttl#tag-1',
        'metadata',
        { count: 10 },
        0
      );

      expect(uri).toBe('https://pod.example/data/tags.ttl#metadata-1');
    });
  });

  describe('absolute URL handling', () => {
    it('should handle absolute base URL', () => {
      const table = podTable('users', {
        id: id(),
      }, {
        base: 'https://other-pod.example/data/users/',
        type: 'https://schema.org/Person',
        namespace: ns,
      });

      const uri = resolver.resolve(table, { id: 'bob' });

      expect(uri).toBe('https://other-pod.example/data/users/bob.ttl');
    });
  });

  describe('fallback URI generation', () => {
    it('should generate fallback when id is missing', () => {
      const table = podTable('users', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: '/data/users/',
        type: 'https://schema.org/Person',
        namespace: ns,
      });

      const uri = resolver.resolve(table, { name: 'Alice' }, 0);

      expect(uri).toContain('https://pod.example/data/users/');
      expect(uri).toContain('row-1');
    });
  });
});
