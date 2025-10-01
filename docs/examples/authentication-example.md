# 认证示例

本文以最小脚本展示如何创建 Solid 会话并通过 Drizzle Solid 执行查询。示例与 `examples/02-authentication.ts`、`examples/03-basic-usage.ts` 保持一致。

## Node.js: 客户端凭证登录

```ts
import { Session } from '@inrupt/solid-client-authn-node';
import { drizzle, podTable, string } from 'drizzle-solid';

async function main() {
  const session = new Session();
  await session.login({
    oidcIssuer: process.env.SOLID_OIDC_ISSUER!,
    clientId: process.env.SOLID_CLIENT_ID!,
    clientSecret: process.env.SOLID_CLIENT_SECRET!,
    tokenType: 'DPoP'
  });

  const profiles = podTable('profiles', {
    webId: string('webId').primaryKey(),
    name: string('name')
  }, {
    containerPath: '/profiles/',
    rdfClass: 'https://schema.org/Person'
  });

  const db = drizzle(session);
  const result = await db.select().from(profiles).limit(5);
  console.log(result);
}

main().catch((error) => {
  console.error('认证示例失败', error);
  process.exit(1);
});
```

运行命令：

```bash
SOLID_CLIENT_ID=... SOLID_CLIENT_SECRET=... SOLID_OIDC_ISSUER=... \
  ts-node scripts/auth-example.ts
```

> 若使用本地 CSS 预设账户，可直接执行 `npm run example:auth` 获取等效输出。

## 浏览器：交互式登录

```ts
import {
  handleIncomingRedirect,
  login,
  getDefaultSession
} from '@inrupt/solid-client-authn-browser';
import { drizzle } from 'drizzle-solid';

export async function bootstrap() {
  await handleIncomingRedirect();
  const session = getDefaultSession();

  if (!session.info.isLoggedIn) {
    await login({
      oidcIssuer: 'https://solidcommunity.net',
      redirectUrl: window.location.href,
      clientName: 'Drizzle Solid Demo'
    });
    return null; // 浏览器将重定向后重新执行
  }

  return drizzle(session as any);
}
```

结合 `bootstrap()` 返回的数据库实例即可与 Node 端共享相同的查询逻辑。

## 常见问题

| 现象 | 处理建议 |
| --- | --- |
| `drizzle(session)` 报错 “需要有效的已认证Session” | 确认 `session.info.isLoggedIn === true` 并携带 `fetch` | 
| 登录后仍返回 401/403 | Pod 未授权访问，检查 CSS 是否运行及容器 ACL |
| 浏览器登录无响应 | 确认 `redirectUrl` 与应用托管地址一致，避免跨域阻止 |

更多上下文可参考 `docs/guides/authentication.md` 与 `docs/quick-start-local.md`。
