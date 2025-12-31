# Session 与运行环境

drizzle-solid 支持 4 种运行环境，每种环境使用不同的 Session 创建方式，但 drizzle 的使用方式完全一致。

## 环境总览

| 场景 | 环境 | Session 来源 | 典型场景 |
|------|------|-------------|---------|
| 独立浏览器应用 | Browser | `@inrupt/solid-client-authn-browser` | 第三方 Solid 应用 |
| 独立 Node 应用 | Node | `@inrupt/solid-client-authn-node` | CLI 工具、后端服务 |
| Pod 生态浏览器应用 | Browser | 宿主传入 Session | Pod 管理界面的内嵌插件 |
| Pod 生态 Node 应用 | Node | `@inrupt/solid-client-authn-node` + client credentials | 代理人服务（API Server） |

## 核心概念：密码箱模型

Pod 可以理解为用户的 **密码箱**，里面存放各类第三方服务的钥匙（API Key、Token 等）。

```
Pod = 密码箱
  ├── AI API Key（OpenAI、Claude 等）
  ├── GitHub Token
  ├── 其他服务凭证
  └── ...

client_id + client_secret = 密码箱钥匙（访问 Pod 的凭证）
```

当用户需要一个 **代理人**（如 API Server）帮忙办事时：

1. 用户把密码箱钥匙（client_id + client_secret）给代理人
2. 代理人用钥匙打开密码箱（登录 Pod）
3. 代理人从密码箱拿需要的钥匙（读取 AI API Key 等）
4. 代理人用拿到的钥匙办事（调用 AI 服务等）

## 使用方式

### 场景 1：独立浏览器应用

第三方 Solid 应用，需要完整的 OIDC 登录流程。

```typescript
import { Session } from '@inrupt/solid-client-authn-browser';
import { drizzle } from 'drizzle-solid';

// 创建 session 并登录
const session = new Session();
await session.login({
  oidcIssuer: 'https://login.inrupt.com',
  clientId: 'your-client-id',
  redirectUrl: window.location.href,
});

// 登录成功后使用 drizzle
if (session.info.isLoggedIn) {
  const db = drizzle(session);
  const users = await db.select().from(userTable);
}
```

### 场景 2：独立 Node 应用

CLI 工具或后端服务，需要完整的 OIDC 登录流程。

```typescript
import { Session } from '@inrupt/solid-client-authn-node';
import { drizzle } from 'drizzle-solid';

const session = new Session();
await session.login({
  oidcIssuer: 'https://login.inrupt.com',
  clientId: process.env.SOLID_CLIENT_ID,
  clientSecret: process.env.SOLID_CLIENT_SECRET,
});

if (session.info.isLoggedIn) {
  const db = drizzle(session);
  const users = await db.select().from(userTable);
}
```

### 场景 3：Pod 生态浏览器应用（内嵌）

内嵌在 Pod Web UI 中的应用，用户已经登录，宿主负责提供 Session。

**内嵌应用代码：**

```typescript
import { drizzle, SolidAuthSession } from 'drizzle-solid';

// 应用接收 session，不关心它怎么来的
export function createApp(session: SolidAuthSession) {
  const db = drizzle(session);
  
  return {
    async getUsers() {
      return db.select().from(userTable);
    },
    async createUser(data) {
      return db.insert(userTable).values(data);
    },
  };
}
```

**Pod Web UI（宿主）代码：**

```typescript
// 宿主构造 session，传给内嵌应用
function initEmbeddedApp(appModule, currentWebId) {
  const session = {
    info: { isLoggedIn: true, webId: currentWebId },
    fetch: window.fetch.bind(window),  // 自动带 cookie
  };
  return appModule.createApp(session);
}

// 用户切换 Pod 时，重新创建应用实例
function switchPod(appModule, newWebId) {
  const session = {
    info: { isLoggedIn: true, webId: newWebId },
    fetch: window.fetch.bind(window),
  };
  return appModule.createApp(session);
}
```

**Session 切换通知：**

当用户在 Pod Web UI 切换 Pod 时，宿主会发送通知：

```typescript
// 宿主发送通知
window.dispatchEvent(new CustomEvent('solid-session-change', {
  detail: { session: newSession }
}));

// 内嵌应用监听通知
window.addEventListener('solid-session-change', (event) => {
  const { session } = event.detail;
  app = createApp(session);  // 重新创建应用实例
});
```

### 场景 4：Pod 生态 Node 应用（代理人服务）

API Server 等代理人服务，使用用户提供的 client_id + client_secret 访问用户的 Pod。

**完整流程：**

```
创建阶段（在 Pod Web UI 内嵌的管理页面）：
1. 用户点击 "创建 API Key"
2. 内嵌应用调用 Pod 创建 client_id + client_secret
3. 内嵌应用把 client_id + client_secret 发给 API Server 后端存储
4. 用户拿到 client_id 当 API Key 使用

使用阶段：
1. 用户请求 API Server，带着 client_id（作为 API Key）
2. API Server 查自己的数据库：client_id -> { webId, client_secret }
3. API Server 用 client_id + client_secret 登录 Pod
4. 访问用户 Pod 数据
```

**API Server 代码：**

