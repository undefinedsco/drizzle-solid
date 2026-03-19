# drizzle-solid

Chinese version: [`README.zh-CN.md`](README.zh-CN.md)

`drizzle-solid` stores application-owned data in Solid Pods with typed schemas and a Drizzle-aligned developer experience.

Use it when you want:

- TypeScript schemas for Pod data
- explicit Pod layout through `base` and `subjectTemplate`
- a choice between a Solid-first API (`pod()`) and a Drizzle-shaped API (`drizzle()`)
- exact entity reads and writes by IRI or locator
- SPARQL-backed reads when your backend exposes query capability

## What it is good at

- application-owned data in your Pod or a user Pod
- typed CRUD over known resource layouts
- gradual migration from `drizzle-orm`
- Pod-native concepts such as IRIs, documents, links, discovery, notifications, and federation

## What it is not trying to be

- a general-purpose RDF exploration toolkit
- full SQL/database parity across every Solid backend
- a library that hides Pod boundaries, permissions, or network costs
- a raw SQL-first abstraction

## Install

```bash
yarn add @undefineds.co/drizzle-solid drizzle-orm
# optional: install when your app wants the built-in SPARQL engine
yarn add @comunica/query-sparql-solid
```

```bash
npm install @undefineds.co/drizzle-solid drizzle-orm
# optional: install when your app wants the built-in SPARQL engine
npm install @comunica/query-sparql-solid
```

`@comunica/query-sparql-solid` is an optional peer dependency.

Current support stance:

- supported: `@comunica/query-sparql-solid` `4.x`
- not in the current supported matrix: `3.x`

If another in-process runtime already ships Comunica, inject that engine instead of installing a second copy.

## Choose your API style

### `pod(session)`

Use this for new code when you want Solid concepts to be explicit in the API:

- `collection(table)`
- `entity(table, iri)`
- `bind(schema, options)`
- `sparql(query)`

### `drizzle(session)`

Use this when you are migrating from `drizzle-orm` or want to keep builder-shaped code:

- `select / insert / update / delete`
- `db.query.<table>`
- `findByLocator / findByIri`
- `updateByLocator / updateByIri`
- `deleteByLocator / deleteByIri`

Both styles use the same runtime. The difference is API shape, not storage behavior.

## Quick start

```ts
import { pod, podTable, string, datetime } from '@undefineds.co/drizzle-solid';

const posts = podTable('posts', {
  id: string('id').primaryKey(),
  title: string('title').predicate('http://schema.org/headline'),
  content: string('content').predicate('http://schema.org/text'),
  createdAt: datetime('createdAt').predicate('http://schema.org/dateCreated'),
}, {
  base: 'https://alice.example/data/posts/',
  subjectTemplate: '{id}.ttl',
  type: 'http://schema.org/CreativeWork',
});

const client = pod(session);
await client.init(posts);

const created = await client.collection(posts).create({
  id: 'post-1',
  title: 'Hello Solid',
  content: 'Stored as RDF in a Pod document.',
  createdAt: new Date(),
});

if (!created) {
  throw new Error('Create failed');
}

const post = client.entity(posts, created['@id']);

console.log(await post.get());
await post.update({ title: 'Updated title' });
await post.delete();
```

## Drizzle-style exact operations

```ts
import { drizzle, podTable, string } from '@undefineds.co/drizzle-solid';

const posts = podTable('posts', {
  id: string('id').primaryKey(),
  title: string('title').predicate('http://schema.org/headline'),
}, {
  base: 'https://alice.example/data/posts/',
  subjectTemplate: '{id}.ttl',
  type: 'http://schema.org/CreativeWork',
});

const db = drizzle(session);
await db.init(posts);

await db.insert(posts).values({
  id: 'post-1',
  title: 'Hello Solid',
});

const row = await db.findByLocator(posts, { id: 'post-1' });

await db.updateByLocator(posts, { id: 'post-1' }, {
  title: 'Updated title',
});

await db.deleteByLocator(posts, { id: 'post-1' });
```

## How Pod layout works

Every model describes both shape and placement.

- `base` defines where documents live
- `subjectTemplate` defines how business fields map to an IRI
- `type` is the primary persisted `rdf:type`

Common `subjectTemplate` patterns:

- `#{id}` — many entities in one document
- `{id}.ttl` — one document per entity
- `{id}.ttl#it` — one document per entity with a stable fragment
- `{chatId}/messages.ttl#{id}` — partitioned layout with multiple locator variables

If your template uses multiple variables, exact lookup requires either:

- the full IRI, or
- a complete locator with every required variable

## Collection reads vs exact entity operations

This is the most important runtime rule.

### Collection reads

Use collection reads when you want a list or filtered subset:

- `client.collection(table).list(...)`
- `db.select().from(table)...`
- `db.query.<table>.findMany(...)`

### Exact entity operations

Use exact-target helpers when you mean one concrete entity:

- `client.entity(table, iri)`
- `db.findByIri(table, iri)`
- `db.findByLocator(table, locator)`
- `db.updateByIri(...)`
- `db.updateByLocator(...)`
- `db.deleteByIri(...)`
- `db.deleteByLocator(...)`

Do not rely on `where({ id: ... })` or `where(eq(table.id, ...))` as an exact-target shortcut.

## SPARQL support and backend behavior

`drizzle-solid` works across different Solid runtimes, but capabilities differ.

| Capability | Community Solid Server | xpod |
| --- | --- | --- |
| Basic CRUD | ✅ | ✅ |
| Document notifications | ✅ | ✅ |
| Drizzle-style read facade | ✅ | ✅ |
| SPARQL pushdown | ⚠️ Limited / often client-assisted | ✅ Better in-process support |
| Filter / aggregation pushdown | ❌ Mostly client-side execution | ✅ Better server-side support |
| Federated queries | ⚠️ Client-side federation | ⚠️ Client-side federation |
| In-process local runtime | ⚠️ External setup | ✅ via `@undefineds.co/xpod` |

Practical rule:

- if you have a SPARQL endpoint or sidecar, use it for collection queries
- if you only have plain LDP document access, exact-target reads and writes still work
- plain-LDP document mode does not silently widen exact operations into scans

## Examples

The canonical examples in `examples/` are part of the integration verification flow:

- `examples/01-quick-start.ts`
- `examples/02-relational-query.ts`
- `examples/03-zero-config-discovery.ts`
- `examples/04-notifications.ts`
- `examples/05-data-discovery.ts`
- `examples/06-federated-query.ts`
- `examples/07-hooks-and-profile.ts`
- `examples/08-iri-based-operations.ts`
- `examples/08-schema-inheritance.ts`
- `examples/09-multi-variable-templates.ts`

## Documentation

Start here:

- `docs/guides/installation.md`
- `docs/api/README.md`
- `docs/guides/migrating-from-drizzle-orm.md`
- `docs/guides/multi-variable-templates.md`
- `docs/guides/notifications.md`
- `docs/guides/data-discovery.md`

## Contributing

Before pushing:

```bash
yarn quality
SOLID_ENABLE_REAL_TESTS=true SOLID_SERIAL_TESTS=true yarn vitest --run tests/integration/css
```

Examples must remain runnable and verified.

## License

MIT

## Related links

- GitHub: https://github.com/undefinedsco/drizzle-solid
- npm: https://www.npmjs.com/package/@undefineds.co/drizzle-solid
- xpod: https://github.com/undefinedsco/xpod
