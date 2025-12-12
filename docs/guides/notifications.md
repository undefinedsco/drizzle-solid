# Solid Notifications

drizzle-solid 支持 [Solid Notifications Protocol](https://solid.github.io/notifications/protocol)，允许你订阅资源变化并实时接收通知。

## 基本用法

```typescript
import { drizzle } from 'drizzle-solid';
import { NotificationsClient } from 'drizzle-solid/notifications';

// 创建 drizzle 实例
const db = drizzle(session);

// 创建 notifications 客户端
const notifications = new NotificationsClient(session.fetch);

// 订阅资源变化
const subscription = await notifications.subscribe(
  'https://pod.example/alice/data/posts.ttl',
  {
    onNotification: (event) => {
      console.log(`${event.type}: ${event.object}`);
      // 输出: "Update: https://pod.example/alice/data/posts.ttl"
    },
    onError: (error) => {
      console.error('Notification error:', error);
    }
  }
);

// 取消订阅
subscription.unsubscribe();
```

## 通道类型

drizzle-solid 支持两种通知通道：

| 通道类型 | 说明 | 适用场景 |
|---------|------|---------|
| `streaming-http` | Server-Sent Events (SSE) | 默认推荐，浏览器兼容性好 |
| `websocket` | WebSocket | 双向通信，低延迟 |

```typescript
// 指定使用 WebSocket 通道
const subscription = await notifications.subscribe(resourceUrl, {
  channel: 'websocket',
  onNotification: (event) => { /* ... */ }
});

// 如果请求的通道不可用，会自动回退到其他可用通道
```

## 事件类型

通知事件遵循 [Activity Streams 2.0](https://www.w3.org/TR/activitystreams-core/) 规范：

```typescript
interface NotificationEvent {
  id: string;           // 事件唯一 ID
  type: NotificationType;
  object: string;       // 变更的资源 URL
  published: string;    // ISO 8601 时间戳
  state?: string;       // 资源状态 (需要 state feature)
}

type NotificationType = 
  | 'Create'   // 资源创建
  | 'Update'   // 资源更新
  | 'Delete'   // 资源删除
  | 'Add'      // 添加到容器
  | 'Remove';  // 从容器移除
```

## 订阅容器

除了订阅单个文件，还可以订阅容器来监听子资源变化：

```typescript
// 订阅容器，监听新文件创建
const subscription = await notifications.subscribe(
  'https://pod.example/alice/data/',  // 容器 URL（以 / 结尾）
  {
    onNotification: (event) => {
      if (event.type === 'Add') {
        console.log('New resource added:', event.object);
      }
    }
  }
);
```

## 订阅特性 (Features)

某些服务器支持额外的订阅特性：

```typescript
const subscription = await notifications.subscribe(resourceUrl, {
  features: ['state'],  // 请求在通知中包含资源状态
  onNotification: (event) => {
    if (event.state) {
      // event.state 包含资源的 Turtle 内容
      console.log('Resource state:', event.state);
    }
  }
});
```

可用特性：
- `state` - 在通知中包含资源的完整状态
- `endAt` - 指定订阅结束时间
- `rate` - 限制通知频率

## 与 drizzle 查询结合

实时更新数据的典型模式：

```typescript
import { drizzle } from 'drizzle-solid';
import { NotificationsClient } from 'drizzle-solid/notifications';
import { podTable, string } from 'drizzle-solid';

const posts = podTable('posts', {
  id: string('id').primaryKey(),
  title: string('title').predicate('http://schema.org/headline'),
}, {
  base: `${podBase}data/posts.ttl`,
  type: 'http://schema.org/CreativeWork'
});

const db = drizzle(session);
const notifications = new NotificationsClient(session.fetch);

// 初始加载
let allPosts = await db.select().from(posts);

// 订阅变化
const subscription = await notifications.subscribe(
  `${podBase}data/posts.ttl`,
  {
    onNotification: async (event) => {
      if (event.type === 'Update' || event.type === 'Create') {
        // 重新查询获取最新数据
        allPosts = await db.select().from(posts);
        console.log('Posts updated:', allPosts);
      }
    }
  }
);

// 清理
subscription.unsubscribe();
notifications.unsubscribeAll();
```

## 错误处理

```typescript
const subscription = await notifications.subscribe(resourceUrl, {
  onNotification: (event) => { /* ... */ },
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

```typescript
// 即使请求 streaming-http，如果不可用也会自动回退到 websocket
const subscription = await notifications.subscribe(resourceUrl, {
  channel: 'streaming-http',
  onNotification: (event) => { /* ... */ }
});

// 可以检查实际使用的通道
console.log('Using channel:', subscription.channel);
```

## API 参考

### NotificationsClient

```typescript
class NotificationsClient {
  constructor(authenticatedFetch: typeof fetch);
  
  // 订阅资源变化
  subscribe(topic: string, options: SubscribeOptions): Promise<Subscription>;
  
  // 取消所有订阅
  unsubscribeAll(): void;
}
```

### SubscribeOptions

```typescript
interface SubscribeOptions {
  channel?: 'streaming-http' | 'websocket';  // 默认 'streaming-http'
  features?: ('state' | 'endAt' | 'rate')[];
  onNotification: (event: NotificationEvent) => void;
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

## 相关文档

- [Solid Notifications Protocol 规范](https://solid.github.io/notifications/protocol)
- [CSS Notifications 配置](./css-notifications.md)
