# Core Concepts

Chinese version: [`concepts.zh-CN.md`](concepts.zh-CN.md)

This guide keeps only the minimum mental model you need to use `drizzle-solid` correctly.

If you already know `drizzle-orm`, the biggest change is not syntax. It is identity and placement.

## Remember these four objects

### Pod

A Pod is a data space.

It is closer to “a user-owned set of accessible resources” than to a database instance.

### Document

A document is the real persistence unit.

Usually that means a Turtle or JSON-LD resource.

### Entity

An entity is one RDF subject — the business object you actually read and write.

### IRI

An IRI is the final identity of the entity.

In many cases, `id` is only one variable used to build that IRI.

## Why `base` and `subjectTemplate` matter

In `drizzle-solid`, a model describes both fields and placement.

```ts
const posts = podTable('posts', {
  id: string('id').primaryKey(),
  title: string('title').predicate('http://schema.org/headline'),
}, {
  base: 'https://alice.example/data/posts/',
  subjectTemplate: '{id}.ttl',
  type: 'http://schema.org/CreativeWork',
});
```

Here:

- `base` defines the document or container location
- `subjectTemplate` defines how business fields map to an IRI

## Three common layouts

### Many entities in one document

```ts
subjectTemplate: '#{id}'
```

### One document per entity

```ts
subjectTemplate: '{id}.ttl'
```

### Partitioned by a business dimension

```ts
subjectTemplate: '{chatId}/messages.ttl#{id}'
```

## Collection reads vs exact-entity operations

This is the most important runtime distinction.

### Collection reads

Use these when you want a set of rows:

- `collection(table).list(...)`
- `db.select().from(...)`
- `db.query.<resource>.findMany(...)`

### Exact entity operations

Use these when you already know the concrete target:

- `entity(resource, iri)`
- `findById` / `findByIri`
- `updateById` / `updateByIri`
- `deleteById` / `deleteByIri`
- `findByResource` / `updateByResource` / `deleteByResource` for mixed exact targets

`findByLocator` / `updateByLocator` / `deleteByLocator` are deprecated
compatibility helpers.

## Why relationship fields should be modeled as links

In SQL, relation fields usually start as foreign keys.

In `drizzle-solid`, a better rule is:

- they are RDF links
- they should ideally point to stable IRIs

Preferred new code:

```ts
uri('author').link(users)
```

## Type hierarchy

When you model class hierarchy:

- `type` is the main persisted `rdf:type`
- `subClassOf` is the vocabulary / schema hierarchy

In normal cases, persist one most-specific main type per entity.

## When to use `pod()` vs `drizzle()`

### Use `pod()`

- for new code
- when you want `collection()` / `entity()` semantics to stay obvious

### Use `drizzle()`

- when migrating existing `drizzle-orm` code
- when you want to keep builder / `db.query` shape

Both share the same runtime.

## The one-line version

> In `drizzle-solid`, a model describes fields, entity IRI, and placement in the Pod.
