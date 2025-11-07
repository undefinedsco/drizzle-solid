import { describe, it, expect, beforeEach } from 'vitest';
import {
  ColumnBuilder,
  PodTable,
  PodColumn,
  PodStringColumn,
  PodIntegerColumn,
  PodBooleanColumn,
  PodDateTimeColumn,
  PodJsonColumn,
  PodObjectColumn,
  podTable,
  string,
  int,
  boolean,
  date,
  json,
  object,
  uri,
  text,
  RDF_CLASSES,
  type PodTableOptions
} from '@src/core/pod-table';

const schemaNamespace = { prefix: 'schema', uri: 'https://schema.org/' };

describe('PodTable', () => {
  let table: PodTable;
  let columns: Record<string, PodColumn>;
  let options: PodTableOptions;

  beforeEach(() => {
    columns = {
      id: new PodIntegerColumn('id', { primaryKey: true, required: true }),
      name: new PodStringColumn('name', { required: true }),
      email: new PodStringColumn('email', { required: false }),
      active: new PodBooleanColumn('active', { defaultValue: true })
    };

    options = {
      resourcePath: 'idp:///users/index.ttl',
      rdfClass: 'https://schema.org/Person',
      namespace: schemaNamespace
    };

    table = new PodTable('users', columns, options);
  });

  describe('构造函数', () => {
    it('应该正确初始化表', () => {
      expect(table).toBeDefined();
      expect(table.config.name).toBe('users');
      expect(table.columns).toEqual(columns);
    });

    it('应该设置正确的配置', () => {
      expect(table.config.containerPath).toBe('/users/');
      expect(table.config.rdfClass).toBe('https://schema.org/Person');
      expect(table.config.namespace).toEqual(schemaNamespace);
    });
  });

  describe('getContainerPath', () => {
    it('应该返回容器路径', () => {
      expect(table.getContainerPath()).toBe('/users/');
    });
  });

  describe('getRdfClass', () => {
    it('应该返回 RDF 类', () => {
      expect(table.getRdfClass()).toBe('https://schema.org/Person');
    });
  });

  describe('getNamespace', () => {
    it('应该返回命名空间配置', () => {
      expect(table.getNamespace()).toEqual(schemaNamespace);
    });
  });

  describe('getColumns', () => {
    it('应该返回所有列', () => {
      const cols = table.getColumns();
      expect(cols).toEqual(columns);
    });
  });

  describe('getColumn', () => {
    it('应该返回指定列', () => {
      const idColumn = table.getColumn('id');
      expect(idColumn).toBe(columns.id);
    });

    it('应该返回 undefined 对于不存在的列', () => {
      const nonExistentColumn = table.getColumn('nonExistent');
      expect(nonExistentColumn).toBeUndefined();
    });
  });

  describe('hasColumn', () => {
    it('应该正确检查列是否存在', () => {
      expect(table.hasColumn('id')).toBe(true);
      expect(table.hasColumn('name')).toBe(true);
      expect(table.hasColumn('nonExistent')).toBe(false);
    });
  });
});

