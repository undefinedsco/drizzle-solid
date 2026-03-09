# CSS Notifications

这篇文档聚焦 Community Solid Server / Solid 兼容服务上的通知使用方式。

主线推荐：

- 集合级订阅：`client.collection(table).subscribe()`
- 单体级订阅：`client.entity(table, iri).subscribe()`

## 最小示例

```ts
import { pod, podTable, string } from '@undefineds.co/drizzle-solid';

const users = podTable('users', {
  id: string('id').primaryKey(),
  name: string('name').predicate('http://xmlns.com/foaf/0.1/name'),
}, {
  base: '/data/users.ttl',
  type: 'http://xmlns.com/foaf/0.1/Person',
});

const client = pod(session);
await client.init(users);

const usersCollection = client.collection(users);
await usersCollection.subscribe({
  features: ['state'],
  onNotification: (event) => {
    console.log(event.type, event.object);
  },
});
```

## CSS 侧的现实边界

- 通知能力依赖服务器实现与部署配置
- 不同服务对 `websocket` / `streaming-http` 的支持度不同
- 通知适合做“变更信号”，不要把它当成事务级保证机制

## 建议实践

- 收到通知后重新走一次 `collection.list()` 或 `entity.get()`，而不是只信任回调里的最小事件负载
- 对列表页用集合订阅；对详情页用单体订阅
- 把 UI 更新逻辑放在应用层，不要把通知等同于本地 hooks

## 与 hooks 的区别

- `subscribe()`：服务端资源变化通知
- `hooks.afterInsert/afterUpdate/afterDelete`：本地写操作生命周期钩子

二者可以一起用，但语义不同。

## Drizzle-shaped 等价入口

旧文档里如果看到 `db.subscribe(...)`，可以理解为今天仍保留的 Drizzle-shaped 写法；主线代码优先写成：

- `client.collection(table).subscribe(...)`
- `client.entity(table, iri).subscribe(...)`
