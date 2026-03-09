# Node Session Authentication

This guide shows the recommended Node-side authentication flow for `drizzle-solid`.

## Recommended flow

1. Create an Inrupt `Session`
2. Log in with client credentials
3. Build your client with `pod(session)` for semantic-first code, or `drizzle(session)` if you want to keep the Drizzle-shaped surface
4. Use the Solid semantics you actually need: resource placement, IRI identity, exact-target mutation

## Minimal example

```ts
import { Session } from '@inrupt/solid-client-authn-node';
import { pod, podTable, string } from '@undefineds.co/drizzle-solid';

async function main() {
  const session = new Session();
  await session.login({
    oidcIssuer: process.env.SOLID_OIDC_ISSUER!,
    clientId: process.env.SOLID_CLIENT_ID!,
    clientSecret: process.env.SOLID_CLIENT_SECRET!,
    tokenType: 'DPoP',
  });

  if (!session.info.isLoggedIn) {
    throw new Error('Session login failed');
  }

  const todos = podTable('todos', {
    id: string('id').primaryKey(),
    title: string('title').predicate('http://schema.org/name'),
  }, {
    base: '/data/todos.ttl',
    type: 'http://schema.org/Thing',
  });

  const client = pod(session);
  await client.init(todos);

  const rows = await client.collection(todos).list({ limit: 10 });
  console.log(rows);
}

main().catch(console.error);
```

## Troubleshooting

| Error | Likely cause | Fix |
| --- | --- | --- |
| `needs to be logged in` | `Session.login()` was not awaited properly | Ensure `session.info.isLoggedIn` before constructing the client |
| 401 / 403 | Token expired or Pod ACL blocks access | Re-authenticate or fix ACL/container setup |
| `fetch` ECONNREFUSED | Local server is not running | Start CSS / xpod before running the example |
