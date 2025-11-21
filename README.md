# Drizzle Solid

一个为Solid Pod设计的类型安全ORM，基于Drizzle ORM构建，让您能够像操作传统数据库一样操作Solid Pod中的RDF数据。

## ✨ 特性

- 🔒 **类型安全**: 完整的 TypeScript 支持与严格模式提示
- 🧭 **Drizzle 对齐**: 沿用 Drizzle ORM 的查询构建器与错误形态，降低迁移成本
- 🌐 **Solid 实测**: CSS 集成测试覆盖 CRUD、条件组合、聚合与联结场景
- 🔁 **智能回退**: SQL 查询自动转换为 SPARQL；当 CSS/Comunica 无法处理过滤器或聚合时由方言拉取数据并在内存中回放
- 🔧 **灵活映射**: 自定义命名空间、谓词和列类型（字符串、数字、布尔、时间、JSON/Object）

## 🚀 快速开始

### 安装

```bash
yarn add drizzle-solid
```

### 基本用法

```typescript
import { drizzle } from 'drizzle-solid';
import { podTable, string, int } from 'drizzle-solid';
import { Session } from '@inrupt/solid-client-authn-node';

// 定义表结构
const profileTable = podTable('profile', {
  name: string('name'),
  email: string('email'),
  age: int('age')
});

// 创建数据库连接
const session = new Session(); // 已认证的session
const db = drizzle(session);

// 初始化需要使用的表（创建容器、资源并注册 TypeIndex）
await db.init([profileTable]);

// 查询数据
const profiles = await db.select().from(profileTable);

// 插入数据
await db.insert(profileTable).values({
  name: 'Alice',
  email: 'alice@example.com',
  age: 30
});
```

## 📚 示例教程

我们提供了完整的示例来帮助您快速上手：

### 🏗️ 示例1: 服务器设置和Pod创建

```bash
yarn example:setup
```

这个示例会：
- 启动本地Community Solid Server（如果需要）
- 引导您创建Solid Pod
- 验证Pod创建成功
- 获取WebID用于后续示例

### 📖 示例2: 认证与 Session 复用

```bash
yarn example:auth
```

这个示例展示：
- 如何使用 `@inrupt/solid-client-authn-node` 进行客户端凭证登录
- 如何复用已存在的 session 凭证
- 如何在命令行中检查访问令牌与 Pod 元数据

### 🛠️ 示例3: 基础 CRUD 演练

```bash
yarn example:usage
```

这个示例展示：
- 如何连接到 Solid Pod 并定义表结构
- 使用 Drizzle 风格 API 执行插入、查询、更新、删除
- 如何查看生成的 SPARQL 语句与本地回放逻辑

## 📖 详细文档

### 表定义

```typescript
import { podTable, string, int, boolean, date, uri, eq, gte, and } from 'drizzle-solid';

const userTable = podTable('users', {
  name: string('name'),           // foaf:name
  email: string('email'),         // foaf:mbox
  age: int('age'),               // foaf:age
  verified: boolean('verified'),     // 自定义谓词
  createdAt: date('createdAt'),   // dcterms:created
  organization: uri('organization')
    .predicate('https://schema.org/member') // <org> schema:member <person>
    .inverse()
}, {
  // 目标 Turtle 资源，必填，可以是相对 Pod 路径或绝对 URL
  base: 'data/users.ttl',
  // 主体类型
  type: 'https://schema.org/Person',
  // 可选：注册 TypeIndex（仅在提供 typeIndex 时才会尝试）
  typeIndex: 'private' // 'public' | 'private' | undefined
});

// 初始化：在 CRUD 前确保容器/资源存在（会按 base 自动创建）
await db.init([userTable]);
```

- 使用 `.inverse()` 可以把列映射为 `<object> predicate <subject>` 方向，适合例如 `<org> schema:member <person>` 这样的反向边；查询/写入都会自动交换 RDF 三元组的主体和宾语。

### Drizzle 风格查询：`db.query` + `findByIRI`

将 schema 传入 `drizzle(session, { schema })` 后，可通过 Drizzle 对齐的查询助手调用：

```ts
import * as schema from './schema';
const db = drizzle(session, { schema });

const users = await db.query.users.findMany({
  where: { verified: true },
  orderBy: [{ column: schema.users.name, direction: 'asc' }],
  with: {
    posts: true // 根据子表 referenceTarget + @id 预加载关联行
  }
});

const alice = await db.query.users.findByIRI('https://pod.example/data/users.ttl#alice');
```

- `findMany/findFirst/findById/count` 与 Drizzle ORM 行为一致，复用现有 `select` 管道。
- `with` 支持基于 `reference(target)` 的引用外键（通过 `@id` 关联），结果会嵌套数组挂在相应键上。
- `findByIRI` 可直接接受绝对 IRI 或 fragment（无协议时按 `id` 匹配）。
- TypeIndex 注册策略：仅当表配置了 `typeIndex: 'private' | 'public'` 时才会尝试写入 TypeIndex；未配置则跳过。

