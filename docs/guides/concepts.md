# Solid 基础概念

Drizzle Solid 建立在 Solid 规范之上，通过 SQL 风格的 API 操作 RDF 三元组。本章回顾核心术语，并说明这些概念在本库中的映射关系。

## Solid 与 Pod
- **Solid (Social Linked Data)**：去中心化的个人数据存储规范。
- **Pod (Personal Online Datastore)**：用户私有的数据空间，每个 Pod 可以托管在不同的服务器上。
- **Community Solid Server (CSS)**：本项目测试与示例使用的开源 Solid 服务器实现。

在 Drizzle Solid 中，每张表需要指定目标 Turtle 资源的 `base`（可以是相对 Pod 的路径或绝对 URL），方言会在绑定的 Pod 中定位或创建对应的容器与资源：

```ts
import { podTable, string, int } from 'drizzle-solid';

export const profiles = podTable('profiles', {
  webId: string('webId').primaryKey(),
  name: string('name').notNull(),
  age: int('age')
}, {
  // 资源文件：/profiles/profiles.ttl
  base: '/profiles/profiles.ttl',
  type: 'https://schema.org/Person'
});
```

> `base` 可以是相对路径（自动拼到当前 Pod 根）或绝对 URL；CRUD 前请调用 `db.init([table])` 以确保容器/资源存在。

## Subject（Document vs Fragment）

`subjectTemplate`（选填）用来决定"每行记录的 subject URI 形状"，也决定数据落在**一个文件**还是**多个文件**里：

- **Document 模式**（每条记录一个文件）：`base` 是容器（以 `/` 结尾），默认 `subjectTemplate: '{id}.ttl'`，subject 形如 `.../users/alice.ttl`。
  - 如果你希望区分"文档本身"和"文档描述的对象"，可以显式加 fragment：`subjectTemplate: '{id}.ttl#it'` → `.../users/alice.ttl#it`。
- **Fragment 模式**（多条记录共享一个文件）：`base` 是具体资源（如 `.../tags.ttl`），默认 `subjectTemplate: '#{id}'`，subject 形如 `.../tags.ttl#tag-1`。

这意味着：document 模式下 fragment 是**可选的**，完全由 `subjectTemplate` 控制（不需要额外的 fragment 配置项）。

### 核心配置字段

| 字段 | 说明 | 示例 |
|------|------|------|
| `base` | subjectTemplate 的基础路径，相对于 Pod 根目录 | `/data/chat/message.ttl` 或 `/data/users/` |
| `subjectTemplate` | 主题 URI 生成模式 | `#{id}` (Fragment) 或 `{id}.ttl` (Document) |
| `resourcePath` | 从 subject 推导的文件路径（内部使用） | 去掉 `#fragment` 后的部分 |
| `containerPath` | resourcePath 的上级目录（内部使用） | Fragment 模式下是文件的父目录 |

### 模式判断逻辑

系统根据 **生成的 subject URI 是否包含 `#`** 来判断模式：

```
base + subjectTemplate → subject URI → 是否包含 # → 确定模式
```

| base | subjectTemplate | 生成的 subject | 模式 |
|------|-----------------|---------------|------|
| `/data/msg.ttl` | `#{id}` | `/data/msg.ttl#123` | Fragment |
| `/data/users/` | `{id}.ttl` | `/data/users/123.ttl` | Document |

### Fragment 模式详解

多条记录存储在同一个文件中，适合消息列表、配置项等数据量较小的场景。

```typescript
const messageTable = podTable('message', {
  id: id(),
  content: string('content').predicate('http://schema.org/text'),
  author: uri('author').predicate('http://schema.org/author'),
}, {
  base: '/data/chat/message.ttl',      // 必须是文件路径
  subjectTemplate: '#{id}',            // 默认值，可省略
  type: 'http://schema.org/Message'
});

// 生成的数据存储在 /data/chat/message.ttl 文件中：
// <#msg-1> a schema:Message; schema:text "Hello"; schema:author <alice> .
// <#msg-2> a schema:Message; schema:text "Hi"; schema:author <bob> .
```

**关键点**：
- `base` 指向具体文件（如 `message.ttl`）
- 生成的 subject 包含 `#`，如 `http://pod/data/chat/message.ttl#msg-1`
- 所有记录存储在同一个 `.ttl` 文件中
- 内部推导：`resourcePath` = 文件路径，`containerPath` = 上级目录

### Document 模式详解

每条记录独立存储在单独的文件中，适合用户资料、文档等需要独立访问控制的数据。