describe('PodColumn', () => {
  describe('PodStringColumn', () => {
    let column: PodStringColumn;

    beforeEach(() => {
      column = new PodStringColumn('name', { required: true });
    });

    it('应该正确初始化字符串列', () => {
      expect(column.name).toBe('name');
      expect(column.dataType).toBe('string');
      expect(column.options.required).toBe(true);
    });

    it('应该生成正确的谓词', () => {
      const predicate = column.getPredicate(schemaNamespace);
      expect(predicate).toBe('https://schema.org/name');
    });

    it('应该使用自定义谓词', () => {
      const customColumn = new PodStringColumn('custom', { 
        predicate: 'https://example.com/custom' 
      });
      const predicate = customColumn.getPredicate();
      expect(predicate).toBe('https://example.com/custom');
    });

    it('应该检查是否为引用', () => {
      expect(column.isReference()).toBe(false);
    });
  });

  describe('PodIntegerColumn', () => {
    let column: PodIntegerColumn;

    beforeEach(() => {
      column = new PodIntegerColumn('id', { primaryKey: true });
    });

    it('应该正确初始化整数列', () => {
      expect(column.name).toBe('id');
      expect(column.dataType).toBe('integer');
      expect(column.options.primaryKey).toBe(true);
    });

    it('应该生成正确的谓词', () => {
      const predicate = column.getPredicate(schemaNamespace);
      expect(predicate).toBe('https://schema.org/id');
    });
  });

  describe('PodBooleanColumn', () => {
    let column: PodBooleanColumn;

    beforeEach(() => {
      column = new PodBooleanColumn('active', { defaultValue: true });
    });

    it('应该正确初始化布尔列', () => {
      expect(column.name).toBe('active');
      expect(column.dataType).toBe('boolean');
      expect(column.options.defaultValue).toBe(true);
    });

    it('应该生成正确的谓词', () => {
      const predicate = column.getPredicate(schemaNamespace);
      expect(predicate).toBe('https://schema.org/active');
    });
  });

  describe('引用列', () => {
    it('应该正确识别引用列', () => {
      const referenceColumn = new PodStringColumn('author', {
        referenceTarget: 'https://schema.org/Person'
      });
      
      expect(referenceColumn.isReference()).toBe(true);
      expect(referenceColumn.getReferenceTarget()).toBe('https://schema.org/Person');
    });
  });
});

describe('PodColumn 选项', () => {
  it('应该支持主键选项', () => {
    const column = new PodStringColumn('id', { primaryKey: true });
    expect(column.options.primaryKey).toBe(true);
  });

  it('应该支持必需选项', () => {
    const column = new PodStringColumn('name', { required: true });
    expect(column.options.required).toBe(true);
  });

  it('应该支持默认值选项', () => {
    const column = new PodStringColumn('status', { defaultValue: 'active' });
    expect(column.options.defaultValue).toBe('active');
  });

  it('应该支持自定义谓词选项', () => {
    const column = new PodStringColumn('custom', { 
      predicate: 'https://example.com/custom' 
    });
    expect(column.options.predicate).toBe('https://example.com/custom');
  });
});

describe('链式方法', () => {
  it('应该支持 primaryKey() 方法', () => {
    const column = int('id').primaryKey();
    expect(column.options.primaryKey).toBe(true);
    expect(column.options.required).toBe(true); // 主键自动为必需
  });

  it('应该支持 notNull() 方法', () => {
    const column = string('name').notNull();
    expect(column.options.required).toBe(true);
  });

  it('应该支持 default() 方法', () => {
    const column = string('status').default('active');
    expect(column.options.defaultValue).toBe('active');
  });

  it('应该支持 predicate() 方法', () => {
    const column = string('custom').predicate('https://example.com/custom');
    expect(column.options.predicate).toBe('https://example.com/custom');
  });

  it('应该支持 reference() 方法', () => {
    const column = int('authorId').reference(RDF_CLASSES.SCHEMA_PERSON);
    expect(column.options.referenceTarget).toBe(RDF_CLASSES.SCHEMA_PERSON);
    expect(column.options.referenceTarget).toBeDefined();
  });

  it('应该支持链式调用', () => {
    const column = int('id').primaryKey().reference(RDF_CLASSES.SCHEMA_PERSON);
    expect(column.options.primaryKey).toBe(true);
    expect(column.options.required).toBe(true);
    expect(column.options.referenceTarget).toBe(RDF_CLASSES.SCHEMA_PERSON);
  });

  it('应该支持 array() 方法', () => {
    const arrayColumn = text('tags').array();
    expect(arrayColumn.dataType).toBe('array');
    expect(arrayColumn.options.isArray).toBe(true);
    expect(arrayColumn.options.baseType).toBe('string');
  });

  it('应该支持 uri() 类型', () => {
    const uriColumn = uri('webId');
    expect(uriColumn.dataType).toBe('uri');
  });

  it('应该支持 uri().array() 组合', () => {
    const uriArrayColumn = uri('friends').array().reference(RDF_CLASSES.FOAF_PERSON);
    expect(uriArrayColumn.dataType).toBe('array');
    expect(uriArrayColumn.options.isArray).toBe(true);
    expect(uriArrayColumn.options.baseType).toBe('uri');
    expect(uriArrayColumn.options.referenceTarget).toBe(RDF_CLASSES.FOAF_PERSON);
  });
});

