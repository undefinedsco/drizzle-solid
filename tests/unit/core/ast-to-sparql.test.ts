import { describe, it, expect, beforeEach } from 'vitest';
import { ASTToSPARQLConverter } from '@src/core/ast-to-sparql';
import { podTable, string } from '@src/core/pod-table';
import { podTable, string } from '@src/core/pod-table';
import { eq, and, inArray, isNull, regex as regexCond } from '@src/core/query-conditions';
import { subjectResolver } from '@src/core/subject';

// Mock PodTable
const mockTable = {
  _: {
    name: 'users',
    schema: {},
    columns: {
      id: { name: 'id', dataType: 'integer' },
      name: { name: 'name', dataType: 'string' },
      email: { name: 'email', dataType: 'string' },
      organization: { name: 'organization', dataType: 'string' }
    }
  },
  columns: {
    id: { 
      name: 'id', 
      dataType: 'integer',
      options: { required: true },
      getPredicate: (namespace: { uri: string }) => `${namespace.uri}identifier`,
      isReference: () => false
    },
    name: { 
      name: 'name', 
      dataType: 'string',
      options: { required: true },
      getPredicate: (namespace: { uri: string }) => `${namespace.uri}name`,
      isReference: () => false
    },
    email: { 
      name: 'email', 
      dataType: 'string',
      options: { required: false },
      getPredicate: (namespace: { uri: string }) => `${namespace.uri}email`,
      isReference: () => false
    },
    organization: {
      name: 'organization',
      dataType: 'string',
      options: { required: false, inverse: true, referenceTarget: 'https://schema.org/Organization' },
      getPredicate: () => 'https://schema.org/member',
      isReference: () => true
    }
  },
  config: {
    name: 'users',
    base: '/users/index.ttl',
    type: 'https://schema.org/Person',
    namespace: { prefix: 'schema', uri: 'https://schema.org/' },
    typeIndex: 'private'
  },
  getContainerPath: () => '/data/',
  getRdfClass: () => 'https://schema.org/Person',
  getNamespace: () => ({ prefix: 'schema', uri: 'https://schema.org/' }),
  getColumns: () => ({
    id: { name: 'id', dataType: 'integer' },
    name: { name: 'name', dataType: 'string' },
    email: { name: 'email', dataType: 'string' },
    organization: { name: 'organization', dataType: 'string' }
  })
} as any; 

