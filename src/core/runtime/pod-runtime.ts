import { resolvePodBase } from '../utils/pod-root';
import { webIdResolver } from '../../utils/webid-resolver';
import type { SolidAuthSession } from '../pod-dialect';

const REQUEST_ID_DETECTION_TIMEOUT_MS = 3_000;

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
  private storageUrl: string | null = null;  // 缓存的 storage URL
  private storageResolvedAt: number = 0;     // storage 解析时间戳
  private connected = false;
  private wrappedFetch: typeof fetch | null = null;
  private requestIdSupported: boolean | null = null;
  private explicitPodUrl: boolean;

  /** Storage 缓存过期时间，默认 5 分钟 */
  private storageTTL: number = 5 * 60 * 1000;

  constructor(options: { session: SolidAuthSession; webId: string; podUrl?: string; storageTTL?: number }) {
    this.session = options.session;
    this.webId = options.webId;
    this.podUrl = resolvePodBase({ webId: this.webId, podUrl: options.podUrl });
    this.explicitPodUrl = typeof options.podUrl === 'string' && options.podUrl.trim().length > 0;
    if (options.storageTTL !== undefined) {
      this.storageTTL = options.storageTTL;
    }
  }

  /**
   * 检测服务器是否允许 X-Request-ID header (通过 CORS preflight)
   * 使用原生 fetch 发送最干净的 OPTIONS 请求
   */
  private async detectRequestIdSupport(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_ID_DETECTION_TIMEOUT_MS);
    try {
      const response = await globalThis.fetch(this.podUrl, {
        method: 'OPTIONS',
        signal: controller.signal,
      });

      const allowedHeaders = response.headers.get('Access-Control-Allow-Headers') || '';
      const supported = allowedHeaders.toLowerCase().includes('x-request-id');
      return supported;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
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

  /**
   * 获取缓存的 storage URL (从 profile 的 pim:storage 读取)
   * 如果没有显式配置，返回 null
   */
  getStorageUrl(): string | null {
    return this.storageUrl;
  }

  /**
   * 检查 storage 缓存是否过期
   */
  isStorageExpired(): boolean {
    if (!this.storageResolvedAt) return true;
    return Date.now() - this.storageResolvedAt > this.storageTTL;
  }

  /**
   * 获取 Pod URL，如果 storage 缓存过期则自动刷新
   * 用于需要确保最新 storage 的场景
   */
  async getPodUrlWithRefresh(): Promise<string> {
    if (this.isStorageExpired()) {
      await this.refreshStorage();
    }
    return this.podUrl;
  }

  /**
   * 强制刷新 storage URL（从 profile 重新读取）
   * 用于 storage 配置变更后的场景
   */
  async refreshStorage(): Promise<string | null> {
    if (this.explicitPodUrl) {
      this.storageUrl = this.podUrl;
      this.storageResolvedAt = Date.now();
      return this.storageUrl;
    }

    // 清除 webIdResolver 的缓存
    webIdResolver.clearCache();

    const resolvedStorage = await webIdResolver.resolveStorage(this.webId, this.getFetch());
    if (resolvedStorage) {
      this.storageUrl = resolvedStorage;
      this.storageResolvedAt = Date.now();
      if (!this.explicitPodUrl && resolvedStorage !== this.podUrl) {
        console.log(`[PodRuntime] Storage refreshed: ${resolvedStorage}`);
        this.podUrl = resolvedStorage;
      }
    }
    return this.storageUrl;
  }

  setPodUrl(url: string): void {
    // Ensure trailing slash for consistency
    this.podUrl = url.endsWith('/') ? url : `${url}/`;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    try {
      console.log(`Connecting to Solid Pod: ${this.podUrl}`);
      console.log(`Using WebID: ${this.webId}`);

      if (this.explicitPodUrl) {
        this.requestIdSupported = false;
        this.wrappedFetch = this.createWrappedFetch();
        this.storageUrl = this.podUrl;
        this.storageResolvedAt = Date.now();
        this.connected = true;
        console.log('Using explicit Pod URL; skipping Pod root probe');
        return;
      }

      // 检测是否支持 X-Request-ID
      this.requestIdSupported = await this.detectRequestIdSupport();

      // 重新创建 wrappedFetch（现在知道是否支持了）
      this.wrappedFetch = this.createWrappedFetch();

      // 从 profile 解析 storage URL (IdP-SP 分离支持)
      // 使用 webIdResolver 的缓存，避免重复读取 profile
      const resolvedStorage = await webIdResolver.resolveStorage(this.webId, this.wrappedFetch);
      if (resolvedStorage) {
        this.storageUrl = resolvedStorage;
        this.storageResolvedAt = Date.now();
        if (resolvedStorage !== this.podUrl) {
          console.log(`[PodRuntime] IdP-SP separation detected: storage at ${resolvedStorage}`);
          this.podUrl = resolvedStorage;
        }
      }

      // Probe pod root with HEAD
      const response = await this.wrappedFetch(this.podUrl, {
        method: 'HEAD',
      });

      const status = response.status;
      if (status === 500 && !this.explicitPodUrl) {
        const requestId = this.requestIdSupported
          ? (response.headers.get('X-Request-ID') || 'unknown')
          : 'disabled';
        console.error(`Pod probe failed, X-Request-ID: ${requestId}`);
        throw new Error(`Failed to connect to Pod: ${status} ${response.statusText}`);
      }

      if (status === 500 && this.explicitPodUrl) {
        console.warn(`Pod root returned ${status} for explicit Pod URL, continuing (child resources may still be writable)`);
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
