# 从 `drizzle-orm` 迁移到 `drizzle-solid`

English version: [`migrating-from-drizzle-orm.md`](migrating-from-drizzle-orm.md)

这份文档面向已经熟悉 `drizzle-orm` 的开发者。

目标不是让你先改掉所有代码风格，而是帮你把原来的 SQL 心智迁到 Solid Pod 的数据模型上。

## 先说结论

你不需要先把：

```ts
const db = drizzle(session);
```

改成别的入口。

迁移时，优先处理的是：

- 数据放在哪里
- 主键如何变成 IRI
- 关系字段如何变成 link / IRI
- 哪些查询是列表读取，哪些写操作必须是精确目标
- raw SQL 心智何时改成 SPARQL

## 迁移时最重要的 4 个变化

1. **表/行不再是主语义，文档/实体/IRI 才是**
2. **关系字段不再只是 foreign key，更接近 RDF link**
3. **写操作要显式指向一个精确目标**
4. **实例默认保留一个最具体的 `rdf:type`**

## 推荐迁移顺序

1. 保留 `drizzle(session)`，先不要急着换 API 风格
2. 把每个模型补上 `base` 和 `subjectTemplate`
3. 把 SQL 外键心智改成 IRI / link 心智
4. 把“列表读取”和“精确写入”拆开理解
5. 把依赖 raw SQL 的地方评估为 SPARQL 或别的实现
6. 最后再决定是否在新代码里改用 `pod(session)`

## 第一步：先定义数据放在哪里

在 SQL 里，你主要定义表结构。

在 Solid 里，你除了定义列，还要定义：

- 数据写到哪个文档或容器
- 一条记录的身份如何映射成 IRI

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

这里多出来的两个关键信息是：

- `base`
- `subjectTemplate`

没有这两个信息，库就不知道一条记录在 Pod 里应该落到哪里。

## 第二步：把主键理解成 IRI

在 `drizzle-orm` 里，你很容易把 `id` 当成最终身份。

在 `drizzle-solid` 里，更准确的理解是：

- `id` 往往只是构造 subject IRI 的一个变量
- 真正的最终身份是 `@id` / subject IRI

例如：

```ts
const row = await db.findByLocator(posts, { id: 'post-1' });
const iri = row?.['@id'];
```

如果你已经拿到了完整 IRI，后续读写应优先直接用 IRI：

```ts
const row = await db.findByIri(posts, iri);
await db.updateByIri(posts, iri, { title: 'Updated' });
await db.deleteByIri(posts, iri);
```

## 第三步：把关系字段理解成 link

迁移时最常见的误区，是把关系字段继续当成“数据库外键列”。

更适合的理解是：

- 它表达的是 RDF link
- 它最好能稳定指向一个 IRI

推荐新代码优先写成：

```ts
uri('author').link(users)
```

迁移时你要先判断：

- 这个字段到底是业务标识，还是实体链接？
- 如果它是实体链接，是否应该保存完整 IRI？
- 如果暂时还不能保存完整 IRI，是否至少能稳定补全为 IRI？

## 第四步：把“列表读取”和“精确写入”拆开

这一步最容易出错。

### 列表读取

下面这些仍然适合表达“取一批数据”：

```ts
await db.select().from(posts).where({ title: 'Hello Solid' });
await db.query.posts.findMany({ where: { title: 'Hello Solid' } });
await client.collection(posts).list({ where: { title: 'Hello Solid' } });
```

### 精确读取 / 更新 / 删除

当你想操作一个明确实体时，应该改成 exact-target API：

```ts
await db.findByLocator(posts, { id: 'post-1' });
await db.findByIri(posts, iri);

await db.updateByLocator(posts, { id: 'post-1' }, {
  title: 'Updated title',
});

await db.deleteByIri(posts, iri);
```

或者用更显式的 façade：

```ts
const post = client.entity(posts, iri);
await post.get();
await post.update({ title: 'Updated title' });
await post.delete();
```

### 不要继续依赖这些写法

迁移后，不要把下面这些当成精确单体操作：

- `where({ id: ... })`
- `where({ '@id': ... })`
- `where(eq(table.id, ...))`

这些写法不再承担 exact-target 语义。

## 第五步：多变量模板要补齐 locator

如果你的布局是：

```ts
subjectTemplate: '{chatId}/messages.ttl#{id}'
```

那 `id` 自己并不够定位实体。

你需要：

- 传完整 IRI，或
- 传完整 locator，例如 `{ chatId, id }`

正确示例：

```ts
await db.findByLocator(messages, {
  chatId: 'chat-1',
  id: 'msg-1',
});
```

错误心智是继续假设：

- “只要有 `id`，库应该自己全局找出来”

这在 Pod 场景里既不稳定，也不透明。

## 第六步：join 不再默认等于 SQL 主键 join

在 SQL 里你可能会直接写：

```ts
eq(Post.messageId, Message.id)
```

但如果 `Message` 的 `subjectTemplate` 是多变量，这通常不够。

你需要把右表定位信息补齐：

```ts
leftJoin(Message, and(
  eq(Post.messageId, Message.id),
  eq(Post.chatId, Message.chatId),
))
```

或者直接让关系字段保存完整 IRI。

## 第七步：raw SQL 心智迁到 SPARQL

如果你原来大量使用：

- raw SQL
- `sql`` fragment`
- `toSQL()`

迁移时要直接接受一个事实：

- `drizzle-solid` 的图查询 escape hatch 是 SPARQL

可用入口：

- `db.executeSPARQL(query)`
- `client.sparql(query)`
- `toSPARQL()` / `toSparql()`

示例：

```ts
await db.executeSPARQL(`
  SELECT ?s WHERE {
    ?s a <http://schema.org/CreativeWork> .
  }
  LIMIT 10
`);
```

## `pod()` 什么时候再引入

等你把上面的迁移做完，再决定是否在新代码里改用 `pod(session)`。

`pod()` 的价值不是“更先进”，而是把语义写得更明显：

- `collection(table)`：集合读取
- `entity(table, iri)`：精确实体
- `bind(schema, options)`：运行时绑定位置

如果你的团队更需要“语义可读性”，就逐步用它。

如果你更重视迁移成本，继续用 `drizzle()` 也完全可以。

## 一张对照表

| `drizzle-orm` 心智 | `drizzle-solid` 心智 |
| --- | --- |
| table | 一类实体在 Pod 里的布局 |
| row primary key | `@id` / subject IRI |
| 表位置 | `base` + `subjectTemplate` |
| foreign key | RDF link / IRI link |
| 按 `where(id=...)` 更新单行 | `updateByLocator` / `updateByIri` |
| raw SQL | raw SPARQL |
| `toSQL()` | `toSPARQL()` / `toSparql()` |

## 迁移检查清单

- [ ] 每个模型都已定义 `base`
- [ ] 每个模型都已定义 `subjectTemplate`
- [ ] 团队已明确哪些字段是 link / IRI
- [ ] 写操作已改为 exact-target API
- [ ] 多变量模板已补齐 locator 规则
- [ ] raw SQL 依赖已评估为 SPARQL 或其他方案
- [ ] 示例和真实 Pod 场景都已验证

## 相关阅读

- `README.md`
- `docs/api/README.md`
- `docs/guides/installation.md`
- `docs/guides/multi-variable-templates.md`
- `examples/01-quick-start.ts`
- `examples/08-iri-based-operations.ts`
