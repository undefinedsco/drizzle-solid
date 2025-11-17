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
  rdfClass: 'https://schema.org/Person'
});
```

> `base` 可以是相对路径（自动拼到当前 Pod 根）或绝对 URL；CRUD 前请调用 `db.init([table])` 以确保容器/资源存在。

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
  rdfClass: 'http://xmlns.com/foaf/0.1/Person'
});
```

如果未调用 `.predicate(...)`，需要在 `namespace` 中包含同名条目，否则构建时会抛错。推荐做法是搭配命名空间常量使用，例如结合 `@inrupt/vocab-common-rdf`：

```ts
import { podTable, string, VCARD, FOAF } from 'drizzle-solid';
import { LINQ } from '@/models/namespace';

const contacts = podTable('contacts', {
  webId: string('webId').primaryKey(),
  name: string('name').predicate(VCARD.fn),
  nickname: string('nickname').predicate(FOAF.nick),
  favorite: string('favorite').predicate(LINQ.profileFavorite)
}, {
  // 目标资源（必填，可相对 Pod 基路径）
  base: 'idp:///contacts/index.ttl',
  rdfClass: FOAF.Person,
  namespace: LINQ,
  // 可选 TypeIndex 注册，默认不注册
  typeIndex: 'private' // 'public' | 'private' | undefined
});

const db = drizzle(session);
// 初始化容器/资源，再进行 CRUD
await db.init([contacts]);
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

理解以上概念将有助于调试 Pod 级别的问题。下一步可阅读 [认证与连接](./authentication.md) 深入了解会话管理。
