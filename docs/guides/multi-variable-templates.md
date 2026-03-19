# Multi-variable `subjectTemplate`

Chinese version: [`multi-variable-templates.zh-CN.md`](multi-variable-templates.zh-CN.md)

This guide answers one practical question:

> what should you do when one entity cannot be located by `id` alone, and also needs `chatId`, `userId`, a date, or another partition key?

## What a multi-variable template means

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

Here:

- `chatId` decides the partition
- `id` decides the fragment inside that partition

So the full identity is not just `id`. It is either:

- `chatId + id`
- or the full IRI

## When to use a multi-variable template

Good fit:

- messages partitioned by chat room
- data partitioned by user
- logs partitioned by date

Not a good fit:

- you do not need partitioning at all
- you want every entity to be globally reachable from one business key

## Three common operations

### 1. List reads

When you want everything in one partition, do a collection read:

```ts
const messages = client.collection(Message);

const chat1Messages = await messages.list({
  where: eq(Message.chatId, 'chat-1'),
});
```

### 2. Exact read

If you know every template variable:

```ts
const row = await db.findByLocator(Message, {
  chatId: 'chat-1',
  id: 'msg-123',
});
```

If you already have the full IRI:

```ts
const fullIri = 'https://alice.example/data/chats/chat-1/messages.ttl#msg-123';
const entity = client.entity(Message, fullIri);
const row = await entity.get();
```

### 3. Exact update / delete

```ts
await db.updateByLocator(Message, {
  chatId: 'chat-1',
  id: 'msg-123',
}, {
  content: 'Updated',
});

await db.deleteByLocator(Message, {
  chatId: 'chat-1',
  id: 'msg-123',
});
```

Or use the full IRI:

```ts
const entity = client.entity(Message, fullIri);
await entity.update({ content: 'Updated' });
await entity.delete();
```

## Why `id` alone is not enough

If the template is:

```ts
subjectTemplate: '{chatId}/messages.ttl#{id}'
```

then this:

```ts
{ id: 'msg-123' }
```

does not tell the library whether it should look in:

- `chat-1/messages.ttl`
- `chat-2/messages.ttl`
- or somewhere else

That is an incomplete target, not an optimizer problem.

## The rule to follow

### For exact single-entity reads

Use:

- a full IRI, or
- a complete locator

### For exact single-entity writes

Use:

- a full IRI, or
- a complete locator

### For list reads

You may use only part of the variables, but then you are explicitly doing a collection read.

## What to do in joins

If the right side of the join uses a multi-variable template, the join condition must complete the right-side locator.

Correct:

```ts
await db.select({
  postTitle: Post.title,
  messageBody: Message.content,
})
  .from(Post)
  .leftJoin(Message, and(
    eq(Post.messageId, Message.id),
    eq(Post.chatId, Message.chatId),
  ));
```

Incomplete:

```ts
eq(Post.messageId, Message.id)
```

because it only provides the local `id`, not the full locator.

## Best practices

### Prefer storing the full IRI

If a relation field really points to one entity, storing the full IRI usually makes later reads and navigation simpler.

### Make locator variables business-meaningful

Examples:

- `chatId`
- `userId`
- `date`

Do not invent partition keys that have no business meaning.

### Avoid partitions that are too coarse or too fine

Too coarse:

- large documents
- high read/update cost

Too fine:

- too many tiny files
- higher operational overhead

## Practical migration rule from SQL

Treat multi-variable templates as:

- “part of the business data also participates in physical placement”

Do not keep assuming:

- “if I have a local id, the library should just scan globally and find it”