### 支持的列类型

Drizzle Solid 完全兼容所有 Drizzle ORM 数据库方言的列类型：

#### 基础类型
```typescript
// 字符串类型
string('name')     // 通用字符串
text('content')    // 文本内容
varchar('title')   // 可变长度字符串
char('code')       // 固定长度字符串

// 数字类型
int('count')       // MySQL 风格整数
integer('id')      // PostgreSQL 风格整数
bigint('large')    // 大整数
smallint('small')  // 小整数
tinyint('tiny')    // 微整数 (MySQL)
mediumint('medium') // 中等整数 (MySQL)
serial('auto')     // 自增序列

// 浮点数类型
real('price')      // 实数
decimal('amount')  // 十进制数
numeric('value')   // 数值
float('ratio')     // 单精度浮点
double('precise')  // 双精度浮点

// 布尔类型
boolean('active')  // 布尔值

// 日期时间类型
date('birthday')   // 日期
datetime('event')  // 日期时间
timestamp('created') // 时间戳

// JSON 类型
json('data')       // JSON 数据
jsonb('config')    // 二进制 JSON (PostgreSQL)
object('metadata') // 对象类型 (扩展)
```

### 查询操作

```typescript
// 查询所有记录
const users = await db.select().from(userTable);

// 条件查询
const adults = await db.select()
  .from(userTable)
  .where(gte(userTable.age, 18));

// 选择特定字段
const names = await db.select({ name: userTable.name })
  .from(userTable);

// 使用条件构建器
const verifiedAdults = await db.select()
  .from(userTable)
  .where(and(gte(userTable.age, 18), eq(userTable.verified, true)));

// 排序、分页查询
const recentUsers = await db.select()
  .from(userTable)
  .orderBy(userTable.createdAt, 'desc') // 默认升序，可显式指定 'desc'
  .limit(10)  // 取前 10 条
  .offset(10); // 跳过前 10 条，实现分页

// DISTINCT 查询，去重后返回唯一记录
const uniqueEmails = await db.select({ email: userTable.email })
  .from(userTable)
  .distinct();
```

### 聚合查询

```typescript
import { count, max } from 'drizzle-solid';

const stats = await db
  .select({
    totalUsers: count(),
    oldestAge: max(userTable.age)
  })
  .from(userTable)
  .where(gte(userTable.age, 18));

console.log(stats[0]);
// { totalUsers: 42, oldestAge: 63 }
```

> 当前聚合支持 `count/sum/avg/min/max`，由客户端在内存中计算，选择列表需全部为聚合字段；`JOIN` 与 `GROUP BY` 亦已通过客户端回放实现（在 CSS 升级至最新 Comunica 前仍保留此策略）。

### 插入数据

```typescript
// 插入单条记录
await db.insert(userTable).values({
  name: 'Bob',
  email: 'bob@example.com',
  age: 25
});

// 批量插入
await db.insert(userTable).values([
  { name: 'Alice', email: 'alice@example.com', age: 30 },
  { name: 'Charlie', email: 'charlie@example.com', age: 35 }
]);
```

### 更新数据

```typescript
await db.update(userTable)
  .set({ age: 26 })
  .where(eq(userTable.name, 'Bob'));
```

### 删除数据

```typescript
await db.delete(userTable)
  .where(eq(userTable.name, 'Bob'));
```

## ✅ 当前 SQL 支持范围

- 已实现：`select/insert/update/delete`、Drizzle 风格的 `where` 条件构建器（`eq/ne/lt/gte/like/in/not` 等）、`orderBy`、`limit/offset`、`distinct`、嵌套布尔组合，以及基于本地回放的 `count/sum/avg/min/max` 聚合、`JOIN` 和 `GROUP BY`。
- 运行策略：聚合、`JOIN`、`GROUP BY` 会先获取符合条件的行，再在内存中完成聚合/联结，避免依赖当前 CSS (Comunica v2) 缺失的 SPARQL 1.1 聚合与联结实现；后续待 CSS 升级后可切回原生支持。
- 未覆盖：`HAVING`、窗口函数、`UNION/UNION ALL`、子查询与跨容器联结；如需这些能力，请暂时改用手写 SPARQL 或拆分查询。

## 🗺️ Roadmap

