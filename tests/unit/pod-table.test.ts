/**
 * PodTable 单元测试
 */

import { podTable, string, int, date, id } from '@src/index';
import { SCHEMA_INRUPT as SCHEMA } from '@inrupt/vocab-common-rdf';

describe('PodTable Tests', () => {
  const schemaNamespace = { prefix: SCHEMA.PREFIX, uri: SCHEMA.NAMESPACE };

  test('should create table with columns', () => {
    const table = podTable('users', {
      id: string('id').primaryKey(),
      name: string('name').notNull(),
      age: int('age'),
      createdAt: date('createdAt')
    }, {
      base: 'idp:///users/index.ttl',
      type: 'https://schema.org/Person',
      namespace: schemaNamespace
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
      base: 'idp:///tasks/index.ttl',
      type: 'https://schema.org/Task',
      namespace: schemaNamespace
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

  test('should throw error if no primary key defined', () => {
    expect(() => {
      podTable('bad_table', {
        name: string('name').predicate('http://example.org/name')
      }, {
        base: '/data/bad_table.ttl',
        type: 'http://example.org/Test'
      });
    }).toThrow(/must have exactly one primary key/);
  });

  test('should throw error if multiple primary keys defined', () => {
    expect(() => {
      podTable('bad_table_multi', {
        id1: string('id1').primaryKey().predicate('http://example.org/id1'),
        id2: string('id2').primaryKey().predicate('http://example.org/id2'),
        name: string('name').predicate('http://example.org/name')
      }, {
        base: '/data/bad_table_multi.ttl',
        type: 'http://example.org/Test'
      });
    }).toThrow(/must have exactly one primary key/);
  });

  test('should have default generator for id() helper', () => {
    // We use the imported id function from top of file
    const idCol = id('uuid_test');
    expect(idCol.options.defaultValue).toBeDefined();
    expect(typeof idCol.options.defaultValue).toBe('function');
    
    const generated = (idCol.options.defaultValue as () => string)();
    expect(typeof generated).toBe('string');
    expect(generated.length).toBeGreaterThan(10); // NanoID is usually ~21 chars
  });
});
