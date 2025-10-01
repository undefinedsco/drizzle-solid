# Solid 基础概念

Drizzle Solid 建立在 Solid 规范之上，通过 SQL 风格的 API 操作 RDF 三元组。本章回顾核心术语，并说明这些概念在本库中的映射关系。

## Solid 与 Pod
- **Solid (Social Linked Data)**：去中心化的个人数据存储规范。
- **Pod (Personal Online Datastore)**：用户私有的数据空间，每个 Pod 可以托管在不同的服务器上。
- **Community Solid Server (CSS)**：本项目测试与示例使用的开源 Solid 服务器实现。

在 Drizzle Solid 中，每张表都会指定 `containerPath`，方言会在绑定的 Pod 中定位或创建对应的容器与 Turtle 资源：

```ts
import { podTable, string, int } from 'drizzle-solid';

export const profiles = podTable('profiles', {
  webId: string('webId').primaryKey(),
  name: string('name').notNull(),
  age: int('age')
}, {
  containerPath: '/profiles/',
  rdfClass: 'https://schema.org/Person'
});
```

> `containerPath` 必须以 `/` 结尾；底层资源将命名为 `<container>/profiles.ttl`。

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

如果未调用 `.predicate(...)`，库会默认使用 `https://schema.org/<列名>`。

## 常用词汇表
`src/core/rdf-constants.ts` 预置了常用命名空间，可通过 `COMMON_NAMESPACES`/`RDF_PREDICATES`/`RDF_CLASSES` 直接引用，保持语义一致性。

```ts
import { COMMON_NAMESPACES, RDF_PREDICATES, RDF_CLASSES } from 'drizzle-solid';

const posts = podTable('posts', {
  id: string('id').primaryKey(),
  title: string('title').predicate(RDF_PREDICATES.DC_TITLE),
  author: string('author').predicate(RDF_PREDICATES.SCHEMA_AUTHOR)
}, {
  containerPath: '/posts/',
  rdfClass: RDF_CLASSES.SCHEMA_ARTICLE,
  namespace: COMMON_NAMESPACES.dc
});
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
