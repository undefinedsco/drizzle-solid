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
- `entity(table, iri)`
- `bind(schema, options)`
- `sparql(query)`

### `drizzle(session, config?)`

Best when migrating from `drizzle-orm` or keeping builder-shaped code:

- `select / insert / update / delete`
- `db.query.<table>`
- `findByLocator / findByIri`
- `updateByLocator / updateByIri`
- `deleteByLocator / deleteByIri`

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
| list or filtered reads | `collection(table).list(...)` / `db.select()` / `db.query.<table>.findMany()` |
| read one exact entity | `client.entity(table, iri)` / `db.findByIri(...)` / `db.findByLocator(...)` |
| update one exact entity | `entity.update(...)` / `db.updateByIri(...)` / `db.updateByLocator(...)` |
| delete one exact entity | `entity.delete()` / `db.deleteByIri(...)` / `db.deleteByLocator(...)` |
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

### `client.entity(table, iri)`

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

- `db.query.<table>.findMany(...)`
- `db.query.<table>.findFirst(...)`
- `db.query.<table>.findByLocator(...)`
- `db.query.<table>.findByIri(...)`
- `db.query.<table>.count(...)`

### Exact-target helpers

- `db.findByLocator(table, locator)`
- `db.findByIri(table, iri)`
- `db.updateByLocator(table, locator, data)`
- `db.updateByIri(table, iri, data)`
- `db.deleteByLocator(table, locator)`
- `db.deleteByIri(table, iri)`

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
- `db.query.<table>.findMany(...)`

Exact-target operations:

- `entity(table, iri)`
- `findByIri`
- `findByLocator`
- `updateByIri` / `updateByLocator`
- `deleteByIri` / `deleteByLocator`

### 2. public `where()` is not an exact-target shortcut

Do not treat these as exact single-entity APIs:

- `where({ id: ... })`
- `where({ '@id': ... })`
- `where(eq(table.id, ...))`

Use exact-target helpers instead.

### 3. multi-variable templates require complete locator information

For example:

```ts
subjectTemplate: '{chatId}/messages.ttl#{id}'
```

You need either:

- a full IRI, or
- a complete locator such as `{ chatId, id }`

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