```typescript
const userTable = podTable('user', {
  id: id(),
  name: string('name').predicate('http://schema.org/name'),
  email: string('email').predicate('http://schema.org/email'),
}, {
  base: '/data/users/',                // 必须是目录路径（以 / 结尾）
  subjectTemplate: '{id}.ttl',         // 每条记录一个文件
  type: 'http://schema.org/Person'
});

// 生成的数据存储在多个文件中：
// /data/users/alice.ttl: <alice.ttl> a schema:Person; schema:name "Alice" .
// /data/users/bob.ttl: <bob.ttl> a schema:Person; schema:name "Bob" .
```

**关键点**：
- `base` 指向容器/目录（以 `/` 结尾）
- 生成的 subject 不包含 `#`，如 `http://pod/data/users/alice.ttl`
- 每条记录独立一个文件
- 内部推导：`resourcePath` 动态取决于记录，`containerPath` = base 本身

### 常见配置错误

#### 错误 1：Fragment 模式使用目录路径

```typescript
// ❌ 错误：base 是目录，但 subjectTemplate 是 fragment
const table = podTable('tags', { ... }, {
  base: '/data/tags/',           // 目录路径
  subjectTemplate: '#{id}'       // Fragment 模式
});
// 问题：会尝试 PATCH 目录而不是文件，导致操作失败
```

**正确写法**：

```typescript
// ✅ 正确：base 指向具体文件
const table = podTable('tags', { ... }, {
  base: '/data/tags/tags.ttl',   // 文件路径
  subjectTemplate: '#{id}'
});
```

#### 错误 2：Document 模式使用文件路径

```typescript
// ❌ 错误：base 是文件，但想要每条记录独立文件
const table = podTable('users', { ... }, {
  base: '/data/users.ttl',       // 文件路径
  subjectTemplate: '{id}.ttl'    // Document 模式
});
// 问题：生成的路径会变成 /data/users.ttl/alice.ttl，不符合预期
```

**正确写法**：

```typescript
// ✅ 正确：base 指向目录
const table = podTable('users', { ... }, {
  base: '/data/users/',          // 目录路径
  subjectTemplate: '{id}.ttl'
});
```

#### 错误 3：SAI/TypeIndex 场景下的 base 配置

在使用 SAI 或 TypeIndex 发现机制时，Fragment 模式的 `base` 必须是完整文件路径：

```typescript
// ❌ 错误：SAI RegistrySet 使用目录路径
const registrySet = podTable('set', { ... }, {
  type: INTEROP.RegistrySet,
  base: '/registries/chat/',     // 目录路径，但默认 subjectTemplate 是 #{id}
});
// 问题：Discovery 找到的是目录，INSERT 时 PATCH 目录会失败
```

**正确写法**：

```typescript
// ✅ 正确：显式指定文件路径
const registrySet = podTable('set', { ... }, {
  type: INTEROP.RegistrySet,
  base: '/registries/chat/set.ttl',  // 明确的文件路径
});
```

### 内部字段推导规则

用户只需配置 `base` 和 `subjectTemplate`，系统自动推导内部字段：

**Fragment 模式** (`base: '/data/chat/message.ttl'`)：
- `resourcePath` = `/data/chat/message.ttl`（文件本身）
- `containerPath` = `/data/chat/`（上级目录）

**Document 模式** (`base: '/data/users/'`)：
- `resourcePath` = 动态，取决于具体记录的 subject（如 `/data/users/alice.ttl`）
- `containerPath` = `/data/users/`（base 本身）

## WebID
WebID 是用户在 Solid 生态中的唯一身份 URL，例如 `https://localhost:3001/alice/profile/card#me`。集成测试会在登录后的 `session.info.webId` 中暴露该地址。

## RDF 三元组
Solid 以 “主语-谓语-宾语” 记录数据，Drizzle Solid 通过列的 `predicate` 自动映射到对应的 RDF URI：

```ts
const profiles = podTable('profiles', {
  name: string('name').predicate('http://xmlns.com/foaf/0.1/name'),
  email: string('email').predicate('http://xmlns.com/foaf/0.1/mbox')
}, {
  containerPath: '/profiles/',
  type: 'http://xmlns.com/foaf/0.1/Person'
});
```

如果未调用 `.predicate(...)`，需要在 `namespace` 中包含同名条目，否则构建时会抛错。推荐做法是结合 `@inrupt/vocab-common-rdf` 等库直接引用现成的 vocab，并手动提供 `namespace` 对象：

