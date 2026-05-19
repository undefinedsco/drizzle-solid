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

    it('should extract exact resource id from document URI filename', () => {
      const parsed = resolver.parseSubject('https://pod.example/data/users/alice.ttl', documentTable);
      expect(parsed).not.toBeNull();
      expect(parsed!.id).toBe('alice.ttl');
      expect(parsed!.mode).toBe('document');
    });

    it('should return relative path when extension does not match template', () => {
      const parsed = resolver.parseSubject('https://pod.example/data/users/bob.rdf', documentTable);
      expect(parsed).not.toBeNull();
      expect(parsed!.id).toBe('bob.rdf');
    });

    it('should handle nested paths in document mode', () => {
      const parsed = resolver.parseSubject('https://pod.example/data/users/2025/01/carol.ttl', documentTable);
      expect(parsed).not.toBeNull();
      expect(parsed!.id).toBe('2025/01/carol.ttl');
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

    it('should extract exact resource id from fragment URI', () => {
      const parsed = resolver.parseSubject('https://pod.example/data/tags.ttl#tag-1', fragmentTable);
      expect(parsed).not.toBeNull();
      expect(parsed!.id).toBe('tags.ttl#tag-1');
      expect(parsed!.mode).toBe('fragment');
    });

    it('should extract id from fragment with special characters', () => {
      const parsed = resolver.parseSubject('https://pod.example/data/tags.ttl#my-tag_123', fragmentTable);
      expect(parsed).not.toBeNull();
      expect(parsed!.id).toBe('tags.ttl#my-tag_123');
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
