# Installation

Chinese version: [`installation.zh-CN.md`](installation.zh-CN.md)

## Requirements

- Node.js 18+
- TypeScript 5+ for TS projects
- Yarn / npm / pnpm

## 1. Install the core package

```bash
yarn add @undefineds.co/drizzle-solid drizzle-orm
```

or:

```bash
npm install @undefineds.co/drizzle-solid drizzle-orm
```

## 2. Pick an authentication package

For Node services:

```bash
yarn add @inrupt/solid-client-authn-node
```

Browser apps can use `@inrupt/solid-client-authn-browser`.

## 3. Pick a SPARQL engine strategy

`@comunica/query-sparql-solid` is an optional peer dependency.

Current support:

- supported: `4.x`
- not in the current support matrix: `3.x`

Install it in the app when you need:

- built-in SPARQL execution
- `db.executeSPARQL()` / `client.sparql()`
- SPARQL-backed cross-resource reads

```bash
yarn add @comunica/query-sparql-solid
```

### If the host runtime already ships Comunica

Reuse that copy instead of installing another one:

```ts
import { createRequire } from 'node:module';
import { pod, createNodeModuleSparqlEngineFactory } from '@undefineds.co/drizzle-solid';

const requireFromHere = createRequire(import.meta.url);

const client = pod(session, {
  sparql: {
    createQueryEngine: createNodeModuleSparqlEngineFactory(
      requireFromHere.resolve('@undefineds.co/xpod/package.json')
    ),
  },
});
```

Or configure one shared process-wide engine:

```ts
import { createRequire } from 'node:module';
import {
  configureSparqlEngine,
  createNodeModuleSparqlEngineFactory,
} from '@undefineds.co/drizzle-solid';

const requireFromHere = createRequire(import.meta.url);

configureSparqlEngine({
  createQueryEngine: createNodeModuleSparqlEngineFactory(
    requireFromHere.resolve('@undefineds.co/xpod/package.json')
  ),
});
```

## 4. Minimal verification

This example uses `pod(session)` because it shows collection and entity semantics directly.

```ts
import { Session } from '@inrupt/solid-client-authn-node';
import { pod, podTable, string } from '@undefineds.co/drizzle-solid';

async function main() {
  const session = new Session();
  await session.login({
    oidcIssuer: process.env.SOLID_OIDC_ISSUER!,
    clientId: process.env.SOLID_CLIENT_ID!,
    clientSecret: process.env.SOLID_CLIENT_SECRET!,
  });

  const profiles = podTable('profiles', {
    webId: string('webId').primaryKey(),
    name: string('name').predicate('http://xmlns.com/foaf/0.1/name'),
  }, {
    base: '/profiles/profiles.ttl',
    type: 'http://xmlns.com/foaf/0.1/Person',
  });

  const client = pod(session);
  await client.init(profiles);

  const rows = await client.collection(profiles).list({ limit: 1 });
  console.log(rows);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

If you prefer a Drizzle-shaped surface, you can keep using `drizzle(session)`.

## 5. Migrating from `drizzle-orm`

Start here:

- `docs/guides/migrating-from-drizzle-orm.md`

## 6. Repository development / testing

If you are working inside this repository and want real CSS / xpod tests:

```bash
yarn css:install
```

This installs the isolated CSS runtime under `.internal/css-runtime/`.

## FAQ

- **`Cannot find module '@comunica/query-sparql-solid'`**
  - install it in the app, or inject the host runtime copy through `sparql.createQueryEngine` / `configureSparqlEngine()`
- **Authentication fails**
  - check `SOLID_CLIENT_ID`, `SOLID_CLIENT_SECRET`, and `SOLID_OIDC_ISSUER`
- **CSS / xpod dependency conflicts**
  - use `yarn css:install` inside this repository to keep the test runtime isolated
