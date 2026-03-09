# Authentication Example

This example shows the recommended application entry pattern.

## Node example

仓库里的主线 example 默认用 `pod()` 展开：

```ts
import { Session } from '@inrupt/solid-client-authn-node';
import { pod, podTable, string } from '@undefineds.co/drizzle-solid';

async function run() {
  const session = new Session();
  await session.login({
    oidcIssuer: process.env.SOLID_OIDC_ISSUER!,
    clientId: process.env.SOLID_CLIENT_ID!,
    clientSecret: process.env.SOLID_CLIENT_SECRET!,
    tokenType: 'DPoP',
  });

  const profiles = podTable('profiles', {
    id: string('id').primaryKey(),
    name: string('name').predicate('http://xmlns.com/foaf/0.1/name'),
  }, {
    base: '/profiles/profiles.ttl',
    type: 'http://xmlns.com/foaf/0.1/Person',
  });

  const client = pod(session);
  await client.init(profiles);

  const result = await client.collection(profiles).list({ limit: 5 });
  console.log(result);
}
```

## When you only have `fetch`

```ts
import { pod, solid } from '@undefineds.co/drizzle-solid';

export function createClient(webId: string, authenticatedFetch: typeof fetch) {
  return pod(solid({
    webId,
    fetch: authenticatedFetch,
  }));
}
```

## Drizzle-shaped alternative

如果你更想保留 Drizzle 风格 builder / `db.query.*` 代码形状，也可以继续使用：

```ts
import { drizzle } from '@undefineds.co/drizzle-solid';

const db = drizzle(session);
```

## Quick troubleshooting

| Symptom | Suggestion |
| --- | --- |
| `pod(session)` / `drizzle(session)` reports an unauthenticated session | Ensure `session.info.isLoggedIn === true` and the session carries an authenticated `fetch` |
| Logged in but still seeing 401/403 | Check Pod ACL and whether the target container exists |
| Browser login does not complete | Verify `redirectUrl` and hosting origin |
