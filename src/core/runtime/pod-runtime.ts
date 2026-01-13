import { resolvePodBase } from '../utils/pod-root';
import type { SolidAuthSession } from '../pod-dialect';

// 生成唯一请求 ID
function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}

export class PodRuntime {
  private session: SolidAuthSession;
  private webId: string;
  private podUrl: string;
  private connected = false;
  private wrappedFetch: typeof fetch | null = null;
  private requestIdSupported: boolean | null = null;

  constructor(options: { session: SolidAuthSession; webId: string; podUrl?: string }) {
    this.session = options.session;
    this.webId = options.webId;
    this.podUrl = resolvePodBase({ webId: this.webId, podUrl: options.podUrl });
  }

  /**
   * 检测服务器是否允许 X-Request-ID header (通过 CORS preflight)
   */
  private async detectRequestIdSupport(): Promise<boolean> {
    try {
      // 发送 OPTIONS preflight 请求检测
      const response = await fetch(this.podUrl, {
        method: 'OPTIONS',
      });

      const allowedHeaders = response.headers.get('Access-Control-Allow-Headers') || '';
      // 检查是否允许 X-Request-ID（不区分大小写）
      const supported = allowedHeaders.toLowerCase().includes('x-request-id');

      if (supported) {
        console.log('[PodRuntime] X-Request-ID header is supported by server');
      } else {
        console.log('[PodRuntime] X-Request-ID header is not in Access-Control-Allow-Headers, disabling');
      }

      return supported;
    } catch {
      // 如果 OPTIONS 请求失败（可能是同源请求），假设支持
      console.log('[PodRuntime] Could not detect CORS headers, assuming X-Request-ID is supported');
      return true;
    }
  }

  /**
   * 创建包装的 fetch 函数，自动添加 X-Request-ID header
   */
  private createWrappedFetch(): typeof fetch {
    const originalFetch = this.session.fetch;
    const self = this;

    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      // 如果不支持 X-Request-ID，直接使用原始 fetch
      if (!self.requestIdSupported) {
        return originalFetch(input, init);
      }

      const requestId = generateRequestId();
      const headers = new Headers(init?.headers);

      if (!headers.has('X-Request-ID')) {
        headers.set('X-Request-ID', requestId);
      }

      return originalFetch(input, {
        ...init,
        headers,
      });
    };
  }

  getSession(): SolidAuthSession {
    return this.session;
  }

  /**
   * 获取 fetch 函数（如果服务器支持，会自动添加 X-Request-ID）
   */
  getFetch(): typeof fetch {
    if (!this.wrappedFetch) {
      this.wrappedFetch = this.createWrappedFetch();
    }
    return this.wrappedFetch;
  }

  getWebId(): string {
    return this.webId;
  }

  getPodUrl(): string {
    return this.podUrl;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    try {
      console.log(`Connecting to Solid Pod: ${this.podUrl}`);
      console.log(`Using WebID: ${this.webId}`);

      // 检测是否支持 X-Request-ID
      this.requestIdSupported = await this.detectRequestIdSupport();

      // 重新创建 wrappedFetch（现在知道是否支持了）
      this.wrappedFetch = this.createWrappedFetch();

      // Probe pod root with HEAD
      const response = await this.wrappedFetch(this.podUrl, {
        method: 'HEAD',
      });

      const status = response.status;
      if (status === 500) {
        const requestId = this.requestIdSupported
          ? (response.headers.get('X-Request-ID') || 'unknown')
          : 'disabled';
        console.error(`Pod probe failed, X-Request-ID: ${requestId}`);
        throw new Error(`Failed to connect to Pod: ${status} ${response.statusText}`);
      }
      if (response.ok) {
        console.log('Successfully connected to Solid Pod');
      } else if (status === 401 || status === 403) {
        console.warn(`Pod root returned ${status}, continuing (child resources may still be writable)`);
      } else {
        console.warn(`Pod root returned ${status}, continuing (child resources may still be writable)`);
      }

      this.connected = true;
    } catch (error) {
      console.error('Failed to connect to Pod:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    console.log('Disconnected from Solid Pod');
  }
}
