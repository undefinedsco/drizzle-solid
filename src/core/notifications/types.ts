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
 * 通知事件
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
 * 订阅选项
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
