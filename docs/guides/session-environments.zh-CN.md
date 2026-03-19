# Session Environments

English version: [`session-environments.md`](session-environments.md)

`drizzle-solid` 不要求认证必须来自某一种环境。

只要你最终拿到的是：

- 一个有效的 `webId`
- 一个认证过的 `fetch`

你就可以构造客户端。

## Inrupt Session

```ts
import { pod } from '@undefineds.co/drizzle-solid';

if (session.info.isLoggedIn) {
  const client = pod(session);
  const users = await client.collection(userTable).list();
}
```

## 最小 session 壳

```ts
import { pod, solid } from '@undefineds.co/drizzle-solid';

const client = pod(solid({
  webId: 'https://alice.example/profile/card#me',
  fetch: authenticatedFetch,
}));
```

## Drizzle-shaped alternative

如果你更想保持 builder / `db.query.*` 形状，也可以：

```ts
import { drizzle } from '@undefineds.co/drizzle-solid';

const db = drizzle(session);
```

## 传入应用层

```ts
import type { SolidAuthSession } from '@undefineds.co/drizzle-solid';
import { pod } from '@undefineds.co/drizzle-solid';

export function createApp(session: SolidAuthSession) {
  const client = pod(session);

  return {
    listUsers: () => client.collection(userTable).list(),
  };
}
```

## 关于选择

- 新代码更适合直接用 `pod()`
- 想保持 Drizzle 形状：继续用 `drizzle()`
- 真正关键的是 Pod / IRI / exact-target 语义，而不是入口名字本身