- **`rightJoin`/`fullJoin` 原生支持**: 完成查询构建器、SPARQL 转换与 fallback 扩展，详见[设计方案](docs/guides/right-full-join-sparql-design.md#1-支持-rightjoin--fulljoin)。
- **SPARQL Endpoint 直连模式**: 为纯端点跳过 LDP 探测并持续支持 CRUD，详见[设计方案](docs/guides/right-full-join-sparql-design.md#2-纯-sparql-endpoint-直连模式)。

## 🔧 配置

### 自定义命名空间

Drizzle Solid 不再内置 vocab 常量，请从 RDF vocab 库（例如 `@inrupt/vocab-common-rdf`）导入需要的术语；若需要扩展缺失字段，可使用 `extendNamespace`：

```typescript
import { podTable, string, extendNamespace } from 'drizzle-solid';
import { SCHEMA_INRUPT as SCHEMA } from '@inrupt/vocab-common-rdf';

const LINQ = extendNamespace(
  { prefix: 'linq', uri: 'https://linq.dev/ns/' },
  { favorite: 'profile#favorite' },
  { namespace: 'https://linq.dev/ns/' }
);

const customTable = podTable('custom', {
  title: string('title').predicate(`${SCHEMA.NAMESPACE}title`),
  favorite: string('favorite').predicate(LINQ.favorite)
}, {
  base: 'idp:///custom/index.ttl', // 目标资源
  type: `${SCHEMA.NAMESPACE}CreativeWork`,
  namespace: LINQ
});
```

### 认证配置

```typescript
import { Session } from '@inrupt/solid-client-authn-node';

const session = new Session();
await session.login({
  oidcIssuer: 'https://solidcommunity.net',
  redirectUrl: 'http://localhost:3000/callback',
  clientName: 'My Solid App'
});

const db = drizzle(session);
```

### `base` / `@id` / `id` 与 Pod 根的关系

- `podUrl`（Pod 根）由 WebID 推导，所有相对路径都基于它解析。
- `base` 是表的目标 Turtle 资源（必填），可为相对路径或绝对 URL。示例：`base: '/data/contacts.ttl'` → `https://pod.example/data/contacts.ttl`。
- 写入：
  - 提供 `@id` 则直接作为 subject；
  - 提供 `id`（或库自动生成）则 subject 形如 `base#<id>`（或按表的 subject 模板选择 `#`/`/`）。
- 查询：
  - `where({ '@id': 'https://…#foo' })` 精确匹配该 subject；
  - `where({ id: 'foo' })` 匹配 fragment 为 `foo` 且落在该表 `base` 下的 subject。
- `base` 同时决定存储地址（PUT/PATCH 目标）和 subject 生成；`podUrl` 只负责解析相对的 `base`。

## 🏗️ 架构

Drizzle Solid基于以下组件构建：

- **PodDialect**: Solid Pod的Drizzle方言实现
- **SPARQL转换器**: 将Drizzle查询转换为SPARQL
- **Comunica执行器**: 执行SPARQL查询
- **类型系统**: 完整的TypeScript类型支持

### Comunica CRUD 流程

- 查询会经过 AST → SPARQL 转换；若 Comunica v2 无法执行带过滤器/聚合的 `UPDATE`/`DELETE`，方言会先通过 `SELECT` 拉取命中的 subject，再以 PATCH 方式回写，实现与 SQL 行级操作一致的语义。
- `PodDialect` 会自动推导目标容器与 `.ttl` 资源文件路径，必要时发送 `HEAD`/`PUT` 请求确保容器和资源已经存在，再交由 Comunica 处理数据修改。
- 插入会预先读取现有资源以检测重复 subject，避免重复写入；删除或更新只针对匹配的 subject 生成最小化补丁。
- 对于 `JOIN`、`GROUP BY` 与聚合，选取的数据仍由 SPARQL 拉取，但结果会在内存中组合或聚合，直到 CSS 升级到支持完整 SPARQL 1.1 为止。

## 🤝 贡献

欢迎贡献代码！请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 了解测试要求、提交流程与验证内容。

在提交 PR 之前，请同步运行完整的 CSS 集成测试（覆盖 CRUD、TypeIndex 等场景）：

```bash
SOLID_ENABLE_REAL_TESTS=true npx vitest run tests/integration/css --runInBand
```

> `SOLID_ENABLE_REAL_TESTS=true` 会启用真实 Pod，`--runInBand` 保证所有 suite 共用一个会话并顺序执行，避免对 OIDC 服务造成并发压力。

## 📄 许可证

MIT License - 查看[LICENSE](LICENSE)文件了解详情。

## 🔗 相关链接

- [Drizzle ORM](https://orm.drizzle.team/)
- [Solid Project](https://solidproject.org/)
- [Community Solid Server](https://github.com/CommunitySolidServer/CommunitySolidServer)
- [Inrupt Solid Client](https://github.com/inrupt/solid-client-js)


## 📞 支持

如果遇到问题，可先查阅：

1. `docs/quick-start-local.md` 获取本地 CSS 启动与疑难解答
2. `examples/README.md` 了解脚本入口与运行方式
3. [Issue 列表](https://github.com/undefinedsco/drizzle-solid/issues) 提交复现步骤与日志

---

**开始您的 Solid 数据之旅！** 🚀
