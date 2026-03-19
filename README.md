# drizzle-solid

`drizzle-solid` is a Drizzle-aligned data layer for application-owned data in Solid Pods.

这次变化的重点不是强迫你把构造函数名字从 `drizzle()` 换成别的东西，而是把语义讲清楚：

- `table` 更接近 **resource layout / collection definition**
- `link` 字段更接近 **RDF link / IRI link**
- 实体最终身份更接近 **IRI / @id**，而不只是本地主键
- 读取和写入不再默认共享 SQL 式语义

## Scope

Current v1 solves one problem well:

- persist application-owned data into Solid Pods with typed schemas
- keep Pod layout explicit through `base` and `subjectTemplate`
- make full IRIs part of the public API instead of hiding them behind local-only IDs
- give Drizzle users a migration-friendly surface without pretending Solid is a SQL database
- support adjacent Solid flows such as discovery, notifications, and federation where they fit the Pod model

Not in v1:

- full SQL/database feature parity
- raw SQL as the primary abstraction
- hiding Pod boundaries, permissions, or network behavior
- implicit scan-based `updateMany/deleteMany` on backends that do not support set-based mutation
- universal querying over arbitrary open-world RDF as the main goal

## Constructor Choice

仓库文档与 examples 默认先用 `pod(session, config?)` 讲主线语义：

- `pod(session, config?)`
- `drizzle(session, config?)`

建议这样理解：

- `pod()` 是语义优先的正式入口，方便把 API 组织成 `collection()` / `entity()` / `bind()`
- `drizzle()` 是同一运行时上的 Drizzle-aligned 入口，适合迁移或保留 builder/query 代码形状
- 重要的不是“入口名”，而是下面这些语义：`base`、`subjectTemplate`、`IRI`、exact-target mutation

## Public Surface

当前公开表面可以分成两层：

### Semantic-first surface

- `pod(session, config?)`
- `client.bind(schema, options)`
- `client.collection(table)`
- `client.entity(table, iri)`
- `client.sparql(query)`

### Drizzle-aligned surface

- `drizzle(session, config?)`
- `podTable(name, columns, config)`
- `solidSchema(...)`
- `select / insert / update / delete`
- `db.query.*` read facade

## Install

```bash
yarn add @undefineds.co/drizzle-solid drizzle-orm
# optional, when your app wants the default SPARQL client engine
yarn add @comunica/query-sparql-solid
```

```bash
npm install @undefineds.co/drizzle-solid drizzle-orm
npm install @comunica/query-sparql-solid
```

`@comunica/query-sparql-solid` is an optional peer dependency.

Install it in the consuming app when you need built-in SPARQL query execution or direct SPARQL workflows.

Without a SPARQL endpoint or index, plain-LDP document mode is limited to exact-target access (`findByLocator` / `findByIri` and the matching update/delete APIs). Collection queries are not implicitly expanded into scans.

Current public compatibility stance:

- officially supported: `@comunica/query-sparql-solid` `4.x`
- not currently in the supported matrix: `3.x`

If another in-process runtime already carries Comunica (for example `xpod`), inject that engine instead of forcing a second copy. See `docs/api/README.md` and `docs/guides/installation.md`.

## Quick start

仓库里的主线 quick start 默认使用 `pod(session)`，因为它会把 `collection()` / `entity()` / `bind()` 语义直接写在代码里。

如果你已有大量 Drizzle 风格代码，`drizzle(session)` 仍然是正式可用入口。

```ts
import {
  pod,
  podTable,
  string,
  datetime,
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

const client = pod(session);
await client.init(posts);

const postsCollection = client.collection(posts);

const created = await postsCollection.create({
  id: 'post-1',
  title: 'Hello Solid',
  content: 'Stored as RDF in a Pod document.',
  createdAt: new Date(),
});

const first = await postsCollection.first({
  where: { id: 'post-1' },
});

const postIri = created?.['@id'] ?? postsCollection.iriFor({
  id: 'post-1',
  title: 'Hello Solid',
  content: 'Stored as RDF in a Pod document.',
  createdAt: new Date(),
});

const post = client.entity(posts, postIri);
await post.update({ title: 'Updated title' });
await post.delete();
```

> 如果你保持 `drizzle(session)` 作为入口，语义并不会变：`base`、`subjectTemplate`、`IRI`、精确写目标这些约束仍然完全成立。

## Reusable schema + runtime binding

Use `solidSchema(...)` when you want to separate the reusable data shape from where that data lives in a Pod.

如果你使用 `pod()` façade：

