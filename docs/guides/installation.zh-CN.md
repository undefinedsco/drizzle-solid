# 安装指南

English version: [`installation.md`](installation.md)

## 环境要求
- Node.js 18+
- TypeScript 5+（若在 TS 项目中使用）
- Yarn / npm / pnpm 任一 Node 包管理器

## 1. 安装核心库

```bash
yarn add @undefineds.co/drizzle-solid drizzle-orm
```

或：

```bash
npm install @undefineds.co/drizzle-solid drizzle-orm
```

## 2. 选择认证实现

Node 服务端通常使用：

```bash
yarn add @inrupt/solid-client-authn-node
```

浏览器项目可改用 `@inrupt/solid-client-authn-browser`。

## 3. 选择 SPARQL 引擎接法

`@comunica/query-sparql-solid` 现在是 **可选 peer dependency**。

当前兼容口径：
- **官方支持**：`4.x`
- **暂不承诺支持矩阵**：`3.x`

适合直接安装到应用里的场景：
- LDP-backed 查询回退
- `db.executeSPARQL()` / `client.sparql()`
- 需要内置 SPARQL client 的跨资源查询

```bash
yarn add @comunica/query-sparql-solid
```

### 如果宿主已经带了自己的 Comunica

比如 `xpod` 在同一进程里已经安装了自己的 Comunica，则不需要再装第二份；直接把工厂传给 `drizzle-solid`：

```ts
import { createRequire } from 'node:module';
import {
  pod,
  createNodeModuleSparqlEngineFactory,
} from '@undefineds.co/drizzle-solid';

const requireFromHere = createRequire(import.meta.url);

const client = pod(session, {
  sparql: {
    createQueryEngine: createNodeModuleSparqlEngineFactory(
      requireFromHere.resolve('@undefineds.co/xpod/package.json')
    ),
  },
});
```

如果你希望整个进程共享同一套配置，也可以：

```ts
import { createRequire } from 'node:module';
import {
  configureSparqlEngine,
  createNodeModuleSparqlEngineFactory,
} from '@undefineds.co/drizzle-solid';

const requireFromHere = createRequire(import.meta.url);

configureSparqlEngine({
  createQueryEngine: createNodeModuleSparqlEngineFactory(
    requireFromHere.resolve('@undefineds.co/xpod/package.json')
  ),
});
```

## 4. 最小化验证

这里用 `pod(session)` 做最小验证，因为它最直接地展示了集合和实体语义。

如果你更习惯 Drizzle 风格，后续也可以继续使用 `drizzle(session)`。

```ts
import { Session } from '@inrupt/solid-client-authn-node';
import { pod, podTable, string } from '@undefineds.co/drizzle-solid';

async function main() {
  const session = new Session();
  await session.login({
    oidcIssuer: process.env.SOLID_OIDC_ISSUER!,
    clientId: process.env.SOLID_CLIENT_ID!,
    clientSecret: process.env.SOLID_CLIENT_SECRET!,
  });

  const profiles = podTable('profiles', {
    webId: string('webId').primaryKey(),
    name: string('name').predicate('http://xmlns.com/foaf/0.1/name'),
  }, {
    base: '/profiles/profiles.ttl',
    type: 'http://xmlns.com/foaf/0.1/Person',
  });

  const client = pod(session);
  await client.init(profiles);

  const rows = await client.collection(profiles).list({ limit: 1 });
  console.log('drizzle-solid 初始化成功', rows);
}

main().catch((error) => {
  console.error('验证失败', error);
  process.exit(1);
});
```

## 5. 从 `drizzle-orm` 迁移？

如果你本来熟悉的是 SQL 版 `drizzle-orm`，下一步优先看：

- `docs/guides/migrating-from-drizzle-orm.md`

那份指南重点解释：
- `table/row` 如何映射到 `resource/document/entity/IRI`
- 为什么写操作要改用 exact-target API
- 什么时候继续保留 `drizzle()`，什么时候再引入 `pod()`

## 6. 仓库内开发 / 测试补充

如果你是在本仓库里跑真实 CSS / xpod 测试，还需要：

```bash
yarn css:install
```

这会把测试用的隔离 CSS 运行时装到 `.internal/css-runtime/`，避免和库本身的依赖栈混在一起。

## 常见问题

- **`Cannot find module '@comunica/query-sparql-solid'`**
  - 直接在应用里安装它；或通过 `sparql.createQueryEngine` / `configureSparqlEngine()` 注入宿主已有的那一份。
- **认证失败**
  - 检查 `SOLID_CLIENT_ID`、`SOLID_CLIENT_SECRET`、`SOLID_OIDC_ISSUER`。
- **CSS / xpod 依赖冲突**
  - 仓库内开发请使用 `yarn css:install` 保持测试运行时隔离。

下一步建议阅读：`docs/api/README.md`、`docs/guides/migrating-from-drizzle-orm.md`、`docs/quick-start-local.md`
