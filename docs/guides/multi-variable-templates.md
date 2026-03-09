# Multi-variable subjectTemplate

## 设计理念

drizzle-solid 支持多变量模板如 `{chatId}/messages.ttl#{id}`，这允许你按照 Solid 的容器层次结构组织数据，实现更灵活的数据分区和管理。

### 为什么需要多变量模板？

在 Solid Pod 中，数据通常按照层次结构组织：

```
/data/
  /chats/
    /chat-1/
      messages.ttl
    /chat-2/
      messages.ttl
```

使用多变量模板，你可以将这种层次结构映射到表结构中：

```typescript
const Message = podTable('Message', {
  id: string('id').primaryKey(),
  chatId: string('chatId'),
  content: string('content'),
}, {
  base: '/data/chats/',
  subjectTemplate: '{chatId}/messages.ttl#{id}',
  type: 'http://schema.org/Message'
});
```

这样，每个 chat 的消息会自动存储在对应的子目录中。

## 查询方式

### 方式 1: 使用完整 URI（推荐，最高效）

当你知道完整 URI 时，直接使用：

```typescript
const fullUri = 'http://pod.example/data/chats/chat-1/messages.ttl#msg-123';
const messages = await db.select()
  .from(Message)
  .where(eq(Message.id, fullUri));
```

**优势**：
- 系统直接定位到该资源，无需扫描容器
- 最高效的查询方式
- 适合从外部系统（如通知、链接）获取的 URI

### 方式 2: 提供所有模板变量

如果只有短 id，需要提供所有模板变量：

```typescript
const messages = await db.select()
  .from(Message)
  .where(
    and(
      eq(Message.id, 'msg-123'),
      eq(Message.chatId, 'chat-1')
    )
  );
```

**工作原理**：
- 系统从 WHERE 条件中提取所有模板变量
- 解析完整路径：`/data/chats/chat-1/messages.ttl#msg-123`
- 直接查询该文件

### 方式 3: 只提供部分变量（查询子容器）

如果只提供 `chatId` 而不提供 `id`，系统会查询该 chat 的所有消息：

```typescript
const messages = await db.select()
  .from(Message)
  .where(eq(Message.chatId, 'chat-1'));
```

**工作原理**：
- 系统解析部分路径：`/data/chats/chat-1/`
- 扫描该子容器下的所有 `.ttl` 文件
- 执行 SPARQL 查询过滤结果

### 错误情况：只提供短 id

```typescript
// ❌ 错误：缺少 chatId 变量
await db.select()
  .from(Message)
  .where(eq(Message.id, 'msg-123'));

// Error: Cannot resolve subjectTemplate '{chatId}/messages.ttl#{id}':
// missing required variable(s) [chatId].
// Add eq(table.chatId, value) to your where clause.
```

**为什么会报错**：
- 系统无法确定应该查询哪个 chat 的 messages.ttl
- 如果允许这种查询，需要扫描所有 chat 子目录，性能很差
- 明确要求所有变量确保查询意图清晰

## 读取与写入的不同语义

### 读查询（list/filter）

`select().where(...)` 和 `db.query.*.findMany(...)` 主要承担 list/filter 语义：

- 可以使用完整 URI 做点查询
- 可以提供全部 template 变量做精确读取
- 也可以只提供部分分区变量，让系统在**有边界**的范围内扫描（例如某个 `chatId` 子目录）

这就是为什么下面这种查询是保留的：

```typescript
await db.select()
  .from(Message)
  .where(eq(Message.chatId, 'chat-1'));
```

### 写操作（update/delete）

`update(...).where(...)` / `delete(...).where(...)` 不采用同样的宽松语义。默认要求目标是**确定性的**：

- 完整 IRI
- 或能够唯一解出 subject 的全部 template 变量

如果 `where()` 不足以唯一定位 subject，系统会直接报错，并建议：

- 补齐缺失的 template 变量
- 或改用 `db.updateByIri()` / `db.deleteByIri()`

### 不做隐式 scan + mutate

为了避免性能退化和语义不透明，当前不支持把宽过滤条件静默降级为“先扫描再逐条更新/删除”的 `updateMany/deleteMany`。

如果未来某个后端（例如 xpod）**显式声明**支持 filter-based multi-row mutation，这类能力可以按后端 capability 开放；在不支持的后端上则继续直接报错。

## 设计权衡

### 1. 明确性 vs 灵活性

**选择**：读路径允许有边界的部分变量扫描；写路径要求确定性 target

**理由**：
- 让 list/filter 语义保持可用
- 避免 mutation 隐式退化成昂贵扫描
- 提供清晰的错误提示，引导用户在写路径上改用完整 IRI 或补齐变量

### 2. 性能 vs 便利性

**选择**：支持三种查询方式，性能递减

