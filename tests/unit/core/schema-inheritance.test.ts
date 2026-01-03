import { describe, it, expect } from 'vitest';
import {
  solidSchema,
  id,
  string,
  datetime,
  uri,
  int,
  boolean,
} from '@src/core/pod-table';

const VOCAB = {
  Secret: 'https://vocab.example/Secret',
  APIKey: 'https://vocab.example/APIKey',
  Password: 'https://vocab.example/Password',
  AuditedSecret: 'https://vocab.example/AuditedSecret',
  name: 'https://vocab.example/name',
  createdAt: 'https://vocab.example/createdAt',
  expiresAt: 'https://vocab.example/expiresAt',
  apiKey: 'https://vocab.example/apiKey',
  service: 'https://vocab.example/service',
  hash: 'https://vocab.example/hash',
  salt: 'https://vocab.example/salt',
  count: 'https://vocab.example/count',
  active: 'https://vocab.example/active',
};

describe('Schema Inheritance', () => {
  // 基础 schema 供测试使用
  const secretSchema = solidSchema('secret', {
    id: id(),
    name: string('name').predicate(VOCAB.name),
    createdAt: datetime('createdAt').predicate(VOCAB.createdAt),
  }, {
    type: VOCAB.Secret,
  });

  describe('基本继承', () => {
    it('子类应该继承父类所有列', () => {
      const apiKeySchema = secretSchema.extend('apiKey', {
        apiKey: string('apiKey').notNull().predicate(VOCAB.apiKey),
      }, {
        type: VOCAB.APIKey,
      });

      // 检查继承的列
      expect(apiKeySchema.columns.id).toBeDefined();
      expect(apiKeySchema.columns.name).toBeDefined();
      expect(apiKeySchema.columns.createdAt).toBeDefined();
      // 检查新增的列
      expect(apiKeySchema.columns.apiKey).toBeDefined();
    });

    it('子类应该能添加多个新属性', () => {
      const passwordSchema = secretSchema.extend('password', {
        hash: string('hash').notNull().predicate(VOCAB.hash),
        salt: string('salt').notNull().predicate(VOCAB.salt),
      }, {
        type: VOCAB.Password,
      });

      expect(Object.keys(passwordSchema.columns)).toHaveLength(5); // id, name, createdAt, hash, salt
      expect(passwordSchema.columns.hash).toBeDefined();
      expect(passwordSchema.columns.salt).toBeDefined();
    });
  });

  describe('subClassOf 自动设置', () => {
    it('子类 subClassOf 应该自动包含父类 type', () => {
      const apiKeySchema = secretSchema.extend('apiKey', {
        apiKey: string('apiKey').predicate(VOCAB.apiKey),
      }, {
        type: VOCAB.APIKey,
      });

      expect(apiKeySchema.subClassOf).toBeDefined();
      expect(apiKeySchema.subClassOf).toContain(VOCAB.Secret);
    });

    it('多级继承应该包含所有祖先类型', () => {
      // 第一级继承
      const namedSecretSchema = secretSchema.extend('namedSecret', {
        displayName: string('displayName').predicate('https://vocab.example/displayName'),
      }, {
        type: 'https://vocab.example/NamedSecret',
      });

      // 第二级继承
      const apiKeySchema = namedSecretSchema.extend('apiKey', {
        apiKey: string('apiKey').predicate(VOCAB.apiKey),
      }, {
        type: VOCAB.APIKey,
      });

      expect(apiKeySchema.subClassOf).toContain('https://vocab.example/NamedSecret');
      expect(apiKeySchema.subClassOf).toContain(VOCAB.Secret);
    });
  });

  describe('约束增强', () => {
    it('子类可以给继承的属性添加 notNull 约束', () => {
      const strictSecretSchema = secretSchema.extend('strictSecret', {
        name: string('name').notNull(), // 添加 notNull
      }, {
        type: 'https://vocab.example/StrictSecret',
      });

      // 应该继承父类的 predicate
      expect(strictSecretSchema.columns.name.options?.predicate).toBe(VOCAB.name);
    });

    it('子类可以给继承的属性添加 default 约束', () => {
      const defaultedSecretSchema = secretSchema.extend('defaultedSecret', {
        name: string('name').default('Unnamed'),
      }, {
        type: 'https://vocab.example/DefaultedSecret',
      });

      expect(defaultedSecretSchema.columns.name).toBeDefined();
      // predicate 应该被继承
      expect(defaultedSecretSchema.columns.name.options?.predicate).toBe(VOCAB.name);
    });
  });

  describe('predicate 保护', () => {
    it('尝试修改 predicate 应该抛出错误', () => {
      expect(() => {
        secretSchema.extend('badSchema', {
          name: string('name').predicate('https://different.example/name'), // 不同的 predicate
        }, {
          type: 'https://vocab.example/BadSchema',
        });
      }).toThrow(/不能修改.*predicate/);
    });

    it('使用相同 predicate 不应抛出错误', () => {
      expect(() => {
        secretSchema.extend('samePredicateSchema', {
          name: string('name').notNull().predicate(VOCAB.name), // 相同的 predicate + 新约束
        }, {
          type: 'https://vocab.example/SamePredicateSchema',
        });
      }).not.toThrow();
    });
  });

  describe('at() 方法', () => {
    it('继承的 schema 可以正常绑定位置', () => {
      const apiKeySchema = secretSchema.extend('apiKey', {
        apiKey: string('apiKey').predicate(VOCAB.apiKey),
      }, {
        type: VOCAB.APIKey,
      });

      const table = apiKeySchema.at('/vault/api-keys/');

      expect(table).toBeDefined();
      expect(table.config.base).toBe('/vault/api-keys/');
      expect(table.columns.id).toBeDefined();
      expect(table.columns.name).toBeDefined();
      expect(table.columns.apiKey).toBeDefined();
    });

    it('绑定后的表应该有正确的 subClassOf', () => {
      const apiKeySchema = secretSchema.extend('apiKey', {
        apiKey: string('apiKey').predicate(VOCAB.apiKey),
      }, {
        type: VOCAB.APIKey,
      });

      const table = apiKeySchema.at('/vault/api-keys/');

      expect(table.config.subClassOf).toContain(VOCAB.Secret);
    });
  });

  describe('类型推断', () => {
    it('$inferSelect 应该包含所有继承的字段', () => {
      const apiKeySchema = secretSchema.extend('apiKey', {
        apiKey: string('apiKey').predicate(VOCAB.apiKey),
        count: int('count').predicate(VOCAB.count),
      }, {
        type: VOCAB.APIKey,
      });

      const table = apiKeySchema.at('/vault/api-keys/');

      // 类型测试 - 这些应该编译通过
      type SelectType = typeof table.$inferSelect;

      // 运行时验证结构
      const columnKeys = Object.keys(table.columns);
      expect(columnKeys).toContain('id');
      expect(columnKeys).toContain('name');
      expect(columnKeys).toContain('createdAt');
      expect(columnKeys).toContain('apiKey');
      expect(columnKeys).toContain('count');
    });
  });

  describe('空继承', () => {
    it('不添加新列也可以继承', () => {
      const aliasSchema = secretSchema.extend('secretAlias', {}, {
        type: 'https://vocab.example/SecretAlias',
      });

      expect(Object.keys(aliasSchema.columns)).toHaveLength(3); // id, name, createdAt
      expect(aliasSchema.subClassOf).toContain(VOCAB.Secret);
    });
  });

  describe('复杂继承场景', () => {
    it('Secret -> APIKey 完整示例', () => {
      const apiKeySchema = secretSchema.extend('apiKey', {
        apiKey: string('apiKey').notNull().predicate(VOCAB.apiKey),
        service: uri('service').predicate(VOCAB.service),
        active: boolean('active').default(true).predicate(VOCAB.active),
      }, {
        type: VOCAB.APIKey,
      });

      // 验证结构
      expect(apiKeySchema.name).toBe('apiKey');
      expect(apiKeySchema.type).toBe(VOCAB.APIKey);
      expect(apiKeySchema.subClassOf).toContain(VOCAB.Secret);

      // 验证列
      expect(Object.keys(apiKeySchema.columns)).toHaveLength(6);
      expect(apiKeySchema.columns.id).toBeDefined();
      expect(apiKeySchema.columns.name).toBeDefined();
      expect(apiKeySchema.columns.createdAt).toBeDefined();
      expect(apiKeySchema.columns.apiKey).toBeDefined();
      expect(apiKeySchema.columns.service).toBeDefined();
      expect(apiKeySchema.columns.active).toBeDefined();
    });
  });
});
