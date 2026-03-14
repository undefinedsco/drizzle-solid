# 从 `drizzle-orm` 迁移到 `drizzle-solid`

这不是 `drizzle-solid` 版本升级指南。

这份文档面向已经熟悉 SQL 版 `drizzle-orm` 的开发者，帮助你把原来的建模与查询习惯迁移到 Solid Pod 的数据模型里。

## 先记住四个变化

1. **表/行不是主语义，文档/IRI 才是**
2. **引用不再只是 foreign key，更接近 RDF link**
3. **写操作需要更强调 exact-target，而不是默认 SQL 式 set-based mutation**
4. **类层级放在 schema / vocabulary，实例默认只保留一个主 `rdf:type`**

## 先说结论

**你不需要第一步就把 `drizzle(session)` 改掉。**

如果你继续这样写：

```ts
const db = drizzle(session);
```

完全没问题。

不过仓库文档与 examples 在讲新代码时，会默认使用 `pod()` 来直接表达 `collection()` / `entity()` / `bind()` / link 语义。

迁移真正要处理的是：

- `table` 如何映射到 Pod resource layout
- `id` 与 `@id` / IRI 的关系
- `link` 字段如何映射到 RDF link
- `type` / `subClassOf` 如何表达类层级，而不是再复制一套字符串分类系统
- `where(...)` 在读和写上的语义差异
- `toSQL()` / raw SQL 心智如何迁到 SPARQL

## 心智模型对照