```ts
const client = pod(session);
const profileTable = client.bind(profileSchema, {
  base: 'https://alice.example/profile/card',
});
```

如果你保持 `drizzle()` 入口：

```ts
const db = drizzle(session);
const profileTable = db.createTable(profileSchema, {
  base: 'https://alice.example/profile/card',
});
```

## Identity and placement

`subjectTemplate` defines how application identity maps onto Pod resources.

Common patterns:

- `#{id}`: many entities inside one document
- `{id}.ttl`: one document per entity
- `{id}.ttl#it`: one document per entity with stable in-document fragment
- `{chatId}/messages.ttl#{id}`: multi-variable layouts and partitioned resources

If a layout uses multiple template variables, exact lookup is only exact when all required locator variables are present, or when you already hold the full IRI.

这不是命名细节，而是持久化语义本身。

## Type hierarchy

Class hierarchy and instance typing are not the same thing.

- `type` is the primary persisted `rdf:type` for an entity
- `subClassOf` expresses schema / vocabulary hierarchy
- by default, persisted instance data should keep one most-specific, authoritative `rdf:type`
- do not persist both a base/table type and a business subtype on the same entity unless they carry genuinely different semantics
- do not introduce parallel string-based type systems when the meaning is already carried by RDF class membership
- if parent types must be materialized for no-inference environments, treat that as an explicit compatibility mode rather than the default stored shape

## Exact-target mutation semantics

Reads and writes do not intentionally behave the same way.

- list / filter reads can stay collection-oriented
- writes should prefer exact-target semantics
- if an API path semantically requires exact-target resolution, it should remain exact or fail explicitly; do not silently widen it into scan-style execution
- incomplete `where(...)` information should not silently degrade into scan + mutate
- if a subject can only be resolved by multiple template variables, mutation should use an explicit IRI or provide all required variables
- join on a multi-variable target should also provide all required locator variables, or join via full IRI values
- do not silently degrade unresolved multi-variable joins into scan-style fallback

所以最重要的变化不是“要不要换成 `pod()`”，而是：

- 什么时候你只是在做集合读取
- 什么时候你已经需要一个确定的实体目标

## Server support

### Capability matrix

| Capability | Community Solid Server | xpod |
| --- | --- | --- |
| Basic CRUD | ✅ | ✅ |
| Document notifications | ✅ | ✅ |
| Drizzle-style read facade | ✅ | ✅ |
| SPARQL pushdown | ⚠️ Limited / often client-assisted | ✅ Better in-process support |
| Filter / aggregation pushdown | ❌ Mostly fallback execution | ✅ Better server-side support |
| Federated queries | ⚠️ Client-side federation | ⚠️ Client-side federation |
| In-process local runtime | ⚠️ External setup | ✅ via `@undefineds.co/xpod` |

If `xpod` already ships its own Comunica stack, `drizzle-solid` can reuse that copy instead of requiring another app-level install.

## Verified examples

The canonical examples in `examples/` are part of the real integration verification flow:

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

See `examples/manifest.json` and `tests/integration/css/examples-verification.test.ts`.

## Migration

If you already know `drizzle-orm`, start here:

- `docs/guides/migrating-from-drizzle-orm.md`

那份指南重点解释的是：

- `table/row` → `resource/document/entity/IRI`
- `link` / relation fields → RDF link / IRI link
- `where`-style mutation → exact-target mutation
- `toSQL()` / raw SQL 主心智 → `toSPARQL()` / SPARQL 主心智

而不是要求你第一步先改掉构造函数名。

## Documentation map

- `docs/api/README.md` — current public API and constructor positioning
- `docs/guides/installation.md` — installation and SPARQL engine setup
- `docs/guides/migrating-from-drizzle-orm.md` — migration guide for Drizzle users
- `docs/guides/testing.md` — canonical testing policy, verification layers, and execution-path guardrails
- `docs/guides/context7-and-skills.md` — Context7 publication scope, skills plan, and feedback flow
- `docs/guides/issue-triage.md` — classify code, docs, tooling, and decision issues
- `docs/guides/modeling-consensus.md` — when modeling questions require multi-AI consensus instead of a single answer
- `docs/guides/decisions/README.md` — decision records and the template for stable repo-wide conclusions
- `skills/README.md` — canonical public skill pack source for future Context7 Skills publishing
- `examples/README.md` — curated runnable examples
- `docs/guides/data-discovery.md` — discovery workflows
- `docs/guides/notifications.md` — notification flows
- `docs/xpod-features.md` — xpod runtime notes
- `ACTION-PLAN.md` — testing/parity backlog and execution log, not the testing policy

## Contributing

Before pushing:

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
