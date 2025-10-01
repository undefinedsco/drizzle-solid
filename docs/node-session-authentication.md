# Node.js Session 认证指南

本节聚焦服务器端环境下如何创建、缓存与复用 Inrupt `Session`，并与 Drizzle Solid 集成。

## 创建会话

```ts
import { Session } from '@inrupt/solid-client-authn-node';

export async function createSession() {
  const session = new Session();
  await session.login({
    clientId: process.env.SOLID_CLIENT_ID!,
    clientSecret: process.env.SOLID_CLIENT_SECRET!,
    oidcIssuer: process.env.SOLID_OIDC_ISSUER!,
    tokenType: 'DPoP'
  });

  if (!session.info.isLoggedIn) {
    throw new Error('Solid Session 登录失败');
  }

  return session;
}
```

> 建议在启动脚本前加载 `.env.local`，例如通过 `dotenv/config`。

## 与 Drizzle Solid 集成

```ts
import { drizzle, podTable, string } from 'drizzle-solid';
import { createSession } from './create-session';

async function main() {
  const session = await createSession();

  const todos = podTable('todos', {
    id: string('id').primaryKey(),
    title: string('title').notNull()
  }, {
    containerPath: '/todos/',
    rdfClass: 'https://schema.org/Action'
  });

  const db = drizzle(session);
  const rows = await db.select().from(todos).limit(10);
  console.log(rows);
}

main().catch((error) => {
  console.error('查询失败', error);
  process.exit(1);
});
```

## 会话复用策略

- **缓存 `session.info.sessionId`**：Inrupt 提供 `session.info.sessionId`，可在长期运行的服务中持久化，结合 `Session` 构造函数的 `sessionId` 选项复用既有登录态。
- **序列化 `fetch`**：若需要跨进程复用，可通过 `session.fetch` 代理请求；请勿手工拼装 `Authorization` 头，以免触发 CSS 的 DPoP 校验失败。
- **优雅退出**：结束脚本前调用 `session.logout()` 可主动吊销令牌，测试环境通常可省略。

## 故障排查

| 错误 | 可能原因 | 解决方案 |
| --- | --- | --- |
| `needs to be logged in` | `Session.login` 未被正确 await | 确保在调用 `drizzle(session)` 前检查 `session.info.isLoggedIn` |
| 401 / 403 | 凭证过期或容器缺少权限 | 重新执行 `npm run example:setup`，或使用 `ensureContainer` 辅助创建容器 |
| `fetch` ECONNREFUSED | CSS 未启动 | 在另一个终端运行 `npm run server:start` |

更多示例可参考 `examples/02-authentication.ts` 与 `tests/integration/css/helpers.ts`。
