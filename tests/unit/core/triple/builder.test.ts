/**
 * TripleBuilder Unit Tests
 */

import { tripleBuilder, TripleBuilderImpl } from '../../../../src/core/triple';
import { podTable, string, int, boolean, datetime, uri, object } from '../../../../src/core/schema';

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
      }).toThrow(/Cannot resolve URI/);
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

  describe('URI auto-completion with tableRegistry', () => {
    // 定义测试用的表
    const personsTable = podTable('persons', {
      id: string('id').primaryKey(),
      name: string('name').predicate('https://schema.org/name'),
    }, {
      base: 'https://pod.example/data/persons/',
      type: 'https://schema.org/Person',
    });

    const messagesTable = podTable('messages', {
      id: string('id').primaryKey(),
      content: string('content').predicate('https://schema.org/text'),
      author: uri('author')
        .predicate('https://schema.org/author')
        .reference('https://schema.org/Person'),
    }, {
      base: 'https://pod.example/data/messages/',
      type: 'https://schema.org/Message',
    });

    it('should resolve relative URI using tableRegistry', () => {
      const builder = new TripleBuilderImpl();
      
      // 设置 tableRegistry（classRegistry 和 nameRegistry）
      const classRegistry = new Map<string, any[]>();
      classRegistry.set('https://schema.org/Person', [personsTable]);
      classRegistry.set('https://schema.org/Message', [messagesTable]);
      
      const nameRegistry = new Map<string, any>();
      nameRegistry.set('persons', personsTable);
      nameRegistry.set('messages', messagesTable);
      
      builder.setTableRegistry(classRegistry, nameRegistry);
      
      // 构建三元组时，'alice' 应该被补全为完整 URI
      const result = builder.buildInsert(
        'https://pod.example/data/messages/msg1',
        messagesTable.columns.author,
        'alice',
        messagesTable
      );

      expect(result.triples).toHaveLength(1);
      expect(result.triples[0].object.termType).toBe('NamedNode');
      // 应该被补全为 https://pod.example/data/persons/alice
      expect(result.triples[0].object.value).toContain('https://pod.example/data/persons/');
      expect(result.triples[0].object.value).toContain('alice');
    });

    it('should pass through absolute URIs unchanged', () => {
      const builder = new TripleBuilderImpl();
      
      const classRegistry = new Map<string, any[]>();
      classRegistry.set('https://schema.org/Person', [personsTable]);
      const nameRegistry = new Map<string, any>();
      nameRegistry.set('persons', personsTable);
      
      builder.setTableRegistry(classRegistry, nameRegistry);
      
      const result = builder.buildInsert(
        'https://pod.example/data/messages/msg1',
        messagesTable.columns.author,
        'https://other.pod/users/bob#me',
        messagesTable
      );

      expect(result.triples[0].object.value).toBe('https://other.pod/users/bob#me');
    });

    it('should throw error when tableRegistry is missing for reference', () => {
      const builder = new TripleBuilderImpl();
      
      // 没有设置 tableRegistry
      expect(() => {
        builder.buildInsert(
          'https://pod.example/data/messages/msg1',
          messagesTable.columns.author,
          'alice', // 相对 URI，无法补全
          messagesTable
        );
      }).toThrow(/Cannot resolve URI/);
    });
  });

  describe('Multi-table ambiguity handling', () => {
    // 同一个 class 定义了两个表 - Document Mode
    const usersTable1 = podTable('users_internal', {
      id: string('id').primaryKey(),
      name: string('name').predicate('https://schema.org/name'),
    }, {
      base: 'https://pod.example/data/internal/users/',
      type: 'https://schema.org/Person',
      subjectTemplate: '{id}',  // Document Mode without extension
    });

    const usersTable2 = podTable('users_public', {
      id: string('id').primaryKey(),
      name: string('name').predicate('https://schema.org/name'),
    }, {
      base: 'https://pod.example/data/public/users/',
      type: 'https://schema.org/Person', // 同一个 class
      subjectTemplate: '{id}',  // Document Mode without extension
    });

    // 引用 Person 的消息表（使用 class URI）
    const messagesTable = podTable('messages', {
      id: string('id').primaryKey(),
      author: uri('author')
        .predicate('https://schema.org/author')
        .reference('https://schema.org/Person'),
    }, {
      base: 'https://pod.example/data/messages/',
      type: 'https://schema.org/Message',
      subjectTemplate: '{id}.ttl',
    });

    // 使用表名字符串明确指定表
    const messagesTableWithTableName = podTable('messages_with_tablename', {
      id: string('id').primaryKey(),
      author: uri('author')
        .predicate('https://schema.org/author')
        .reference('users_public'), // 表名字符串（非 URL 格式）
    }, {
      base: 'https://pod.example/data/messages_tablename/',
      type: 'https://schema.org/Message',
      subjectTemplate: '{id}.ttl',
    });

    // 使用表对象直接引用（注意：这里 usersTable2 必须在之前定义）
    const messagesTableWithTableObj = podTable('messages_with_tableobj', {
      id: string('id').primaryKey(),
      author: uri('author')
        .predicate('https://schema.org/author')
        .reference(usersTable2), // 直接传表对象
    }, {
      base: 'https://pod.example/data/messages_tableobj/',
      type: 'https://schema.org/Message',
    });

    it('should throw ambiguity error when same class has multiple tables', () => {
      const builder = new TripleBuilderImpl();
      
      // 同一个 class 对应多个表
      const classRegistry = new Map<string, any[]>();
      classRegistry.set('https://schema.org/Person', [usersTable1, usersTable2]);
      classRegistry.set('https://schema.org/Message', [messagesTable]);
      
      const nameRegistry = new Map<string, any>();
      nameRegistry.set('users_internal', usersTable1);
      nameRegistry.set('users_public', usersTable2);
      nameRegistry.set('messages', messagesTable);
      
      builder.setTableRegistry(classRegistry, nameRegistry);
      
      // 使用 reference(class) 但 class 有多个表，应该抛出歧义错误
      expect(() => {
        builder.buildInsert(
          'https://pod.example/data/messages/msg1',
          messagesTable.columns.author,
          'alice',
          messagesTable
        );
      }).toThrow(/Ambiguous reference.*multiple tables/);
    });

    it('should resolve using table name string when class is ambiguous', () => {
      const builder = new TripleBuilderImpl();
      
      // 同一个 class 对应多个表
      const classRegistry = new Map<string, any[]>();
      classRegistry.set('https://schema.org/Person', [usersTable1, usersTable2]);
      classRegistry.set('https://schema.org/Message', [messagesTableWithTableName]);
      
      const nameRegistry = new Map<string, any>();
      nameRegistry.set('users_internal', usersTable1);
      nameRegistry.set('users_public', usersTable2);
      nameRegistry.set('messages_with_tablename', messagesTableWithTableName);
      
      builder.setTableRegistry(classRegistry, nameRegistry);
      
      // 使用 reference('users_public') 表名字符串
      const result = builder.buildInsert(
        'https://pod.example/data/messages_tablename/msg1',
        messagesTableWithTableName.columns.author,
        'alice',
        messagesTableWithTableName
      );

      expect(result.triples).toHaveLength(1);
      expect(result.triples[0].object.termType).toBe('NamedNode');
      // 应该使用 users_public 表的 base
      expect(result.triples[0].object.value).toBe('https://pod.example/data/public/users/alice');
    });

    it('should resolve using table object directly', () => {
      const builder = new TripleBuilderImpl();
      
      // 使用表对象直接引用，不需要 registry
      const result = builder.buildInsert(
        'https://pod.example/data/messages_tableobj/msg1',
        messagesTableWithTableObj.columns.author,
        'bob',
        messagesTableWithTableObj
      );

      expect(result.triples).toHaveLength(1);
      expect(result.triples[0].object.termType).toBe('NamedNode');
      // 应该使用 usersTable2 的 base
      expect(result.triples[0].object.value).toBe('https://pod.example/data/public/users/bob');
    });

    it('should throw error when table name not found in registry', () => {
      const builder = new TripleBuilderImpl();
      
      const messagesTableWithBadRef = podTable('messages_bad', {
        id: string('id').primaryKey(),
        author: uri('author')
          .predicate('https://schema.org/author')
          .reference('non_existent_table'), // 不存在的表名
      }, {
        base: 'https://pod.example/data/messages_bad/',
        type: 'https://schema.org/Message',
      });

      const classRegistry = new Map<string, any[]>();
      classRegistry.set('https://schema.org/Person', [usersTable1]);
      
      const nameRegistry = new Map<string, any>();
      nameRegistry.set('users_internal', usersTable1);
      
      builder.setTableRegistry(classRegistry, nameRegistry);
      
      expect(() => {
        builder.buildInsert(
          'https://pod.example/data/messages_bad/msg1',
          messagesTableWithBadRef.columns.author,
          'alice',
          messagesTableWithBadRef
        );
      }).toThrow(/table "non_existent_table" not found/);
    });

    it('should work when class has single table (no ambiguity)', () => {
      const builder = new TripleBuilderImpl();
      
      // class 只对应一个表
      const classRegistry = new Map<string, any[]>();
      classRegistry.set('https://schema.org/Person', [usersTable1]); // 只有一个表
      classRegistry.set('https://schema.org/Message', [messagesTable]);
      
      const nameRegistry = new Map<string, any>();
      nameRegistry.set('users_internal', usersTable1);
      nameRegistry.set('messages', messagesTable);
      
      builder.setTableRegistry(classRegistry, nameRegistry);
      
      // 应该正常工作，使用唯一的表
      const result = builder.buildInsert(
        'https://pod.example/data/messages/msg1',
        messagesTable.columns.author,
        'bob',
        messagesTable
      );

      expect(result.triples).toHaveLength(1);
      expect(result.triples[0].object.value).toBe('https://pod.example/data/internal/users/bob');
    });
  });

  describe('URI resolution with subjectTemplate (fragment modes)', () => {
    // 测试 Document Mode: {id}.ttl
    const usersDocMode = podTable('users_doc', {
      id: string('id').primaryKey(),
      name: string('name').predicate('https://schema.org/name'),
    }, {
      base: 'https://pod.example/data/users/',
      type: 'https://schema.org/Person',
      subjectTemplate: '{id}.ttl',  // Document Mode - 无 fragment
    });

    // 测试 Document Mode with #it: {id}.ttl#it
    const usersDocWithIt = podTable('users_doc_it', {
      id: string('id').primaryKey(),
      name: string('name').predicate('https://schema.org/name'),
    }, {
      base: 'https://pod.example/data/users-it/',
      type: 'https://schema.org/Person',
      subjectTemplate: '{id}.ttl#it',  // Document Mode with #it fragment
    });

    // 测试 Document Mode with #me: {id}.ttl#me
    const usersDocWithMe = podTable('users_doc_me', {
      id: string('id').primaryKey(),
      name: string('name').predicate('https://schema.org/name'),
    }, {
      base: 'https://pod.example/data/users-me/',
      type: 'https://schema.org/Person',
      subjectTemplate: '{id}.ttl#me',  // Document Mode with #me fragment
    });

    // 测试 Fragment Mode: #{id}
    const usersFragmentMode = podTable('users_fragment', {
      id: string('id').primaryKey(),
      name: string('name').predicate('https://schema.org/name'),
    }, {
      base: 'https://pod.example/data/users.ttl',  // 单文件
      type: 'https://schema.org/Person',
      subjectTemplate: '#{id}',  // Fragment Mode
    });

    // 引用不同模式用户表的消息表
    const messagesRefDoc = podTable('messages_ref_doc', {
      id: string('id').primaryKey(),
      author: uri('author')
        .predicate('https://schema.org/author')
        .reference('users_doc'),
    }, {
      base: 'https://pod.example/data/messages/',
      type: 'https://schema.org/Message',
    });

    const messagesRefIt = podTable('messages_ref_it', {
      id: string('id').primaryKey(),
      author: uri('author')
        .predicate('https://schema.org/author')
        .reference('users_doc_it'),
    }, {
      base: 'https://pod.example/data/messages/',
      type: 'https://schema.org/Message',
    });

    const messagesRefMe = podTable('messages_ref_me', {
      id: string('id').primaryKey(),
      author: uri('author')
        .predicate('https://schema.org/author')
        .reference('users_doc_me'),
    }, {
      base: 'https://pod.example/data/messages/',
      type: 'https://schema.org/Message',
    });

    const messagesRefFragment = podTable('messages_ref_fragment', {
      id: string('id').primaryKey(),
      author: uri('author')
        .predicate('https://schema.org/author')
        .reference('users_fragment'),
    }, {
      base: 'https://pod.example/data/messages/',
      type: 'https://schema.org/Message',
    });

    it('should resolve URI with Document Mode subjectTemplate ({id}.ttl)', () => {
      const builder = new TripleBuilderImpl();
      
      const classRegistry = new Map<string, any[]>();
      classRegistry.set('https://schema.org/Person', [usersDocMode]);
      
      const nameRegistry = new Map<string, any>();
      nameRegistry.set('users_doc', usersDocMode);
      nameRegistry.set('messages_ref_doc', messagesRefDoc);
      
      builder.setTableRegistry(classRegistry, nameRegistry);
      
      const result = builder.buildInsert(
        'https://pod.example/data/messages/msg1',
        messagesRefDoc.columns.author,
        'alice',
        messagesRefDoc
      );

      expect(result.triples).toHaveLength(1);
      expect(result.triples[0].object.termType).toBe('NamedNode');
      // Document Mode: baseUrl + id + '.ttl'
      expect(result.triples[0].object.value).toBe('https://pod.example/data/users/alice.ttl');
    });

    it('should resolve URI with #it fragment subjectTemplate ({id}.ttl#it)', () => {
      const builder = new TripleBuilderImpl();
      
      const classRegistry = new Map<string, any[]>();
      classRegistry.set('https://schema.org/Person', [usersDocWithIt]);
      
      const nameRegistry = new Map<string, any>();
      nameRegistry.set('users_doc_it', usersDocWithIt);
      nameRegistry.set('messages_ref_it', messagesRefIt);
      
      builder.setTableRegistry(classRegistry, nameRegistry);
      
      const result = builder.buildInsert(
        'https://pod.example/data/messages/msg1',
        messagesRefIt.columns.author,
        'alice',
        messagesRefIt
      );

      expect(result.triples).toHaveLength(1);
      expect(result.triples[0].object.termType).toBe('NamedNode');
      // Document Mode with #it: baseUrl + id + '.ttl#it'
      expect(result.triples[0].object.value).toBe('https://pod.example/data/users-it/alice.ttl#it');
    });

    it('should resolve URI with #me fragment subjectTemplate ({id}.ttl#me)', () => {
      const builder = new TripleBuilderImpl();
      
      const classRegistry = new Map<string, any[]>();
      classRegistry.set('https://schema.org/Person', [usersDocWithMe]);
      
      const nameRegistry = new Map<string, any>();
      nameRegistry.set('users_doc_me', usersDocWithMe);
      nameRegistry.set('messages_ref_me', messagesRefMe);
      
      builder.setTableRegistry(classRegistry, nameRegistry);
      
      const result = builder.buildInsert(
        'https://pod.example/data/messages/msg1',
        messagesRefMe.columns.author,
        'bob',
        messagesRefMe
      );

      expect(result.triples).toHaveLength(1);
      expect(result.triples[0].object.termType).toBe('NamedNode');
      // Document Mode with #me: baseUrl + id + '.ttl#me'
      expect(result.triples[0].object.value).toBe('https://pod.example/data/users-me/bob.ttl#me');
    });

    it('should resolve URI with Fragment Mode subjectTemplate (#{id})', () => {
      const builder = new TripleBuilderImpl();
      
      const classRegistry = new Map<string, any[]>();
      classRegistry.set('https://schema.org/Person', [usersFragmentMode]);
      
      const nameRegistry = new Map<string, any>();
      nameRegistry.set('users_fragment', usersFragmentMode);
      nameRegistry.set('messages_ref_fragment', messagesRefFragment);
      
      builder.setTableRegistry(classRegistry, nameRegistry);
      
      const result = builder.buildInsert(
        'https://pod.example/data/messages/msg1',
        messagesRefFragment.columns.author,
        'charlie',
        messagesRefFragment
      );

      expect(result.triples).toHaveLength(1);
      expect(result.triples[0].object.termType).toBe('NamedNode');
      // Fragment Mode: base (去掉尾部/) + '#' + id
      expect(result.triples[0].object.value).toBe('https://pod.example/data/users.ttl#charlie');
    });

    it('should resolve UUID with #it fragment correctly', () => {
      const builder = new TripleBuilderImpl();
      
      const classRegistry = new Map<string, any[]>();
      classRegistry.set('https://schema.org/Person', [usersDocWithIt]);
      
      const nameRegistry = new Map<string, any>();
      nameRegistry.set('users_doc_it', usersDocWithIt);
      nameRegistry.set('messages_ref_it', messagesRefIt);
      
      builder.setTableRegistry(classRegistry, nameRegistry);
      
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const result = builder.buildInsert(
        'https://pod.example/data/messages/msg1',
        messagesRefIt.columns.author,
        uuid,
        messagesRefIt
      );

      expect(result.triples).toHaveLength(1);
      expect(result.triples[0].object.termType).toBe('NamedNode');
      // UUID with #it: baseUrl + uuid + '.ttl#it'
      expect(result.triples[0].object.value).toBe(`https://pod.example/data/users-it/${uuid}.ttl#it`);
    });

    it('should pass through absolute URIs regardless of subjectTemplate', () => {
      const builder = new TripleBuilderImpl();
      
      const classRegistry = new Map<string, any[]>();
      classRegistry.set('https://schema.org/Person', [usersDocWithIt]);
      
      const nameRegistry = new Map<string, any>();
      nameRegistry.set('users_doc_it', usersDocWithIt);
      nameRegistry.set('messages_ref_it', messagesRefIt);
      
      builder.setTableRegistry(classRegistry, nameRegistry);
      
      // 传入完整的 URI
      const absoluteUri = 'https://other.pod/users/dave#me';
      const result = builder.buildInsert(
        'https://pod.example/data/messages/msg1',
        messagesRefIt.columns.author,
        absoluteUri,
        messagesRefIt
      );

      expect(result.triples).toHaveLength(1);
      expect(result.triples[0].object.termType).toBe('NamedNode');
      // 完整 URI 应该直接使用，不做任何修改
      expect(result.triples[0].object.value).toBe(absoluteUri);
    });

    it('should use direct table reference with subjectTemplate', () => {
      const builder = new TripleBuilderImpl();
      
      // 使用直接表引用的消息表
      const messagesDirectRef = podTable('messages_direct_ref', {
        id: string('id').primaryKey(),
        author: uri('author')
          .predicate('https://schema.org/author')
          .reference(usersDocWithIt),  // 直接引用表对象
      }, {
        base: 'https://pod.example/data/messages/',
        type: 'https://schema.org/Message',
      });
      
      // 不需要 registry，因为是直接引用表对象
      const result = builder.buildInsert(
        'https://pod.example/data/messages/msg1',
        messagesDirectRef.columns.author,
        'eve',
        messagesDirectRef
      );

      expect(result.triples).toHaveLength(1);
      expect(result.triples[0].object.termType).toBe('NamedNode');
      // 应该使用 usersDocWithIt 表的 base 和 subjectTemplate
      expect(result.triples[0].object.value).toBe('https://pod.example/data/users-it/eve.ttl#it');
    });
  });
});
