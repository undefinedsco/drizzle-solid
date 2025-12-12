import { BaseChannel } from './base-channel';
import type { ChannelConfig } from '../types';

/**
 * SSE (Server-Sent Events) 通道实现
 * 对应 Solid Notifications Protocol 的 StreamingHTTPChannel2023
 */
export class SSEChannel extends BaseChannel {
  private abortController: AbortController | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  constructor(config: ChannelConfig) {
    super(config);
  }

  async connect(): Promise<void> {
    if (this._connected) {
      return;
    }

    this.abortController = new AbortController();
    const fetchFn = this.config.fetch || fetch;

    try {
      const response = await fetchFn(this.config.receiveFrom, {
        method: 'GET',
        headers: {
          'Accept': 'text/event-stream',
        },
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('SSE response has no body');
      }

      this._connected = true;
      this.reader = response.body.getReader();
      this.readStream();
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        this.handleError(error as Error);
      }
      throw error;
    }
  }

  disconnect(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.reader) {
      this.reader.cancel().catch(() => {});
      this.reader = null;
    }
    this._connected = false;
    this.handleClose();
  }

  /**
   * 读取 SSE 流
   */
  private async readStream(): Promise<void> {
    if (!this.reader) return;

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (this._connected) {
        const { done, value } = await this.reader.read();
        
        if (done) {
          this.handleClose();
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        
        // 解析 SSE 消息（以 \n\n 分隔）
        const messages = buffer.split('\n\n');
        buffer = messages.pop() || ''; // 保留最后一个不完整的消息

        for (const message of messages) {
          this.parseSSEMessage(message);
        }
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        this.handleError(error as Error);
      }
    }
  }

  /**
   * 解析单个 SSE 消息
   */
  private parseSSEMessage(message: string): void {
    const lines = message.split('\n');
    let data = '';
    let eventType = 'message';

    for (const line of lines) {
      if (line.startsWith('data:')) {
        data += line.slice(5).trim();
      } else if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      }
      // 忽略 id: 和 retry: 字段
    }

    if (data && eventType === 'message') {
      this.handleMessage(data);
    }
  }
}
