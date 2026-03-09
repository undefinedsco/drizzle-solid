# API 参考

这份文档描述当前推荐的 `drizzle-solid` 公共 API。

新的重点不是强推新的构造函数名字，而是把语义讲清楚：

- Resource / Document / Entity / IRI
- Link 而不是 SQL foreign-key 心智
- list/filter 读取 与 exact-target mutation 的区分
- SPARQL 而不是 raw SQL 的 escape hatch

仓库文档与 examples 默认先展示 semantic-first surface（`pod()` / `collection()` / `entity()`），再补充 Drizzle-shaped surface。

## 构造入口

### `pod(session, config?)`

`pod()` 是建立在同一运行时之上的语义优先 façade。

仓库里的新文档和 examples 默认用它来表达这些对象：

- `collection(table)`
- `entity(table, iri)`
- `bind(schema, options)`

```ts
import { pod } from '@undefineds.co/drizzle-solid';

const client = pod(session, {
  schema,
  autoConnect: false,
});
```

### `drizzle(session, config?)`

这是同一运行时上的 Drizzle-aligned 标准构造入口。

```ts
import { drizzle } from '@undefineds.co/drizzle-solid';

const db = drizzle(session, {
  schema,
  autoConnect: false,
  sparql: {
    createQueryEngine,
  },
});
```

常用配置：
- `schema`: 传入表注册表，启用 link 解析和 Drizzle-shaped 查询层
- `autoConnect`: 是否自动连接 Pod
- `debug`: 输出调试日志
- `sparql.createQueryEngine`: 注入自定义 SPARQL QueryEngine 工厂
- `notifications.preferredChannels`: 通知通道偏好顺序

### `solid({ webId, fetch })`

这是轻量 inline session helper，用于先构造一个最小 Solid session：

```ts
import { pod, solid } from '@undefineds.co/drizzle-solid';

const session = solid({
  webId: 'https://alice.example/profile/card#me',
  fetch: authenticatedFetch,
});

const client = pod(session);
```

## 建模

### `podTable(name, columns, config)`

当前仍然是主要建模入口。

关键配置：
- `base`: 资源文件或容器路径
- `subjectTemplate`: subject 生成模板
- `type`: RDF class IRI
- `namespace`: 可选命名空间配置
- `sparqlEndpoint`: 显式指定 sidecar endpoint

列级链接字段统一写成 `uri(...).link(target)`。

### `solidSchema(...)`

适合定义可复用 schema。

如果你使用 `pod()` façade：

```ts
const profileTable = client.bind(profileSchema, {
  base: 'https://alice.example/profile/card',
});
```

如果你保持 `drizzle()` 入口：

```ts
const profileTable = db.createTable(profileSchema, {
  base: 'https://alice.example/profile/card',
});
```

## Drizzle-shaped surface

如果你保持 Drizzle 风格 builder / query 代码形状，这一层仍然是正式支持的公共 API。

### Query builders

当前仍支持：
- `db.select()`
- `db.insert()`
- `db.update()`
- `db.delete()`

### Read facade

当前仍支持：
- `db.query.<table>`
- `findMany`
- `findFirst`
- `findById`
- `findByIri`
- `count`

这部分能力是 **读导向 facade**，不应该被理解成“所有 SQL 语义都成立”。

## Semantic-first surface

### `client.collection(table)`

Collection 表达“一个模型在某个 Pod 布局下的可枚举实体集合”。

支持：
- `list(options?)`
- `first(options?)`
- `create(record)` / `createMany(records)`
- `subscribe(options)`
- `iriFor(record)`
- `byIri(iri)` / `entity(iri)`
- `select(fields?)`

### `client.entity(table, iri)`

Entity 表达“一个由完整 IRI 唯一标识的实体”。

支持：
- `get()` / `read()`
- `update(data)`
- `delete()`
- `subscribe(options)`
- `documentUrl`
- `fragment`

这组 helper 的价值是把“集合读取”和“精确实体目标”显式写在代码里。

## Discovery / Federation helpers

如果你使用 `pod()` façade，还可以直接通过 `client` 访问：

- `client.discovery.discover(...)`
- `client.locationToTable(location, options?)`
- `client.discoverTablesFor(rdfClass, options?, tableOptions?)`
- `client.query`
- `client.getLastFederatedErrors()`

如果你使用 `drizzle()`，对应能力仍然在 `db` 上可用。

## SPARQL API

### `client.sparql(query)` / `db.executeSPARQL(query)`

显式 SPARQL 入口：

```ts
await db.executeSPARQL(`SELECT ?s WHERE { ?s ?p ?o } LIMIT 10`);
```

或者：

```ts
await client.sparql(`SELECT ?s WHERE { ?s ?p ?o } LIMIT 10`);
```

这是图查询 escape hatch，**只接受 SPARQL，不接受 raw SQL**。

### Builder 输出

查询构建器支持：
- `toSPARQL()`
- `toSparql()`

当前 **不再提供** `toSQL()` 兼容别名。

## 语义边界

### 读和写的目标解析不同

- list/filter 读取可以保持 collection-oriented
- 写入应该优先 exact-target semantics
- 信息不足时不会静默退化成 scan + mutate

如果 `subjectTemplate` 需要多个变量才能唯一定位 subject，就不要把 mutation 建立在模糊 `where(...)` 之上；优先显式使用 IRI。

## 什么时候该用哪个入口

### 用 `pod()` façade

适合：
- 你想把集合读取和精确实体操作写得更显式
- 你希望 `collection()` / `entity()` / `bind()` 这些名字直接出现在代码里
- 你在写新的业务代码，或希望统一团队的 Solid 语义表达

### 继续用 `drizzle()`

适合：
- 你已经大量使用 Drizzle 风格 builder
- 你想先保留原来的代码形状
- 你当前更关心迁移成本，而不是 API 组织方式

## 不承诺的能力

当前不把以下能力当作稳定主线契约：
- raw SQL / `sql`` fragment` surface
- `toSQL()`
- 隐式扫描式 `updateMany/deleteMany`
- 与关系数据库完全一致的事务、DDL、自增、外键语义

## 相关阅读

- `README.md`
- `docs/guides/installation.md`
- `docs/guides/migrating-from-drizzle-orm.md`
- `docs/guides/multi-variable-templates.md`
- `docs/xpod-features.md`
