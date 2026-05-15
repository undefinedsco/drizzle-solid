# Migrating from `drizzle-orm` to `drizzle-solid`

Chinese version: [`migrating-from-drizzle-orm.zh-CN.md`](migrating-from-drizzle-orm.zh-CN.md)

This guide is for developers who already know `drizzle-orm`.

The goal is not to force a new coding style first. The goal is to move your SQL mental model into a Solid Pod data model safely.

## Start with the real migration work

You do not need to change:

```ts
const db = drizzle(session);
```

on day one.

Migrate these things first:

- where data lives
- how primary keys become IRIs
- how relation fields become links / IRIs
- which queries are collection reads and which writes must be exact-target operations
- where raw SQL thinking should become SPARQL

## The four biggest changes

1. tables/rows are no longer the primary mental model; documents/entities/IRIs are
2. relation fields are not just foreign keys; they behave more like RDF links
3. writes should point at one exact target explicitly
4. persisted instances should usually keep one most-specific `rdf:type`

## Recommended migration order

1. keep `drizzle(session)` first
2. add `base` and `subjectTemplate` to each model
3. move foreign-key thinking toward IRI / link thinking
4. separate list reads from exact writes
5. evaluate raw SQL usage and replace it with SPARQL or another path
6. only then decide whether new code should adopt `pod(session)`

## Step 1: define where data lives

In SQL you mainly define structure.

In Solid you also define:

- which document or container receives the data
- how one record maps to an IRI

```ts
const posts = podTable('posts', {
  id: string('id').primaryKey(),
  title: string('title').predicate('http://schema.org/headline'),
  content: string('content').predicate('http://schema.org/text'),
}, {
  base: 'https://alice.example/data/posts/',
  subjectTemplate: '{id}.ttl',
  type: 'http://schema.org/CreativeWork',
});
```

The two new pieces are:

- `base`
- `subjectTemplate`

## Step 2: treat IRI as the final identity

In `drizzle-orm`, `id` often feels like the final identity.

In `drizzle-solid`, a better rule is:

- public `id` means the base-relative resource id for exact operations
- `@id` is the full subject IRI

```ts
const row = await db.findById(posts, 'post-1.ttl');
const iri = row?.['@id'];
```

Once you have the full IRI, prefer to use it directly:

```ts
const row = await db.findByIri(posts, iri);
await db.updateByIri(posts, iri, { title: 'Updated' });
await db.deleteByIri(posts, iri);
```

## Step 3: treat relation fields as links

The usual migration mistake is to keep thinking of relation fields as database foreign-key columns.

A better rule is:

- they represent RDF links
- ideally they should point to stable IRIs

Preferred new code:

```ts
uri('author').link(users)
```

## Step 4: separate list reads from exact writes

### List reads

These still express “get a set of rows”:

```ts
await db.select().from(posts).where({ title: 'Hello Solid' });
await db.query.posts.findMany({ where: { title: 'Hello Solid' } });
await client.collection(posts).list({ where: { title: 'Hello Solid' } });
```

### Exact reads / updates / deletes

When you mean one concrete entity, switch to exact-target APIs:

```ts
await db.findById(posts, 'post-1.ttl');
await db.findByIri(posts, iri);

await db.updateById(posts, 'post-1.ttl', {
  title: 'Updated title',
});

await db.deleteById(posts, 'post-1.ttl');
await db.deleteByIri(posts, iri);
```

Or use the semantic façade:

```ts
const post = client.entity(posts, iri);
await post.get();
await post.update({ title: 'Updated title' });
await post.delete();
```

Do not keep relying on:

- `where({ id: ... })`
- `where({ '@id': ... })`
- `where(eq(table.id, ...))`

Those are no longer exact-target shortcuts.

## Step 5: pass the base-relative id for multi-variable templates

If your layout looks like this:

```ts
subjectTemplate: '{chatId}/messages.ttl#{id}'
```

then `id` alone is not enough.

You need:

- a full IRI, or
- a base-relative resource id such as `chat-1/messages.ttl#msg-123`

## Step 6: joins are not automatically SQL primary-key joins

This may look natural in SQL:

```ts
eq(Post.messageId, Message.id)
```

But if `Message` uses a multi-variable template, that is incomplete.

You need to complete the right-side locator:

```ts
leftJoin(Message, and(
  eq(Post.messageId, Message.id),
  eq(Post.chatId, Message.chatId),
))
```

Or store the full IRI directly.

## Step 7: move raw SQL thinking to SPARQL

If your old code depends heavily on:

- raw SQL
- `sql`` fragments`
- `toSQL()`

then the practical replacement is:

- `db.executeSPARQL(query)`
- `client.sparql(query)`
- `toSPARQL()` / `toSparql()`

## When to introduce `pod()`

After the data model and write paths are migrated, decide whether new code should use `pod(session)`.

`pod()` is useful when you want the semantics to stay obvious:

- `collection(table)` for collection reads
- `entity(table, iri)` for exact entities
- `bind(schema, options)` for runtime placement

If migration cost matters more, staying on `drizzle()` is fine.

## Quick mapping table

| `drizzle-orm` thinking | `drizzle-solid` thinking |
| --- | --- |
| table | one entity layout in a Pod |
| row primary key | `@id` / subject IRI |
| table location | `base` + `subjectTemplate` |
| foreign key | RDF link / IRI link |
| update one row by `where(id=...)` | `updateById` / `updateByIri` |
| raw SQL | raw SPARQL |
| `toSQL()` | `toSPARQL()` / `toSparql()` |

## Migration checklist

- [ ] every model has `base`
- [ ] every model has `subjectTemplate`
- [ ] the team knows which fields are links / IRIs
- [ ] writes moved to exact-target APIs
- [ ] multi-variable templates use base-relative ids for exact operations
- [ ] raw SQL dependencies were evaluated
- [ ] examples and real Pod flows were verified