```ts
import { podTable, string, uri, extendNamespace } from 'drizzle-solid';
import { VCARD, FOAF } from '@inrupt/vocab-common-rdf';

const LINQ_NAMESPACE = extendNamespace(
  { prefix: 'linq', uri: 'https://linq.dev/ns/' },
  { profileFavorite: 'profile#favorite' },
  { namespace: 'https://linq.dev/ns/' }
);

const contacts = podTable('contacts', {
  webId: string('webId').primaryKey(),
  name: string('name').predicate(VCARD.fn),
  nickname: string('nickname').predicate(FOAF.nick),
  favorite: string('favorite').predicate(LINQ_NAMESPACE.profileFavorite),
  organization: uri('organization')
    .predicate('https://schema.org/member')
    .inverse() // RDF 中存储为 <org> schema:member <person>
}, {
  // 目标资源（必填，可相对 Pod 基路径）
  base: 'idp:///contacts/index.ttl',
  type: FOAF.Person,
  namespace: LINQ_NAMESPACE,
  // 可选 TypeIndex 注册，仅在提供 typeIndex 时尝试
  typeIndex: 'private' // 'public' | 'private'
});

const db = drizzle(session);
// 初始化容器/资源，再进行 CRUD
await db.init([contacts]);

> `.inverse()` 会把列映射为 `<object> predicate <subject>`，适合同步 `<org> schema:member <person>` 这类反向边，Drizzle 在 SELECT/INSERT/UPDATE/DELETE 时会自动交换主体与宾语。

### URI 引用与自动补全（reference）

当列是 `uri()` 或 `.reference(...)` 引用字段时，你可以在 INSERT/UPDATE 时只传“相对 ID”，库会根据被引用表的 `base + subjectTemplate` 自动拼出完整 IRI（前提是 `drizzle(session, { schema })` 传入了 schema）：

```ts
const users = podTable('users', { id: string('id').primaryKey() }, {
  base: '/data/users/',
  subjectTemplate: '{id}.ttl',
  type: 'https://schema.org/Person',
});

const posts = podTable('posts', {
  id: string('id').primaryKey(),
  author: uri('author').predicate('https://schema.org/author').reference(users),
}, {
  base: '/data/posts/',
  subjectTemplate: '{id}.ttl',
  type: 'https://schema.org/BlogPosting',
});

const db = drizzle(session, { schema: { users, posts } });
await db.insert(posts).values({ id: 'post-1', author: 'alice' }); // -> .../users/alice.ttl
```

`reference(...)` 支持三种写法（用于解决同 class 多表歧义）：
- `reference(usersTable)`：直接指定表对象（优先级最高）
- `reference('users')`：指定表名（需要 schema 里存在同名 key 或 table.config.name）
- `reference('https://schema.org/Person')`：指定 class URI（若同 class 多表会报歧义错误）

### Drizzle 风格查询助手

如果调用 `drizzle(session, { schema })` 传入表定义，`db.query.<table>` 会提供 Drizzle 对齐的 `findMany/findFirst/findById/count`，并支持：
- `with`: 基于 `reference(target)` 的引用，按 `@id` 关联预加载子表数据（返回嵌套数组）。
- `findByIRI`: 直接用绝对 IRI 或 fragment 查询单行。
- TypeIndex 注册策略：仅当表配置了 `typeIndex: 'private' | 'public'` 时才尝试写入 TypeIndex；未配置则跳过。

示例：

```ts
const db = drizzle(session, { schema: { users, posts } });

const usersWithPosts = await db.query.users.findMany({
  with: { posts: true },
  orderBy: [{ column: users.id, direction: 'asc' }]
});

const alice = await db.query.users.findByIRI('https://pod.example/data/users.ttl#alice');
```
```

## 权限与 ACL
Solid 使用 Web Access Control (WAC) 或 Access Control Policies (ACP) 管理访问权限：
- 集成测试默认使用预设账户，容器 ACL 在 `config/preset-accounts.json` 中维护。
- 若针对真实 Pod 操作，需要为目标容器授予读写权限，否则更新会在 403 或 404 时回退。
- 可使用 `tests/integration/css/helpers.ts` 中的 `ensureContainer` 帮助方法创建容器并设置基础 ACL。

## 数据一致性与回退
由于 CSS 捆绑的 Comunica v2 不支持部分 SPARQL 1.1 更新特性，Drizzle Solid 会：
- 对 `JOIN`、`GROUP BY` 与聚合查询执行客户端回放；
- 对包含过滤器的 `UPDATE`/`DELETE` 先执行 `SELECT` 获取匹配的 subject，再生成最小化补丁；
- 保证最终写入的 Turtle 文件与 SQL 语义一致。

理解以上概念将有助于调试 Pod 级别的问题。下一步可阅读 [认证与连接](./authentication.md) 深入了解会话管理，或阅读 [数据发现与 SAI](./data-discovery.md) 了解如何动态发现 Pod 中的数据位置。
