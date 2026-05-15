# drizzle-solid

English version: [`README.md`](README.md)

`drizzle-solid` 用类型化 schema 和 Drizzle 对齐的开发体验，把应用自有数据存进 Solid Pod。

适合在你需要下面这些能力时使用：

- 用 TypeScript schema 描述 Pod 数据
- 用 `base` 和 `subjectTemplate` 明确声明数据布局
- 在 `pod()` 和 `drizzle()` 两种 API 风格之间选择
- 通过 base-relative id 或 IRI 精确读写单个资源
- 在后端提供查询能力时走 SPARQL 读取

## 它擅长什么

- 应用自有数据存储在你的 Pod 或用户 Pod 中
- 对已知资源布局做类型化 CRUD
- 从 `drizzle-orm` 逐步迁移，而不假装 Pod 就是 SQL 表
- 使用 IRI、文档、链接、发现、通知、联邦等 Pod 原生概念

## 它不打算做什么

- 通用 RDF 图探索工具
- 所有 Solid 后端上的完整 SQL / 数据库能力对齐
- 隐藏 Pod 边界、权限或网络成本
- raw SQL 优先的抽象层

## 安装

```bash
yarn add @undefineds.co/drizzle-solid drizzle-orm
# 可选：当你的应用需要内置 SPARQL 引擎时再安装
yarn add @comunica/query-sparql-solid
```

```bash
npm install @undefineds.co/drizzle-solid drizzle-orm
# 可选：当你的应用需要内置 SPARQL 引擎时再安装
npm install @comunica/query-sparql-solid
```

`@comunica/query-sparql-solid` 是可选 peer dependency。

当前支持范围：

- 支持：`@comunica/query-sparql-solid` `4.x`
- 当前不在支持矩阵中：`3.x`

如果宿主运行时已经自带 Comunica，就注入那一份，不要再装第二份。

## 选择 API 风格

### `pod(session)`

适合新代码，或者你希望 API 直接体现 Solid 语义：

- `collection(table)`
- `entity(resource, iri)`
- `bind(schema, options)`
- `sparql(query)`

### `drizzle(session)`

适合从 `drizzle-orm` 迁移，或者你想保留 builder 形状：

- `select / insert / update / delete`
- `db.query.<resource>`
- `findById / findByIri`
- `updateById / updateByIri`
- `deleteById / deleteByIri`

两者底层是同一个运行时。区别是 API 组织方式，不是存储行为。

## 快速开始

```ts
import { pod, podTable, string, datetime } from '@undefineds.co/drizzle-solid';

const posts = podTable('posts', {
  id: string('id').primaryKey(),
  title: string('title').predicate('http://schema.org/headline'),
  content: string('content').predicate('http://schema.org/text'),
  createdAt: datetime('createdAt').predicate('http://schema.org/dateCreated'),
}, {
  base: 'https://alice.example/data/posts/',
  subjectTemplate: '{id}.ttl',
  type: 'http://schema.org/CreativeWork',
});

const client = pod(session);
await client.init(posts);

const created = await client.collection(posts).create({
  id: 'post-1',
  title: 'Hello Solid',
  content: 'Stored as RDF in a Pod document.',
  createdAt: new Date(),
});

if (!created) {
  throw new Error('Create failed');
}

const post = client.entity(posts, created['@id']);

console.log(await post.get());
await post.update({ title: 'Updated title' });
await post.delete();
```

## Drizzle 风格的精确操作

```ts
import { drizzle, podTable, string } from '@undefineds.co/drizzle-solid';

const posts = podTable('posts', {
  id: string('id').primaryKey(),
  title: string('title').predicate('http://schema.org/headline'),
}, {
  base: 'https://alice.example/data/posts/',
  subjectTemplate: '{id}.ttl',
  type: 'http://schema.org/CreativeWork',
});

const db = drizzle(session);
await db.init(posts);

await db.insert(posts).values({
  id: 'post-1',
  title: 'Hello Solid',
});

const row = await db.findById(posts, 'post-1.ttl');

await db.updateById(posts, 'post-1.ttl', {
  title: 'Updated title',
});

await db.deleteById(posts, 'post-1.ttl');
```

