# 认证与连接

Drizzle Solid 直接复用 Inrupt 的会话对象；只要 `Session` 处于登录状态，即可传给 `drizzle(session)` 获取数据库实例。本章覆盖 Node 环境的客户端凭证登录、浏览器交互式登录，以及常见的会话复用技巧。

## 核心概念
- **WebID**：Solid 生态中的唯一身份 URL，例如 `https://localhost:3001/alice/profile/card#me`。
- **Pod**：用户的数据容器，Drizzle Solid 会基于表的 `containerPath` 推导具体资源文件。
- **会话 (Session)**：Inrupt SDK 暴露的认证状态载体，维护访问令牌和 `fetch` 函数。

## Node.js 客户端凭证流程

```ts
import { Session } from '@inrupt/solid-client-authn-node';
import { drizzle, podTable, string } from 'drizzle-solid';

type Env = {
  SOLID_CLIENT_ID: string;
  SOLID_CLIENT_SECRET: string;
  SOLID_OIDC_ISSUER: string;
};

async function createDatabase(env: Env) {
  const session = new Session();
  await session.login({
    clientId: env.SOLID_CLIENT_ID,
    clientSecret: env.SOLID_CLIENT_SECRET,
    oidcIssuer: env.SOLID_OIDC_ISSUER,
    tokenType: 'DPoP'
  });

  if (!session.info.isLoggedIn) {
    throw new Error('Solid session 登录失败');
  }

  const profiles = podTable('profiles', {
    webId: string('webId').primaryKey(),
    name: string('name')
  }, {
    containerPath: '/profiles/',
    rdfClass: 'https://schema.org/Person'
  });

  const db = drizzle(session);
  return { db, session, profiles };
}
```

> 建议将凭证写入 `.env.local`，并由 Jest/CSS 集成测试自动读取。

## 浏览器交互式登录

```ts
import {
  handleIncomingRedirect,
  login,
  getDefaultSession
} from '@inrupt/solid-client-authn-browser';
import { drizzle } from 'drizzle-solid';

export async function ensureAuthenticated() {
  await handleIncomingRedirect();
  const session = getDefaultSession();

  if (!session.info.isLoggedIn) {
    await login({
      oidcIssuer: 'https://solidcommunity.net',
      redirectUrl: window.location.href,
      clientName: 'Drizzle Solid Demo'
    });
    return null; // 浏览器将重定向，后续逻辑会在回调后继续
  }

  return drizzle(session as any);
}
```

> 浏览器端同样返回与 Node 一致的 `Session` 接口，只要保证 `info.isLoggedIn === true` 即可交给 `drizzle`。

## 会话复用与缓存

- **持久化访问令牌**：测试环境可将 `session.info.sessionId` 序列化保存，复用 `Session` 的 `fetch` 逻辑减少认证成本。
- **错误处理**：若操作返回 401/403，可捕获后触发 `session.logout()` 并重新登录，避免因过期令牌导致的隐式失败。
- **多 Pod 支持**：目前每个数据库实例绑定一个 `Session`，如需访问多个 Pod，请为每个 Pod 创建独立的 `drizzle(session)`。

## 常见故障排查

| 现象 | 可能原因 | 处理方式 |
| --- | --- | --- |
| 登录成功但查询 403 | `containerPath` 对应的 `.ttl` 不存在或 ACL 无写权限 | 调用 `ensureContainer`（见 `tests/integration/css/helpers.ts`）或手动授予权限 |
| 登录卡死 | 未为客户端凭证启用 `tokenEndpoint` 权限，或 CSS 未启动 | 检查 `.env.local` 与 `npm run server:start` 输出 |
| 在 Jest 中 fetch 失败 | 会话未登录或 `.env.local` 缺少凭证 | 断言 `session.info.isLoggedIn === true` 后再执行测试 |

更多实例代码可查看 `examples/02-authentication.ts` 与 `tests/integration/css/drizzle-crud.test.ts`。
