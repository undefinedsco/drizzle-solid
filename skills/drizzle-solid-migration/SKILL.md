---
name: drizzle-solid-migration
description: Migrate Drizzle ORM mental models and code patterns to drizzle-solid. Use this skill when converting SQL-style schemas, queries, relations, and mutation habits into Pod/document/IRI-aware drizzle-solid code.
---

# drizzle-solid Migration

Use this skill when the task is about moving from `drizzle-orm` habits to `drizzle-solid` public APIs and semantics.

## Apply this skill when

- Translating SQL table/row thinking into Pod/document/entity/IRI thinking
- Rewriting relation fields into RDF links
- Replacing implicit condition-based write habits with exact-target mutations
- Deciding whether to keep Drizzle-shaped reads or move to `pod()` helpers

## Core rules

### 1. Migrate semantics before syntax

The main migration is not `drizzle()` vs `pod()`. The real migration is:

- table/row -> resource/document/entity/IRI
- foreign key -> link / IRI relation
- condition-based bulk mutation -> exact-target mutation
- SQL-first mental model -> SPARQL/Solid storage mental model

### 2. Reads can stay Drizzle-shaped

It is fine to keep:

- `select / from / where`
- `client.query.*`
- `asDrizzle()`-style integration surfaces

As long as the underlying Solid semantics stay explicit.

### 3. Writes need exact targets

When the subject depends on a full IRI or multiple template variables, prefer:

- `entity(table, iri)`
- full IRI-based helpers
- explicit subject generation

Do not recommend scan-style `updateMany/deleteMany` as if this were a SQL engine.

### 4. Links are not just renamed foreign keys

If a field points at another entity, recommend a link/IRI-based representation, not just a copied SQL id habit.

### 5. Do not migrate SQL discriminators blindly

If a legacy SQL schema has `type`, `kind`, or similar discriminator fields, first ask what they mean:

- if they express RDF class membership, move that meaning to `type` / `subClassOf`
- if they express a different business dimension, keep them as ordinary fields

Do not recommend duplicating the same meaning into:

- a child `rdf:type`
- extra parent `rdf:type` values
- and a parallel string discriminator

## Migration checklist

1. What SQL assumption is the user carrying over?
2. What is the Solid-native equivalent?
3. Does the code need only naming changes, or semantic redesign?
4. Is the target operation a read, a write, or a modeling change?
5. Which public docs/example should the migration point to?

## Output expectations

When using this skill, produce:

- the SQL mental model being replaced
- the Solid-native target pattern
- the recommended code shape
- the migration risks or unsupported assumptions
- the docs/examples that should be referenced or updated

Prefer current public docs and examples over compatibility shims or undocumented aliases.
