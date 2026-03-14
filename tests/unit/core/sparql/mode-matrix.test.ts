/**
 * Mode Matrix Tests - 验证所有模式组合
 *
 * 维度:
 * 1. Resource Mode: fragment (.ttl) vs document (/)
 * 2. ID Predicate: @id (virtual) vs custom predicate
 * 3. Operation: SELECT, INSERT, UPDATE, DELETE
 * 4. WHERE: none, id=, id IN
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SelectBuilder } from '../../../../src/core/sparql/builder/select-builder';
import { UpdateBuilder } from '../../../../src/core/sparql/builder/update-builder';
import { podTable, string, id } from '../../../../src/core/schema';
import { UriResolverImpl } from '../../../../src/core/uri';

const ns = { prefix: 'schema', uri: 'https://schema.org/' };
const prefixes = { schema: 'https://schema.org/' };

describe('Mode Matrix - Complete Coverage', () => {
  let selectBuilder: SelectBuilder;
  let updateBuilder: UpdateBuilder;
  let resolver: UriResolverImpl;

  beforeEach(() => {
    resolver = new UriResolverImpl('https://pod.example');
    selectBuilder = new SelectBuilder(prefixes, resolver);
    updateBuilder = new UpdateBuilder(prefixes, resolver);
  });

  // ==========================================
  // Fragment Mode + @id Predicate
  // ==========================================
  describe('Fragment Mode + @id Predicate', () => {
    const table = podTable('tags', {
      id: id(),
      name: string('name').predicate('https://schema.org/name'),
    }, {
      base: '/data/tags.ttl',
      type: 'https://schema.org/Tag',
      namespace: ns,
    });

    describe('SELECT', () => {
      it('should not use STRAFTER for id', () => {
        const ast = { type: 'select', columns: [{ name: 'id' }, { name: 'name' }] };
        const result = selectBuilder.convertSelect(ast, table);
        expect(result.query).not.toContain('STRAFTER');
        expect(result.query).toContain('?subject');
      });

      it('should convert id = to subject URI comparison', () => {
        const ast = {
          type: 'select',
          columns: [{ name: 'name' }],
          where: { type: 'binary_expr', operator: '=', left: { name: 'id' }, right: 'tag-1' },
        };
        const result = selectBuilder.convertSelect(ast, table);
        expect(result.query).toContain('?subject');
        expect(result.query).toContain('https://pod.example/data/tags.ttl#tag-1');
      });

      it('should convert id IN to subject URIs', () => {
        const ast = {
          type: 'select',
          columns: [{ name: 'name' }],
          where: { type: 'binary_expr', operator: 'IN', left: { name: 'id' }, right: ['a', 'b'] },
        };
        const result = selectBuilder.convertSelect(ast, table);
        expect(result.query).toContain('VALUES ?subject');
        expect(result.query).toContain('tags.ttl#a');
        expect(result.query).toContain('tags.ttl#b');
      });
    });

    describe('UPDATE', () => {
      it('should generate correct subject URI for fragment', () => {
        const result = updateBuilder.convertUpdate(
          { name: 'Updated' },
          { id: 'tag-1' },
          table
        );
        expect(result.query).toContain('https://pod.example/data/tags.ttl#tag-1');
      });
    });

    describe('DELETE', () => {
      it('should generate correct subject URI for fragment', () => {
        const result = updateBuilder.convertDelete({ id: 'tag-1' }, table);
        expect(result.query).toContain('https://pod.example/data/tags.ttl#tag-1');
      });
    });
  });

  // ==========================================
  // Document Mode + @id Predicate
  // ==========================================
  describe('Document Mode + @id Predicate', () => {
    const table = podTable('users', {
      id: id(),
      name: string('name').predicate('https://schema.org/name'),
    }, {
      base: '/data/users/',
      type: 'https://schema.org/Person',
      namespace: ns,
    });

    describe('SELECT', () => {
      it('should not use STRAFTER for id', () => {
        const ast = { type: 'select', columns: [{ name: 'id' }, { name: 'name' }] };
        const result = selectBuilder.convertSelect(ast, table);
        expect(result.query).not.toContain('STRAFTER');
      });

      it('should convert id = to document URI comparison', () => {
        const ast = {
          type: 'select',
          columns: [{ name: 'name' }],
          where: { type: 'binary_expr', operator: '=', left: { name: 'id' }, right: 'alice' },
        };
        const result = selectBuilder.convertSelect(ast, table);
        expect(result.query).toContain('?subject');
        expect(result.query).toContain('https://pod.example/data/users/alice.ttl');
      });

      it('should convert id IN to document URIs', () => {
        const ast = {
          type: 'select',
          columns: [{ name: 'name' }],
          where: { type: 'binary_expr', operator: 'IN', left: { name: 'id' }, right: ['alice', 'bob'] },
        };
        const result = selectBuilder.convertSelect(ast, table);
        expect(result.query).toContain('VALUES ?subject');
        expect(result.query).toContain('users/alice.ttl');
        expect(result.query).toContain('users/bob.ttl');
      });
    });

    describe('UPDATE', () => {
      it('should generate correct subject URI for document', () => {
        const result = updateBuilder.convertUpdate(
          { name: 'Updated' },
          { id: 'alice' },
          table
        );
        expect(result.query).toContain('https://pod.example/data/users/alice.ttl');
      });
    });

    describe('DELETE', () => {
      it('should generate correct subject URI for document', () => {
        const result = updateBuilder.convertDelete({ id: 'alice' }, table);
        expect(result.query).toContain('https://pod.example/data/users/alice.ttl');
      });
    });
  });

  // ==========================================
  // Fragment Mode + Custom Predicate
  // ==========================================
  describe('Fragment Mode + Custom Predicate', () => {
    const table = podTable('items', {
      id: string('id').primaryKey().predicate('https://schema.org/identifier'),
      name: string('name').predicate('https://schema.org/name'),
    }, {
      base: '/data/items.ttl',
      type: 'https://schema.org/Thing',
      namespace: ns,
    });

    describe('SELECT', () => {
      it('should query id as regular property', () => {
        const ast = { type: 'select', columns: [{ name: 'id' }, { name: 'name' }] };
        const result = selectBuilder.convertSelect(ast, table);
        expect(result.query).toContain('schema:identifier');
        expect(result.query).toContain('?id');
      });

      it('should use ?id variable in WHERE', () => {
        const ast = {
          type: 'select',
          columns: [{ name: 'name' }],
          where: { type: 'binary_expr', operator: '=', left: { name: 'id' }, right: 'item-1' },
        };
        const result = selectBuilder.convertSelect(ast, table);
        expect(result.query).toContain('?id');
        expect(result.query).toContain('"item-1"');
        // Should NOT convert to full URI
        expect(result.query).not.toContain('items.ttl#item-1');
      });
    });
  });

  // ==========================================
  // Document Mode + Custom Predicate
  // ==========================================
  describe('Document Mode + Custom Predicate', () => {
    const table = podTable('products', {
      id: string('id').primaryKey().predicate('https://schema.org/sku'),
      name: string('name').predicate('https://schema.org/name'),
    }, {
      base: '/data/products/',
      type: 'https://schema.org/Product',
      namespace: ns,
    });

    describe('SELECT', () => {
      it('should query id as regular property', () => {
        const ast = { type: 'select', columns: [{ name: 'id' }, { name: 'name' }] };
        const result = selectBuilder.convertSelect(ast, table);
        expect(result.query).toContain('schema:sku');
        expect(result.query).toContain('?id');
      });

      it('should use ?id variable in WHERE', () => {
        const ast = {
          type: 'select',
          columns: [{ name: 'name' }],
          where: { type: 'binary_expr', operator: '=', left: { name: 'id' }, right: 'SKU-123' },
        };
        const result = selectBuilder.convertSelect(ast, table);
        expect(result.query).toContain('?id');
        expect(result.query).toContain('"SKU-123"');
      });
    });
  });

  // ==========================================
  // Edge Cases
  // ==========================================
  describe('Edge Cases', () => {
    it('should handle @id column explicitly named differently', () => {
      const table = podTable('profiles', {
        identifier: id('identifier'),  // @id but named 'identifier'
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: '/profiles.ttl',
        type: 'https://schema.org/Person',
        namespace: ns,
      });

      const ast = {
        type: 'select',
        columns: [{ name: 'name' }],
        where: { type: 'binary_expr', operator: '=', left: { name: 'identifier' }, right: 'me' },
      };
      const result = selectBuilder.convertSelect(ast, table);
      // identifier with @id predicate should behave like id
      expect(result.query).toContain('?subject');
    });
  });
});
