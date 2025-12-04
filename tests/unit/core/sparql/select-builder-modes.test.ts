/**
 * Tests for SelectBuilder handling document vs fragment modes
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SelectBuilder } from '../../../../src/core/sparql/builder/select-builder';
import { podTable, string, id } from '../../../../src/core/pod-table';
import { subjectResolver, SubjectResolverImpl } from '../../../../src/core/subject';

const ns = { prefix: 'schema', uri: 'https://schema.org/' };

describe('SelectBuilder mode handling', () => {
  let builder: SelectBuilder;

  beforeEach(() => {
    builder = new SelectBuilder({ schema: 'https://schema.org/' });
    (subjectResolver as SubjectResolverImpl).setPodUrl('https://pod.example');
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

    it('should NOT generate BIND STRAFTER - id extracted in JS', () => {
      const ast = {
        type: 'select',
        columns: [{ name: 'id' }, { name: 'name' }],
      };

      const result = builder.convertSelect(ast, fragmentTable);

      // id extraction unified in JS, no STRAFTER in SPARQL
      expect(result.query).not.toContain('STRAFTER');
      expect(result.query).toContain('?subject');
    });
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

    it('should NOT generate BIND STRAFTER for id in document mode', () => {
      const ast = {
        type: 'select',
        columns: [{ name: 'id' }, { name: 'name' }],
      };

      const result = builder.convertSelect(ast, documentTable);

      // document mode: id is extracted in JS, not via SPARQL STRAFTER
      expect(result.query).not.toContain('STRAFTER');
    });

    it('should still select subject in document mode', () => {
      const ast = {
        type: 'select',
        columns: [{ name: 'id' }, { name: 'name' }],
      };

      const result = builder.convertSelect(ast, documentTable);

      expect(result.query).toContain('?subject');
    });
  });

  describe('custom predicate id', () => {
    const customIdTable = podTable('items', {
      id: string('id').primaryKey().predicate('https://schema.org/identifier'),
      name: string('name').predicate('https://schema.org/name'),
    }, {
      base: '/data/items.ttl',
      type: 'https://schema.org/Thing',
      namespace: ns,
    });

    it('should generate triple pattern for id with custom predicate', () => {
      const ast = {
        type: 'select',
        columns: [{ name: 'id' }, { name: 'name' }],
      };

      const result = builder.convertSelect(ast, customIdTable);

      // Custom predicate: id is queried as a regular property
      expect(result.query).toContain('schema:identifier');
      expect(result.query).not.toContain('STRAFTER');
    });
  });

  describe('WHERE clause with id', () => {
    it('should convert @id column to full URI in WHERE (fragment mode)', () => {
      const fragmentTable = podTable('tags', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: '/data/tags.ttl',
        type: 'https://schema.org/Tag',
        namespace: ns,
      });

      const ast = {
        type: 'select',
        columns: [{ name: 'id' }, { name: 'name' }],
        where: {
          type: 'binary_expr',
          operator: '=',
          left: { name: 'id' },
          right: 'tag-1',
        },
      };

      const result = builder.convertSelect(ast, fragmentTable);

      // Should compare ?subject with full URI, not ?id with "tag-1"
      expect(result.query).toContain('?subject');
      expect(result.query).toContain('https://pod.example/data/tags.ttl#tag-1');
      expect(result.query).not.toContain('?id');
    });

    it('should convert @id column to full URI in WHERE (document mode)', () => {
      const documentTable = podTable('users', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: '/data/users/',
        type: 'https://schema.org/Person',
        namespace: ns,
      });

      const ast = {
        type: 'select',
        columns: [{ name: 'id' }, { name: 'name' }],
        where: {
          type: 'binary_expr',
          operator: '=',
          left: { name: 'id' },
          right: 'alice',
        },
      };

      const result = builder.convertSelect(ast, documentTable);

      // Should compare ?subject with full URI
      expect(result.query).toContain('?subject');
      expect(result.query).toContain('https://pod.example/data/users/alice.ttl');
    });

    it('should use ?id variable for custom predicate id in WHERE', () => {
      const customIdTable = podTable('items', {
        id: string('id').primaryKey().predicate('https://schema.org/identifier'),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: '/data/items.ttl',
        type: 'https://schema.org/Thing',
        namespace: ns,
      });

      const ast = {
        type: 'select',
        columns: [{ name: 'id' }, { name: 'name' }],
        where: {
          type: 'binary_expr',
          operator: '=',
          left: { name: 'id' },
          right: 'item-123',
        },
      };

      const result = builder.convertSelect(ast, customIdTable);

      // Custom predicate: use ?id variable with literal value
      expect(result.query).toContain('?id');
      expect(result.query).toContain('"item-123"');
    });

    it('should handle IN clause with @id column', () => {
      const fragmentTable = podTable('tags', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: '/data/tags.ttl',
        type: 'https://schema.org/Tag',
        namespace: ns,
      });

      const ast = {
        type: 'select',
        columns: [{ name: 'id' }, { name: 'name' }],
        where: {
          type: 'binary_expr',
          operator: 'IN',
          left: { name: 'id' },
          right: ['tag-1', 'tag-2'],
        },
      };

      const result = builder.convertSelect(ast, fragmentTable);

      // Should convert all values to full URIs
      expect(result.query).toContain('?subject IN');
      expect(result.query).toContain('https://pod.example/data/tags.ttl#tag-1');
      expect(result.query).toContain('https://pod.example/data/tags.ttl#tag-2');
    });
  });
});
