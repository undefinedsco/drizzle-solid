# Solid 基础概念

`drizzle-solid` 不是把 Solid 假装成 SQL 数据库。

它做的是：

- 用类型化 schema 描述 Pod 数据
- 把 RDF predicate、文档位置、IRI 身份一起纳入建模
- 提供一套迁移友好的 API，让 Drizzle 用户能逐步进入 Solid 心智

## 四个核心对象

### Pod

Pod 是用户的数据空间。

### Document

Document 是真实持久化单元，通常是一个 Turtle / JSON-LD 资源。

### Entity

Entity 是 document 里的一个 RDF subject。

### IRI

IRI 是实体的原生身份，通常比本地 `id` 更接近真实唯一标识。

## 建模入口

### `podTable(...)`

当模型和存储位置一起确定时：

```ts
const posts = podTable('posts', {
  id: string('id').primaryKey(),
  title: string('title').predicate('http://schema.org/headline'),
}, {
  base: '/data/posts/',
  subjectTemplate: '{id}.ttl',
  type: 'http://schema.org/CreativeWork',
});
```

### `solidSchema(...)` + `client.bind(...)`

当你想把“模型”与“落在哪里”分开时：

```ts
const profileTable = client.bind(profileSchema, {
  base: 'https://alice.example/profile/card',
});
```

## `base` 与 `subjectTemplate`

这是 `drizzle-solid` 最重要的两项配置。

- `base`：资源容器或资源文件的基础位置
- `subjectTemplate`：如何从业务字段生成实体 IRI

常见模式：

- `#{id}`：一个文档里多个实体
- `{id}.ttl`：一实体一文档
- `{id}.ttl#it`：一实体一文档，并保留文档内 fragment
- `{chatId}/messages.ttl#{id}`：多变量布局

## 读取与写入为什么分开建模

### 集合读取

```ts
const postsCollection = client.collection(posts);
const rows = await postsCollection.list({ where: { id: 'post-1' } });
```

### 精确实体操作

```ts
const post = client.entity(posts, iri);
await post.update({ title: 'Updated' });
await post.delete();
```

原因是：

- 读取可以在边界可控时做筛选和枚举
- 写入不应该在信息不足时隐式退化成扫描式 mutation
- 如果目标依赖完整模板变量，最安全的写法是直接使用 IRI

## 引用与关系

`uri()` / `iri()` 字段表示链接，不要把它只理解成 SQL 外键。

列级链接统一写成 `uri(...).link(target)`。

推荐做法：

- 存完整 IRI 或能稳定补全为 IRI 的值
- 在迁移旧代码时，可以让 link 字段根据 schema 自动补全目标 IRI
- 关系读取通常落在 Drizzle-shaped read facade，常见入口是 `client.query`

## 类型层级

- `type` 表示实例默认写入的主 `rdf:type`
- `subClassOf` 表示 schema / vocabulary 层级，不默认额外写入实例数据
- 默认持久化形状应尽量只保留一个最具体、最权威的 `rdf:type`
- 如果未来需要兼容无推理环境，再通过显式兼容选项物化父类类型，而不是默认双写

## Drizzle-shaped surface 仍在，但不是主心智

以下能力仍然存在：

- `client.query.*`
- `client.asDrizzle()`
- `select / insert / update / delete`

但新的主线业务代码更推荐：

- `pod()`
- `collection()`
- `entity()`
- `bind()`
- `sparql()`
