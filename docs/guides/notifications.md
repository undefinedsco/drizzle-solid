# 通知与订阅

推荐心智：

- **集合变化**：`client.collection(table).subscribe()`
- **单体变化**：`client.entity(table, iri).subscribe()`

不要再把通知入口默认理解成 `db.subscribe()`；那个接口仍然存在，但不再是仓库文档的主线写法。

## 集合订阅

```ts
import { pod, podTable, string, datetime } from '@undefineds.co/drizzle-solid';

const posts = podTable('posts', {
  id: string('id').primaryKey(),
  title: string('title').predicate('http://schema.org/headline'),
  content: string('content').predicate('http://schema.org/text'),
  createdAt: datetime('createdAt').predicate('http://schema.org/dateCreated'),
}, {
  base: `${podBase}data/posts.ttl`,
  type: 'http://schema.org/CreativeWork',
});

const client = pod(session);
await client.init(posts);

const postsCollection = client.collection(posts);
const subscription = await postsCollection.subscribe({
  onCreate: async () => {
    console.log(await postsCollection.list());
  },
  onUpdate: async () => {
    console.log(await postsCollection.list());
  },
  onDelete: async () => {
    console.log(await postsCollection.list());
  },
});

subscription.unsubscribe();
```

## 单体订阅

```ts
const post = client.entity(posts, 'https://alice.example/data/posts/post-1.ttl');

const unsubscribe = await post.subscribe({
  onUpdate: (data) => {
    console.log('updated', data);
  },
  onDelete: () => {
    console.log('deleted');
  },
});

unsubscribe();
```

## 通道类型

支持：

- `streaming-http`
- `websocket`

```ts
const subscription = await postsCollection.subscribe({
  channel: 'websocket',
  onUpdate: () => {},
});

console.log(subscription.channel);
```

## 订阅特性

```ts
await postsCollection.subscribe({
  features: ['state'],
  onUpdate: (activity) => {
    console.log(activity.state);
  },
});
```

常见特性：

- `state`
- `endAt`
- `rate`

## Drizzle-shaped 等价入口

如果你仍在迁移旧代码，可以通过：

- `client.asDrizzle().subscribe(table, options)`
- `client.asDrizzle().subscribeByIri(table, iri, options)`

但新的文档、example 和主线业务代码应优先使用 `collection()` / `entity()` 入口。
