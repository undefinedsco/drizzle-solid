# drizzle-solid

`drizzle-solid` is a Drizzle-aligned adapter for application-owned data in Solid Pods.

It helps you define typed models, map them to RDF resources/documents/IRIs, and read or write them with a familiar query builder — without pretending Solid is a relational database.

The library is intentionally **document-first**, **IRI-native**, **Pod-aware**, and **SPARQL-native**.

## What it helps with

- Defining typed application data for Solid Pods
- Mapping fields to RDF predicates and resource layouts
- Using a Drizzle-style CRUD/query builder over Pod data
- Performing exact entity operations through full IRIs
- Building discovery, federation, and notification flows on top of Solid-native storage

## Design principles

- **Document-first**: model around Solid resources and document boundaries
- **IRI-native**: treat IRIs as first-class identity, not as an afterthought over local IDs
- **Pod-aware**: keep resource layout, links, network, and access constraints explicit
- **Drizzle-aligned**: stay close to Drizzle's builder surface and ergonomics where it makes sense
- **SPARQL-native**: the native query model is SPARQL/Solid, not SQL emulation

## What it is

- A typed persistence layer for application-owned data in Solid Pods
- A Drizzle-style API surface over RDF resources and documents
- A practical bridge for teams migrating Drizzle mental models into Solid-native data flows

## What it isn't

- Not a general-purpose SQL ORM
- Not a universal abstraction over arbitrary RDF on the open web
- Not a graph database or SPARQL engine replacement
- Not a black box that hides Pod boundaries, permissions, or network behavior
- Not a promise that every SQL/driver-specific Drizzle feature maps cleanly to Solid

## Core concepts

### Resource

A resource is the persisted unit in a Pod, usually a Turtle or JSON-LD document addressed by URL.

### Document

A document may contain one entity or many entities. Document layout is part of application design, not an implementation detail.

### Entity

An entity is a typed RDF subject stored in a document. It is closer to a linked-data subject than to a relational row.

### IRI

IRIs are native identity. `drizzle-solid` keeps the full subject IRI available and provides explicit IRI APIs for exact operations.

### Link

Links between entities are represented as IRIs and may cross documents or Pods.

### Model

`drizzle-solid` supports two modeling styles:

- `podTable(...)`: schema plus concrete storage location
- `solidSchema(...)` + `db.createTable(...)`: reusable schema separated from where data is stored

### Pod client

`drizzle(session)` creates the database client bound to an authenticated Solid session.

## Modeling vs persistence

A Solid application usually needs to answer two different questions:

1. **What is the shape of my data?**
2. **Where does that data live in Pods?**

`drizzle-solid` keeps those concerns explicit.

- Use `podTable(...)` when your app owns the storage location and you want one place to define shape + location.
- Use `solidSchema(...)` when the same schema should be reused across different Pod locations, profiles, or discovered data sources.
- Use `db.createTable(schema, { base, ... })` when you want to bind a reusable schema to a concrete place at runtime.

This keeps Solid's persistence model visible instead of flattening everything into table-only abstractions.

## Why document-first

Solid stores data in resources, not in tables.

That means application design starts with questions like:

- which entities belong in the same document
- which entities should be split into separate resources
- which resources should be public, private, or shared
- how links should work across documents and Pods

`drizzle-solid` follows that reality. It provides a structured API, but keeps resource identity and document layout as part of the model.

## Quick start

### Install

```bash
yarn add @undefineds.co/drizzle-solid drizzle-orm
# optional, when you want the default LDP/SPARQL client engine in the app
yarn add @comunica/query-sparql-solid
```

```bash
# or with npm
npm install @undefineds.co/drizzle-solid drizzle-orm
npm install @comunica/query-sparql-solid
```

`@comunica/query-sparql-solid` is now an **optional peer dependency**.

Install it directly in the consuming app when you use LDP-backed query resolution, raw `executeSPARQL()`, or other flows that need the built-in SPARQL client. If you already ship that engine elsewhere (for example through `xpod`), inject it instead of forcing a second copy.

Current compatibility stance:

- **Officially supported**: `@comunica/query-sparql-solid` **4.x**
- **Not currently part of the public support matrix**: `3.x`
- The codebase contains a few compatibility shims for different binding shapes, but we should not advertise `3.x` as supported until we add an explicit test matrix and widen the peer range.

> In this repository, the examples import `drizzle-solid` through a local TypeScript path alias. In external applications, import the published package name: `@undefineds.co/drizzle-solid`.

### Define a model and run CRUD

