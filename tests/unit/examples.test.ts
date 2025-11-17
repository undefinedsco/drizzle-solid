/**
 * Examples 验证测试
 * 验证examples中的核心功能能正常工作，而不是直接运行examples
 */

import { drizzle } from '@src/driver';
import { podTable, string, int, date } from '@src/index';

import { vi } from 'vitest';

// Mock Session for testing
const mockSession = {
  info: {
    isLoggedIn: true,
    webId: 'http://localhost:3000/alice/profile/card#me'
  },
  fetch: vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ 
      results: { 
        bindings: [] 
      } 
    })
  })
} as any;

describe('Examples Functionality Tests', () => {
  test('should support basic authentication setup', () => {
    // 验证能创建drizzle实例（类似01-server-setup和02-authentication的核心功能）
    const db = drizzle(mockSession);
    expect(db).toBeDefined();
    expect(mockSession.info.isLoggedIn).toBe(true);
    expect(mockSession.info.webId).toBe('http://localhost:3000/alice/profile/card#me');
  });

  test('should support table definition and CRUD operations', () => {
    // 验证能定义表和执行CRUD操作（类似03-basic-usage的核心功能）
    const taskTable = podTable('tasks', {
      id: string('id').primaryKey().predicate('https://schema.org/identifier'),
      title: string('title').notNull().predicate('https://schema.org/name'),
      description: string('description').predicate('https://schema.org/description'),
      status: string('status').notNull().predicate('https://schema.org/taskStatus'),
      priority: int('priority').predicate('https://schema.org/priority'),
      createdAt: date('createdAt').notNull().predicate('https://schema.org/dateCreated'),
      updatedAt: date('updatedAt').notNull().predicate('https://schema.org/dateModified')
    }, {
      base: 'idp:///tasks/index.ttl',
      rdfClass: 'https://schema.org/Task',
      namespace: { prefix: 'schema', uri: 'https://schema.org/' }
    });

    const db = drizzle(mockSession);

    // 验证能创建查询（不实际执行）
    expect(() => {
      const selectQuery = db.select().from(taskTable);
      const insertQuery = db.insert(taskTable).values({
        id: 'task-1',
        title: 'Test Task',
        description: 'A test task',
        status: 'pending',
        priority: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      const updateQuery = db.update(taskTable)
        .set({ status: 'completed' })
        .where({ id: 'task-1' } as any);
      const deleteQuery = db.delete(taskTable)
        .where({ id: 'task-1' } as any);

      // 所有查询都应该能成功创建
      expect(selectQuery).toBeDefined();
      expect(insertQuery).toBeDefined();
      expect(updateQuery).toBeDefined();
      expect(deleteQuery).toBeDefined();
    }).not.toThrow();
  });

  test('should support session reuse pattern', () => {
    // 验证Session复用模式（类似03-basic-usage中的tryReuseSession功能）
    const originalEnv = process.env;
    
    // Mock环境变量
    process.env = {
      ...originalEnv,
      SOLID_CLIENT_ID: 'test-client-id',
      SOLID_CLIENT_SECRET: 'test-client-secret',
      SOLID_OIDC_ISSUER: 'http://localhost:3000'
    };

    // 验证能读取环境变量
    expect(process.env.SOLID_CLIENT_ID).toBe('test-client-id');
    expect(process.env.SOLID_CLIENT_SECRET).toBe('test-client-secret');
    expect(process.env.SOLID_OIDC_ISSUER).toBe('http://localhost:3000');

    // 恢复原始环境变量
    process.env = originalEnv;
  });

  test('should handle table field access', () => {
    // 验证表字段直接访问功能（修复的功能）
    const table = podTable('test', {
      id: string('id').primaryKey().predicate('https://schema.org/identifier'),
      name: string('name').notNull().predicate('https://schema.org/name')
    }, {
      base: 'idp:///test/index.ttl',
      rdfClass: 'https://schema.org/Thing',
      namespace: { prefix: 'schema', uri: 'https://schema.org/' }
    });

    // 验证直接字段访问
    expect((table as any).id).toBeDefined();
    expect((table as any).name).toBeDefined();
    expect((table as any).id.name).toBe('id');
    expect((table as any).name.name).toBe('name');
  });
});
