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
 * 从 URI 反向映射到 ChannelType
 */
const URI_TO_CHANNEL_TYPE: Record<string, ChannelType> = {
  'http://www.w3.org/ns/solid/notifications#StreamingHTTPChannel2023': 'streaming-http',
  'http://www.w3.org/ns/solid/notifications#WebSocketChannel2023': 'websocket',
};

interface DiscoveredService {
  subscriptionEndpoint: string;
  supportedChannels: ChannelType[];
}

/**
 * Solid Notifications 客户端
 * 
 * 负责：
 * 1. 发现资源的 notifications 服务
 * 2. 创建订阅
 * 3. 管理通道连接
 */
export class NotificationsClient {
  private readonly fetch: typeof globalThis.fetch;
  private readonly subscriptions: Map<string, SubscriptionImpl> = new Map();

  constructor(authenticatedFetch: typeof globalThis.fetch) {
    this.fetch = authenticatedFetch;
  }

  /**
   * 订阅资源变化
   * 
   * @param topic - 要订阅的资源 URL（可以是文件或容器）
   * @param options - 订阅选项
   * @returns 订阅句柄
   */
  async subscribe(topic: string, options: SubscribeOptions): Promise<Subscription> {
    // 1. 发现 notifications 服务
    const discovery = await this.discoverNotificationService(topic);
    
    // 2. 确定使用的通道类型
    let channelType = options.channel || 'streaming-http';
    
    // 如果请求的通道不支持，尝试其他可用通道
    if (!discovery.supportedChannels.includes(channelType)) {
      if (discovery.supportedChannels.length > 0) {
        channelType = discovery.supportedChannels[0];
        console.log(`[Notifications] Requested channel "${options.channel}" not supported, using "${channelType}" instead`);
      } else {
        throw new Error(`No supported notification channels found for ${topic}`);
      }
    }

    // 3. 尝试创建订阅，如果失败则回退到其他通道
    const trySubscribe = async (channel: ChannelType): Promise<Subscription> => {
      const endpoint = await this.getChannelEndpoint(discovery, channel, topic);
      const subscriptionResponse = await this.createSubscription(
        endpoint,
        topic,
        channel,
        options.features
      );

      const channelInstance = this.createChannel(channel, subscriptionResponse.receiveFrom, options);
      await channelInstance.connect();

      const subscription = new SubscriptionImpl(
        topic,
        channel,
        channelInstance,
        () => this.subscriptions.delete(topic)
      );

      this.subscriptions.set(topic, subscription);
      return subscription;
    };

    // 尝试请求的通道
    try {
      return await trySubscribe(channelType);
    } catch (error) {
      // 如果失败，尝试回退到其他通道
      const fallbackChannels = discovery.supportedChannels.filter(c => c !== channelType);
      for (const fallbackChannel of fallbackChannels) {
        try {
          console.log(`[Notifications] Channel "${channelType}" failed, trying "${fallbackChannel}"`);
          return await trySubscribe(fallbackChannel);
        } catch (fallbackError) {
          // 继续尝试下一个
        }
      }
      // 所有通道都失败了
      throw error;
    }
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
    // 获取资源的存储根
    const storageRoot = await this.findStorageRoot(resourceUrl);
    
    // 获取 storage description
    const descriptionUrl = `${storageRoot}.well-known/solid`;
    
    try {
      return await this.fetchStorageDescription(descriptionUrl, storageRoot);
    } catch {
      // 回退：使用默认的 notifications 路径
      const url = new URL(resourceUrl);
      return {
        subscriptionEndpoint: `${url.origin}/.notifications/`,
        supportedChannels: ['websocket', 'streaming-http']
      };
    }
  }

  /**
   * 查找资源的存储根 URL
   */
  private async findStorageRoot(resourceUrl: string): Promise<string> {
    // 尝试从 Link header 获取存储根
    try {
      const response = await this.fetch(resourceUrl, { method: 'HEAD' });
      const linkHeader = response.headers.get('Link');
      
      if (linkHeader) {
        // 查找 storage 或 storageDescription 链接
        const storageMatch = linkHeader.match(/<([^>]+)>;\s*rel="?http:\/\/www\.w3\.org\/ns\/pim\/space#storage"?/);
        if (storageMatch) {
          return storageMatch[1];
        }
      }
    } catch {
      // 忽略错误
    }

    // 回退：从 URL 推断存储根（通常是用户 Pod 根）
    const url = new URL(resourceUrl);
    const pathParts = url.pathname.split('/').filter(Boolean);
    
    // 假设第一个路径段是用户名/Pod 名
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
    let defaultEndpoint = '';

    // 解析 Turtle 格式的 storage description
    // 示例：
    // <http://localhost:3000/test/> <http://www.w3.org/ns/solid/notifications#subscription> 
    //   <http://localhost:3000/.notifications/WebSocketChannel2023/> .
    
    // 查找所有 subscription 端点
    const subscriptionRegex = /notify:subscription|notifications#subscription[>\s]+<([^>]+)>/g;
    const altRegex = /<[^>]+>\s+<http:\/\/www\.w3\.org\/ns\/solid\/notifications#subscription>\s+<([^>]+)>/g;
    
    let match;
    const endpoints: string[] = [];
    
    // 尝试第一种格式
    while ((match = subscriptionRegex.exec(body)) !== null) {
      endpoints.push(match[1]);
    }
    
    // 尝试第二种格式
    while ((match = altRegex.exec(body)) !== null) {
      endpoints.push(match[1]);
    }

    // 从端点 URL 推断支持的通道类型
    for (const endpoint of endpoints) {
      if (endpoint.includes('WebSocketChannel2023')) {
        supportedChannels.push('websocket');
        if (!defaultEndpoint) defaultEndpoint = endpoint;
      } else if (endpoint.includes('StreamingHTTPChannel2023')) {
        supportedChannels.push('streaming-http');
        if (!defaultEndpoint) defaultEndpoint = endpoint;
      }
    }

    // 如果没找到具体端点，使用通用格式查找
    if (endpoints.length === 0) {
      // 查找 channelType 声明
      if (body.includes('WebSocketChannel2023')) {
        supportedChannels.push('websocket');
      }
      if (body.includes('StreamingHTTPChannel2023')) {
        supportedChannels.push('streaming-http');
      }
      
      // 使用默认路径
      const url = new URL(storageRoot);
      defaultEndpoint = `${url.origin}/.notifications/`;
    }

    return {
      subscriptionEndpoint: defaultEndpoint || `${new URL(storageRoot).origin}/.notifications/`,
      supportedChannels: supportedChannels.length > 0 ? supportedChannels : ['websocket']
    };
  }

  /**
   * 获取特定通道类型的订阅端点
   */
  private async getChannelEndpoint(
    discovery: DiscoveredService,
    channelType: ChannelType,
    _topic: string
  ): Promise<string> {
    // 如果端点已经包含通道类型，直接使用
    const channelName = channelType === 'websocket' ? 'WebSocketChannel2023' : 'StreamingHTTPChannel2023';
    
    if (discovery.subscriptionEndpoint.includes(channelName)) {
      return discovery.subscriptionEndpoint;
    }
    
    // 尝试构造特定通道的端点
    const baseUrl = discovery.subscriptionEndpoint.replace(/\/$/, '');
    return `${baseUrl}/${channelName}/`;
  }

  /**
   * 创建订阅
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
