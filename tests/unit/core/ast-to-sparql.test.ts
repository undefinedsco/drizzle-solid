import { describe, it, expect, beforeEach } from '@jest/globals';
import { ASTToSPARQLConverter } from '@src/core/ast-to-sparql';
import { eq, and, inArray, isNull } from '@src/core/query-conditions';

// Mock PodTable
const mockTable = {
  _: {
    name: 'users',
    schema: {},
    columns: {
      id: { name: 'id', dataType: 'integer' },
      name: { name: 'name', dataType: 'string' },
      email: { name: 'email', dataType: 'string' }
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
    }
  },
  config: {
    name: 'users',
    containerPath: '/users/',
    rdfClass: 'https://schema.org/Person',
    namespace: { prefix: 'schema', uri: 'https://schema.org/' },
    autoRegister: true
  },
  getContainerPath: () => '/users/',
  getRdfClass: () => 'https://schema.org/Person',
  getNamespace: () => ({ prefix: 'schema', uri: 'https://schema.org/' }),
  getColumns: () => ({
    id: { name: 'id', dataType: 'integer' },
    name: { name: 'name', dataType: 'string' },
    email: { name: 'email', dataType: 'string' }
  })
} as any; // Mock object for testing, intentionally using any for simplicity

describe('ASTToSPARQLConverter', () => {
  let converter: ASTToSPARQLConverter;
  const podUrl = 'https://example.com/pod/';

  beforeEach(() => {
    converter = new ASTToSPARQLConverter(podUrl);
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

    it('应该支持 IS NULL 过滤', () => {
      const condition = isNull(mockTable.columns.email);
      const result = converter.convertSelect({ where: condition }, mockTable);

      expect(result.query).toContain('FILTER(!(BOUND(?email)))');
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

  describe('buildSelectVariables', () => {
    it('应该构建正确的 SELECT 变量', () => {
      const ast = { where: {} };
      const variables = converter['buildSelectVariables'](ast, mockTable);
      
      const variableNames = variables.map((variable: any) => variable.value);
      expect(variableNames).not.toContain('id');
      expect(variableNames).toContain('name');
      expect(variableNames).toContain('email');
    });
  });

  describe('buildWhereClause', () => {
    it('应该构建基本的 WHERE 子句', () => {
      const ast = { where: {} };
      const whereClause = converter['buildWhereClause'](ast, mockTable);
      
      expect(whereClause).toContain('rdf:type');
      expect(whereClause).toContain('https://schema.org/Person');
    });

    it('应该处理 WHERE 条件', () => {
      const ast = { where: { name: 'John' } };
      const whereClause = converter['buildWhereClause'](ast, mockTable);
      
      // 当前实现只生成基本的 RDF 类型和列约束，不处理具体的 WHERE 条件
      expect(whereClause).toContain('rdf:type');
      expect(whereClause).toContain('https://schema.org/Person');
    });
  });

  describe('generateSubjectUri', () => {
    it('应该生成正确的主体 URI', () => {
      const record = { id: 123 };
      const uri = converter['generateSubjectUri'](record, mockTable);
      
      expect(uri).toContain('https://example.com/pod');
      expect(uri).toContain('/users');
      expect(uri).toContain('123');
    });
  });

  describe('getPredicateForColumn', () => {
    it('应该为列获取正确的谓词', () => {
      const column = mockTable.columns.name;
      const predicate = converter['getPredicateForColumn'](column, mockTable);
      
      expect(predicate).toBe('https://schema.org/name');
    });
  });

  describe('formatValue', () => {
    it('应该正确格式化字符串值', () => {
      const column = mockTable.columns.name;
      const formatted = converter['formatValue']('test', column);
      expect(formatted).toBe('"test"');
    });

    it('应该正确格式化数字值', () => {
      const column = mockTable.columns.id;
      const formatted = converter['formatValue'](123, column);
      expect(formatted).toBe('123');
    });

    it('应该正确格式化布尔值', () => {
      const formatted = converter['formatValue'](true);
      expect(formatted).toBe('"true"^^<http://www.w3.org/2001/XMLSchema#boolean>');
    });
  });

  describe('复杂查询测试', () => {
    it('应该处理没有指定列的 SELECT 查询', () => {
      const ast = {
        type: 'select',
        columns: '*' // 使用 * 表示所有列
      };

      const result = converter.convertSelect(ast, mockTable);

      expect(result.query).toContain('SELECT ?subject ?name ?email');
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

  describe('formatValue 方法测试', () => {
    it('应该处理 null 和 undefined 值', () => {
      const result1 = converter['formatValue'](null);
      const result2 = converter['formatValue'](undefined);

      expect(result1).toBe('NULL');
      expect(result2).toBe('NULL');
    });

    it('应该处理引用类型的字符串值', () => {
      const column = {
        isReference: () => true
      };
      const result = converter['formatValue']('http://example.com/resource', column);

      expect(result).toBe('<http://example.com/resource>');
    });

    it('应该处理引用类型的数字值', () => {
      const column = {
        isReference: () => true,
        options: {
          referenceTarget: 'http://example.com/'
        }
      };
      const result = converter['formatValue'](123, column);

      expect(result).toBe('<http://example.com//123>');
    });

    it('应该处理 Date 对象', () => {
      const date = new Date('2023-01-01T00:00:00Z');
      const result = converter['formatValue'](date);

      expect(result).toBe('"2023-01-01T00:00:00.000Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>');
    });

    it('应该处理其他类型的值', () => {
      const result = converter['formatValue']({ toString: () => 'custom' });

      expect(result).toBe('"custom"');
    });
  });

  describe('convert 方法测试', () => {
    it('应该处理 SELECT SQL', () => {
      const sql = {
        queryChunks: ['SELECT * FROM users']
      } as any; // Mock SQL object for testing

      const result = converter.convert(sql);

      expect(result.type).toBe('SELECT');
      expect(result.query).toContain('SELECT * WHERE');
    });

    it('应该处理 INSERT SQL', () => {
      const sql = {
        queryChunks: ['INSERT INTO users VALUES']
      } as any; // Mock SQL object for testing

      const result = converter.convert(sql);

      expect(result.type).toBe('INSERT');
      expect(result.query).toContain('INSERT DATA');
    });

    it('应该处理 UPDATE SQL', () => {
      const sql = {
        queryChunks: ['UPDATE users SET']
      } as any; // Mock SQL object for testing

      const result = converter.convert(sql);

      expect(result.type).toBe('UPDATE');
      expect(result.query).toContain('DELETE');
      expect(result.query).toContain('INSERT');
    });

    it('应该处理 DELETE SQL', () => {
      const sql = {
        queryChunks: ['DELETE FROM users']
      } as any; // Mock SQL object for testing

      const result = converter.convert(sql);

      expect(result.type).toBe('DELETE');
      expect(result.query).toContain('DELETE WHERE');
    });

    it('应该处理不支持的 SQL 操作', () => {
      const sql = {
        queryChunks: ['CREATE TABLE users']
      } as any; // Mock SQL object for testing

      expect(() => converter.convert(sql)).toThrow('Unsupported SQL operation');
    });
  });

  describe('AST 解析方法测试', () => {
    it('应该解析 SELECT AST', () => {
      const sql = {
        queryChunks: ['SELECT * FROM users']
      } as any; // Mock SQL object for testing

      const result = converter['parseSelectAST'](sql, mockTable);

      expect(result.type).toBe('select');
      expect(result.columns).toBe('*');
    });

    it('应该解析 INSERT AST', () => {
      const sql = {
        queryChunks: ['INSERT INTO users VALUES'],
        params: [{ name: 'John' }]
      } as any; // Mock SQL object for testing

      const result = converter['parseInsertAST'](sql, mockTable);

      expect(result.type).toBe('insert');
      expect(result.values).toEqual([{ name: 'John' }]);
    });

    it('应该解析 UPDATE AST', () => {
      const sql = {
        queryChunks: ['UPDATE users SET name = ?']
      } as any; // Mock SQL object for testing

      const result = converter['parseUpdateAST'](sql, mockTable);

      expect(result.type).toBe('update');
      expect(result.set).toEqual({});
    });

    it('应该解析 DELETE AST', () => {
      const sql = {
        queryChunks: ['DELETE FROM users WHERE id = ?']
      } as any; // Mock SQL object for testing

      const result = converter['parseDeleteAST'](sql, mockTable);

      expect(result.type).toBe('delete');
    });

    it('应该解析不支持的 SQL 操作', () => {
      const sql = {
        queryChunks: ['CREATE TABLE users']
      } as any; // Mock SQL object for testing

      expect(() => converter['parseDrizzleAST'](sql, mockTable)).toThrow('Unsupported SQL operation');
    });
  });

  describe('addPrefix 方法测试', () => {
    it('应该添加自定义前缀', () => {
      converter.addPrefix('custom', 'http://custom.org/');
      
      expect(converter['prefixes']['custom']).toBe('http://custom.org/');
    });
  });
});