1. 完整 URI：O(1) - 直接定位
2. 所有变量：O(1) - 解析路径后直接定位
3. 部分变量：O(n) - 扫描子容器

**理由**：
- 完整 URI 是最常见的场景（从通知、链接获取）
- 所有变量适合应用内查询
- 部分变量适合列表查询（如"某个 chat 的所有消息"）

### 3. 错误提示 vs 自动降级

**选择**：缺少变量时抛出清晰错误，而不是自动降级到全容器扫描

**理由**：
- 全容器扫描可能非常慢（数千个子目录）
- 用户可能不知道正在执行昂贵操作
- 明确错误提示帮助用户理解系统行为

## 实际应用场景

### 场景 1: 聊天应用

```typescript
// 表结构
const Message = podTable('Message', {
  id: string('id').primaryKey(),
  chatId: string('chatId'),
  content: string('content'),
  timestamp: datetime('timestamp'),
}, {
  base: '/data/chats/',
  subjectTemplate: '{chatId}/messages.ttl#{id}',
  type: 'http://schema.org/Message'
});

// 查询某个 chat 的所有消息
const chatMessages = await db.select()
  .from(Message)
  .where(eq(Message.chatId, 'chat-1'))
  .orderBy(desc(Message.timestamp));

// 通过通知获取的完整 URI 查询单条消息
const notification = {
  object: 'http://pod.example/data/chats/chat-1/messages.ttl#msg-123'
};
const message = await db.select()
  .from(Message)
  .where(eq(Message.id, notification.object));
```

### 场景 2: 时间分区的日志

```typescript
// 按年/月/日分区存储日志
const Log = podTable('Log', {
  id: string('id').primaryKey(),
  year: string('year'),
  month: string('month'),
  day: string('day'),
  level: string('level'),
  message: string('message'),
}, {
  base: '/data/logs/',
  subjectTemplate: '{year}/{month}/{day}/logs.ttl#{id}',
  type: 'http://example.org/Log'
});

// 查询某一天的所有日志
const todayLogs = await db.select()
  .from(Log)
  .where(
    and(
      eq(Log.year, '2024'),
      eq(Log.month, '03'),
      eq(Log.day, '04')
    )
  );

// 查询某个月的所有错误日志（会扫描该月所有天的日志文件）
const monthErrors = await db.select()
  .from(Log)
  .where(
    and(
      eq(Log.year, '2024'),
      eq(Log.month, '03'),
      eq(Log.level, 'ERROR')
    )
  );
```

### 场景 3: 用户数据分区

```typescript
// 按用户 ID 分区存储用户数据
const UserPost = podTable('UserPost', {
  id: string('id').primaryKey(),
  userId: string('userId'),
  title: string('title'),
  content: string('content'),
}, {
  base: '/data/posts/',
  subjectTemplate: '{userId}/posts.ttl#{id}',
  type: 'http://schema.org/BlogPosting'
});

// 查询某个用户的所有文章
const userPosts = await db.select()
  .from(UserPost)
  .where(eq(UserPost.userId, 'alice'));

// 通过完整 URI 查询单篇文章
const post = await db.select()
  .from(UserPost)
  .where(eq(UserPost.id, 'http://pod.example/data/posts/alice/posts.ttl#post-1'));
```

## 最佳实践

### 1. 选择合适的分区粒度

**好的分区**：
- 每个分区包含适量数据（几十到几百条记录）
- 分区边界清晰（如按 chat、按用户、按日期）
- 查询通常针对单个分区

**不好的分区**：
- 分区过细，导致大量小文件
- 分区过粗，单个文件过大
- 查询经常需要跨多个分区

### 2. 在 WHERE 条件中提供分区变量

```typescript
// ✅ 好：提供分区变量，查询单个文件
await db.select()
  .from(Message)
  .where(
    and(
      eq(Message.chatId, 'chat-1'),
      eq(Message.content, 'hello')
    )
  );

// ❌ 差：缺少分区变量，需要扫描所有 chat
await db.select()
  .from(Message)
  .where(eq(Message.content, 'hello'));
```

### 3. 使用完整 URI 进行点查询

```typescript
// ✅ 好：从通知、链接获取完整 URI
const uri = notification.object;
const message = await db.select()
  .from(Message)
  .where(eq(Message.id, uri));

// ❌ 差：手动拼接 URI（容易出错）
const uri = `${base}${chatId}/messages.ttl#${id}`;
```

### 4. 文档化你的分区策略

在代码注释中说明分区逻辑：

```typescript
/**
 * Message 表按 chatId 分区存储
 *
 * 存储结构：
 * /data/chats/
 *   /chat-1/messages.ttl  <- chat-1 的所有消息
 *   /chat-2/messages.ttl  <- chat-2 的所有消息
 *
 * 查询建议：
 * - 查询单个 chat 的消息：提供 chatId
 * - 查询单条消息：使用完整 URI
 * - 避免跨 chat 查询（性能差）
 */
