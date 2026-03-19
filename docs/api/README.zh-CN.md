# API 参考

English version: [`README.md`](README.md)

这份文档从使用者角度回答三个问题：

- 我该用 `pod()` 还是 `drizzle()`？
- 常见任务分别该调用哪个 API？
- 哪些边界是当前版本的硬约束？

## 先选入口

### `pod(session, config?)`

适合新代码，或者你希望 API 直接体现 Solid 语义：

- `collection(table)`
- `entity(table, iri)`
- `bind(schema, options)`
- `sparql(query)`

```ts
import { pod } from '@undefineds.co/drizzle-solid';

const client = pod(session, {
  schema,
  autoConnect: false,
});
```

### `drizzle(session, config?)`

适合迁移自 `drizzle-orm`，或者你想保留 builder / facade 形状：

- `select / insert / update / delete`
- `db.query.<table>`
- `findByLocator / findByIri`
- `updateByLocator / updateByIri`
- `deleteByLocator / deleteByIri`

```ts
import { drizzle } from '@undefineds.co/drizzle-solid';

const db = drizzle(session, {
  schema,
  autoConnect: false,
});
```

两者底层是同一运行时。区别是 API 组织方式，不是存储语义。

### `solid({ webId, fetch })`

这是一个轻量 inline session helper，适合你已经有认证后的 `fetch`：

```ts
import { pod, solid } from '@undefineds.co/drizzle-solid';

const session = solid({
  webId: 'https://alice.example/profile/card#me',
  fetch: authenticatedFetch,
});

const client = pod(session);
```

## 常见任务对应哪个 API

| 任务 | 推荐 API |
| --- | --- |
| 新建业务代码 | `pod(session)` |
| 保留 Drizzle 风格 | `drizzle(session)` |
| 定义带存储布局的模型 | `podTable(name, columns, config)` |
| 定义可复用 schema | `solidSchema(...)` |
| 运行时把 schema 绑定到位置 | `client.bind(...)` / `db.createTable(...)` |
| 列表 / 过滤读取 | `collection(table).list(...)` / `db.select()` / `db.query.<table>.findMany()` |
| 精确读取单个实体 | `client.entity(table, iri)` / `db.findByIri(...)` / `db.findByLocator(...)` |
| 精确更新单个实体 | `entity.update(...)` / `db.updateByIri(...)` / `db.updateByLocator(...)` |
| 精确删除单个实体 | `entity.delete()` / `db.deleteByIri(...)` / `db.deleteByLocator(...)` |
| 直接执行 SPARQL | `client.sparql(...)` / `db.executeSPARQL(...)` |
| 把发现结果转成表定义 | `client.locationToTable(...)` / `db.locationToTable(...)` |
| 按 RDF class 发现表 | `client.discoverTablesFor(...)` / `db.discoverTablesFor(...)` |

## 建模 API

### `podTable(name, columns, config)`

这是主线建模入口。除了列定义，你还要定义数据放在哪里。

关键配置：

- `base`: 文档或容器位置
- `subjectTemplate`: 行身份如何映射成 IRI
- `type`: 主持久化 `rdf:type`
- `namespace`: 可选命名空间
- `sparqlEndpoint`: 显式 sidecar / endpoint

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

### `solidSchema(...)`

适合“先定义形状，再在运行时绑定位置”的场景。

```ts
const profileTable = client.bind(profileSchema, {
  base: 'https://alice.example/profile/card',
});
```

或：

```ts
const profileTable = db.createTable(profileSchema, {
  base: 'https://alice.example/profile/card',
});
```

### Link 字段

关系字段优先按 RDF link / IRI 来理解。

推荐写法：

- `uri(...).link(target)`

不要默认把它当成“数据库外键列”。

## `pod()` 风格 API

### `client.collection(table)`

用于“集合”语义。

常用方法：

- `list(options?)`
- `first(options?)`
- `create(record)`
- `createMany(records)`
- `subscribe(options)`
- `iriFor(record)`
- `entity(iri)` / `byIri(iri)`
- `select(fields?)`

### `client.entity(table, iri)`

用于“一个精确实体”语义。

常用方法：

- `get()` / `read()`
- `update(data)`
- `delete()`
- `subscribe(options)`
- `documentUrl`
- `fragment`

### 其他 `client` 能力

- `bind(schema, options)`
- `asDrizzle()`
- `query`
- `sparql(query)`
- `batch(operations)`
- `locationToTable(location, options?)`
- `discoverTablesFor(rdfClass, options?, tableOptions?)`
- `discovery`
- `getLastFederatedErrors()`

## `drizzle()` 风格 API

### Query builders

当前支持：

- `db.select()`
- `db.insert()`
- `db.update()`
- `db.delete()`

### Read facade

当前支持：

- `db.query.<table>.findMany(...)`
- `db.query.<table>.findFirst(...)`
- `db.query.<table>.findByLocator(...)`
- `db.query.<table>.findByIri(...)`
- `db.query.<table>.count(...)`

### Exact-target helpers

这是单实体读写的正式入口：

- `db.findByLocator(table, locator)`
- `db.findByIri(table, iri)`
- `db.updateByLocator(table, locator, data)`
- `db.updateByIri(table, iri, data)`
- `db.deleteByLocator(table, locator)`
- `db.deleteByIri(table, iri)`

## SPARQL API

### `client.sparql(query)` / `db.executeSPARQL(query)`

这是图查询 escape hatch，只接受 SPARQL。

```ts
await db.executeSPARQL(`
  SELECT ?s WHERE {
    ?s ?p ?o .
  }
  LIMIT 10
`);
```

### Builder 输出

查询构建器支持：

- `toSPARQL()`
- `toSparql()`

当前不提供 `toSQL()`。

## 关键语义边界

### 1. 列表读取和精确目标不是一回事

列表 / 过滤读取可以是 collection-oriented：

- `collection().list(...)`
- `db.select().from(...).where(...)`
- `db.query.<table>.findMany(...)`

单实体操作应该显式走 exact-target API：

- `entity(table, iri)`
- `findByIri`
- `findByLocator`
- `updateByIri` / `updateByLocator`
- `deleteByIri` / `deleteByLocator`

### 2. 公共 `where()` 不再承担“按 id 精确命中”

不要再把下面这些当成单实体捷径：

- `where({ id: ... })`
- `where({ '@id': ... })`
- `where(eq(table.id, ...))`

正确做法是改用 exact-target helper。

### 3. 多变量模板必须补齐 locator

例如：

```ts
subjectTemplate: '{chatId}/messages.ttl#{id}'
```

这时只给 `id` 不够，必须：

- 给完整 IRI，或
- 给完整 locator，例如 `{ chatId, id }`

### 4. plain LDP document mode 有明确边界

如果没有 SPARQL endpoint / sidecar / index：

- exact-target read/write 仍然支持
- collection 查询不保证可用
- 不会静默扩成全局扫描

## 当前不承诺的能力

以下不属于当前稳定主线契约：

- raw SQL / `sql`` fragment`
- `toSQL()`
- 隐式扫描式 `updateMany/deleteMany`
- 关系数据库式外键、DDL、自增和完全等价事务语义

## 相关阅读

- `README.md`
- `docs/guides/installation.md`
- `docs/guides/migrating-from-drizzle-orm.md`
- `docs/guides/multi-variable-templates.md`
- `docs/guides/notifications.md`