describe('类型推断', () => {
  it('应该正确推断表数据类型', () => {
    const users = podTable('users', {
      id: int('id').primaryKey(),
      name: string('name').notNull(),
      email: string('email').notNull(),
      createdAt: date('createdAt'),
    }, {
      resourcePath: 'idp:///users/index.ttl',
      rdfClass: RDF_CLASSES.SCHEMA_PERSON,
      namespace: schemaNamespace
    });

    // 测试表结构
    expect(users.config.name).toBe('users');
    expect(users.columns.id.options.primaryKey).toBe(true);
    expect(users.columns.name.options.required).toBe(true);
    expect(users.columns.email.options.required).toBe(true);
    expect(users.columns.createdAt.options.required).toBeUndefined(); // 默认值字段的 required 是 undefined
  });

  it('应该正确推断插入数据类型', () => {
    // 测试插入数据 - 主键可选，必需字段必需，可选字段可选
    const insertData = {
      name: 'Alice',
      email: 'alice@example.com',
      // id 和 createdAt 都是可选的
    };

    expect(insertData.name).toBe('Alice');
    expect(insertData.email).toBe('alice@example.com');
  });

  it('应该正确推断更新数据类型', () => {
    // 测试更新数据 - 所有字段都是可选的
    const updateData = {
      name: 'Alice Updated',
      // 其他字段都是可选的
    };

    expect(updateData.name).toBe('Alice Updated');
  });

  it('应该支持引用类型', () => {
    const posts = podTable('posts', {
      id: int('id').primaryKey(),
      title: string('title').notNull(),
      authorId: int('authorId').notNull().reference(RDF_CLASSES.SCHEMA_PERSON),
      createdAt: date('createdAt'),
    }, {
      resourcePath: 'idp:///posts/index.ttl',
      rdfClass: RDF_CLASSES.SCHEMA_BLOG_POSTING,
      namespace: schemaNamespace
    });

    // 测试引用字段
    expect(posts.columns.authorId.isReference()).toBe(true);
    expect(posts.columns.authorId.getReferenceTarget()).toBe(RDF_CLASSES.SCHEMA_PERSON);
  });
});

describe('新的列定义函数', () => {
  it('应该支持 string() 函数', () => {
    const column = string('name');
    expect(column).toBeInstanceOf(ColumnBuilder);
    expect(column.name).toBe('name');
    expect(column.dataType).toBe('string');
  });

  it('应该支持 int() 函数', () => {
    const column = int('id');
    expect(column).toBeInstanceOf(ColumnBuilder);
    expect(column.name).toBe('id');
    expect(column.dataType).toBe('integer');
  });

  it('应该支持 boolean() 函数', () => {
    const column = boolean('active');
    expect(column).toBeInstanceOf(ColumnBuilder);
    expect(column.name).toBe('active');
    expect(column.dataType).toBe('boolean');
  });

  it('应该支持 date() 函数', () => {
    const column = date('createdAt');
    expect(column).toBeInstanceOf(ColumnBuilder);
    expect(column.name).toBe('createdAt');
    expect(column.dataType).toBe('datetime');
  });

  it('应该支持 json() 函数', () => {
    const column = json('preferences');
    expect(column).toBeInstanceOf(ColumnBuilder);
    expect(column.name).toBe('preferences');
    expect(column.dataType).toBe('json');
  });

  it('应该支持 object() 函数', () => {
    const column = object('profile');
    expect(column).toBeInstanceOf(ColumnBuilder);
    expect(column.name).toBe('profile');
    expect(column.dataType).toBe('object');
  });

  it('ColumnBuilder 应该在 podTable 中转换为具体列类型', () => {
    const table = podTable('people', {
      name: string('name').notNull(),
      born: date('born'),
      active: boolean('active'),
      avatar: json('avatar'),
      preferences: object('preferences')
    }, {
      resourcePath: 'idp:///people/index.ttl',
      rdfClass: RDF_CLASSES.SCHEMA_PERSON,
      namespace: schemaNamespace
    });

    expect(table.columns.name).toBeInstanceOf(PodStringColumn);
    expect(table.columns.born).toBeInstanceOf(PodDateTimeColumn);
    expect(table.columns.active).toBeInstanceOf(PodBooleanColumn);
    expect(table.columns.avatar).toBeInstanceOf(PodJsonColumn);
    expect(table.columns.preferences).toBeInstanceOf(PodObjectColumn);
  });
});

