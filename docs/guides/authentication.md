# Authentication and Connection

Chinese version: [`authentication.zh-CN.md`](authentication.zh-CN.md)

`drizzle-solid` reuses a Solid `Session` directly.

What matters is:

- you have a logged-in `Session`
- `pod(session)` vs `drizzle(session)` is only an API-shape choice
- Pod / IRI / exact-target semantics are the real runtime model

## Core concepts

- **WebID** — a Solid identity URL such as `https://alice.example/profile/card#me`
- **Pod** — the user-owned data space
- **Session** — the Inrupt SDK authentication holder with tokens and authenticated `fetch`

## Node.js client-credentials login

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
    throw new Error('Solid session login failed');
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

## Browser interactive login

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

## When to use `pod()`

Use it when you want collection reads, exact entities, and runtime binding to stay explicit.

If your app already relies heavily on builders or `db.query.*`, keeping `drizzle()` is fine.

## Session reuse

- **token caching** — tests can reuse `session.info.sessionId`-related state to reduce repeated login work
- **expiry handling** — if an operation returns 401/403, re-authenticate instead of letting later queries fail silently
- **multi-Pod access** — one `Session` is one auth context; permissions matter more than constructor naming

## Troubleshooting

| Symptom | Likely cause | What to check |
| --- | --- | --- |
| login succeeds but queries return 403 | missing Pod resource or ACL permissions | verify resource existence and authorization |
| login hangs | mismatched OIDC issuer or client credentials | verify `.env.local` and server config |
| browser callback returns but no login state | redirect URL mismatch | verify the real app URL |
| `drizzle(session)` / `pod(session)` says not logged in | `Session.login()` was not fully awaited | check `session.info.isLoggedIn === true` before constructing the client |
