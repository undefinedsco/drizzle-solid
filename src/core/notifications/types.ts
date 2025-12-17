/**
 * Solid Notifications Protocol 类型定义
 * @see https://solid.github.io/notifications/protocol
 */

/**
 * 通知事件类型（Activity Streams 2.0）
 */
export type NotificationType = 
  | 'Create'   // 资源创建
  | 'Update'   // 资源更新
  | 'Delete'   // 资源删除
  | 'Add'      // 添加到容器
  | 'Remove';  // 从容器移除

/**
 * Activity Streams 2.0 Object
 * 可以是简单的 URI 字符串，也可以是完整的对象（未来扩展）
 * @see https://www.w3.org/TR/activitystreams-core/#object
 */
export type ActivityObject = string | {
  /** 对象 URI */
  id: string;
  /** 对象类型 */
  type?: string;
  /** 新数据（未来扩展） */
  new?: Record<string, unknown>;
  /** 旧数据（未来扩展） */
  old?: Record<string, unknown>;
  /** 其他属性 */
  [key: string]: unknown;
};

/**
 * Activity Streams 2.0 Activity
 * @see https://www.w3.org/TR/activitystreams-core/#activities
 */
export interface Activity {
  /** Activity 唯一 ID */
  id: string;
  /** Activity 类型 */
  type: NotificationType;
  /** 变更的资源（URI 或对象） */
  object: ActivityObject;
  /** 目标容器（Add/Remove 时） */
  target?: string;
  /** 发布时间（ISO 8601） */
  published: string;
  /** 状态 token */
  state?: string;
}

/**
 * 通知事件（兼容旧接口）
 * @deprecated 使用 Activity 代替
 */
export interface NotificationEvent {
  /** 事件唯一 ID */
  id: string;
  /** 事件类型 */
  type: NotificationType;
  /** 变更的资源 URL */
  object: string;
  /** 事件发布时间（ISO 8601） */
  published: string;
  /** 变更后的资源状态（Turtle 格式，需要 state feature） */
  state?: string;
}

/**
 * 通道类型
 */
export type ChannelType = 'streaming-http' | 'websocket';

/**
 * 订阅特性
 */
export type SubscriptionFeature = 'state' | 'endAt' | 'rate';

/**
 * 订阅选项（旧接口，兼容）
 */
export interface SubscribeOptions {
  /** 通道类型，默认 'streaming-http' (SSE) */
  channel?: ChannelType;
  /** 订阅特性 */
  features?: SubscriptionFeature[];
  /** 收到通知时的回调 */
  onNotification: (event: NotificationEvent) => void;
  /** 发生错误时的回调 */
  onError?: (error: Error) => void;
  /** 连接关闭时的回调 */
  onClose?: () => void;
  /** 
   * 是否启用自动重连（默认 true）
   * 当连接断开时（如 xpod node_id 切换），自动重新订阅
   */
  autoReconnect?: boolean;
  /**
   * 最大重连次数（默认 5）
   * 设为 0 或 Infinity 表示无限重连
   */
  maxReconnectAttempts?: number;
  /**
   * 重连延迟基数（默认 1000ms）
   * 实际延迟 = baseDelay * 2^attempt（指数退避）
   */
  reconnectDelayMs?: number;
  /**
   * 重连时的回调
   */
  onReconnect?: (attempt: number) => void;
}

/**
 * 表订阅选项（新接口，按类型分开）
 */
export interface TableSubscribeOptions {
  /** 通道类型，默认 'streaming-http' (SSE) */
  channel?: ChannelType;
  /** 订阅特性 */
  features?: SubscriptionFeature[];
  /** 资源创建时的回调 */
  onCreate?: (activity: Activity) => void | Promise<void>;
  /** 资源更新时的回调 */
  onUpdate?: (activity: Activity) => void | Promise<void>;
  /** 资源删除时的回调 */
  onDelete?: (activity: Activity) => void | Promise<void>;
  /** 添加到容器时的回调 */
  onAdd?: (activity: Activity) => void | Promise<void>;
  /** 从容器移除时的回调 */
  onRemove?: (activity: Activity) => void | Promise<void>;
  /** 发生错误时的回调 */
  onError?: (error: Error) => void;
  /** 连接关闭时的回调 */
  onClose?: () => void;
}

/**
 * 订阅句柄
 */
export interface Subscription {
  /** 取消订阅 */
  unsubscribe(): void;
  /** 订阅是否活跃 */
  readonly active: boolean;
  /** 通道类型 */
  readonly channel: ChannelType;
  /** 订阅的主题（资源 URL） */
  readonly topic: string;
}

/**
 * Notifications 服务发现响应
 */
export interface NotificationServiceDescription {
  /** 订阅端点 URL */
  subscriptionEndpoint: string;
  /** 支持的通道类型 */
  channelTypes: string[];
  /** 支持的特性 */
  features?: string[];
}

/**
 * 订阅请求体
 */
export interface SubscriptionRequest {
  '@context': string[];
  type: string;  // 'WebSocketChannel2023' | 'StreamingHTTPChannel2023'
  topic: string;
  features?: string[];
}

/**
 * 订阅响应体
 */
export interface SubscriptionResponse {
  '@context': string[];
  id: string;
  type: string;
  topic: string;
  receiveFrom: string;  // WebSocket URL 或 SSE URL
  features?: string[];
}

/**
 * Channel 接口（内部使用）
 */
export interface NotificationChannel {
  /** 连接到通知服务 */
  connect(): Promise<void>;
  /** 断开连接 */
  disconnect(): void;
  /** 是否已连接 */
  readonly connected: boolean;
}

/**
 * Channel 配置（内部使用）
 */
export interface ChannelConfig {
  /** 接收通知的 URL（WebSocket URL 或 SSE URL） */
  receiveFrom: string;
  /** 收到通知时的回调 */
  onNotification: (event: NotificationEvent) => void;
  /** 发生错误时的回调 */
  onError?: (error: Error) => void;
  /** 连接关闭时的回调 */
  onClose?: () => void;
  /** 认证 fetch 函数 */
  fetch?: typeof fetch;
}