```ts
import {
  drizzle,
  podTable,
  string,
  datetime,
  eq,
} from '@undefineds.co/drizzle-solid';

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

const db = drizzle(session);
await db.init([posts]);

await db.insert(posts).values({
  id: 'post-1',
  title: 'Hello Solid',
  content: 'Stored as RDF in a Pod document.',
  createdAt: new Date(),
});

const rows = await db.select()
  .from(posts)
  .where(eq(posts.id, 'post-1'));

await db.update(posts)
  .set({ title: 'Updated title' })
  .where(eq(posts.id, 'post-1'));

await db.delete(posts)
  .where(eq(posts.id, 'post-1'));
```

### Reusable schema + runtime binding

```ts
import {
  drizzle,
  solidSchema,
  id,
  string,
} from '@undefineds.co/drizzle-solid';

const profileSchema = solidSchema({
  id: id(),
  name: string('name').predicate('http://xmlns.com/foaf/0.1/name'),
  bio: string('bio').predicate('http://schema.org/description'),
}, {
  type: 'http://xmlns.com/foaf/0.1/Person',
});

const db = drizzle(session);

const profileTable = db.createTable(profileSchema, {
  base: 'https://alice.example/profile/card',
});
```

## Exact IRI operations

For detail-page flows, remote links, shared resources, or exact mutation targets, use the IRI APIs:

- `db.findByIri(table, iri)`
- `db.updateByIri(table, iri, data)`
- `db.deleteByIri(table, iri)`
- `db.subscribeByIri(table, iri, options)`

```ts
const agent = await db.findByIri(agentTable, 'https://alice.example/data/agents.ttl#assistant');

await db.updateByIri(
  agentTable,
  'https://alice.example/data/agents.ttl#assistant',
  { description: 'Updated through explicit IRI' },
);

await db.deleteByIri(
  agentTable,
  'https://alice.example/data/agents.ttl#assistant',
);
```

## Subject templates and identity

`subjectTemplate` controls how record identity maps to Pod resources.

Common patterns:

- `#{id}`: fragment mode, many entities in one RDF file
- `{id}.ttl`: document mode, one file per entity
- `{id}.ttl#it`: document mode with stable in-document fragment
- `{chatId}/{yyyy}/{MM}/{dd}/messages.ttl#{id}`: multi-variable, date-partitioned layouts

Example:

```ts
const Message = podTable('Message', {
  id: string('id').primaryKey(),
  chatId: string('chatId').predicate('http://example.org/chatId'),
  content: string('content').predicate('http://schema.org/text'),
  timestamp: datetime('timestamp').predicate('http://schema.org/dateCreated'),
}, {
  base: 'https://alice.example/data/chats/',
  subjectTemplate: '{chatId}/messages.ttl#{id}',
  type: 'http://schema.org/Message',
});
```

For reads, the library can often work from:

- a full IRI
- all template variables
- a narrower partial condition that scans a smaller bounded area

Read-path and write-path semantics are intentionally different:

- **Read queries** (`select`, `db.query.*`) may use partial template information for list/filter flows when the resolver can keep the scan bounded.
- **Mutations** (`update`, `delete`) require deterministic targets by default. If `where()` cannot uniquely resolve the subject from the template, the dialect throws and tells you to use `updateByIri()` / `deleteByIri()` (or to provide the missing template variables).
- **No implicit scan-based `updateMany/deleteMany` fallback** is performed on backends that do not natively support set-based mutation.
- **Capability-based enhancement**: if a backend explicitly supports filter-based multi-row mutation in the future (for example, an xpod capability), `drizzle-solid` can expose that path there without pretending every Solid server supports it.

## Server support

### Capability matrix

| Capability | Community Solid Server | xpod |
| --- | --- | --- |
| Basic CRUD | ✅ LDP mode | ✅ LDP mode |
| SPARQL SELECT pushdown | ❌ Client-side / resolver-driven | ✅ `/-/sparql` sidecar |
| SPARQL UPDATE | ⚠️ Limited / write path stays LDP-oriented | ✅ Better server-side support |
| Filter / aggregation pushdown | ❌ Fallbacks and client execution | ✅ Single-Pod pushdown |
| Federated queries | ⚠️ Client-side federation | ⚠️ Client-side federation |
| Notifications | ✅ | ✅ |
| In-process test runtime | ⚠️ External CSS setup | ✅ via `@undefineds.co/xpod` |

### Community Solid Server (CSS)

On plain CSS, `drizzle-solid` keeps working, but many queries are resolved through client-side execution and Solid-aware fallbacks. This is the compatibility baseline.

### xpod

`xpod` adds a Solid-compatible SPARQL sidecar and is the recommended development/runtime target when you want stronger query pushdown and a lower-friction local setup.

If `xpod` already carries its own Comunica stack, you can point `drizzle-solid` at that copy instead of installing another one in the app:

