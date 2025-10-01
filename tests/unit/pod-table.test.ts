/**
 * PodTable 单元测试
 */

import { podTable, string, int, date } from '@src/index';

describe('PodTable Tests', () => {
  test('should create table with columns', () => {
    const table = podTable('users', {
      id: string('id').primaryKey(),
      name: string('name').notNull(),
      age: int('age'),
      createdAt: date('createdAt')
    }, {
      containerPath: '/users/',
      rdfClass: 'https://schema.org/Person'
    });

    expect(table).toBeDefined();
    expect(table.config.name).toBe('users');
    expect(table.columns).toBeDefined();
    expect(table.columns.id).toBeDefined();
    expect(table.columns.name).toBeDefined();
    expect(table.columns.age).toBeDefined();
    expect(table.columns.createdAt).toBeDefined();
  });

  test('should support direct field access', () => {
    const table = podTable('tasks', {
      id: string('id').primaryKey(),
      title: string('title').notNull(),
      priority: int('priority')
    }, {
      containerPath: '/tasks/',
      rdfClass: 'https://schema.org/Task'
    });

    // Test direct field access (added in our modifications)
    expect((table as any).id).toBeDefined();
    expect((table as any).title).toBeDefined();
    expect((table as any).priority).toBeDefined();
  });

  test('should handle basic column creation', () => {
    const col1 = string('id');
    expect(col1).toBeDefined();
    expect(col1.name).toBe('id');
    
    const col2 = int('count');
    expect(col2).toBeDefined();
    expect(col2.name).toBe('count');
  });
});