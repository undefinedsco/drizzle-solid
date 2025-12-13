import { BaseChannel } from './base-channel';
import type { ChannelConfig } from '../types';

/**
 * SSE (Server-Sent Events) 通道实现
 * 对应 Solid Notifications Protocol 的 StreamingHTTPChannel2023
 * 
 * 支持两种模式：
 * 1. 标准 SSE (text/event-stream): data: 前缀的 JSON-LD
 * 2. CSS 直接模式 (text/turtle): 直接返回 Turtle 格式的通知
 */
export class SSEChannel extends BaseChannel {
  private abortController: AbortController | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private contentType: string = '';

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
      // CSS 直接模式不需要 Accept: text/event-stream
      // 使用 text/turtle 可以获得 Turtle 格式的通知流
      const response = await fetchFn(this.config.receiveFrom, {
        method: 'GET',
        headers: {
          'Accept': 'text/turtle, text/event-stream',
        },
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('SSE response has no body');
      }

      this.contentType = response.headers.get('content-type') || '';
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
   * 读取流
   */
  private async readStream(): Promise<void> {
    if (!this.reader) return;

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (this._connected) {
        const { done, value } = await this.reader.read();
        
        if (done) {
          // 处理最后的缓冲区
          if (buffer.trim()) {
            this.parseNotification(buffer.trim());
          }
          this.handleClose();
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        
        // 根据内容类型选择解析方式
        if (this.contentType.includes('text/turtle')) {
          // CSS Turtle 模式：以空行分隔通知
          buffer = this.processTurtleBuffer(buffer);
        } else {
          // 标准 SSE 模式：以 \n\n 分隔
          buffer = this.processSSEBuffer(buffer);
        }
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        this.handleError(error as Error);
      }
    }
  }

  /**
   * 处理 Turtle 格式的缓冲区
   * CSS 返回的 Turtle 通知以空行分隔
   */
  private processTurtleBuffer(buffer: string): string {
    // Turtle 通知以 "." 结尾，后跟换行
    // 寻找完整的 Turtle 语句（以 . 结尾的行）
    const lines = buffer.split('\n');
    let currentNotification = '';
    let remaining = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      currentNotification += line + '\n';
      
      // 检查是否是完整的 Turtle 语句（以 . 结尾）
      if (line.trim().endsWith('.')) {
        // 完整的通知，解析它
        this.parseTurtleNotification(currentNotification.trim());
        currentNotification = '';
      }
    }
    
    // 返回未完成的部分
    return currentNotification;
  }

  /**
   * 处理标准 SSE 格式的缓冲区
   */
  private processSSEBuffer(buffer: string): string {
    const messages = buffer.split('\n\n');
    const remaining = messages.pop() || '';

    for (const message of messages) {
      if (message.trim()) {
        this.parseSSEMessage(message);
      }
    }

    return remaining;
  }

  /**
   * 解析 Turtle 格式的通知 (CSS 模式)
   * 
   * 示例：
   * <urn:xxx:topic> <https://www.w3.org/ns/activitystreams#object> <http://localhost:3000/test/>;
   *     <http://www.w3.org/ns/solid/notifications#state> "\"etag\"";
   *     <https://www.w3.org/ns/activitystreams#published> "2025-12-13T00:54:11.531Z"^^<xsd:dateTime>;
   *     a <https://www.w3.org/ns/activitystreams#Update>.
   */
  private parseTurtleNotification(turtle: string): void {
    try {
      // 提取关键信息
      const objectMatch = turtle.match(/<https:\/\/www\.w3\.org\/ns\/activitystreams#object>\s*<([^>]+)>/);
      const typeMatch = turtle.match(/a\s*<https:\/\/www\.w3\.org\/ns\/activitystreams#(\w+)>/);
      const publishedMatch = turtle.match(/<https:\/\/www\.w3\.org\/ns\/activitystreams#published>\s*"([^"]+)"/);
      const stateMatch = turtle.match(/<http:\/\/www\.w3\.org\/ns\/solid\/notifications#state>\s*"([^"]+)"/);
      const idMatch = turtle.match(/^<([^>]+)>/);

      if (!objectMatch || !typeMatch) {
        // 不是有效的通知，忽略
        return;
      }

      const notification = {
        id: idMatch?.[1] || `urn:notification:${Date.now()}`,
        type: typeMatch[1] as any,
        object: objectMatch[1],
        published: publishedMatch?.[1] || new Date().toISOString(),
        state: stateMatch?.[1],
      };

      this.handleMessage(JSON.stringify(notification));
    } catch (error) {
      console.warn('[SSE] Failed to parse Turtle notification:', error);
    }
  }

  /**
   * 解析通知（自动检测格式）
   */
  private parseNotification(data: string): void {
    if (data.startsWith('{')) {
      // JSON 格式
      this.handleMessage(data);
    } else if (data.includes('activitystreams')) {
      // Turtle 格式
      this.parseTurtleNotification(data);
    }
  }

  /**
   * 解析标准 SSE 消息
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
    }

    if (data && eventType === 'message') {
      this.handleMessage(data);
    }
  }
}