```ts
import { createRequire } from 'node:module';
import {
  drizzle,
  createNodeModuleSparqlEngineFactory,
} from '@undefineds.co/drizzle-solid';

const requireFromHere = createRequire(import.meta.url);

const db = drizzle(session, {
  sparql: {
    createQueryEngine: createNodeModuleSparqlEngineFactory(
      requireFromHere.resolve('@undefineds.co/xpod/package.json')
    ),
  },
});
```

The same factory can also be registered globally via `configureSparqlEngine(...)` when you want one process-wide default.

See `docs/xpod-features.md` and `docs/api/README.md` for more detail.

## Verified examples

The canonical examples in `examples/` are verified in the test suite.

- `examples/01-quick-start.ts` — CRUD quick start
- `examples/02-relational-query.ts` — relational query API surface
- `examples/03-zero-config-discovery.ts` — zero-config discovery flow
- `examples/04-notifications.ts` — Solid notifications
- `examples/05-data-discovery.ts` — discovery API
- `examples/06-federated-query.ts` — federated query across Pods
- `examples/07-hooks-and-profile.ts` — hooks and profile management
- `examples/08-iri-based-operations.ts` — explicit IRI operations
- `examples/08-schema-inheritance.ts` — schema inheritance
- `examples/09-multi-variable-templates.ts` — multi-variable subject templates

The example manifest lives at `examples/manifest.json`, and the integration verification lives at `tests/integration/css/examples-verification.test.ts`.

## Query surface and SQL scope

`drizzle-solid` aims to stay close to Drizzle's public builder surface where that maps cleanly to Solid.

Current supported surface includes:

- CRUD builders: `select`, `insert`, `update`, `delete`
- Read-oriented query facade: `db.query.*.findMany`, `findFirst`, `findById`, `findByIRI`, `count`
- Exact-target APIs: `findByIri`, `updateByIri`, `deleteByIri`, `subscribeByIri`
- Conditions: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `inArray`, `exists`, `and`, `or`, `not`
- Query features: joins, ordering, limits, offsets, distinct, aggregation helpers
- Builder inspection via `toSPARQL()` / `toSparql()`
- Raw **SPARQL** workflows through `execute()` / `executeSPARQL()` where you need explicit graph-native control
- Batch and `returning()` support where implemented by the dialect

Not the mainline contract:

- `toSQL()` compatibility aliases
- raw SQL as the primary abstraction
- transaction semantics identical to SQL databases
- implicit scan-based `updateMany/deleteMany` on backends that do not support set-based mutation
- driver-specific DDL, auto-increment, foreign keys, or SQL engine behaviors

The migration goal is API familiarity with low migration cost, but the execution model remains Solid/SPARQL-native rather than semantics-faking SQL emulation. See `docs/api/README.md` for the current public surface and runtime wiring options.

## Discovery, interoperability, and federation

The library also includes higher-level Solid workflows:

- data discovery and interop metadata
- TypeIndex-driven location discovery
- shape-aware table generation
- federated queries across discovered Pod locations
- notifications for resource/entity updates

Useful starting points:

- `docs/guides/data-discovery.md`
- `docs/guides/notifications.md`
- `docs/guides/css-notifications.md`
- `docs/federated-queries.md`
- `docs/guides/multi-variable-templates.md`

## Documentation map

- `examples/README.md` — curated walkthroughs and runnable examples
- `docs/quick-start-local.md` — local setup guide
- `docs/guides/data-discovery.md` — discovery workflows
- `docs/guides/issue-handling.md` — issue reproduction and regression workflow
- `docs/api/README.md` — public API and runtime wiring reference
- `docs/guides/testing.md` — test conventions and coverage strategy
- `ACTION-PLAN.md` — current parity and implementation plan

## Planned scope

### Current direction

The current focus is:

- typed models for application-owned Pod data
- explicit document and subject placement
- Drizzle-aligned query ergonomics
- practical CRUD, discovery, federation, and notification flows

### Likely next steps

- better modeling ergonomics around reusable schemas and links
- clearer guidance around multi-resource layouts and identity strategies
- continued Drizzle parity on Solid-relevant behaviors
- stronger documentation around Solid-native tradeoffs and migration paths

### Out of scope

- hiding Solid behind a fake SQL database mental model
- universal querying over arbitrary open-world RDF as the primary goal
- promising full relational/database feature parity where Solid semantics differ

## Contributing

Before contributing:

```bash
yarn build
yarn lint
SOLID_ENABLE_REAL_TESTS=true SOLID_SERIAL_TESTS=true yarn vitest --run --silent
```

Examples must remain runnable and verified.

## License

MIT

## Related links

- GitHub: https://github.com/undefinedsco/drizzle-solid
- npm: https://www.npmjs.com/package/@undefineds.co/drizzle-solid
- xpod: https://github.com/undefinedsco/xpod
