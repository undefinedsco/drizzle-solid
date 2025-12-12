import { BaseChannel } from './base-channel';
import type { ChannelConfig } from '../types';

// 兼容 Node.js 和浏览器环境
const getWebSocket = (): typeof WebSocket => {
  if (typeof WebSocket !== 'undefined') {
    return WebSocket;
  }
  // Node.js 环境，动态导入 ws
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ws = require('ws');
    return ws as typeof WebSocket;
  } catch {
    throw new Error('WebSocket is not available. Install "ws" package for Node.js support.');
  }
};

/**
 * WebSocket 通道实现
 * 对应 Solid Notifications Protocol 的 WebSocketChannel2023
 */
export class WebSocketChannel extends BaseChannel {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 3;
  private readonly reconnectDelay = 1000; // ms

  constructor(config: ChannelConfig) {
    super(config);
  }

  async connect(): Promise<void> {
    if (this._connected) {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        const WebSocketImpl = getWebSocket();
        this.ws = new WebSocketImpl(this.config.receiveFrom) as WebSocket;

        this.ws.onopen = () => {
          this._connected = true;
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event: MessageEvent) => {
          const data = typeof event.data === 'string' 
            ? event.data 
            : event.data?.toString?.() || '';
          this.handleMessage(data);
        };

        this.ws.onerror = () => {
          const error = new Error('WebSocket error');
          this.handleError(error);
          if (!this._connected) {
            reject(error);
          }
        };

        this.ws.onclose = (event: CloseEvent) => {
          this._connected = false;
          
          if (!event.wasClean && this.reconnectAttempts < this.maxReconnectAttempts) {
            // 尝试重连
            this.reconnectAttempts++;
            setTimeout(() => {
              this.connect().catch(() => {});
            }, this.reconnectDelay * this.reconnectAttempts);
          } else {
            this.handleClose();
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  disconnect(): void {
    this.reconnectAttempts = this.maxReconnectAttempts; // 防止重连
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this._connected = false;
  }
}
