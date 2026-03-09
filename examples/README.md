# Drizzle Solid Examples

This folder hosts the canonical end-to-end walkthroughs referenced in the docs. Each public example should map to a runnable verification path recorded in `examples/manifest.json`, so explanatory docs and executable samples stay connected.

> 这些 examples 会在“保留 `drizzle()` 也完全可行”的前提下，按场景选择更清楚的代码组织方式。部分示例使用 `pod()`，只是为了把 collection/entity/bind 语义写得更显式，不代表你必须迁移构造入口。

## Example lineup
- `01-quick-start.ts`: Quick start demo with explicit `collection()` + `entity()` semantics.
- `02-relational-query.ts`: Demonstrates relational queries with `client.query` read facade.
- `03-zero-config-discovery.ts`: Zero-config access using SAI auto-discovery (Bob reads Alice's shared data without knowing URLs).
- `04-notifications.ts`: Real-time notifications using `collection.subscribe()` and exact-IRI entity mutations.
- `05-data-discovery.ts`: Comprehensive data discovery API examples:
  - Basic discovery with `client.discovery.discover()`
  - Filtering by appId
  - Listing all registrations with `client.discovery.discoverAll()`
  - Shape selection in `client.locationToTable()`
  - One-step discover and create tables with `client.discoverTablesFor()`
  - Cross-Pod discovery
  - Multi-Shape scenario explanation
- `06-federated-query.ts`: Federated queries across multiple Pods with `client.query` and `FederatedQueryExecutor`.
- `07-hooks-and-profile.ts`: Runtime binding + hooks + ProfileManager workflow.
- `08-iri-based-operations.ts`: Explicit IRI-based entity operations.
- `08-schema-inheritance.ts`: `solidSchema.extend()` + runtime binding workflow.
- `09-multi-variable-templates.ts`: Multi-variable `subjectTemplate` with collection reads and exact IRI lookup.

### Utility files
- `setup.ts`: Common setup utilities (used by tests).
- `utils/sai-helpers.ts`: SAI environment setup helpers (used by tests).

## Verification policy

- Canonical example registry: `examples/manifest.json`
- Structural check: `yarn examples:check`
- Strict coverage gate: `yarn examples:check:strict`
- Current real-example integration proof: `tests/integration/css/examples-verification.test.ts`

`examples/manifest.json` is the source of truth for mapping each explanatory example to:
- its runnable entrypoint or exported runner
- the docs that reference it
- the verification path that proves it still works

## Key Concepts

### IRI-based Operations
For single-entity operations (detail pages, shared resources, remote links), use an explicit IRI target:

```typescript
const profile = client.entity(profileTable, 'https://alice.pod/profile/card#me');
await profile.get();
await profile.update({ name: 'New Name' });
await profile.delete();
```

### Collection-based Reads
列表读取、筛选和集合订阅优先通过明确的集合语义表达：

```typescript
const posts = client.collection(postsTable);
const latest = await posts.list({ limit: 20 });
const first = await posts.first({ where: { id: 'post-1' } });
```

### Data Discovery
Data discovery allows apps to find data locations dynamically instead of hardcoding paths.

```typescript
const locations = await client.discovery.discover('https://schema.org/Person');
```

### Shape Selection
When a container has multiple Shapes (from different apps), you can choose which one to use:

```typescript
const table = await client.locationToTable(location);
const byApp = await client.locationToTable(location, { appId: 'https://acme.com/app#id' });
const byShape = await client.locationToTable(location, { shape: 'https://shapes.example/Person.shacl' });
```

## Running
```bash
yarn example:setup               # launches CSS and seeds pods
yarn example:quick               # runs 01-quick-start.ts
yarn example:query               # runs 02-relational-query.ts
yarn example:discovery           # runs 05-data-discovery.ts
yarn example:data-discovery      # alias for 05-data-discovery.ts
yarn example:notifications       # runs 04-notifications.ts
yarn example:federated           # runs 06-federated-query.ts
yarn example:hooks               # runs 07-hooks-and-profile.ts
yarn example:iri                 # runs 08-iri-based-operations.ts
yarn example:schema-inheritance  # runs 08-schema-inheritance.ts
yarn example:templates           # runs 09-multi-variable-templates.ts
```

`03-zero-config-discovery.ts` is verified as an embedded integration scenario rather than a standalone CLI script; see `examples/manifest.json` and `tests/integration/css/examples-verification.test.ts`.

Make sure `yarn server:start` (Community Solid Server) is running in another terminal before invoking the examples.
