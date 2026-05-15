# API Reference

Chinese version: [`README.zh-CN.md`](README.zh-CN.md)

This document answers three user-facing questions:

- when should you use `pod()` vs `drizzle()`?
- which API fits each common task?
- which boundaries are hard constraints in the current version?

## Choose an entrypoint

### `pod(session, config?)`

Best for new code or when you want Solid concepts to be explicit:

- `collection(table)`
- `entity(resource, iri)`
- `bind(schema, options)`
- `sparql(query)`

### `drizzle(session, config?)`

Best when migrating from `drizzle-orm` or keeping builder-shaped code:

- `select / insert / update / delete`
- `db.query.<resource>`
- `findById / findByIri`
- `updateById / updateByIri`
- `deleteById / deleteByIri`

### `solid({ webId, fetch })`

A lightweight inline session helper when you already have an authenticated `fetch`.

## Common tasks

| Task | Recommended API |
| --- | --- |
| start new business code | `pod(session)` |
| keep Drizzle-style shape | `drizzle(session)` |
| define a model with placement | `podTable(name, columns, config)` |
| define a reusable schema | `solidSchema(...)` |
| bind a schema to a location at runtime | `client.bind(...)` / `db.createTable(...)` |
| list or filtered reads | `collection(table).list(...)` / `db.select()` / `db.query.<resource>.findMany()` |
| read one exact resource | `client.entity(resource, iri)` / `db.query.<resource>.findById(...)` / `db.findById(...)` / `db.findByIri(...)` |
| update one exact resource | `entity.update(...)` / `db.updateById(...)` / `db.updateByIri(...)` |
| delete one exact resource | `entity.delete()` / `db.deleteById(...)` / `db.deleteByIri(...)` |
| execute SPARQL directly | `client.sparql(...)` / `db.executeSPARQL(...)` |

## Modeling APIs

### `podTable(name, columns, config)`

The main modeling entrypoint.

Key config fields:

- `base`
- `subjectTemplate`
- `type`
- `namespace`
- `sparqlEndpoint`

### `solidSchema(...)`

Use this when shape and placement should stay separate until runtime.

### Link fields

Relationship fields should be modeled as RDF links / IRIs.

Preferred form:

- `uri(...).link(target)`

## `pod()` style APIs

### `client.collection(table)`

Collection-oriented surface.

Common methods:

- `list(options?)`
- `first(options?)`
- `create(record)`
- `createMany(records)`
- `subscribe(options)`
- `iriFor(record)`
- `entity(iri)` / `byIri(iri)`
- `select(fields?)`

### `client.entity(resource, iri)`

Exact-entity surface.

Common methods:

- `get()` / `read()`
- `update(data)`
- `delete()`
- `subscribe(options)`
- `documentUrl`
- `fragment`

### Other `client` capabilities

- `bind(schema, options)`
- `asDrizzle()`
- `query`
- `sparql(query)`
- `batch(operations)`
- `locationToTable(location, options?)`
- `discoverTablesFor(rdfClass, options?, tableOptions?)`
- `discovery`
- `getLastFederatedErrors()`

## `drizzle()` style APIs

### Query builders

- `db.select()`
- `db.insert()`
- `db.update()`
- `db.delete()`

### Read facade

- `db.query.<resource>.findMany(...)`
- `db.query.<resource>.findFirst(...)`
- `db.query.<resource>.find(...)`
- `db.query.<resource>.findById(...)`
- `db.query.<resource>.findByLocator(...)` (deprecated)
- `db.query.<resource>.findByIri(...)`
- `db.query.<resource>.findByResource(...)`
- `db.query.<resource>.count(...)`

### Exact-target helpers

- `db.findById(resource, id)`
- `db.findByIri(resource, iri)`
- `db.findByResource(resource, target)`
- `db.findByLocator(resource, locator)` (deprecated)
- `db.updateById(resource, id, data)`
- `db.updateByIri(resource, iri, data)`
- `db.updateByResource(resource, target, data)`
- `db.updateByLocator(resource, locator, data)` (deprecated)
- `db.deleteById(resource, id)`
- `db.deleteByIri(resource, iri)`
- `db.deleteByResource(resource, target)`
- `db.deleteByLocator(resource, locator)` (deprecated)

`*ByResource` accepts a full IRI, a row with `@id`, a base-relative id, or a
legacy locator object. Prefer `*ById` when the caller already has the
base-relative id.

## SPARQL APIs

### `client.sparql(query)` / `db.executeSPARQL(query)`

This is the graph-query escape hatch. It accepts SPARQL, not SQL.

### Builder output

Supported:

- `toSPARQL()`
- `toSparql()`

Not provided:

- `toSQL()`

## Hard semantic boundaries

### 1. collection reads and exact-target operations are different

Collection reads:

- `collection().list(...)`
- `db.select().from(...).where(...)`
- `db.query.<resource>.findMany(...)`

Exact-target operations:

- `entity(resource, iri)`
- `findById` / `findByIri`
- `updateById` / `updateByIri`
- `deleteById` / `deleteByIri`
- `findByResource` / `updateByResource` / `deleteByResource` for mixed exact targets
- `findByLocator` / `updateByLocator` / `deleteByLocator` (deprecated compatibility)

### 2. public `where()` is not an exact-target shortcut

Do not treat these as exact single-entity APIs:

- `where({ id: ... })`
- `where({ '@id': ... })`
- `where(eq(table.id, ...))`

Use exact-target helpers instead.

### 3. multi-variable templates require a base-relative id for `*ById`

For example:

```ts
subjectTemplate: '{chatId}/messages.ttl#{id}'
```

You need either:

- a full IRI, or
- the base-relative resource id, for example `chat-1/messages.ttl#msg-1`

Legacy locator helpers still accept a complete locator such as `{ chatId, id }`,
but they are deprecated.

### 4. plain LDP document mode has explicit limits

Without SPARQL endpoint / sidecar / index:

- exact-target read/write still works
- collection queries are not guaranteed
- the library does not silently widen into global scans

## Not part of the stable contract

- raw SQL / `sql`` fragments`
- `toSQL()`
- implicit scan-based `updateMany/deleteMany`
- full relational database semantics for foreign keys, DDL, auto-increment, or transactions

## Related reading

- `README.md`
- `docs/guides/installation.md`
- `docs/guides/migrating-from-drizzle-orm.md`
- `docs/guides/multi-variable-templates.md`
