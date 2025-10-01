import { describe, it, expect, beforeEach } from '@jest/globals';
import { z } from 'zod';
import { 
  createTableSchema, 
  createInsertSchema, 
  createUpdateSchema,
  getTableSchema,
  TableSchemaBuilder
} from '@src/core/zod-integration';
import { 
  podTable, 
  string, 
  int, 
  boolean, 
  date, 
  json, 
  object,
  COMMON_NAMESPACES,
  RDF_CLASSES
} from '@src/core/pod-table';

describe('Zod 集成测试', () => {
  let usersTable: any; // Test table, using any for simplicity

  beforeEach(() => {
    usersTable = podTable('users', {
      id: int('id').primaryKey(),
      name: string('name').notNull(),
      email: string('email').notNull(),
      age: int('age'),
      isActive: boolean('isActive').default(true),
      createdAt: date('createdAt'),
      profile: json('profile'),
      metadata: object('metadata')
    }, {
      containerPath: '/users/',
      rdfClass: RDF_CLASSES.SCHEMA_PERSON,
      namespace: COMMON_NAMESPACES.schema
    });
  });

  describe('createTableSchema', () => {
    it('应该为表创建完整的 Zod schema', () => {
      const schema = createTableSchema(usersTable);
      
      expect(schema).toBeDefined();
      expect(schema.parse).toBeDefined();
      expect(schema.safeParse).toBeDefined();
    });

    it('应该验证正确的数据', () => {
      const schema = createTableSchema(usersTable);
      const validData = {
        id: 1,
        name: 'John Doe',
        email: 'john@example.com',
        age: 30,
        isActive: true,
        createdAt: new Date(),
        profile: { bio: 'Software developer' },
        metadata: { source: 'web' }
      };

      const result = schema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('应该拒绝无效的数据', () => {
      const schema = createTableSchema(usersTable);
      const invalidData = {
        id: 'not-a-number',
        name: 123, // 应该是字符串
        email: 'invalid-email'
      };

      const result = schema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('应该处理可选字段', () => {
      const schema = createTableSchema(usersTable);
      const partialData = {
        id: 1,
        name: 'John Doe',
        email: 'john@example.com'
        // 其他字段都是可选的
      };

      const result = schema.safeParse(partialData);
      expect(result.success).toBe(true);
    });
  });

  describe('createInsertSchema', () => {
    it('应该为插入操作创建 schema', () => {
      const schema = createInsertSchema(usersTable);
      
      expect(schema).toBeDefined();
      expect(schema.parse).toBeDefined();
    });

    it('应该允许插入必需字段', () => {
      const schema = createInsertSchema(usersTable);
      const insertData = {
        name: 'John Doe',
        email: 'john@example.com'
      };

      const result = schema.safeParse(insertData);
      expect(result.success).toBe(true);
    });

    it('应该拒绝缺少必需字段的插入', () => {
      const schema = createInsertSchema(usersTable);
      const invalidInsertData = {
        name: 'John Doe'
        // 缺少必需的 email 字段
      };

      const result = schema.safeParse(invalidInsertData);
      expect(result.success).toBe(false);
    });
  });

  describe('createUpdateSchema', () => {
    it('应该为更新操作创建 schema', () => {
      const schema = createUpdateSchema(usersTable);
      
      expect(schema).toBeDefined();
      expect(schema.parse).toBeDefined();
    });

    it('应该允许部分更新', () => {
      const schema = createUpdateSchema(usersTable);
      const updateData = {
        name: 'Jane Doe'
      };

      const result = schema.safeParse(updateData);
      expect(result.success).toBe(true);
    });

    it('应该允许空更新对象', () => {
      const schema = createUpdateSchema(usersTable);
      const emptyUpdateData = {};

      const result = schema.safeParse(emptyUpdateData);
      expect(result.success).toBe(true);
    });
  });

  describe('getTableSchema', () => {
    it('应该获取表的 schema', () => {
      const schema = getTableSchema(usersTable);
      
      expect(schema).toBeDefined();
      expect(schema.getSchema).toBeDefined();
      expect(schema.getSchema().parse).toBeDefined();
    });

    it('应该返回与 createTableSchema 相同的结果', () => {
      const schema1 = createTableSchema(usersTable);
      const schema2 = getTableSchema(usersTable).getSchema();
      
      // 验证两个 schema 的行为相同
      const testData = {
        id: 1,
        name: 'John Doe',
        email: 'john@example.com'
      };

      const result1 = schema1.safeParse(testData);
      const result2 = schema2.safeParse(testData);
      
      expect(result1.success).toBe(result2.success);
    });
  });

  describe('TableSchemaBuilder', () => {
    it('应该创建 TableSchemaBuilder 实例', () => {
      const builder = new TableSchemaBuilder(usersTable);
      
      expect(builder).toBeDefined();
      expect(builder.getSchema).toBeDefined();
    });

    it('应该构建完整的 schema', () => {
      const builder = new TableSchemaBuilder(usersTable);
      const schema = builder.getSchema();
      
      expect(schema).toBeDefined();
      expect(schema.parse).toBeDefined();
    });

    it('应该支持自定义验证', () => {
      const builder = new TableSchemaBuilder(usersTable);
      
      // 添加自定义验证
      builder.addValidation('email', z.string().email());
      
      const schema = builder.getSchema();
      const validData = {
        id: 1,
        name: 'John Doe',
        email: 'john@example.com'
      };

      const result = schema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('应该拒绝无效的自定义验证', () => {
      const builder = new TableSchemaBuilder(usersTable);
      
      // 添加自定义验证
      builder.addValidation('email', z.string().email());
      
      const schema = builder.getSchema();
      const invalidData = {
        id: 1,
        name: 'John Doe',
        email: 'invalid-email'
      };

      const result = schema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });
  });

  describe('复杂数据类型测试', () => {
    it('应该正确处理 JSON 字段', () => {
      const schema = createTableSchema(usersTable);
      const dataWithJson = {
        id: 1,
        name: 'John Doe',
        email: 'john@example.com',
        profile: {
          bio: 'Software developer',
          skills: ['JavaScript', 'TypeScript'],
          preferences: {
            theme: 'dark',
            notifications: true
          }
        }
      };

      const result = schema.safeParse(dataWithJson);
      expect(result.success).toBe(true);
    });

    it('应该正确处理 Object 字段', () => {
      const schema = createTableSchema(usersTable);
      const dataWithObject = {
        id: 1,
        name: 'John Doe',
        email: 'john@example.com',
        metadata: {
          source: 'web',
          version: '1.0',
          tags: ['user', 'active']
        }
      };

      const result = schema.safeParse(dataWithObject);
      expect(result.success).toBe(true);
    });

    it('应该正确处理 Date 字段', () => {
      const schema = createTableSchema(usersTable);
      const dataWithDate = {
        id: 1,
        name: 'John Doe',
        email: 'john@example.com',
        createdAt: new Date('2023-01-01T00:00:00Z')
      };

      const result = schema.safeParse(dataWithDate);
      expect(result.success).toBe(true);
    });

    it('应该正确处理布尔字段', () => {
      const schema = createTableSchema(usersTable);
      const dataWithBoolean = {
        id: 1,
        name: 'John Doe',
        email: 'john@example.com',
        isActive: false
      };

      const result = schema.safeParse(dataWithBoolean);
      expect(result.success).toBe(true);
    });
  });

  describe('错误处理测试', () => {
    it('应该处理无效的表定义', () => {
      expect(() => {
        createTableSchema(null as never);
      }).toThrow();
    });

    it('应该处理空的表定义', () => {
      const emptyTable = podTable('empty', {}, {
        containerPath: '/empty/',
        rdfClass: RDF_CLASSES.SCHEMA_PERSON,
        namespace: COMMON_NAMESPACES.schema
      });

      const schema = createTableSchema(emptyTable);
      expect(schema).toBeDefined();
    });

    it('应该处理无效的列类型', () => {
      const invalidTable = podTable('invalid', {
        id: int('id').primaryKey(),
        name: string('name').notNull()
      }, {
        containerPath: '/invalid/',
        rdfClass: RDF_CLASSES.SCHEMA_PERSON,
        namespace: COMMON_NAMESPACES.schema
      });

      // 模拟无效的列类型
      (invalidTable.columns.name as any).dataType = 'invalid-type'; // Test mock, using any for simplicity

      const schema = createTableSchema(invalidTable);
      expect(schema).toBeDefined();
    });
  });

  describe('性能测试', () => {
    it('应该能够快速创建大量 schema', () => {
      const start = Date.now();
      
      for (let i = 0; i < 100; i++) {
        const schema = createTableSchema(usersTable);
        expect(schema).toBeDefined();
      }
      
      const end = Date.now();
      const duration = end - start;
      
      // 应该在合理时间内完成
      expect(duration).toBeLessThan(1000);
    });

    it('应该能够快速验证大量数据', () => {
      const schema = createTableSchema(usersTable);
      const testData = {
        id: 1,
        name: 'John Doe',
        email: 'john@example.com'
      };

      const start = Date.now();
      
      for (let i = 0; i < 1000; i++) {
        const result = schema.safeParse(testData);
        expect(result.success).toBe(true);
      }
      
      const end = Date.now();
      const duration = end - start;
      
      // 应该在合理时间内完成
      expect(duration).toBeLessThan(1000);
    });
  });
});
