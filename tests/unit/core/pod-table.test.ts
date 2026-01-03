import { describe, it, expect } from 'vitest';
import {
  PodTable,
  PodStringColumn,
  PodIntegerColumn,
  PodBooleanColumn,
  PodJsonColumn,
  PodObjectColumn,
  podTable,
  relations,
  InferTableData,
  InferInsertData,
  InferUpdateData,
  string,
  int,
  boolean,
  date,
  json,
  object,
  id,
  uri,
} from '@src/core/schema';

const FOAF_NAME = 'http://xmlns.com/foaf/0.1/name';
const SCHEMA_PERSON = 'https://schema.org/Person';
const SCHEMA_BLOG_POSTING = 'https://schema.org/BlogPosting';
const FOAF_PERSON = 'http://xmlns.com/foaf/0.1/Person';

describe('PodTable', () => {
  describe('构造函数/工厂函数', () => {
    it('应该正确初始化表', () => {
      const table = podTable('users', {
        id: id(),
        name: string('name').predicate(FOAF_NAME)
      }, { 
        base: '/users/',
        type: SCHEMA_PERSON 
      });

      expect(table.config.name).toBe('users');
      expect(table.config.type).toBe(SCHEMA_PERSON);
      expect(table.columns.name).toBeDefined();
    });

    it('应该设置正确的配置', () => {
      const table = podTable('users', {
        id: id(),
        name: string('name').predicate(FOAF_NAME)
      }, {
        base: '/data/users/',
        type: SCHEMA_PERSON,
        typeIndex: 'private'
      });

      expect(table.config.base).toBe('/data/users/');
      expect(table.config.typeIndex).toBe('private');
    });
  });

  describe('getContainerPath', () => {
    it('应该返回容器路径', () => {
      const table = podTable('users', {
        id: id()
      }, { 
        base: '/data/users/',
        type: SCHEMA_PERSON 
      });
      expect(table.getContainerPath()).toBe('/data/users/');
    });
  });

  describe('getRdfClass', () => {
    it('应该返回 RDF 类', () => {
      const table = podTable('users', {
        id: id()
      }, { 
        base: '/users/',
        type: SCHEMA_PERSON 
      });
      expect(table.getType()).toBe(SCHEMA_PERSON);
    });
  });

  describe('getNamespace', () => {
    it('应该返回命名空间配置', () => {
      const ns = { prefix: 'ex', uri: 'http://example.org/' };
      const table = podTable('users', {
        id: id()
      }, { 
        base: '/users/',
        type: SCHEMA_PERSON,
        namespace: ns
      });
      expect(table.getNamespace()).toEqual(ns);
    });
  });

  describe('subClassOf metadata', () => {
    it('should normalize and expose parent classes', () => {
      const table = podTable('users', { id: id() }, {
        base: '/users/',
        type: SCHEMA_PERSON,
        subClassOf: ['https://schema.org/Thing', { value: 'http://xmlns.com/foaf/0.1/Agent' }]
      });

      expect(table.getSubClassOf()).toContain('https://schema.org/Thing');
      expect(table.getSubClassOf()).toContain('http://xmlns.com/foaf/0.1/Agent');
    });
  });

  describe('getColumns', () => {
    it('应该返回所有列', () => {
      const columns = {
        id: id(),
        name: string('name').predicate(FOAF_NAME)
      };
      const table = podTable('users', columns, { 
        base: '/users/',
        type: SCHEMA_PERSON 
      });
      // Note: podTable converts columns, so we check keys
      expect(Object.keys(table.getColumns())).toEqual(Object.keys(columns));
    });
  });

  describe('getColumn', () => {
    it('应该返回指定列', () => {
      const table = podTable('users', {
        id: id(),
        name: string('name').predicate(FOAF_NAME)
      }, { 
        base: '/users/',
        type: SCHEMA_PERSON 
      });
      expect(table.getColumn('name')).toBeDefined();
    });

    it('应该返回 undefined 对于不存在的列', () => {
      const table = podTable('users', {
        id: id()
      }, { 
        base: '/users/',
        type: SCHEMA_PERSON 
      });
      expect(table.getColumn('age')).toBeUndefined();
    });
  });

  describe('hasColumn', () => {
    it('应该正确检查列是否存在', () => {
      const table = podTable('users', {
        id: id(),
        name: string('name').predicate(FOAF_NAME)
      }, { 
        base: '/users/',
        type: SCHEMA_PERSON 
      });
      expect(table.hasColumn('name')).toBe(true);
      expect(table.hasColumn('age')).toBe(false);
    });
  });

  describe('PodColumn', () => {
    describe('PodStringColumn', () => {
      it('应该正确初始化字符串列', () => {
        const column = new PodStringColumn('name');
        expect(column.name).toBe('name');
        expect(column.dataType).toBe('string');
      });

      it('应该生成正确的谓词', () => {
        const column = new PodStringColumn('name');
        expect(column.getPredicate({ prefix: 'ex', uri: 'http://example.org/' })).toBe('http://example.org/name');
      });

      it('应该使用自定义谓词', () => {
        const column = new PodStringColumn('name')
          .predicate(FOAF_NAME);
        expect(column.getPredicate()).toBe(FOAF_NAME);
      });

      it('应该检查是否为引用', () => {
        const column = new PodStringColumn('friend')
          .reference(SCHEMA_PERSON);
        expect(column.isReference()).toBe(true);
        expect(column.getReferenceTarget()).toBe(SCHEMA_PERSON);
      });
    });

    describe('PodIntegerColumn', () => {
      it('应该正确初始化整数列', () => {
        const column = new PodIntegerColumn('age');
        expect(column.name).toBe('age');
        expect(column.dataType).toBe('integer');
      });

      it('应该生成正确的谓词', () => {
        const column = new PodIntegerColumn('age');
        expect(column.getPredicate({ prefix: 'ex', uri: 'http://example.org/' })).toBe('http://example.org/age');
      });
    });

    describe('PodBooleanColumn', () => {
      it('应该正确初始化布尔列', () => {
        const column = new PodBooleanColumn('active');
        expect(column.name).toBe('active');
        expect(column.dataType).toBe('boolean');
      });

      it('应该生成正确的谓词', () => {
        const column = new PodBooleanColumn('active');
        expect(column.getPredicate({ prefix: 'ex', uri: 'http://example.org/' })).toBe('http://example.org/active');
      });
    });

    describe('引用列', () => {
      it('应该正确识别引用列', () => {
        const column = string('authorId').reference(SCHEMA_PERSON);
        expect(column.options.referenceTarget).toBe(SCHEMA_PERSON);
      });

      it('应该支持 inverse 标记', () => {
        const column = int('id').primaryKey().reference(SCHEMA_PERSON).inverse();
        expect(column.options.inverse).toBe(true);
        expect(column.options.referenceTarget).toBe(SCHEMA_PERSON);
      });

      it('relations 应该挂载关系元数据', () => {
        const users = podTable('users', {
          id: id(),
          name: string('name').predicate(FOAF_NAME)
        }, { 
          base: '/users/',
          type: SCHEMA_PERSON 
        });

        const posts = podTable('posts', {
          id: id(),
          authorId: int('authorId').notNull().reference(SCHEMA_PERSON).predicate('https://schema.org/author'),
        }, { 
          base: '/posts/',
          type: SCHEMA_BLOG_POSTING 
        });

        const postRelations = relations(posts, ({ one }) => ({
          author: one(users, {
            fields: [posts.authorId],
            references: [users.id]
          })
        }));

        expect(posts.relations).toBeDefined();
        expect(posts.relations?.author).toBeDefined();
        expect(posts.relations?.author.type).toBe('one');
        expect(posts.columns.authorId.getReferenceTarget()).toBe(SCHEMA_PERSON);
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
      const column = new PodStringColumn('type', { defaultValue: 'user' });
      expect(column.options.defaultValue).toBe('user');
    });

    it('应该支持自定义谓词选项', () => {
      const column = new PodStringColumn('name', { predicate: FOAF_NAME });
      expect(column.getPredicate()).toBe(FOAF_NAME);
    });
  });

  describe('inverse 谓词映射', () => {
    it('应该在表映射中记录 inverse 列', () => {
      const table = podTable('test', {
        id: id(),
        member: uri('member').predicate('http://example.org/memberOf').inverse()
      }, {
        base: '/test/',
        type: 'http://example.org/Group'
      });

      expect(table.mapping.columns.member.inverse).toBe(true);
    });
  });

  describe('链式方法', () => {
    it('应该支持 primaryKey() 方法', () => {
      const column = string('id').primaryKey();
      expect(column.options.primaryKey).toBe(true);
    });

    it('应该支持 notNull() 方法', () => {
      const column = string('name').notNull();
      expect(column.options.required).toBe(true);
    });

    it('应该支持 default() 方法', () => {
      const column = string('type').default('user');
      expect(column.options.defaultValue).toBe('user');
    });

    it('应该支持 predicate() 方法', () => {
      const column = string('name').predicate(FOAF_NAME);
      expect(column.options.predicate).toBe(FOAF_NAME);
    });

    it('应该支持 reference() 方法', () => {
      const column = string('authorId').reference(SCHEMA_PERSON);
      expect(column.options.referenceTarget).toBe(SCHEMA_PERSON);
    });

    it('应该支持链式调用', () => {
      const column = string('name')
        .notNull()
        .default('Unnamed')
        .predicate(FOAF_NAME);

      expect(column.options.required).toBe(true);
      expect(column.options.defaultValue).toBe('Unnamed');
      expect(column.options.predicate).toBe(FOAF_NAME);
    });

    it('应该支持 array() 方法', () => {
      const column = string('tags').array();
      expect(column.dataType).toBe('array');
      expect((column as any).elementType).toBe('string');
      expect(column.options.isArray).toBe(true);
    });

    it('应该支持 uri() 类型', () => {
      const column = uri('website');
      expect(column.dataType).toBe('uri');
    });

    it('应该支持 uri().array() 组合', () => {
      const column = uri('links').array();
      expect(column.dataType).toBe('array');
      expect((column as any).elementType).toBe('uri');
    });
  });

  describe('类型推断', () => {
    it('应该正确推断表数据类型', () => {
      const table = podTable('users', {
        id: id(),
        name: string('name').notNull().predicate(FOAF_NAME),
        age: int('age').predicate('https://schema.org/age'),
        active: boolean('active').default(true).predicate('https://schema.org/active')
      }, { 
        base: '/users/',
        type: SCHEMA_PERSON 
      });

      type User = InferTableData<typeof table>;
      
      const user: User = {
        id: '1',
        name: 'John',
        age: 30,
        active: true
      };
      
      expect(user.name).toBe('John');
    });

    it('应该正确推断插入数据类型', () => {
      const table = podTable('users', {
        id: id(),
        name: string('name').notNull().predicate(FOAF_NAME),
        age: int('age').predicate('https://schema.org/age'),
        active: boolean('active').default(true).predicate('https://schema.org/active')
      }, { 
        base: '/users/',
        type: SCHEMA_PERSON 
      });

      type NewUser = InferInsertData<typeof table>;
      
      const user: NewUser = {
        name: 'John'
      };
      
      expect(user.name).toBe('John');
    });

    it('应该正确推断更新数据类型', () => {
      const table = podTable('users', {
        id: id(),
        name: string('name').notNull().predicate(FOAF_NAME)
      }, { 
        base: '/users/',
        type: SCHEMA_PERSON 
      });

      type UpdateUser = InferUpdateData<typeof table>;
      
      const update: UpdateUser = {
        name: 'Jane'
      };
      
      expect(update.name).toBe('Jane');
    });

    it('应该支持引用类型', () => {
      const table = podTable('posts', {
        id: id(),
        authorId: uri('authorId').reference(SCHEMA_PERSON).predicate('https://schema.org/author')
      }, { 
        base: '/posts/',
        type: SCHEMA_BLOG_POSTING 
      });

      type Post = InferTableData<typeof table>;
      const post: Post = {
        id: '1',
        authorId: 'https://example.org/users/1'
      };
      expect(post.authorId).toBe('https://example.org/users/1');
    });
  });

  describe('新的列定义函数', () => {
    it('应该支持 string() 函数', () => {
      const col = string('name').predicate(FOAF_NAME);
      expect(col.name).toBe('name');
      expect(col.dataType).toBe('string');
    });

    it('应该支持 int() 函数', () => {
      const col = int('age').predicate('https://schema.org/age');
      expect(col.name).toBe('age');
      expect(col.dataType).toBe('integer');
    });

    it('应该支持 boolean() 函数', () => {
      const col = boolean('active').predicate('https://schema.org/active');
      expect(col.name).toBe('active');
      expect(col.dataType).toBe('boolean');
    });

    it('应该支持 date() 函数', () => {
      const col = date('created').predicate('https://schema.org/dateCreated');
      expect(col.name).toBe('created');
      expect(col.dataType).toBe('datetime');
    });

    it('应该支持 json() 函数', () => {
      const col = json('config').predicate('https://example.org/config');
      expect(col.name).toBe('config');
      expect(col.dataType).toBe('json');
    });

    it('应该支持 object() 函数', () => {
      const col = object('profile').predicate('https://example.org/profile');
      expect(col.name).toBe('profile');
      expect(col.dataType).toBe('object');
    });

    it('ColumnBuilder 应该在 podTable 中转换为具体列类型', () => {
      const table = podTable('users', {
        id: id(),
        name: string('name').predicate(FOAF_NAME)
      }, { 
        base: '/users/',
        type: SCHEMA_PERSON 
      });

      expect(table.columns.name instanceof PodStringColumn).toBe(true);
    });
  });

  describe('新的列类型', () => {
    describe('PodJsonColumn', () => {
      it('应该正确初始化 JSON 列', () => {
        const column = new PodJsonColumn('data');
        expect(column.name).toBe('data');
        expect(column.dataType).toBe('json');
      });

      it('应该生成正确的谓词', () => {
        const column = new PodJsonColumn('data');
        expect(column.getPredicate({ prefix: 'ex', uri: 'http://example.org/' })).toBe('http://example.org/data');
      });

      it('应该支持链式方法', () => {
        const column = new PodJsonColumn('data').notNull().default({});
        expect(column.options.required).toBe(true);
        expect(column.options.defaultValue).toEqual({});
      });
    });

    describe('PodObjectColumn', () => {
      it('应该正确初始化 Object 列', () => {
        const column = new PodObjectColumn('profile');
        expect(column.name).toBe('profile');
        expect(column.dataType).toBe('object');
      });

      it('应该生成正确的谓词', () => {
        const column = new PodObjectColumn('profile');
        expect(column.getPredicate({ prefix: 'ex', uri: 'http://example.org/' })).toBe('http://example.org/profile');
      });

      it('应该支持链式方法', () => {
        const column = new PodObjectColumn('profile').notNull();
        expect(column.options.required).toBe(true);
      });
    });

    describe('id helper', () => {
      it('should set predicate to @id and be primary key', () => {
        const col = id();
        expect(col.options.predicate).toBe('@id');
        expect(col.options.primaryKey).toBe(true);
      });
    });

    describe('typeIndex option validation', () => {
      it('should disable TypeIndex when an invalid value is provided', () => {
        const table = podTable('test', { id: id() }, {
          base: '/test/',
          type: SCHEMA_PERSON,
          typeIndex: 'none' as any
        });
        expect(table.config.typeIndex).toBeUndefined();
      });
    });
  });

  describe('JSON 和 Object 类型推断', () => {
    it('应该正确推断包含 JSON 和 Object 字段的表类型', () => {
      const table = podTable('settings', {
        id: id(),
        config: json('config').predicate('http://example.org/config'),
        profile: object('profile').predicate('http://example.org/profile')
      }, {
        base: '/settings/',
        type: 'http://example.org/Settings'
      });

      type Settings = InferTableData<typeof table>;
      
      const s: Settings = {
        id: '1',
        config: { theme: 'dark', fontSize: 14 },
        profile: { avatar: 'http://example.org/img.png', bio: 'Hello' }
      };

      expect(s.config).toEqual({ theme: 'dark', fontSize: 14 });
      expect(s.profile).toEqual({ avatar: 'http://example.org/img.png', bio: 'Hello' });
    });

    it('应该支持 JSON 和 Object 字段的插入数据', () => {
      const table = podTable('settings', {
        id: id(),
        config: json('config').predicate('http://example.org/config')
      }, {
        base: '/settings/',
        type: 'http://example.org/Settings'
      });

      type NewSettings = InferInsertData<typeof table>;
      const ns: NewSettings = {
        config: { a: 1 }
      };
      expect(ns.config).toEqual({ a: 1 });
    });

    it('应该支持 JSON 和 Object 字段的更新数据', () => {
      const table = podTable('settings', {
        id: id(),
        config: json('config').predicate('http://example.org/config')
      }, {
        base: '/settings/',
        type: 'http://example.org/Settings'
      });

      type UpdateSettings = InferUpdateData<typeof table>;
      const us: UpdateSettings = {
        config: { a: 2 }
      };
      expect(us.config).toEqual({ a: 2 });
    });
  });

  describe('PodTable.$schema', () => {
    const posts = podTable('posts', {
      id: id(),
      title: string('title').predicate('https://schema.org/headline'),
    }, {
      base: '/posts/',
      type: SCHEMA_BLOG_POSTING,
      subjectTemplate: '{id}.ttl'
    });

    it('should return a PodSchema with $kind identifier', () => {
      const schema = posts.$schema;

      expect(schema.$kind).toBe('SolidSchema');
      expect(schema.type).toBe(SCHEMA_BLOG_POSTING);
      expect(schema.columns).toBe(posts.columns);
    });

    it('should include subjectTemplate if defined', () => {
      const schema = posts.$schema;
      expect(schema.subjectTemplate).toBe('{id}.ttl');
    });

    it('should include namespace if defined', () => {
      const table = podTable('users', { id: id() }, {
        base: '/users/',
        type: SCHEMA_PERSON,
        namespace: { prefix: 'ex', uri: 'http://example.org/' }
      });
      expect(table.$schema.namespace).toEqual({ prefix: 'ex', uri: 'http://example.org/' });
    });

    it('should include subClassOf if defined', () => {
      const table = podTable('users', { id: id() }, {
        base: '/users/',
        type: SCHEMA_PERSON,
        subClassOf: ['https://schema.org/Thing']
      });
      expect(table.$schema.subClassOf).toContain('https://schema.org/Thing');
    });

    it('should not include base in schema (federated query use case)', () => {
      const schema = posts.$schema;
      expect((schema as any).base).toBeUndefined();
    });
  });

  describe('relations() with federated discover', () => {
    const usersSchema = podTable('users', {
      id: id(),
      name: string('name').predicate(FOAF_NAME)
    }, { 
      base: '/users/',
      type: SCHEMA_PERSON 
    }).$schema;

    const posts = podTable('posts', {
      id: id(),
      authorId: uri('authorId').reference(SCHEMA_PERSON).predicate('https://schema.org/author'),
    }, { 
      base: '/posts/',
      type: SCHEMA_BLOG_POSTING 
    });

    it('should support discover option with PodSchema', () => {
      const postRelations = relations(posts, ({ one }) => ({
        author: one(usersSchema, {
          discover: (post) => 'https://example.org/profile/card#me',
          fields: [posts.authorId]
        })
      }));

      expect(posts.relations?.author.discover).toBeDefined();
      expect(posts.relations?.author.isFederated).toBe(true);
    });

    it('should mark relation as non-federated when using PodTable', () => {
      const usersTable = podTable('users', { id: id() }, { base: '/u/', type: SCHEMA_PERSON });
      const r = relations(posts, ({ one }) => ({
        author: one(usersTable)
      }));
      expect(posts.relations?.author.isFederated).toBe(false);
    });

    it('should support discover returning array of webIds', () => {
      const r = relations(posts, ({ one }) => ({
        author: one(usersSchema, {
          discover: () => ['https://pod1.com/card#me', 'https://pod2.com/card#me']
        })
      }));
      expect(posts.relations?.author.discover!({})).toHaveLength(2);
    });
  });
});
