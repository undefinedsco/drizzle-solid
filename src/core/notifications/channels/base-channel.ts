import type { NotificationChannel, ChannelConfig, NotificationEvent } from '../types';

/**
 * 解析 Activity Streams 2.0 消息为 NotificationEvent
 */
export function parseActivityStreamsMessage(data: string): NotificationEvent {
  const json = JSON.parse(data);
  
  return {
    id: json.id || json['@id'] || '',
    type: json.type,
    object: typeof json.object === 'string' ? json.object : json.object?.id || json.object?.['@id'] || '',
    published: json.published || new Date().toISOString(),
    state: json.state,
  };
}

/**
 * Channel 抽象基类
 */
export abstract class BaseChannel implements NotificationChannel {
  protected _connected = false;
  protected readonly config: ChannelConfig;

  constructor(config: ChannelConfig) {
    this.config = config;
  }

  get connected(): boolean {
    return this._connected;
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): void;

  /**
   * 处理收到的消息
   */
  protected handleMessage(data: string): void {
    try {
      const event = parseActivityStreamsMessage(data);
      this.config.onNotification(event);
    } catch (error) {
      this.handleError(new Error(`Failed to parse notification: ${error}`));
    }
  }

  /**
   * 处理错误
   */
  protected handleError(error: Error): void {
    if (this.config.onError) {
      this.config.onError(error);
    } else {
      console.error('[NotificationChannel] Error:', error);
    }
  }

  /**
   * 处理连接关闭
   */
  protected handleClose(): void {
    this._connected = false;
    if (this.config.onClose) {
      this.config.onClose();
    }
  }
}