const Message = podTable('Message', { ... }, {
  base: '/data/chats/',
  subjectTemplate: '{chatId}/messages.ttl#{id}',
});
```

## 与单变量模板的对比

### 单变量模板（简单场景）

```typescript
const User = podTable('User', {
  id: string('id').primaryKey(),
  name: string('name'),
}, {
  base: '/data/users/',
  subjectTemplate: '{id}.ttl',  // 只有一个变量
});

// 查询很简单，只需要 id
const user = await db.select()
  .from(User)
  .where(eq(User.id, 'alice'));
```

**适用场景**：
- 数据量不大（几百到几千条）
- 不需要分区
- 查询通常通过主键

### 多变量模板（复杂场景）

```typescript
const Message = podTable('Message', {
  id: string('id').primaryKey(),
  chatId: string('chatId'),
  content: string('content'),
}, {
  base: '/data/chats/',
  subjectTemplate: '{chatId}/messages.ttl#{id}',  // 多个变量
});

// 查询需要提供分区变量
const messages = await db.select()
  .from(Message)
  .where(eq(Message.chatId, 'chat-1'));
```

**适用场景**：
- 数据量大（数千到数万条）
- 需要按某个维度分区（用户、时间、类别等）
- 查询通常针对某个分区

## 常见问题

### Q: 为什么查询报错"missing required variable(s)"？

A: 当使用多变量模板时（如 `{chatId}/{yyyy}/{MM}/{dd}/messages.ttl#{id}`），只提供 `eq(Message.id, 'msg-123')` 是不够的，因为系统不知道去哪个分区查找。

**❌ 错误示例**：
```typescript
// 只提供 id，系统不知道去哪个 chatId 目录查找
const messages = await db.select()
  .from(Message)
  .where(eq(Message.id, 'msg-123'));
// Error: Cannot resolve subjectTemplate: missing required variable(s) [chatId]
```

**✅ 正确做法 1：提供完整 URI**（推荐）
```typescript
// 如果你有完整 URI（例如从通知、链接等获取）
const fullUri = 'http://pod/.../chat-1/2026/03/05/messages.ttl#msg-123';
const messages = await db.select()
  .from(Message)
  .where(eq(Message.id, fullUri));  // ← value 可以是完整 URI
```

**✅ 正确做法 2：提供所有模板变量**
```typescript
// 如果你知道 chatId
const messages = await db.select()
  .from(Message)
  .where(and(
    eq(Message.id, 'msg-123'),
    eq(Message.chatId, 'chat-1')  // ← 提供缺失的变量
  ));
```

**✅ 正确做法 3：使用 `findByIri()`**（最高效）
```typescript
// 如果有完整 URI，推荐用 findByIri 而不是 select + where
const message = await db.findByIri(Message, fullUri);
```

**关键点**：当查询条件的 key 是 `id` 时，value 可以填：
- 短 id（如 `'msg-123'`）- 需要提供所有其他模板变量
- 完整 URI（如 `'http://pod/.../messages.ttl#msg-123'`）- 不需要其他变量

### Q: 为什么不能只提供 id 查询？

A: 因为系统无法确定应该查询哪个分区。如果允许这种查询，需要扫描所有分区，性能很差。如果你确实需要这种查询，考虑：
1. 使用单变量模板（不分区）
2. 维护一个索引表
3. 使用完整 URI

### Q: 如何跨分区查询？

A: 读查询可以考虑几种方式：
1. 尽量提供部分分区变量，把扫描范围收窄到某个子容器
2. 在应用层循环查询每个分区
3. 使用 SPARQL 联邦查询（高级功能）
4. 维护一个全局索引表

不要把“跨分区筛选”理解成写操作里的 `updateMany/deleteMany`。在当前默认契约下，写操作仍要求确定性 target，除非底层后端明确支持 set-based mutation。

### Q: 分区变量必须是字符串吗？

A: 是的，模板变量会被转换为路径的一部分，必须是字符串。如果你的分区键是数字或日期，需要先转换为字符串。

### Q: 可以有三个或更多变量吗？

A: 可以，例如 `{year}/{month}/{day}/logs.ttl#{id}`。但要注意：
- 变量越多，查询时需要提供的条件越多
- 分区层次越深，文件系统压力越大
- 通常 2-3 个变量就足够了

## 总结

多变量模板是 drizzle-solid 的强大功能，允许你：
- 按照 Solid 的容器层次结构组织数据
- 实现高效的数据分区和查询
- 保持查询的明确性和性能

关键原则：
1. **完整 URI 优先**：最高效的点查询与精确 mutation 方式
2. **读写分层**：读查询可做有边界过滤，写操作默认要求确定性 target
3. **合理分区**：平衡文件数量和文件大小
4. **清晰错误**：不做隐式 scan + mutate，错误里明确建议下一步
