# 多变量 `subjectTemplate`

English version: [`multi-variable-templates.md`](multi-variable-templates.md)

这篇文档回答的是一个实际问题：

> 当一条数据不仅靠 `id`，还要靠 `chatId`、`userId`、日期等信息才能定位时，`drizzle-solid` 该怎么写？

## 什么叫多变量模板

例如：

```ts
const Message = podTable('Message', {
  id: string('id').primaryKey(),
  chatId: string('chatId').predicate('http://example.org/chatId'),
  content: string('content').predicate('http://schema.org/text'),
  timestamp: datetime('timestamp').predicate('http://schema.org/dateCreated'),
}, {
  base: 'https://alice.example/data/chats/',
  subjectTemplate: '{chatId}/messages.ttl#{id}',
  type: 'http://schema.org/Message',
});
```

它表示：

- `chatId` 决定消息落在哪个分区
- `id` 决定同一分区里的实体 fragment

所以一条消息的完整身份不只是 `id`，而是：

- `chatId + id`
- 或完整 IRI

## 什么时候该用多变量模板

适合：

- 按聊天房间分消息
- 按用户分 profile / settings / activity
- 按日期分日志或事件

不适合：

- 你根本不需要分区
- 你希望只靠一个业务键就定位所有实体

## 先看三种常见操作

### 1. 列表读取

如果你想列出某个分区的数据，直接做 collection read：

```ts
const messages = client.collection(Message);

const chat1Messages = await messages.list({
  where: eq(Message.chatId, 'chat-1'),
});
```

这适合：

- 列表页
- 某个房间或用户下的数据浏览
- 受控范围内的过滤读取

### 2. 精确读取一个实体

如果你知道所有模板变量：

```ts
const row = await db.findByLocator(Message, {
  chatId: 'chat-1',
  id: 'msg-123',
});
```

如果你已经拿到了完整 IRI：

```ts
const fullIri = 'https://alice.example/data/chats/chat-1/messages.ttl#msg-123';
const entity = client.entity(Message, fullIri);
const row = await entity.get();
```

### 3. 精确更新 / 删除

```ts
await db.updateByLocator(Message, {
  chatId: 'chat-1',
  id: 'msg-123',
}, {
  content: 'Updated',
});

await db.deleteByLocator(Message, {
  chatId: 'chat-1',
  id: 'msg-123',
});
```

或者直接用 IRI：

```ts
const entity = client.entity(Message, fullIri);
await entity.update({ content: 'Updated' });
await entity.delete();
```

## 为什么只给 `id` 不够

如果模板是：

```ts
subjectTemplate: '{chatId}/messages.ttl#{id}'
```

那么只给：

```ts
{ id: 'msg-123' }
```

库并不知道应该去：

- `chat-1/messages.ttl`
- `chat-2/messages.ttl`
- 还是别的分区

所以这是一个信息不完整的问题，不是“优化器够不够聪明”的问题。

## 正确规则

### 读单体

用：

- 完整 IRI，或
- 完整 locator

### 写单体

也用：

- 完整 IRI，或
- 完整 locator

### 列表读取

可以只给部分变量，但你要明确自己在做 collection read，而不是 exact-target read。

## JOIN 时要注意什么

如果右表是多变量模板，join 条件也必须把右表定位完整。

正确示例：

```ts
await db.select({
  postTitle: Post.title,
  messageBody: Message.content,
})
  .from(Post)
  .leftJoin(Message, and(
    eq(Post.messageId, Message.id),
    eq(Post.chatId, Message.chatId),
  ));
```

错误心智是只写：

```ts
eq(Post.messageId, Message.id)
```

因为这只给了局部 `id`，没有给出完整 locator。

## 最佳实践

### 优先保存完整 IRI

如果关系字段天然指向一个实体，优先保存完整 IRI。这样后续读取和跳转都会更直接。

### locator 变量要有明确业务意义

例如：

- `chatId`
- `userId`
- `date`

不要为了“凑多变量模板”而设计没有业务意义的分区键。

### 分区不要过粗，也不要过细

过粗：

- 单文档太大
- 查询和更新成本高

过细：

- 产生大量小文件
- 管理成本高

## 从 SQL 迁移时怎么理解

把多变量模板理解成：

- “一部分业务字段参与了物理定位”

不要继续假设：

- “只要有局部 id，库就应该自己全局找出来”

更实用的迁移心智是：

- 列表读取走 collection API
- 单体操作走 IRI / locator API
- join 时也要补齐右表定位条件

## 常见选择

### 选单变量模板

```ts
subjectTemplate: '{id}.ttl'
```

当你需要：

- 简单
- 易迁移
- 直接按主键定位

### 选多变量模板

```ts
subjectTemplate: '{chatId}/messages.ttl#{id}'
```

当你需要：

- 物理分区
- 容器/文档边界体现业务结构
- 查询大多落在单个分区里

## 下一步读什么

- `docs/guides/concepts.md`
- `docs/api/README.md`
- `docs/guides/migrating-from-drizzle-orm.md`
- `examples/09-multi-variable-templates.ts`
