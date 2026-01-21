/**
 * Tests for extractIdFromSubject handling both document and fragment modes
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { podTable, string, id } from '../../../../src/core/schema';
import { UriResolverImpl } from '../../../../src/core/uri';

const ns = { prefix: 'schema', uri: 'https://schema.org/' };

describe('extractIdFromSubject mode handling', () => {
  let resolver: UriResolverImpl;

  beforeEach(() => {
    resolver = new UriResolverImpl('https://pod.example');
  });

  describe('document mode', () => {
    const documentTable = podTable('users', {
      id: id(),
      name: string('name').predicate('https://schema.org/name'),
    }, {
      base: '/data/users/',  // ends with / -> document mode
      type: 'https://schema.org/Person',
      namespace: ns,
    });

    it('should extract id from document URI filename', () => {
      // 默认模板 {id}.ttl
      const parsed = resolver.parseSubject('https://pod.example/data/users/alice.ttl', documentTable);
      expect(parsed).not.toBeNull();
      expect(parsed!.id).toBe('alice');
      expect(parsed!.mode).toBe('document');
    });

    it('should return relative path when extension does not match template', () => {
      // 默认模板 {id}.ttl#it，输入 URI 是 .rdf 无法匹配，回退到相对路径
      const parsed = resolver.parseSubject('https://pod.example/data/users/bob.rdf', documentTable);
      expect(parsed).not.toBeNull();
      // 模板不匹配时返回相对路径
      expect(parsed!.id).toBe('bob.rdf');
    });

    it('should handle nested paths in document mode', () => {
      // 嵌套路径匹配默认模板 {id}.ttl → id = 2025/01/carol
      const parsed = resolver.parseSubject('https://pod.example/data/users/2025/01/carol.ttl', documentTable);
      expect(parsed).not.toBeNull();
      expect(parsed!.id).toBe('2025/01/carol');
    });

    it('should extract id including fragment for document mode with #it', () => {
      // 使用自定义模板
      const tableWithTemplate = podTable('users', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: '/data/users/',
        subjectTemplate: '{id}.ttl#it',
        type: 'https://schema.org/Person',
        namespace: ns,
      });
      
      // 模板 {id}.ttl#it → id = alice
      const parsed = resolver.parseSubject('https://pod.example/data/users/alice.ttl#it', tableWithTemplate);
      expect(parsed).not.toBeNull();
      expect(parsed!.id).toBe('alice');
      expect(parsed!.mode).toBe('document');
    });
  });

  describe('fragment mode', () => {
    const fragmentTable = podTable('tags', {
      id: id(),
      name: string('name').predicate('https://schema.org/name'),
    }, {
      base: '/data/tags.ttl',  // ends with .ttl -> fragment mode
      type: 'https://schema.org/Tag',
      namespace: ns,
    });

    it('should extract id from fragment URI', () => {
      // 默认模板 #{id} → id = tag-1 (不含 #)
      const parsed = resolver.parseSubject('https://pod.example/data/tags.ttl#tag-1', fragmentTable);
      expect(parsed).not.toBeNull();
      expect(parsed!.id).toBe('tag-1');
      expect(parsed!.mode).toBe('fragment');
    });

    it('should extract id from fragment with special characters', () => {
      // 默认模板 #{id} → id = my-tag_123
      const parsed = resolver.parseSubject('https://pod.example/data/tags.ttl#my-tag_123', fragmentTable);
      expect(parsed).not.toBeNull();
      expect(parsed!.id).toBe('my-tag_123');
    });
  });

  describe('mode detection from base path', () => {
    it('should detect document mode from trailing slash', () => {
      const table = podTable('items', { id: id() }, {
        base: '/items/',
        type: 'https://example.org/Item',
        namespace: ns,
      });
      expect(resolver.getResourceMode(table)).toBe('document');
    });

    it('should detect fragment mode from .ttl extension', () => {
      const table = podTable('items', { id: id() }, {
        base: '/items.ttl',
        type: 'https://example.org/Item',
        namespace: ns,
      });
      expect(resolver.getResourceMode(table)).toBe('fragment');
    });

    it('should detect fragment mode from .jsonld extension', () => {
      const table = podTable('items', { id: id() }, {
        base: '/items.jsonld',
        type: 'https://example.org/Item',
        namespace: ns,
      });
      expect(resolver.getResourceMode(table)).toBe('fragment');
    });
  });
});