```typescript
import { Session } from '@inrupt/solid-client-authn-node';
import { drizzle } from 'drizzle-solid';

app.get('/chat', async (req) => {
  const clientId = req.headers['x-api-key'];
  
  // 1. 查自己的数据库，拿到用户的凭证
  const credentials = await apiServerDb.query(
    'SELECT webId, client_secret FROM user_credentials WHERE client_id = ?',
    [clientId]
  );
  
  if (!credentials) {
    return res.status(401).json({ error: 'Invalid API Key' });
  }
  
  // 2. 用 client_id + client_secret 登录 Pod
  const session = new Session();
  await session.login({
    oidcIssuer: inferIssuerFromWebId(credentials.webId),
    clientId: clientId,
    clientSecret: credentials.client_secret,
  });
  
  // 3. 访问用户 Pod，获取 AI API Key
  const db = drizzle(session);
  const aiKeys = await db.select().from(apiKeysTable).where(eq(name, 'openai'));
  
  // 4. 用获取到的 API Key 调用 AI 服务
  const ai = new OpenAI({ apiKey: aiKeys[0].value });
  const response = await ai.chat.completions.create({ ... });
  
  return res.json(response);
});

// 从 webId 推断 OIDC issuer
function inferIssuerFromWebId(webId: string): string {
  const url = new URL(webId);
  return `${url.protocol}//${url.host}`;
}
```

**管理页面（内嵌应用）代码：**

```typescript
import { drizzle, SolidAuthSession } from 'drizzle-solid';

export function createApiKeyManager(session: SolidAuthSession) {
  const db = drizzle(session);
  
  return {
    // 创建新的 API Key（调用 Pod 的凭证创建接口）
    async createApiKey(name: string) {
      // 1. 调用 Pod 创建 client credentials
      const credentials = await createClientCredentials(session, name);
      
      // 2. 把 credentials 发送给 API Server 存储
      await fetch('https://api-server.example/register-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          webId: session.info.webId,
        }),
      });
      
      // 3. 返回 clientId 给用户当 API Key 用
      return { apiKey: credentials.clientId };
    },
    
    // 列出用户的 API Keys
    async listApiKeys() {
      return db.select().from(apiKeysTable);
    },
    
    // 撤销 API Key
    async revokeApiKey(clientId: string) {
      // 调用 Pod 撤销凭证 + 通知 API Server 删除记录
    },
  };
}
```

## SolidAuthSession 接口

drizzle-solid 接受任何实现此接口的 session 对象：

```typescript
interface SolidAuthSession {
  info: {
    isLoggedIn: boolean;
    webId?: string;
    sessionId?: string;
  };
  fetch: typeof fetch;
  login?: (options?: any) => Promise<void>;
  logout?: () => Promise<void>;
}
```

Inrupt SDK 的 Session 类和宿主构造的简单对象都满足此接口。

## 同构应用设计

如果你的应用需要同时支持 **独立部署** 和 **内嵌部署**，推荐以下模式：

```typescript
// ========== app.ts - 应用核心逻辑 ==========
import { drizzle, SolidAuthSession } from 'drizzle-solid';
import { userTable } from './schema';

export function createApp(session: SolidAuthSession) {
  const db = drizzle(session);
  
  return {
    db,
    session,
    
    async getUsers() {
      return db.select().from(userTable);
    },
    
    async createUser(data: { name: string; email: string }) {
      return db.insert(userTable).values(data);
    },
  };
}

export type App = ReturnType<typeof createApp>;
```

```typescript
// ========== standalone.ts - 独立部署入口 ==========
import { Session } from '@inrupt/solid-client-authn-browser';
import { createApp } from './app';

const session = new Session();

export async function init() {
  await session.login({
    oidcIssuer: 'https://login.inrupt.com',
    clientId: 'your-client-id',
    redirectUrl: window.location.href,
  });
  
  if (session.info.isLoggedIn) {
    return createApp(session);
  }
  throw new Error('Login failed');
}
```

```typescript
// ========== embedded.ts - 内嵌部署入口 ==========
import { SolidAuthSession } from 'drizzle-solid';
import { createApp } from './app';

// 导出给宿主调用
export function initWithSession(session: SolidAuthSession) {
  return createApp(session);
}
```

## Session 生命周期

| 场景 | Session 创建 | Session 更新 | Session 销毁 |
|------|-------------|-------------|-------------|
| 独立浏览器应用 | 用户登录时 | 刷新 token（SDK 自动处理） | 用户登出时 |
| 独立 Node 应用 | 服务启动时 | 刷新 token（SDK 自动处理） | 服务停止时 |
| Pod 内嵌应用 | 宿主传入 | 宿主切换 Pod 时通知 | 宿主管理 |
| Pod 代理人服务 | 每次请求时创建 | 无需更新 | 请求结束后释放 |

## 注意事项

1. **内嵌应用监听 Session 变化**：当用户在 Pod Web UI 切换 Pod 时，需要监听 `solid-session-change` 事件并重新创建应用实例。

2. **代理人服务安全存储 client_secret**：API Server 需要安全存储用户的 client_secret，建议加密存储。

3. **独立应用处理登录流程**：包括重定向、token 刷新等，由 Inrupt SDK 自动处理。

4. **从 webId 推断 issuer**：代理人服务可以从 webId 推断 OIDC issuer，格式通常为 `protocol://host`。
