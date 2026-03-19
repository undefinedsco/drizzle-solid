# 认证与连接

English version: [`authentication.md`](authentication.md)

`drizzle-solid` 直接复用 Solid `Session`。

你真正需要关心的是：

- 先拿到一个已登录的 `Session`
- 选择 `pod(session)` 还是 `drizzle(session)` 只是 API 组织方式
- Pod / IRI / exact-target mutation 才是运行时语义

## 核心概念

- **WebID**：Solid 用户身份 URL，例如 `https://alice.example/profile/card#me`
- **Pod**：用户自己的数据空间
- **Session**：Inrupt SDK 的认证状态载体，包含令牌状态与认证 `fetch`

## Node.js 客户端凭证登录

```ts
import { Session } from '@inrupt/solid-client-authn-node';
import { pod, podTable, string } from '@undefineds.co/drizzle-solid';

async function createDatabase(env: {
  SOLID_CLIENT_ID: string;
  SOLID_CLIENT_SECRET: string;
  SOLID_OIDC_ISSUER: string;
}) {
  const session = new Session();
  await session.login({
    clientId: env.SOLID_CLIENT_ID,
    clientSecret: env.SOLID_CLIENT_SECRET,
    oidcIssuer: env.SOLID_OIDC_ISSUER,
    tokenType: 'DPoP',
  });

  if (!session.info.isLoggedIn) {
    throw new Error('Solid session 登录失败');
  }

  const profiles = podTable('profiles', {
    webId: string('webId').primaryKey(),
    name: string('name').predicate('http://xmlns.com/foaf/0.1/name'),
  }, {
    base: '/profiles/profiles.ttl',
    type: 'https://schema.org/Person',
  });

  const client = pod(session);
  return { client, session, profiles };
}
```

## 浏览器交互式登录

```ts
import {
  handleIncomingRedirect,
  login,
  getDefaultSession,
} from '@inrupt/solid-client-authn-browser';
import { pod } from '@undefineds.co/drizzle-solid';

export async function ensureAuthenticated() {
  await handleIncomingRedirect();
  const session = getDefaultSession();

  if (!session.info.isLoggedIn) {
    await login({
      oidcIssuer: 'https://solidcommunity.net',
      redirectUrl: window.location.href,
      clientName: 'Drizzle Solid Demo',
    });
    return null;
  }

  return pod(session as any);
}
```

## 什么时候用 `pod()`

如果你希望把集合读取、精确实体和运行时绑定写得更显式，可以在同样的 `Session` 上使用：

```ts
import { pod } from '@undefineds.co/drizzle-solid';

const client = pod(session);
```

它适合在新代码里直接表达 link、collection 和 exact-entity 语义。

如果你的应用已经大量使用 builder / `db.query.*`，继续保留 `drizzle()` 也完全可以。

## 会话复用

- **令牌缓存**：测试环境可复用 `session.info.sessionId` 相关状态，减少重复登录成本
- **过期处理**：若操作返回 401/403，可触发重新登录，而不是让后续查询隐式失败
- **多 Pod**：一个 `Session` 对应一个认证上下文；重要的是访问语义和权限，而不是构造函数名字

## 常见故障排查

| 现象 | 可能原因 | 处理方式 |
| --- | --- | --- |
| 登录成功但查询 403 | Pod 资源不存在或 ACL 无权限 | 检查容器存在性与授权策略 |
| 登录卡住 | OIDC issuer / client 凭证不匹配 | 核对 `.env.local` 与服务端配置 |
| 浏览器回调后未登录 | `redirectUrl` 不匹配 | 确保与应用实际地址一致 |
| `drizzle(session)` / `pod(session)` 报未登录 | `Session.login()` 未正确等待完成 | 调用前确认 `session.info.isLoggedIn === true` |