## Pod 布局怎么理解

每个模型不仅描述字段，也描述落点。

- `base` 决定文档位置
- `subjectTemplate` 决定业务字段如何映射成 IRI
- `type` 是主持久化 `rdf:type`

常见 `subjectTemplate`：

- `#{id}`：一个文档里多个实体
- `{id}.ttl`：一个实体一个文档
- `{id}.ttl#it`：一个实体一个文档，并带稳定 fragment
- `{chatId}/messages.ttl#{id}`：多变量分区布局

如果模板用了多个变量，精确定位就必须提供：

- 完整 IRI，或
- base-relative resource id，例如 `chat-1/messages.ttl#msg-1`

## 集合读取 vs 精确实体操作

这是最重要的一条运行时规则。

### 集合读取

当你要拿一批数据时，用：

- `client.collection(table).list(...)`
- `db.select().from(table)...`
- `db.query.<resource>.findMany(...)`

### 精确实体操作

当你要操作一个明确实体时，用：

- `client.entity(resource, iri)`
- `db.query.<resource>.findById(id)`
- `db.findById(resource, id)`
- `db.findByIri(resource, iri)`
- `db.updateById(resource, id, data)`
- `db.deleteById(resource, id)`
- `db.updateByIri(...)`
- `db.deleteByIri(...)`

`findByLocator` / `updateByLocator` / `deleteByLocator` 仍临时保留以兼容旧代码，
但已经废弃。精确定位优先使用 base-relative resource id；如果调用方拿到的是
IRI、row、locator 或 id 的混合 target，再用通用 `*ByResource` helper；已知完整
IRI 时直接用 `*ByIri`。

不要再把 `where({ id: ... })` 或 `where(eq(table.id, ...))` 当成精确单体捷径。

## SPARQL 支持与后端差异

`drizzle-solid` 可以跑在不同 Solid 运行时上，但能力有差异。

| 能力 | Community Solid Server | xpod |
| --- | --- | --- |
| 基础 CRUD | ✅ | ✅ |
| 文档通知 | ✅ | ✅ |
| Drizzle 风格读 facade | ✅ | ✅ |
| SPARQL 下推 | ⚠️ 有限 / 经常依赖客户端辅助 | ✅ 更好的进程内支持 |
| 过滤 / 聚合下推 | ❌ 多数走客户端执行 | ✅ 更好的服务端支持 |
| 联邦查询 | ⚠️ 客户端联邦 | ⚠️ 客户端联邦 |
| 进程内本地运行时 | ⚠️ 需要额外启动 | ✅ 通过 `@undefineds.co/xpod` |

实用规则：

- 有 SPARQL endpoint 或 sidecar 时，集合查询优先走它
- 只有 plain LDP document access 时，精确读写仍然可用
- plain-LDP document mode 不会把精确操作静默扩成扫描

## 示例

仓库里的标准示例会进入集成验证：

- `examples/01-quick-start.ts`
- `examples/02-relational-query.ts`
- `examples/03-zero-config-discovery.ts`
- `examples/04-notifications.ts`
- `examples/05-data-discovery.ts`
- `examples/06-federated-query.ts`
- `examples/07-hooks-and-profile.ts`
- `examples/08-iri-based-operations.ts`
- `examples/08-schema-inheritance.ts`
- `examples/09-multi-variable-templates.ts`

## 文档入口

建议从这里开始：

- `docs/guides/installation.zh-CN.md`
- `docs/api/README.zh-CN.md`
- `docs/guides/migrating-from-drizzle-orm.zh-CN.md`
- `docs/guides/multi-variable-templates.zh-CN.md`
- `docs/guides/notifications.md`
- `docs/guides/data-discovery.md`

## 贡献

推送前运行：

```bash
yarn quality
SOLID_ENABLE_REAL_TESTS=true SOLID_SERIAL_TESTS=true yarn vitest --run tests/integration/css
```

示例必须保持可运行且已验证。

## License

MIT

## 相关链接

- GitHub: https://github.com/undefinedsco/drizzle-solid
- npm: https://www.npmjs.com/package/@undefineds.co/drizzle-solid
- xpod: https://github.com/undefinedsco/xpod
