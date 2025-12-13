import type {
  ChannelType,
  SubscribeOptions,
  Subscription,
  SubscriptionResponse,
  NotificationChannel,
} from './types';
import { SSEChannel } from './channels/sse-channel';
import { WebSocketChannel } from './channels/websocket-channel';

/**
 * Solid Notifications Protocol 通道类型 URI 映射
 */
const CHANNEL_TYPE_URI: Record<ChannelType, string> = {
  'streaming-http': 'http://www.w3.org/ns/solid/notifications#StreamingHTTPChannel2023',
  'websocket': 'http://www.w3.org/ns/solid/notifications#WebSocketChannel2023',
};

/**
 * 通道名称映射
 */
const CHANNEL_NAMES: Record<ChannelType, string> = {
  'streaming-http': 'StreamingHTTPChannel2023',
  'websocket': 'WebSocketChannel2023',
};

interface DiscoveredService {
  baseEndpoint: string;
  supportedChannels: ChannelType[];
}

export interface NotificationsClientConfig {
  /** 通道偏好顺序，默认 ['streaming-http', 'websocket'] */
  preferredChannels?: ChannelType[];
}

/**
 * Solid Notifications 客户端
 * 
 * 支持两种通道：
 * - streaming-http (SSE): CSS 直接连接模式，无需订阅
 * - websocket: 标准订阅模式，POST 获取 receiveFrom
 */
export class NotificationsClient {
  private readonly fetch: typeof globalThis.fetch;
  private readonly subscriptions: Map<string, SubscriptionImpl> = new Map();
  private readonly preferredChannels: ChannelType[];

  constructor(
    authenticatedFetch: typeof globalThis.fetch,
    config?: NotificationsClientConfig
  ) {
    this.fetch = authenticatedFetch;
    this.preferredChannels = config?.preferredChannels ?? ['streaming-http', 'websocket'];
  }

  /**
   * 订阅资源变化
   */
  async subscribe(topic: string, options: SubscribeOptions): Promise<Subscription> {
    // 1. 发现 notifications 服务
    const discovery = await this.discoverNotificationService(topic);
    
    // 2. 根据偏好和服务器支持选择通道
    const channelOrder = options.channel 
      ? [options.channel, ...this.preferredChannels.filter(c => c !== options.channel)]
      : this.preferredChannels;
    
    // 过滤出服务器支持的通道
    const availableChannels = channelOrder.filter(c => discovery.supportedChannels.includes(c));
    
    if (availableChannels.length === 0) {
      throw new Error(`No supported notification channels found for ${topic}. Server supports: ${discovery.supportedChannels.join(', ')}`);
    }

    // 3. 尝试连接，按偏好顺序
    let lastError: Error | null = null;
    
    for (const channelType of availableChannels) {
      try {
        return await this.connectChannel(channelType, topic, discovery, options);
      } catch (error) {
        console.log(`[Notifications] Channel "${channelType}" failed, trying next...`);
        lastError = error as Error;
      }
    }
    
    throw lastError ?? new Error(`Failed to connect to any notification channel for ${topic}`);
  }

  /**
   * 连接到指定通道
   */
  private async connectChannel(
    channelType: ChannelType,
    topic: string,
    discovery: DiscoveredService,
    options: SubscribeOptions
  ): Promise<Subscription> {
    let receiveFrom: string;
    
    if (channelType === 'streaming-http') {
      // CSS 直接连接模式：URL 中编码 topic
      receiveFrom = this.buildSSEDirectUrl(discovery.baseEndpoint, topic);
      console.log(`[Notifications] SSE direct connect to: ${receiveFrom}`);
    } else {
      // WebSocket：标准订阅模式
      const endpoint = `${discovery.baseEndpoint}${CHANNEL_NAMES[channelType]}/`;
      const subscriptionResponse = await this.createSubscription(
        endpoint,
        topic,
        channelType,
        options.features
      );
      receiveFrom = subscriptionResponse.receiveFrom;
      console.log(`[Notifications] WebSocket subscription created, receiveFrom: ${receiveFrom}`);
    }

    // 创建并连接通道
    const channelInstance = this.createChannel(channelType, receiveFrom, options);
    await channelInstance.connect();

    const subscription = new SubscriptionImpl(
      topic,
      channelType,
      channelInstance,
      () => this.subscriptions.delete(topic)
    );

    this.subscriptions.set(topic, subscription);
    return subscription;
  }

  /**
   * 构建 SSE 直接连接 URL (CSS 模式)
   * 格式: /.notifications/StreamingHTTPChannel2023/{encodeURIComponent(topic)}
   */
  private buildSSEDirectUrl(baseEndpoint: string, topic: string): string {
    const base = baseEndpoint.endsWith('/') ? baseEndpoint : `${baseEndpoint}/`;
    return `${base}StreamingHTTPChannel2023/${encodeURIComponent(topic)}`;
  }

  /**
   * 取消所有订阅
   */
  unsubscribeAll(): void {
    for (const subscription of this.subscriptions.values()) {
      subscription.unsubscribe();
    }
    this.subscriptions.clear();
  }

