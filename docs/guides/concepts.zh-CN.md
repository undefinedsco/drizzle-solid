# 核心概念

English version: [`concepts.md`](concepts.md)

这篇文档只保留你开始使用 `drizzle-solid` 必须建立的最小心智。

如果你已经会写 `drizzle-orm`，这里最重要的变化不是语法，而是“数据身份”和“数据位置”。

## 先记住 4 个对象

### Pod

Pod 是数据空间。

你可以把它理解成“用户拥有的一组可访问资源”，而不是一个数据库实例。

### Document

Document 是真实的持久化单元。

通常是一个 Turtle / JSON-LD 文档。

### Entity

Entity 是一个 RDF subject，也就是你代码里真正操作的一条业务对象。

### IRI

IRI 是实体的最终身份。

在很多场景里，`id` 只是生成 IRI 的一个变量；真正稳定的身份是 `@id`。

## 为什么 `base` 和 `subjectTemplate` 很重要

在 `drizzle-solid` 里，一个模型不仅描述字段，还描述“它写到哪里”。

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

这里：

- `base` 决定文档或容器位置
- `subjectTemplate` 决定业务字段如何映射成 IRI

没有这两个信息，库就无法稳定地定位实体。

## 三种最常见的布局

### 一个文档里放多个实体

```ts
subjectTemplate: '#{id}'
```

适合：

- 数据量不大
- 需要放在同一个文档里管理

### 一个实体一个文档

```ts
subjectTemplate: '{id}.ttl'
```

适合：

- 想直接按业务键映射文件
- 文档边界就是实体边界

### 按业务维度做分区

```ts
subjectTemplate: '{chatId}/messages.ttl#{id}'
```

适合：

- 需要按用户、房间、日期等维度分区
- 一组相关实体共享同一文档

## 列表读取和精确实体操作的区别

这是最关键的一条。

### 列表读取

当你想拿一批数据时，用：

- `collection(table).list(...)`
- `db.select().from(...)`
- `db.query.<resource>.findMany(...)`

它们表达的是“在一个范围里找数据”。

### 精确实体操作

当你想读写一个明确实体时，用：

- `entity(resource, iri)`
- `findById` / `findByIri`
- `updateById` / `updateByIri`
- `deleteById` / `deleteByIri`
- `findByResource` / `updateByResource` / `deleteByResource` 用于混合 exact target

`findByLocator` / `updateByLocator` / `deleteByLocator` 只是已废弃兼容入口。

它们表达的是“我已经知道目标是谁”。

## 为什么关系字段要按 link 理解

在 SQL 里，关系字段通常先被理解成 foreign key。

在 `drizzle-solid` 里，更适合的理解是：

- 它是一个 RDF link
- 它最终应该稳定指向一个 IRI

推荐新代码优先使用：

```ts
uri('author').link(users)
```

## 类型层级怎么理解

如果你需要表达类层级：

- `type` 表示实体默认持久化的主 `rdf:type`
- `subClassOf` 表示 vocabulary / schema 层级

默认情况下，一个实体应尽量只保留一个最具体的主类型。

## 什么时候用 `pod()`，什么时候用 `drizzle()`

### 用 `pod()`

适合：

- 新代码
- 想把 `collection()` / `entity()` 语义写得更明显

### 用 `drizzle()`

适合：

- 你在迁移现有 `drizzle-orm` 代码
- 想保留 builder / `db.query` 形状

两者底层运行时相同。

## 你只要记住的版本

如果只保留一句话：

> 在 `drizzle-solid` 里，模型不仅描述字段，也描述实体 IRI 和它在 Pod 里的落点。

## 下一步读什么

- `docs/guides/installation.md`
- `docs/guides/multi-variable-templates.md`
- `docs/api/README.md`