describe('ASTToSPARQLConverter', () => {
  let converter: ASTToSPARQLConverter;
  const podUrl = 'https://example.com';

  beforeEach(() => {
    converter = new ASTToSPARQLConverter(podUrl);
    // Ensure subjectResolver uses the same podUrl
    subjectResolver.setPodUrl(podUrl);
  });

  describe('convertSelectPlan', () => {
    it('应该使用 IR 计划生成 SELECT 查询', () => {
      const condition = eq(mockTable.columns.name, 'Alice');
      const plan = {
        baseTable: mockTable,
        baseAlias: 'users',
        select: undefined,
        selectAll: true,
        where: undefined,
        conditionTree: condition,
        joins: undefined,
        joinFilters: undefined,
        groupBy: undefined,
        orderBy: undefined,
        distinct: false,
        limit: undefined,
        offset: undefined,
        aliasToTable: new Map<string, any>([['users', mockTable]]),
        tableToAlias: new Map<any, string>([[mockTable, 'users']])
      } as any;

      const result = converter.convertSelectPlan(plan);
      expect(result.type).toBe('SELECT');
      expect(result.query).toContain('FILTER');
      expect(result.query).toContain('Alice');
    });

    it('应该遵循 IR 计划中的 select/order/limit', () => {
      const condition = eq(mockTable.columns.name, 'Alice');
      const plan = {
        baseTable: mockTable,
        baseAlias: 'users',
        select: {
          userName: mockTable.columns.name
        },
        selectAll: false,
        where: undefined,
        conditionTree: condition,
        joins: undefined,
        joinFilters: undefined,
        groupBy: undefined,
        orderBy: [{
          column: 'name',
          rawColumn: 'name',
          direction: 'desc'
        }],
        distinct: true,
        limit: 5,
        offset: 2,
        aliasToTable: new Map<string, any>([['users', mockTable]]),
        tableToAlias: new Map<any, string>([[mockTable, 'users']])
      } as any;

      const result = converter.convertSelectPlan(plan);
      expect(result.query).toContain('DISTINCT');
      expect(result.query).toContain('LIMIT 5');
      expect(result.query).toContain('OFFSET 2');
      expect(result.query).toContain('SELECT DISTINCT ?subject (?name AS ?userName)');
      expect(result.query).toContain('ORDER BY DESC (?name)');
      expect(result.query).toContain('FILTER(?name = "Alice")');
    });
  });

  describe('构造函数', () => {
    it('应该正确初始化转换器', () => {
      expect(converter).toBeDefined();
    });
  });

  describe('convertSelect', () => {
    it('应该转换简单的 SELECT 查询', () => {
      const ast = { where: {} };
      const result = converter.convertSelect(ast, mockTable);
      
      expect(result).toBeDefined();
      expect(result.type).toBe('SELECT');
      expect(result.query).toContain('SELECT');
      expect(result.query).toContain('WHERE');
      expect(result.prefixes).toBeDefined();
    });

    it('应该包含正确的命名空间前缀', () => {
      const ast = { where: {} };
      const result = converter.convertSelect(ast, mockTable);
      
      expect(result.query).toContain('PREFIX rdf:');
      expect(result.query).toContain('PREFIX schema:');
    });

    it('应该生成正确的 RDF 类型查询', () => {
      const ast = { where: {} };
      const result = converter.convertSelect(ast, mockTable);
      
      expect(result.query).toContain('rdf:type');
      expect(result.query).toContain('schema:Person');
    });

    it('应该支持 QueryCondition 等值过滤', () => {
      const condition = eq(mockTable.columns.name, 'John');
      const result = converter.convertSelect({ where: condition }, mockTable);

      expect(result.query).toContain('FILTER(?name = "John")');
    });

    it('应该支持逻辑组合和 IN 过滤', () => {
      const condition = and(
        inArray(mockTable.columns.name, ['Alice', 'Bob']),
        eq(mockTable.columns.email, 'alice@example.com')
      );
      const result = converter.convertSelect({ where: condition }, mockTable);

      expect(result.query).toContain('?name IN("Alice", "Bob")');
      expect(result.query).toContain('(?email = "alice@example.com")');
      expect(result.query).toContain('&&');
    });

    it('引用列上的 IN 过滤应该使用 NamedNode', () => {
      const condition = inArray(mockTable.columns.organization, [
        'https://org.example/a',
        'https://org.example/b'
      ]);
      const result = converter.convertSelect({ where: condition }, mockTable);

      expect(result.query).toContain('<https://org.example/a>');
      expect(result.query).toContain('<https://org.example/b>');
      expect(result.query).not.toContain('\"https://org.example/a\"');
    });

    it('应该支持 IS NULL 过滤', () => {
      const condition = isNull(mockTable.columns.email);
      const result = converter.convertSelect({ where: condition }, mockTable);

      expect(result.query).toContain('FILTER(!(BOUND(?email)))');
    });

    it('inverse 列应该反转三元组方向', () => {
      const result = converter.convertSelect({ where: {} }, mockTable);
      expect(result.query).toContain('?organization schema:member ?subject');
    });
  });

  describe('convertInsert', () => {
    it('应该转换 INSERT 查询', () => {
      const values = [{ name: 'John', email: 'john@example.com' }];
      const result = converter.convertInsert(values, mockTable);
      
      expect(result).toBeDefined();
      expect(result.type).toBe('INSERT');
      expect(result.query).toContain('INSERT DATA');
      expect(result.query).toContain('rdf:type');
    });

    it('应该为每个值生成正确的三元组', () => {
      const values = [{ name: 'John', email: 'john@example.com' }];
      const result = converter.convertInsert(values, mockTable);
      
      expect(result.query).toContain('"John"');
      expect(result.query).toContain('"john@example.com"');
    });

    it('inverse 列写入时应交换三元组主体和客体', () => {
      const values = [{ id: 'foo', organization: 'https://org.example/foo' }];
      const result = converter.convertInsert(values, mockTable);
      expect(result.query).toContain('<https://org.example/foo> schema:member <https://example.com/users/index.ttl#foo>');
    });

    it('应该支持 IR plan 输入', () => {
      const plan = {
        table: mockTable,
        rows: [{ name: 'Carol', email: 'carol@example.com' }]
      };
      const result = converter.convertInsert(plan);
      expect(result.query).toContain('"Carol"');
      expect(result.query).toContain('"carol@example.com"');
    });

    it('should include parent rdf:type triples when table declares subClassOf', () => {
      const parentClass = 'https://schema.org/Contact';
      const personTable = podTable('persons', {
        id: string('id').primaryKey().predicate('https://schema.org/identifier'),
        name: string('name').predicate('https://schema.org/name')
      }, {
        base: '/persons.ttl',
        type: 'https://schema.org/Person',
        subClassOf: parentClass
      });

      const insert = converter.convertInsert({ table: personTable, rows: [{ id: 'p-1', name: 'Alice' }] }, personTable);
      expect(insert.query).toContain('schema:Person');
      expect(insert.query).toContain('schema:Contact');
    });
  });

  describe('convertUpdate', () => {
    it('应该转换 UPDATE 查询', () => {
      const data = { name: 'Jane' };
      const where = { id: 1 };
      const result = converter.convertUpdate(data, where, mockTable);
      
      expect(result).toBeDefined();
      expect(result.type).toBe('UPDATE');
      expect(result.query).toContain('DELETE');
      expect(result.query).toContain('INSERT');
    });

    it('inverse 列更新应删除并插入反向三元组', () => {
      const data = { organization: 'https://org.example/new' };
      const where = { id: '2' };
      const result = converter.convertUpdate(data, where, mockTable);
      // Inverse columns should swap subject/object: ?var <pred> <subject> instead of <subject> <pred> ?var
      // sparqljs generator will use prefixes if available
      expect(result.query).toContain('?old_organization_0 schema:member <https://example.com/users/index.ttl#2>');
      expect(result.query).toContain('<https://org.example/new> schema:member <https://example.com/users/index.ttl#2>');
    });
  });

  describe('convertDelete', () => {
    it('应该转换 DELETE 查询', () => {
      const where = { id: 1 };
      const result = converter.convertDelete(where, mockTable);
      
      expect(result).toBeDefined();
      expect(result.type).toBe('DELETE');
      expect(result.query).toContain('DELETE WHERE');
    });
  });

  describe('generatePrefixes', () => {
    it('应该生成所有必要的命名空间前缀', () => {
      const prefixes = converter.getPrefixes();
      
      expect(prefixes).toHaveProperty('rdf');
      expect(prefixes).toHaveProperty('schema');
      expect(prefixes).toHaveProperty('ldp');
      expect(prefixes).toHaveProperty('foaf');
    });
  });

  describe('复杂查询测试', () => {
    it('应该处理没有指定列的 SELECT 查询', () => {
      const ast = {
        type: 'select',
        columns: '*' // 使用 * 表示所有列
      };

      const result = converter.convertSelect(ast, mockTable);

      expect(result.query).toContain('SELECT ?subject ?id ?name ?email ?organization');
    });

    it('应该处理复杂的 WHERE 条件', () => {
      const ast = {
        type: 'select',
        columns: ['id', 'name'],
        where: {
          type: 'binary_expr',
          left: { column: 'name' },
          operator: '=',
          right: { value: 'John Doe' }
        }
      };

      const result = converter.convertSelect(ast, mockTable);

      expect(result.query).toContain('FILTER(?name = "John Doe")');
    });

    it('应该处理 INSERT 查询', () => {
      const values = [
        { id: '1', name: 'John Doe', email: 'john@example.com' }
      ];

      const result = converter.convertInsert(values, mockTable);

      expect(result.query).toContain('INSERT DATA');
      expect(result.query).toContain('"John Doe"');
    });

    it('应该处理 UPDATE 查询', () => {
      const setData = { name: 'Jane Doe' };
      const whereConditions = {
        type: 'binary_expr',
        left: { column: 'id' },
        operator: '=',
        right: { value: '1' }
      };

      const result = converter.convertUpdate(setData, whereConditions, mockTable);

      expect(result.query).toContain('DELETE');
      expect(result.query).toContain('INSERT');
    });

    it('应该处理 DELETE 查询', () => {
      const whereConditions = {
        type: 'binary_expr',
        left: { column: 'id' },
        operator: '=',
        right: { value: '1' }
      };

      const result = converter.convertDelete(whereConditions, mockTable);

      expect(result.query).toContain('DELETE');
    });
  });

  describe('addPrefix 方法测试', () => {
    it('应该添加自定义前缀', () => {
      converter.addPrefix('custom', 'http://custom.org/');

      expect(converter['prefixes']['custom']).toBe('http://custom.org/');
    });
  });

  describe('@id 查询的 SPARQL 模式顺序', () => {
    it('应该在 @id 查询中注入 FILTER 约束', () => {
      const ast = {
        type: 'select',
        select: ['id', 'name', 'email'],
        where: eq('@id', 'https://example.com/profile/card#me')
      };

      const result = converter.convertSelect(ast, mockTable);

      // 检查生成的 SPARQL 查询
      expect(result.query).toContain('FILTER');
      expect(result.query).not.toContain('BIND(');
    });

    it('应该正确处理 subject 字段的过滤', () => {
      const ast = {
        type: 'select',
        select: ['id', 'name'],
        where: eq('subject', 'https://example.com/profile/card#me')
      };

      const result = converter.convertSelect(ast, mockTable);

      // 检查生成的 SPARQL 包含正确的 FILTER
      expect(result.query).toContain('FILTER');
      expect(result.query).toContain('https://example.com/profile/card#me');

      expect(result.query).not.toContain('BIND(');
    });

    it('应该正确构建包含类型约束和过滤器的 WHERE 子句', () => {
      const ast = {
        type: 'select',
        select: ['id', 'name', 'email'],
        where: and(
          eq('@id', 'https://example.com/users/123#user'),
          eq('name', 'John')
        )
      };

      const result = converter.convertSelect(ast, mockTable);

      // 应该包含类型约束
      expect(result.query).toContain('rdf:type');
      expect(result.query).toContain('schema:Person');

      // 应该包含 @id 过滤器
      expect(result.query).toContain('FILTER');
      expect(result.query).toContain('https://example.com/users/123#user');

      // 应该包含 name 过滤器
      expect(result.query).toContain('?name');

      expect(result.query).not.toContain('BIND(');
    });
  });

  describe('generateSubjectUri', () => {
    it('should resolve fragment ids against table base', () => {
      const subject = converter.generateSubjectUri({ id: '#me' }, mockTable);
      expect(subject).toBe('https://example.com/users/index.ttl#me');
    });

    it('should resolve simple identifiers against table base', () => {
      const subject = converter.generateSubjectUri({ id: 'profile' }, mockTable);
      expect(subject).toBe('https://example.com/users/index.ttl#profile');
    });

    it('should preserve absolute ids', () => {
      const absolute = 'https://pod.example.com/profile/card#me';
      const subject = converter.generateSubjectUri({ id: absolute }, mockTable);
      expect(subject).toBe(absolute);
    });
  });

  describe('regex conditions', () => {
    it('should build regex filter for regex condition', () => {
      const condition = regexCond(mockTable.columns.name as any, '^Search.*', 'i');
      const whereClause = converter.buildWhereClauseForCondition(condition, mockTable);
      expect(whereClause).toContain('REGEX(STR(?name), "^Search.*", "i")');
    });
  });

  describe('generateSubjectUri', () => {
    it('should not treat column named subject as explicit resource override', () => {
      const threadTable = podTable('threads', {
        id: string('id').primaryKey(),
        subject: string('subject')
      }, {
        base: '/drizzle-tests/data/threads.ttl',
        type: 'https://schema.org/Conversation',
        namespace: { prefix: 'schema', uri: 'https://schema.org/' }
      });

      const insert = converter.convertInsert({ table: threadTable, rows: [{
        id: 'thread-abc',
        subject: 'Thread Subject'
      }] }, threadTable);

      expect(insert.query).toContain('#thread-abc');
      expect(insert.query).not.toContain('<Thread Subject>');
    });
  });
});
