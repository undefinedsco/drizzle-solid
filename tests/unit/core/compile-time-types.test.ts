import { describe, it, expect } from '@jest/globals';
import { 
  createTypedTable, 
  field, 
  CommonFields, 
  typedTable
} from '@src/core/compile-time-types';

describe('Compile-time Types', () => {
  describe('createTypedTable', () => {
    it('应该创建类型安全的表', () => {
      const usersTable = createTypedTable('users', {
        name: field('name', 'https://schema.org/name', 'string'),
        age: field('age', 'https://schema.org/age', 'number'),
        email: field('email', 'https://schema.org/email', 'string'),
        isActive: field('isActive', 'https://schema.org/isActive', 'boolean')
      }, {
        containerPath: '/users/',
        rdfClass: 'https://schema.org/Person'
      });

      expect(usersTable.config.name).toBe('users');
      expect(usersTable.columns.name.dataType).toBe('string');
      expect(usersTable.columns.age.dataType).toBe('integer');
      expect(usersTable.columns.email.dataType).toBe('string');
      expect(usersTable.columns.isActive.dataType).toBe('boolean');
    });
  });

  describe('CommonFields', () => {
    it('应该提供预定义的常用字段', () => {
      const nameField = CommonFields.name();
      expect(nameField.name).toBe('name');
      expect(nameField.predicate).toBe('https://schema.org/name');
      expect(nameField.type).toBe('string');

      const ageField = CommonFields.age();
      expect(ageField.name).toBe('age');
      expect(ageField.predicate).toBe('https://schema.org/age');
      expect(ageField.type).toBe('number');
    });

    it('应该支持自定义 predicate', () => {
      const customNameField = CommonFields.name('https://example.org/customName');
      expect(customNameField.predicate).toBe('https://example.org/customName');
    });
  });

  describe('typedTable builder', () => {
    it('应该支持链式调用构建表', () => {
      const usersTable = typedTable('users', {
        containerPath: '/users/',
        rdfClass: 'https://schema.org/Person'
      })
        .addField(CommonFields.name())
        .addField(CommonFields.age())
        .addField(CommonFields.email())
        .addField(CommonFields.isActive())
        .build();

      expect(usersTable.config.name).toBe('users');
      expect(usersTable.columns.name.dataType).toBe('string');
      expect(usersTable.columns.age.dataType).toBe('integer');
      expect(usersTable.columns.email.dataType).toBe('string');
      expect(usersTable.columns.isActive.dataType).toBe('boolean');
    });
  });

  describe('类型安全', () => {
    it('应该提供正确的类型信息', () => {
      // 这个测试主要验证 TypeScript 类型检查
      const usersTable = createTypedTable('users', {
        name: field('name', 'https://schema.org/name', 'string'),
        age: field('age', 'https://schema.org/age', 'number'),
        email: field('email', 'https://schema.org/email', 'string'),
        isActive: field('isActive', 'https://schema.org/isActive', 'boolean')
      }, {
        containerPath: '/users/',
        rdfClass: 'https://schema.org/Person'
      });

      // 验证列的类型
      expect(usersTable.columns.name.dataType).toBe('string');
      expect(usersTable.columns.age.dataType).toBe('integer');
      expect(usersTable.columns.email.dataType).toBe('string');
      expect(usersTable.columns.isActive.dataType).toBe('boolean');
    });
  });

  describe('复杂场景', () => {
    it('应该支持复杂的表定义', () => {
      const postsTable = typedTable('posts', {
        containerPath: '/posts/',
        rdfClass: 'https://schema.org/BlogPosting'
      })
        .addField(CommonFields.name('https://schema.org/headline'))
        .addField(field('content', 'https://schema.org/text', 'string'))
        .addField(field('author', 'https://schema.org/author', 'string'))
        .addField(field('published', 'https://schema.org/datePublished', 'Date'))
        .addField(field('updated', 'https://schema.org/dateModified', 'Date'))
        .build();

      expect(postsTable.config.name).toBe('posts');
      expect(postsTable.columns.name.dataType).toBe('string');
      expect(postsTable.columns.content.dataType).toBe('string');
      expect(postsTable.columns.author.dataType).toBe('string');
      expect(postsTable.columns.published.dataType).toBe('datetime');
      expect(postsTable.columns.updated.dataType).toBe('datetime');
    });
  });
});
