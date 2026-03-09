# 多变量 `subjectTemplate`

多变量模板让你把数据自然分布到不同容器或文档里。

典型场景：

- 按聊天房间分区消息
- 按用户分区文档
- 按日期分区日志

## 例子

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

- `chat-1` 的消息会进 `.../chat-1/messages.ttl`
- `chat-2` 的消息会进 `.../chat-2/messages.ttl`
- 同一个文档里，每条消息再通过 `#{id}` 区分

## 推荐用法

### 1. 集合读取

```ts
const client = pod(session);
const messages = client.collection(Message);

const chat1Messages = await messages.list({
  where: eq(Message.chatId, 'chat-1'),
});
```

这类查询适合：

- 列表页
- 按分区浏览
- 范围受控的过滤读取

### 2. 提供所有模板变量做精确读取

```ts
const exact = await messages.list({
  where: and(
    eq(Message.id, 'msg-123'),
    eq(Message.chatId, 'chat-1'),
  ),
  limit: 1,
});
```

### 3. 用完整 IRI 做最高效点查

```ts
const fullIri = 'https://alice.example/data/chats/chat-1/messages.ttl#msg-123';
const entity = client.entity(Message, fullIri);
const row = await entity.get();
```

如果你已经从：

- 通知事件
- 页面链接
- 关系字段

拿到了完整 IRI，就应优先使用 `entity(..., iri)`。

## 为什么只给 `id` 会报错

如果模板是：

```ts
subjectTemplate: '{chatId}/messages.ttl#{id}'
```

那么只给：

```ts
eq(Message.id, 'msg-123')
```

系统并不知道该去哪个 `chatId` 分区找数据。

这时如果默认退化成“扫描所有 chat 再查找”，会有两个问题：

- 性能不可控
- 写操作语义会变得危险

所以默认策略是：**宁可报错，也不隐式全局扫描**。

## 读写语义差异

### 读

- `collection.list()` / `first()` 可以承载列表和筛选读取
- 允许在边界可控时用部分模板变量缩小扫描范围

### 写

- `entity(..., iri).update()` / `delete()` 代表精确 target mutation
- 不建议把多变量模板下的写操作建立在模糊 `where(...)` 之上

## 最佳实践

### 好的分区策略

- 每个分区包含适量数据
- 分区边界对业务有意义
- 查询大多能落在一个分区里

### 不好的分区策略

- 分区过细，产生大量小文件
- 分区过粗，单文件过大
- 业务查询经常跨很多分区

## 与单变量模板的区别

### 单变量模板

```ts
subjectTemplate: '{id}.ttl'
```

适合：

- 直接按主键定位
- 一实体一文档
- 数据量不大或不需要额外分区

### 多变量模板

```ts
subjectTemplate: '{chatId}/messages.ttl#{id}'
```

适合：

- 需要按某个业务维度做物理分区
- 同一分区里保留一批相关实体
- 查询通常针对单个房间、用户、日期等范围

## 迁移建议

如果你来自 SQL / `drizzle-orm`：

- 把多变量模板理解成“物理分区策略”
- 把 `collection.list()` 理解成“受控范围内的读取”
- 把 `entity(..., iri)` 理解成“真正的精确行目标”

相关 example：`examples/09-multi-variable-templates.ts`