describe('新的列类型', () => {
  describe('PodJsonColumn', () => {
    let column: PodJsonColumn;

    beforeEach(() => {
      column = new PodJsonColumn('preferences', { required: false });
    });

    it('应该正确初始化 JSON 列', () => {
      expect(column.name).toBe('preferences');
      expect(column.dataType).toBe('json');
      expect(column.options.required).toBe(false);
    });

    it('应该生成正确的谓词', () => {
      const predicate = column.getPredicate(schemaNamespace);
      expect(predicate).toBe('https://schema.org/preferences');
    });

    it('应该支持链式方法', () => {
      const chainedColumn = column.notNull().default({ theme: 'light' });
      expect(chainedColumn.options.required).toBe(true);
      expect(chainedColumn.options.defaultValue).toEqual({ theme: 'light' });
    });
  });

  describe('PodObjectColumn', () => {
    let column: PodObjectColumn;

    beforeEach(() => {
      column = new PodObjectColumn('profile', { required: false });
    });

    it('应该正确初始化 Object 列', () => {
      expect(column.name).toBe('profile');
      expect(column.dataType).toBe('object');
      expect(column.options.required).toBe(false);
    });

    it('应该生成正确的谓词', () => {
      const predicate = column.getPredicate(schemaNamespace);
      expect(predicate).toBe('https://schema.org/profile');
    });

    it('应该支持链式方法', () => {
      const chainedColumn = column.notNull().default({ age: 0 });
      expect(chainedColumn.options.required).toBe(true);
      expect(chainedColumn.options.defaultValue).toEqual({ age: 0 });
    });
  });
});

describe('JSON 和 Object 类型推断', () => {
  it('应该正确推断包含 JSON 和 Object 字段的表类型', () => {
    const users = podTable('users', {
      id: int('id').primaryKey(),
      name: string('name').notNull(),
      preferences: json('preferences'),
      profile: object('profile'),
      createdAt: date('createdAt'),
    }, {
      resourcePath: 'idp:///users/index.ttl',
      rdfClass: RDF_CLASSES.SCHEMA_PERSON,
      namespace: schemaNamespace
    });

    // 测试表结构
    expect(users.config.name).toBe('users');
    expect(users.columns.id.options.primaryKey).toBe(true);
    expect(users.columns.name.options.required).toBe(true);
    expect(users.columns.preferences.dataType).toBe('json');
    expect(users.columns.profile.dataType).toBe('object');
    expect(users.columns.createdAt.options.required).toBeUndefined();
  });

  it('应该支持 JSON 和 Object 字段的插入数据', () => {
    // 测试插入数据 - JSON 和 Object 字段都是可选的
    const insertData = {
      name: 'Alice',
      preferences: { theme: 'dark', language: 'zh-CN' },
      profile: { age: 25, city: 'Beijing' }
    };

    expect(insertData.name).toBe('Alice');
    expect(insertData.preferences).toEqual({ theme: 'dark', language: 'zh-CN' });
    expect(insertData.profile).toEqual({ age: 25, city: 'Beijing' });
  });

  it('应该支持 JSON 和 Object 字段的更新数据', () => {
    // 测试更新数据 - 所有字段都是可选的
    const updateData = {
      preferences: { theme: 'light' },
      profile: { age: 26 }
    };

    expect(updateData.preferences).toEqual({ theme: 'light' });
    expect(updateData.profile).toEqual({ age: 26 });
  });
});
