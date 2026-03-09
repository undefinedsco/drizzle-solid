# API 参考

这份文档描述当前对外推荐的 `drizzle-solid` 公共 API，以及和 Drizzle 对齐时需要注意的 Solid 语义边界。

## 入口

### `drizzle(session, config?)`

创建数据库实例。

```ts
import { drizzle } from '@undefineds.co/drizzle-solid';

const db = drizzle(session, {
  schema,
  autoConnect: false,
  debug: false,
  sparql: {
    createQueryEngine,
  },
});
```

常用配置：
- `schema`: 传入表注册表，启用 `db.query.<table>` facade 和引用补全
- `autoConnect`: 是否自动连接 Pod
- `debug`: 输出调试日志
- `sparql.createQueryEngine`: 注入自定义 SPARQL QueryEngine 工厂
- `notifications.preferredChannels`: 通知通道偏好顺序

### `solid({ webId, fetch })`

为轻量场景创建 inline session，不依赖 Inrupt `Session` 实例：

```ts
import { solid, drizzle } from '@undefineds.co/drizzle-solid';

const session = solid({
  webId: 'https://alice.example/profile/card#me',
  fetch: authenticatedFetch,
});

const db = drizzle(session);
```

## 建模

### `podTable(name, columns, config)`

推荐的建模入口。关键配置：
- `base`: 资源文件或容器路径
- `subjectTemplate`: subject 生成模板
- `type`: RDF class IRI
- `namespace`: 可选命名空间配置
- `sparqlEndpoint`: 显式指定 sidecar endpoint

### `solidSchema(...)` + `db.createTable(...)`

适合复用 schema、把布局绑定延后到运行时的场景。

## 查询与写入

### CRUD builders

主线 API：
- `db.select()`
- `db.insert(table)`
- `db.update(table)`
- `db.delete(table)`

支持的常见能力：
- `where(...)`
- `limit(...)` / `offset(...)`
- `orderBy(...)`
- `leftJoin(...)` / `innerJoin(...)` 等 join builder
- `count` / `sum` / `avg` / `min` / `max`
- `returning()`（仅在当前方言实现处可用）

### `db.query.<table>` facade

这是一个 **读导向** facade，当前推荐用法包括：
- `findMany(...)`
- `findFirst(...)`
- `findById(...)`
- `findByIRI(...)`（兼容入口）
- `count(...)`

注意：`db.query.*` 不承诺隐式扫描式 `updateMany/deleteMany`。

## IRI-first API

对于详情页、远端资源、共享资源、精确变更目标，优先使用显式 IRI API：
- `db.findByIri(table, iri)`
- `db.updateByIri(table, iri, data)`
- `db.deleteByIri(table, iri)`
- `db.subscribeByIri(table, iri, options)`

这是当前推荐的单实体精确操作方式。

## SPARQL API

### Builder 输出

查询构建器支持：
- `toSPARQL()`
- `toSparql()`

当前 **不再提供** `toSQL()` 兼容别名。

### 直接执行

```ts
await db.executeSPARQL(`SELECT ?s WHERE { ?s ?p ?o } LIMIT 10`);
```

或：

```ts
await db.execute(`ASK { ?s ?p ?o }`);
```

这里的 `execute()` 是 `executeSPARQL()` 的别名，**只接受 SPARQL，不接受 raw SQL**。

## SPARQL 引擎装配

### 默认模式

如果应用本身安装了 `@comunica/query-sparql-solid`，库会按默认方式懒加载它。

当前公共兼容口径：
- 官方支持 `@comunica/query-sparql-solid` `4.x`
- `3.x` 暂不纳入正式支持矩阵

### 实例级注入

```ts
const db = drizzle(session, {
  sparql: {
    createQueryEngine: async () => {
      const { QueryEngine } = await import('@comunica/query-sparql-solid');
      return new QueryEngine();
    },
  },
});
```

### 复用 `xpod` 自带依赖

```ts
import { createRequire } from 'node:module';
import {
  drizzle,
  createNodeModuleSparqlEngineFactory,
} from '@undefineds.co/drizzle-solid';

const requireFromHere = createRequire(import.meta.url);

const db = drizzle(session, {
  sparql: {
    createQueryEngine: createNodeModuleSparqlEngineFactory(
      requireFromHere.resolve('@undefineds.co/xpod/package.json')
    ),
  },
});
```

### 进程级默认配置

```ts
import {
  configureSparqlEngine,
  createNodeModuleSparqlEngineFactory,
} from '@undefineds.co/drizzle-solid';

configureSparqlEngine({
  createQueryEngine: createNodeModuleSparqlEngineFactory('/absolute/path/to/package.json'),
});
```

## 语义边界

### 读和写的 `where(...)` 语义不同

- 读查询可以承载 list/filter 语义
- 写操作默认要求 deterministic target
- 信息不足时不会静默退化成 scan + mutate

如果 `subjectTemplate` 需要多个变量才能唯一定位 subject，而 `where(...)` 没提供足够信息，推荐：
- 补齐模板变量
- 或改用 `db.updateByIri()` / `db.deleteByIri()`

### 不承诺的能力

当前不把以下能力当作稳定主线契约：
- raw SQL / `sql`` fragment` 兼容层
- `toSQL()`
- 隐式扫描式 `updateMany/deleteMany`
- 与关系数据库完全一致的事务、DDL、自增、外键语义

## 相关阅读

- `README.md`
- `docs/guides/installation.md`
- `docs/guides/multi-variable-templates.md`
- `docs/xpod-features.md`