| `drizzle-orm` | `drizzle-solid` |
| --- | --- |
| table | Pod 中的一类实体布局 |
| row primary key | subject IRI / `@id` |
| SQL table location | `base` + `subjectTemplate` |
| constructor | `drizzle(session)` 仍可继续使用 |
| semantic-first helper | `pod(session)` 是新代码默认语义 façade |
| `pgTable/mysqlTable/sqliteTable` | `podTable` |
| 可复用 schema + 实例化表 | `solidSchema(...)` + `db.createTable(...)` 或 `client.bind(...)` |
| `where(id = ...)` 更新单行 | 更推荐精确 IRI target |
| raw SQL / `sql`` | raw SPARQL / `executeSPARQL()` / `client.sparql()` |
| `toSQL()` | `toSPARQL()` / `toSparql()` |

## 推荐迁移路径

### 第一步：先别急着改构造入口

先保持原来的入口：

```ts
const db = drizzle(session);
```

把迁移重心放在：

- schema 的 `base` / `subjectTemplate`
- 引用字段的 IRI/link 语义
- exact-target 写路径
- SPARQL 心智

### 第二步：把“存哪里”定义清楚

SQL 世界里你通常定义列和约束；在 Solid 里你还必须定义“数据放在哪里”。

```ts
const posts = podTable('posts', {
  id: string('id').primaryKey(),
  title: string('title').predicate('http://schema.org/headline'),
  content: string('content').predicate('http://schema.org/text'),
}, {
  base: 'https://alice.example/data/posts/',
  subjectTemplate: '{id}.ttl',
  type: 'http://schema.org/CreativeWork',
});
```

### 第三步：把引用理解成 Link

建议：

- 新代码优先用 `uri(...).link(target)` 表达链接
- 存完整 IRI，或者存能稳定补全为 IRI 的值
- 不要直接把 SQL 外键约束语义投射到 Pod 存储上

### 第四步：区分“读的 where”和“写的 target”

读查询里，`where(...)` 仍然非常有用。

但写查询里，要避免把 SQL 的“按条件更新一批行”心智直接照搬过来。

当目标依赖完整模板变量或完整 subject 时，更推荐：

- 使用完整 IRI
- 或使用 `entity(table, iri)` 这类显式 helper façade

## 建模迁移

### SQL 表定义 → `podTable(...)`

```ts
const posts = podTable('posts', {
  id: string('id').primaryKey(),
  title: string('title').predicate('http://schema.org/headline'),
}, {
  base: 'https://alice.example/data/posts/',
  subjectTemplate: '{id}.ttl',
  type: 'http://schema.org/CreativeWork',
});
```

你需要额外思考：

- 是一个文档里放很多实体，还是一实体一文档
- 公开数据和私有数据是否分容器
- 关联关系是同文档 fragment，还是跨文档 IRI

### SQL discriminator / kind 列 → RDF 类型层级

在 SQL 里，很多项目会用：

- `type`
- `kind`
- `category`

去表达“这条记录属于哪个子类”。

迁移到 `drizzle-solid` 时要先区分两种情况：

- 如果它表达的是**RDF 类成员身份**，优先用 `type` / `subClassOf`
- 如果它表达的是**另一种业务维度**（如状态、来源、执行模式），再保留普通字段

默认口径：

- schema 层用 `subClassOf` 表达类层级
- 实例层默认只持久化一个最具体、最权威的 `rdf:type`
- 不要同时把父类、子类、以及一列字符串 `kind` 都写成同一种语义

只有在明确需要兼容无推理环境时，才考虑显式物化父类类型；那应是兼容选项，不应是默认形状。

### 复用 schema

如果你想保持 Drizzle-aligned 入口：

```ts
const db = drizzle(session);
const profileTable = db.createTable(profileSchema, {
  base: 'https://alice.example/profile/card',
});
```

如果你更喜欢显式 façade：

```ts
const client = pod(session);
const profileTable = client.bind(profileSchema, {
  base: 'https://alice.example/profile/card',
});
```

## CRUD 迁移

### Create

保留 builder 风格完全可以：

```ts
await db.insert(posts).values({
  id: 'post-1',
  title: 'Hello Solid',
});
```

如果你喜欢显式集合语义，也可以：

```ts
await client.collection(posts).create({
  id: 'post-1',
  title: 'Hello Solid',
});
```

### Read list / filter

```ts
const rows = await db.select().from(posts).where({ id: 'post-1' });
```

或者：

```ts
const rows = await client.collection(posts).list({
  where: { id: 'post-1' },
});
```

### Read exact entity

当你已经有完整 IRI 时，应该把它当成真正的身份：

```ts
const row = await db.findByIri(posts, iri);
```

或者用更显式的 façade：

```ts
const row = await client.entity(posts, iri).get();
```

### Update / Delete

迁移时最容易犯的错，是把 SQL 的“按条件更新单行”直接照搬过来。

在 Solid 里，更安全的理解是：

- list/filter read 仍然可以是条件驱动
- write path 更应该是 exact-target 驱动

例如：

```ts
await client.entity(posts, iri).update({ title: 'Updated' });
await client.entity(posts, iri).delete();
```

这不是因为必须改用 `pod()`，而是因为 **写语义本身变了**。

## 为什么写操作强调 IRI

当 `subjectTemplate` 是多变量时，例如：

```ts
subjectTemplate: '{chatId}/messages.ttl#{id}'
```

那么：

- 读查询可以提供部分条件，在边界可控时做读取
- 写查询不应该在信息不足时静默退化成全局扫描

因此迁移建议是：

- 列表页 / 检索页：继续走 `select().where(...)` 或集合读取都可以
- 详情页 / 精确变更：优先拿到 `@id`，按精确目标写

## Raw SQL 迁移

如果旧代码大量使用：

- raw SQL
- `sql`` fragment`
- `toSQL()`

迁移时要明确：

- `drizzle-solid` 的原生图查询 escape hatch 是 **SPARQL**
- 主线 builder 输出是 `toSPARQL()` / `toSparql()`
- 当前不建议继续保留 `toSQL()` 心智

示例：

```ts
await db.executeSPARQL(`
  SELECT ?s WHERE {
    ?s a <http://schema.org/CreativeWork> .
  }
  LIMIT 10
`);
```

## `pod()` 到底是什么

`pod()` 不是强制迁移目标。

更准确地说，它是一个 **显式语义 façade**：

- `collection(table)`：强调“集合读取”
- `entity(table, iri)`：强调“精确实体目标”
- `bind(schema, options)`：强调“运行时绑定位置”

如果这些名字能帮助你的团队写出更清晰的 Solid 代码，就用。

如果你更想保留 `drizzle()` 作为主构造入口，也完全可以。

## 推荐迁移顺序

1. 先把认证接到 Solid `session`
2. 保持 `drizzle(session)` 也没问题，不必急着改入口名
3. 把 SQL 表定义迁到 `podTable(...)`
4. 明确每个模型的 `base` / `subjectTemplate`
5. 把关系字段改成 IRI/link 心智
6. 区分 list/filter 读取 与 exact-target 写入
7. 把 raw SQL / `toSQL()` 迁到 SPARQL 语义
8. 最后再决定是否要在部分业务代码里采用 `pod()` façade

## 迁移检查清单

- [ ] 已明确每个模型的 `base` / `subjectTemplate`
- [ ] 已明确哪些字段代表 link / IRI
- [ ] 已区分读取的条件语义与写入的目标语义
- [ ] 已评估 raw SQL 是否需要改写为 SPARQL
- [ ] 已验证真实 Pod / example 场景
- [ ] 已决定是否需要在部分代码中采用 `pod()` façade

## 相关阅读

- `README.md`
- `docs/api/README.md`
- `docs/guides/installation.md`
- `docs/guides/multi-variable-templates.md`
- `examples/01-quick-start.ts`
- `examples/08-iri-based-operations.ts`