  /**
   * 发现资源的 notifications 服务
   */
  private async discoverNotificationService(resourceUrl: string): Promise<DiscoveredService> {
    const storageRoot = await this.findStorageRoot(resourceUrl);
    const descriptionUrl = `${storageRoot}.well-known/solid`;
    
    try {
      return await this.fetchStorageDescription(descriptionUrl, storageRoot);
    } catch {
      // 回退：使用默认的 notifications 路径
      const url = new URL(resourceUrl);
      return {
        baseEndpoint: `${url.origin}/.notifications/`,
        supportedChannels: ['websocket', 'streaming-http']
      };
    }
  }

  /**
   * 查找资源的存储根 URL
   */
  private async findStorageRoot(resourceUrl: string): Promise<string> {
    try {
      const response = await this.fetch(resourceUrl, { method: 'HEAD' });
      const linkHeader = response.headers.get('Link');
      
      if (linkHeader) {
        const storageMatch = linkHeader.match(/<([^>]+)>;\s*rel="?http:\/\/www\.w3\.org\/ns\/pim\/space#storage"?/);
        if (storageMatch) {
          return storageMatch[1];
        }
      }
    } catch {
      // 忽略错误
    }

    // 回退：从 URL 推断存储根
    const url = new URL(resourceUrl);
    const pathParts = url.pathname.split('/').filter(Boolean);
    
    if (pathParts.length > 0) {
      return `${url.origin}/${pathParts[0]}/`;
    }
    
    return `${url.origin}/`;
  }

  /**
   * 获取 storage description 并提取 notifications 端点
   */
  private async fetchStorageDescription(
    descriptionUrl: string,
    storageRoot: string
  ): Promise<DiscoveredService> {
    const response = await this.fetch(descriptionUrl, {
      headers: { 'Accept': 'text/turtle, application/ld+json' },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch storage description: ${response.status}`);
    }

    const body = await response.text();
    const supportedChannels: ChannelType[] = [];

    // 从 storage description 中查找支持的通道
    // 查找 subscription 端点
    const subscriptionRegex = /<http:\/\/www\.w3\.org\/ns\/solid\/notifications#subscription>\s+<([^>]+)>/g;
    const altRegex = /notify:subscription[>\s]+<([^>]+)>/g;
    
    let match;
    const endpoints: string[] = [];
    
    while ((match = subscriptionRegex.exec(body)) !== null) {
      endpoints.push(match[1]);
    }
    while ((match = altRegex.exec(body)) !== null) {
      endpoints.push(match[1]);
    }

    // 从端点 URL 推断支持的通道类型
    for (const endpoint of endpoints) {
      if (endpoint.includes('WebSocketChannel2023') && !supportedChannels.includes('websocket')) {
        supportedChannels.push('websocket');
      }
      if (endpoint.includes('StreamingHTTPChannel2023') && !supportedChannels.includes('streaming-http')) {
        supportedChannels.push('streaming-http');
      }
    }

    // 如果没找到具体端点，检查 channelType 声明
    if (supportedChannels.length === 0) {
      if (body.includes('WebSocketChannel2023')) {
        supportedChannels.push('websocket');
      }
      if (body.includes('StreamingHTTPChannel2023')) {
        supportedChannels.push('streaming-http');
      }
    }

    const url = new URL(storageRoot);
    return {
      baseEndpoint: `${url.origin}/.notifications/`,
      supportedChannels: supportedChannels.length > 0 ? supportedChannels : ['websocket']
    };
  }

  /**
   * 创建 WebSocket 订阅（POST 请求）
   */
  private async createSubscription(
    endpoint: string,
    topic: string,
    channelType: ChannelType,
    features?: string[]
  ): Promise<SubscriptionResponse> {
    const requestBody = {
      '@context': ['https://www.w3.org/ns/solid/notification/v1'],
      type: CHANNEL_TYPE_URI[channelType],
      topic,
      ...(features && features.length > 0 ? { features } : {}),
    };

    const response = await this.fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/ld+json',
        'Accept': 'application/ld+json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to create subscription: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    return response.json();
  }

  /**
   * 创建通道实例
   */
  private createChannel(
    channelType: ChannelType,
    receiveFrom: string,
    options: SubscribeOptions
  ): NotificationChannel {
    const config = {
      receiveFrom,
      onNotification: options.onNotification,
      onError: options.onError,
      onClose: options.onClose,
      fetch: this.fetch,
    };

    switch (channelType) {
      case 'streaming-http':
        return new SSEChannel(config);
      case 'websocket':
        return new WebSocketChannel(config);
      default:
        throw new Error(`Unsupported channel type: ${channelType}`);
    }
  }
}

/**
 * Subscription 实现
 */
class SubscriptionImpl implements Subscription {
  private _active = true;
  private readonly _channel: ChannelType;
  private readonly _topic: string;
  private readonly notificationChannel: NotificationChannel;
  private readonly onUnsubscribe: () => void;

  constructor(
    topic: string,
    channel: ChannelType,
    notificationChannel: NotificationChannel,
    onUnsubscribe: () => void
  ) {
    this._topic = topic;
    this._channel = channel;
    this.notificationChannel = notificationChannel;
    this.onUnsubscribe = onUnsubscribe;
  }

  get active(): boolean {
    return this._active && this.notificationChannel.connected;
  }

  get channel(): ChannelType {
    return this._channel;
  }

  get topic(): string {
    return this._topic;
  }

  unsubscribe(): void {
    if (!this._active) return;
    
    this._active = false;
    this.notificationChannel.disconnect();
    this.onUnsubscribe();
  }
}
