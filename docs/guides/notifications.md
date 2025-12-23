# Solid Notifications

drizzle-solid 支持 [Solid Notifications Protocol](https://solid.github.io/notifications/protocol)，允许你订阅表的变化并实时接收通知。

## 基本用法

```typescript
import { drizzle } from 'drizzle-solid';
import { podTable, string } from 'drizzle-solid';

const posts = podTable('posts', {
  id: string('id').primaryKey(),
  title: string('title').predicate('http://schema.org/headline'),
}, {
  base: `${podBase}data/posts.ttl`,
  type: 'http://schema.org/CreativeWork'
});

const db = drizzle(session);

// 订阅表变化
const subscription = await db.subscribe(posts, {
  onCreate: async (activity) => {
    console.log('Created:', activity.object);
    // 重新查询获取最新数据
    const latest = await db.select().from(posts);
  },
  onUpdate: async (activity) => {
    console.log('Updated:', activity.object);
    const latest = await db.select().from(posts);
  },
  onDelete: (activity) => {
    console.log('Deleted:', activity.object);
  },
  onError: (error) => {
    console.error('Subscription error:', error);
  }
});

// 取消订阅
subscription.unsubscribe();
```

## Activity 对象

通知遵循 [Activity Streams 2.0](https://www.w3.org/TR/activitystreams-core/) 规范：

```typescript
interface Activity {
  id: string;           // Activity 唯一 ID
  type: NotificationType;
  object: ActivityObject;  // 变更的资源
  target?: string;      // 目标容器（Add/Remove 时）
  published: string;    // ISO 8601 时间戳
  state?: string;       // 状态 token
}

// object 目前是 URI 字符串，未来可能扩展为完整对象
type ActivityObject = string | {
  id: string;
  type?: string;
  new?: Record<string, unknown>;  // 未来扩展
  old?: Record<string, unknown>;  // 未来扩展
};

type NotificationType = 
  | 'Create'   // 资源创建
  | 'Update'   // 资源更新
  | 'Delete'   // 资源删除
  | 'Add'      // 添加到容器
  | 'Remove';  // 从容器移除
```

## 回调类型

| 回调 | 触发时机 |
|------|---------|
| `onNotification` | 原始通知事件（服务端返回的 NotificationEvent） |
| `onCreate` | 新资源创建 |
| `onUpdate` | 资源内容变更 |
| `onDelete` | 资源删除 |
| `onAdd` | 资源添加到容器（Document Mode） |
| `onRemove` | 资源从容器移除 |
| `onError` | 连接错误 |
| `onClose` | 连接关闭 |

说明：
- `onNotification` 与 `onCreate/onUpdate/...` 都是服务端通知回调，前者是原始事件，后者是按类型分发。
- 如果同时提供两类回调，会各自触发；需要自行避免重复处理。
- 表级 hooks（`podTable` 的 `hooks.afterInsert/afterUpdate/afterDelete`）是本地写操作后的生命周期钩子，不依赖通知流。

## 通道类型

drizzle-solid 支持两种通知通道：

| 通道类型 | 说明 | 适用场景 |
|---------|------|---------|
| `streaming-http` | Server-Sent Events (SSE) | 默认推荐，浏览器兼容性好 |
| `websocket` | WebSocket | 双向通信，低延迟 |

```typescript
// 指定使用 WebSocket 通道
const subscription = await db.subscribe(posts, {
  channel: 'websocket',
  onUpdate: (activity) => { /* ... */ }
});

// 如果请求的通道不可用，会自动回退到其他可用通道
console.log('Using channel:', subscription.channel);
```

## 订阅特性 (Features)

某些服务器支持额外的订阅特性：

```typescript
const subscription = await db.subscribe(posts, {
  features: ['state'],  // 请求在通知中包含资源状态
  onUpdate: (activity) => {
    if (activity.state) {
      console.log('State token:', activity.state);
    }
  }
});
```

可用特性：
- `state` - 在通知中包含状态 token
- `endAt` - 指定订阅结束时间
- `rate` - 限制通知频率

## 完整示例

```typescript
import { drizzle } from 'drizzle-solid';
import { podTable, string, datetime } from 'drizzle-solid';
import { eq } from 'drizzle-orm';

// 定义表
const posts = podTable('posts', {
  id: string('id').primaryKey(),
  title: string('title').predicate('http://schema.org/headline'),
  content: string('content').predicate('http://schema.org/text'),
  createdAt: datetime('createdAt').predicate('http://schema.org/dateCreated')
}, {
  base: `${podBase}data/posts.ttl`,
  type: 'http://schema.org/CreativeWork'
});

const db = drizzle(session);

// 初始化表
await db.init(posts);

// 初始加载
let allPosts = await db.select().from(posts);
console.log('Initial posts:', allPosts);

// 订阅变化
const subscription = await db.subscribe(posts, {
  onCreate: async (activity) => {
    console.log(`[CREATE] ${activity.object}`);
    allPosts = await db.select().from(posts);
    renderUI(allPosts);
  },
  
  onUpdate: async (activity) => {
    console.log(`[UPDATE] ${activity.object}`);
    allPosts = await db.select().from(posts);
    renderUI(allPosts);
  },
  
  onDelete: async (activity) => {
    console.log(`[DELETE] ${activity.object}`);
    allPosts = await db.select().from(posts);
    renderUI(allPosts);
  },
  
  onError: (error) => {
    console.error('Subscription error:', error);
  },
  
  onClose: () => {
    console.log('Subscription closed');
  }
});

// 模拟数据变更
await db.insert(posts).values({
  id: 'post-1',
  title: 'Hello World',
  content: 'My first post',
  createdAt: new Date()
});

// 清理
subscription.unsubscribe();
await db.disconnect();
```

## 错误处理

```typescript
const subscription = await db.subscribe(posts, {
  onUpdate: (activity) => { /* ... */ },
  onError: (error) => {
    console.error('Connection error:', error);
    // 可以在这里实现重连逻辑
  },
  onClose: () => {
    console.log('Connection closed');
  }
});
```

## 通道自动回退

drizzle-solid 实现了智能的通道回退机制：

1. **发现阶段回退**：如果请求的通道类型不在服务器支持列表中，自动选择第一个可用通道
2. **运行时回退**：如果订阅创建失败，自动尝试其他可用通道

## API 参考

### db.subscribe()

```typescript
async subscribe<TTable extends PodTable<any>>(
  table: TTable,
  options: TableSubscribeOptions
): Promise<Subscription>
```

### TableSubscribeOptions

```typescript
interface TableSubscribeOptions {
  channel?: 'streaming-http' | 'websocket';  // 默认 'streaming-http'
  features?: ('state' | 'endAt' | 'rate')[];
  onNotification?: (event: NotificationEvent) => void;
  onCreate?: (activity: Activity) => void | Promise<void>;
  onUpdate?: (activity: Activity) => void | Promise<void>;
  onDelete?: (activity: Activity) => void | Promise<void>;
  onAdd?: (activity: Activity) => void | Promise<void>;
  onRemove?: (activity: Activity) => void | Promise<void>;
  onError?: (error: Error) => void;
  onClose?: () => void;
}
```

### Subscription

```typescript
interface Subscription {
  unsubscribe(): void;
  readonly active: boolean;
  readonly channel: 'streaming-http' | 'websocket';
  readonly topic: string;
}
```

## 服务器兼容性

| 服务器 | streaming-http | websocket | 备注 |
|-------|---------------|-----------|------|
| CSS (Community Solid Server) | ✅ | ✅ | 完整支持 |
| xpod | ✅ | ✅ | 完整支持 |
| ESS (Enterprise Solid Server) | ✅ | ❌ | 仅 SSE |
| NSS (Node Solid Server) | ❌ | ❌ | 不支持 |

## 底层 API

如果需要直接使用底层 `NotificationsClient`：

```typescript
import { NotificationsClient } from 'drizzle-solid/notifications';

const notifications = new NotificationsClient(session.fetch);

const subscription = await notifications.subscribe(
  'https://pod.example/alice/data/posts.ttl',
  {
    onNotification: (event) => {
      console.log(`${event.type}: ${event.object}`);
    }
  }
);
```

## 相关文档

- [Solid Notifications Protocol 规范](https://solid.github.io/notifications/protocol)
- [Activity Streams 2.0](https://www.w3.org/TR/activitystreams-core/)
- [CSS Notifications 配置](./css-notifications.md)
