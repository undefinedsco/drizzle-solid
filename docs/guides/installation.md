# 安装指南

## 环境要求
- Node.js 18 或更高版本（建议使用长期支持版）
- npm 8+ 或兼容的包管理器（yarn、pnpm）
- TypeScript 5+（若在 TS 项目中使用）

## 安装核心依赖

使用 npm：

```bash
npm install drizzle-solid drizzle-orm
```

示例与测试默认依赖 Inrupt 的 Node 会话实现以及 CSS 运行时，可按需安装：

```bash
npm install --save-dev @inrupt/solid-client-authn-node
npm run css:install   # 首次运行或升级 CSS 依赖后执行
```

> 浏览器项目可改用 `@inrupt/solid-client-authn-browser`，接口签名与 Node 版保持一致。

## 最小化验证脚本

```ts
// scripts/verify-install.ts
import { Session } from '@inrupt/solid-client-authn-node';
import { drizzle, podTable, string } from 'drizzle-solid';

async function main() {
  const session = new Session();
  // 这里可替换为真实的客户端凭证或交互式登录
  await session.login({
    oidcIssuer: process.env.SOLID_OIDC_ISSUER!,
    clientId: process.env.SOLID_CLIENT_ID!,
    clientSecret: process.env.SOLID_CLIENT_SECRET!
  });

  const profiles = podTable('profiles', {
    webId: string('webId').primaryKey(),
    name: string('name')
  }, {
    containerPath: '/profiles/',
    rdfClass: 'https://schema.org/Person'
  });

  const db = drizzle(session);
  await db.select().from(profiles).limit(1); // 若未抛错则说明依赖正常
  console.log('drizzle-solid 初始化成功');
}

main().catch((error) => {
  console.error('验证失败', error);
  process.exit(1);
});
```

运行脚本：

```bash
SOLID_CLIENT_ID=... SOLID_CLIENT_SECRET=... SOLID_OIDC_ISSUER=... \
  node --loader ts-node/esm scripts/verify-install.ts
```

## TypeScript 配置建议

`tsconfig.json` 中确保以下编译选项启用：

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true
  }
}
```

## 常见问题

- **模块解析错误**：确认 Node 版本 >= 18 且 `npm install` 成功执行。
- **CSS 依赖冲突**：运行 `npm run css:install` 以安装隔离的 Comunica v2 依赖。
- **认证失败**：检查环境变量是否正确，必要时参考 `docs/guides/authentication.md`。

下一步阅读：[认证与连接](./authentication.md)
