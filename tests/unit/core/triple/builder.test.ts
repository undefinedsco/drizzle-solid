/**
 * TripleBuilder Unit Tests
 */

import { tripleBuilder } from '../../../../src/core/triple';
import { podTable, string, int, boolean, datetime, uri, object } from '../../../../src/core/pod-table';

describe('TripleBuilder', () => {
  // 测试用表定义
  const usersTable = podTable('users', {
    id: string('id').primaryKey(),
    name: string('name').predicate('https://schema.org/name'),
    age: int('age').predicate('https://schema.org/age'),
    active: boolean('active').predicate('https://schema.org/active'),
    createdAt: datetime('createdAt').predicate('https://schema.org/dateCreated'),
  }, {
    base: '/data/users/',
    type: 'https://schema.org/Person',
    namespace: { prefix: 'schema', uri: 'https://schema.org/' },
  });

  describe('buildTypeTriple', () => {
    it('should build rdf:type triple', () => {
      const triple = tripleBuilder.buildTypeTriple(
        'https://pod.example/data/users/alice.ttl',
        'https://schema.org/Person'
      );

      expect(triple.subject.termType).toBe('NamedNode');
      expect(triple.subject.value).toBe('https://pod.example/data/users/alice.ttl');
      expect(triple.predicate.value).toBe('http://www.w3.org/1999/02/22-rdf-syntax-ns#type');
      expect(triple.object.value).toBe('https://schema.org/Person');
    });
  });

  describe('buildInsert - basic types', () => {
    it('should build string triple', () => {
      const result = tripleBuilder.buildInsert(
        'https://pod.example/users/alice',
        usersTable.columns.name,
        'Alice',
        usersTable
      );

      expect(result.triples).toHaveLength(1);
      expect(result.triples[0].object.termType).toBe('Literal');
      expect(result.triples[0].object.value).toBe('Alice');
    });

    it('should build integer triple', () => {
      const result = tripleBuilder.buildInsert(
        'https://pod.example/users/alice',
        usersTable.columns.age,
        30,
        usersTable
      );

      expect(result.triples).toHaveLength(1);
      expect(result.triples[0].object.value).toBe('30');
      expect(result.triples[0].object.datatype?.value).toContain('integer');
    });

    it('should build boolean triple', () => {
      const result = tripleBuilder.buildInsert(
        'https://pod.example/users/alice',
        usersTable.columns.active,
        true,
        usersTable
      );

      expect(result.triples).toHaveLength(1);
      expect(result.triples[0].object.value).toBe('true');
      expect(result.triples[0].object.datatype?.value).toContain('boolean');
    });

    it('should build datetime triple', () => {
      const date = new Date('2025-01-15T10:30:00Z');
      const result = tripleBuilder.buildInsert(
        'https://pod.example/users/alice',
        usersTable.columns.createdAt,
        date,
        usersTable
      );

      expect(result.triples).toHaveLength(1);
      expect(result.triples[0].object.value).toBe('2025-01-15T10:30:00.000Z');
      expect(result.triples[0].object.datatype?.value).toContain('dateTime');
    });
  });

  describe('buildInsert - URI type', () => {
    const tableWithUri = podTable('links', {
      id: string('id').primaryKey(),
      homepage: uri('homepage').predicate('https://schema.org/url'),
    }, {
      base: '/data/links/',
      type: 'https://schema.org/WebPage',
    });

    it('should build URI as NamedNode', () => {
      const result = tripleBuilder.buildInsert(
        'https://pod.example/links/1',
        tableWithUri.columns.homepage,
        'https://example.org/page',
        tableWithUri
      );

      expect(result.triples).toHaveLength(1);
      expect(result.triples[0].object.termType).toBe('NamedNode');
      expect(result.triples[0].object.value).toBe('https://example.org/page');
    });

    it('should throw for invalid URI', () => {
      expect(() => {
        tripleBuilder.buildInsert(
          'https://pod.example/links/1',
          tableWithUri.columns.homepage,
          'not-a-valid-uri',
          tableWithUri
        );
      }).toThrow('URI column requires valid HTTP(S) URL');
    });
  });

  describe('buildInsert - Array type', () => {
    const tableWithArray = podTable('posts', {
      id: string('id').primaryKey(),
      tags: string('tags').predicate('https://schema.org/keywords').array(),
    }, {
      base: '/data/posts/',
      type: 'https://schema.org/BlogPosting',
    });

    it('should build multiple triples for array', () => {
      const result = tripleBuilder.buildInsert(
        'https://pod.example/posts/1',
        tableWithArray.columns.tags,
        ['tech', 'solid', 'rdf'],
        tableWithArray
      );

      expect(result.triples).toHaveLength(3);
      expect(result.triples[0].object.value).toBe('tech');
      expect(result.triples[1].object.value).toBe('solid');
      expect(result.triples[2].object.value).toBe('rdf');
    });

    it('should handle comma-separated string as array', () => {
      const result = tripleBuilder.buildInsert(
        'https://pod.example/posts/1',
        tableWithArray.columns.tags,
        'tech, solid, rdf',
        tableWithArray
      );

      expect(result.triples).toHaveLength(3);
    });
  });

  describe('buildInsert - Inverse type', () => {
    const tableWithInverse = podTable('comments', {
      id: string('id').primaryKey(),
      author: string('author').predicate('https://schema.org/author').inverse(),
    }, {
      base: '/data/comments/',
      type: 'https://schema.org/Comment',
    });

    it('should swap subject and object for inverse', () => {
      const result = tripleBuilder.buildInsert(
        'https://pod.example/comments/1',
        tableWithInverse.columns.author,
        'https://pod.example/users/alice',
        tableWithInverse
      );

      expect(result.triples).toHaveLength(1);
      // 逆向: <author> <predicate> <comment>
      expect(result.triples[0].subject.value).toBe('https://pod.example/users/alice');
      expect(result.triples[0].object.value).toBe('https://pod.example/comments/1');
    });
  });

  describe('buildInsert - Inline object', () => {
    const tableWithInline = podTable('people', {
      id: string('id').primaryKey(),
      address: object('address').predicate('https://schema.org/address'),
    }, {
      base: '/data/people/',
      type: 'https://schema.org/Person',
      namespace: { prefix: 'schema', uri: 'https://schema.org/' },
    });

    it('should build parent-child reference and child triples', () => {
      const result = tripleBuilder.buildInsert(
        'https://pod.example/people/alice.ttl',
        tableWithInline.columns.address,
        { street: '123 Main St', city: 'Boston' },
        tableWithInline
      );

      // 父→子引用
      expect(result.triples).toHaveLength(1);
      expect(result.triples[0].predicate.value).toBe('https://schema.org/address');
      expect(result.triples[0].object.termType).toBe('NamedNode');

      // 子对象属性
      expect(result.childTriples).toBeDefined();
      expect(result.childTriples!.length).toBeGreaterThanOrEqual(2);
    });

    it('should generate fragment URI for inline child', () => {
      const result = tripleBuilder.buildInsert(
        'https://pod.example/people/alice.ttl',
        tableWithInline.columns.address,
        { street: '123 Main St' },
        tableWithInline
      );

      const childUri = result.triples[0].object.value;
      expect(childUri).toContain('#address-');
    });

    it('should use explicit id from inline object', () => {
      const result = tripleBuilder.buildInsert(
        'https://pod.example/people/alice.ttl',
        tableWithInline.columns.address,
        { id: 'https://pod.example/addresses/1', street: '123 Main St' },
        tableWithInline
      );

      const childUri = result.triples[0].object.value;
      expect(childUri).toBe('https://pod.example/addresses/1');
    });
  });

  describe('buildDelete', () => {
    it('should build delete triple with variable', () => {
      const result = tripleBuilder.buildDelete(
        'https://pod.example/users/alice',
        usersTable.columns.name,
        usersTable
      );

      expect(result.triples).toHaveLength(1);
      expect(result.triples[0].object.termType).toBe('Variable');
      expect(result.triples[0].object.value).toBe('old_name');
    });

    it('should swap for inverse delete', () => {
      const tableWithInverse = podTable('comments', {
        id: string('id').primaryKey(),
        author: string('author').predicate('https://schema.org/author').inverse(),
      }, {
        base: '/data/comments/',
        type: 'https://schema.org/Comment',
      });

      const result = tripleBuilder.buildDelete(
        'https://pod.example/comments/1',
        tableWithInverse.columns.author,
        tableWithInverse
      );

      expect(result.triples[0].subject.termType).toBe('Variable');
      expect(result.triples[0].object.value).toBe('https://pod.example/comments/1');
    });
  });

  describe('toN3Strings', () => {
    it('should convert triples to N3 format', () => {
      const triples = [
        {
          subject: { termType: 'NamedNode' as const, value: 'https://example.org/s' },
          predicate: { termType: 'NamedNode' as const, value: 'https://example.org/p' },
          object: { termType: 'Literal' as const, value: 'hello' },
        },
      ];

      const n3Strings = tripleBuilder.toN3Strings(triples);

      expect(n3Strings).toHaveLength(1);
      expect(n3Strings[0]).toBe('<https://example.org/s> <https://example.org/p> "hello" .');
    });

    it('should handle variables', () => {
      const triples = [
        {
          subject: { termType: 'NamedNode' as const, value: 'https://example.org/s' },
          predicate: { termType: 'NamedNode' as const, value: 'https://example.org/p' },
          object: { termType: 'Variable' as const, value: 'obj' },
        },
      ];

      const n3Strings = tripleBuilder.toN3Strings(triples);

      expect(n3Strings[0]).toContain('?obj');
    });

    it('should handle typed literals', () => {
      const triples = [
        {
          subject: { termType: 'NamedNode' as const, value: 'https://example.org/s' },
          predicate: { termType: 'NamedNode' as const, value: 'https://example.org/p' },
          object: {
            termType: 'Literal' as const,
            value: 'true',
            datatype: { termType: 'NamedNode' as const, value: 'http://www.w3.org/2001/XMLSchema#boolean' },
          },
        },
      ];

      const n3Strings = tripleBuilder.toN3Strings(triples);

      expect(n3Strings[0]).toContain('^^<http://www.w3.org/2001/XMLSchema#boolean>');
    });
  });

  describe('buildN3Patch', () => {
    it('should build insert-only patch', () => {
      const patch = tripleBuilder.buildN3Patch(
        [],
        ['<https://example.org/s> <https://example.org/p> "value" .'],
        []
      );

      expect(patch).toContain('@prefix solid:');
      expect(patch).toContain('solid:InsertDeletePatch');
      expect(patch).toContain('solid:insert');
      expect(patch).not.toContain('solid:delete');
    });

    it('should build delete-insert patch with where', () => {
      const patch = tripleBuilder.buildN3Patch(
        ['<https://example.org/s> <https://example.org/p> ?old .'],
        ['<https://example.org/s> <https://example.org/p> "new" .'],
        ['<https://example.org/s> <https://example.org/p> ?old .']
      );

      expect(patch).toContain('solid:delete');
      expect(patch).toContain('solid:insert');
      expect(patch).toContain('solid:where');
    });
  });

  describe('getPredicateUri', () => {
    it('should return explicit predicate', () => {
      const uri = tripleBuilder.getPredicateUri(usersTable.columns.name, usersTable);
      expect(uri).toBe('https://schema.org/name');
    });

    it('should use namespace for column without explicit predicate', () => {
      const tableWithNs = podTable('test', {
        id: string('id').primaryKey(),
        foo: string('foo'), // 没有显式 predicate
      }, {
        base: '/data/test/',
        type: 'https://example.org/Test',
        namespace: { prefix: 'ex', uri: 'https://example.org/' },
      });

      const uri = tripleBuilder.getPredicateUri(tableWithNs.columns.foo, tableWithNs);
      expect(uri).toBe('https://example.org/foo');
    });
  });

  describe('formatValue', () => {
    it('should format string value', () => {
      const result = tripleBuilder.formatValue('hello', usersTable.columns.name);
      expect(result).toBe('"hello"');
    });

    it('should format integer value', () => {
      const result = tripleBuilder.formatValue(42, usersTable.columns.age);
      expect(result).toBe('42');
    });

    it('should format URI value', () => {
      const result = tripleBuilder.formatValue('https://example.org', undefined);
      expect(result).toBe('<https://example.org>');
    });

    it('should escape quotes in string', () => {
      const result = tripleBuilder.formatValue('hello "world"', usersTable.columns.name);
      expect(result).toBe('"hello \\"world\\""');
    });
  });
});
