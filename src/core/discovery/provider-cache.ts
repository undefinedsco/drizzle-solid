/**
 * Provider Cache
 * 
 * 缓存 Pod 供应商的 .well-known/solid 响应
 * 同一供应商的用户共享缓存，减少重复请求
 */

/**
 * .well-known/solid 响应内容
 */
export interface WellKnownResponse {
  /** 公开 TypeIndex 位置 */
  typeIndex?: string;
  
  /** 私有 TypeIndex 位置 */
  privateTypeIndex?: string;
  
  /** SAI Registry Set 位置 */
  registrySet?: string;
  
  /** OIDC Issuer */
  oidcIssuer?: string;
  
  /** 原始响应（保留未来扩展字段） */
  raw?: Record<string, string>;
}

/**
 * 缓存的供应商模式（存储相对路径）
 */
interface CachedPattern {
  /** 相对路径映射 */
  paths: {
    typeIndex?: string;
    privateTypeIndex?: string;
    registrySet?: string;
    oidcIssuer?: string;
    [key: string]: string | undefined;
  };
  
  /** 过期时间 */
  expiresAt: number;
}

/**
 * Solid 命名空间 URI
 */
const SOLID = {
  typeIndex: 'http://www.w3.org/ns/solid/terms#publicTypeIndex',
  privateTypeIndex: 'http://www.w3.org/ns/solid/terms#privateTypeIndex',
  oidcIssuer: 'http://www.w3.org/ns/solid/terms#oidcIssuer',
};

const INTEROP = {
  hasRegistrySet: 'http://www.w3.org/ns/solid/interop#hasRegistrySet',
};

export class ProviderCache {
  private cache = new Map<string, CachedPattern>();
  private ttl: number;
  private fetchFn: typeof fetch;

  constructor(options?: { ttl?: number; fetch?: typeof fetch }) {
    this.ttl = options?.ttl ?? 24 * 60 * 60 * 1000; // 默认 24 小时
    this.fetchFn = options?.fetch ?? fetch;
  }

  /**
   * 获取 Pod 的 .well-known 信息
   * 优先使用缓存
   */
  async getWellKnown(podUrl: string): Promise<WellKnownResponse> {
    const provider = this.extractProvider(podUrl);
    const cached = this.cache.get(provider);

    if (cached && Date.now() < cached.expiresAt) {
      // 命中缓存，将相对路径应用到当前 Pod
      return this.applyToPod(cached.paths, podUrl);
    }

    // 请求并缓存
    const response = await this.fetchWellKnown(podUrl);
    const paths = this.extractPaths(response, podUrl);
    
    this.cache.set(provider, {
      paths,
      expiresAt: Date.now() + this.ttl,
    });

    return response;
  }

  /**
   * 发现指定类型的数据位置
   * SAI 优先，TypeIndex 兜底
   */
  async discover(
    podUrl: string,
    type: string,
    discoverFromSAI: (registrySet: string, type: string) => Promise<string | null>,
    discoverFromTypeIndex: (typeIndex: string, type: string) => Promise<string | null>
  ): Promise<string | null> {
    const wellKnown = await this.getWellKnown(podUrl);

    // SAI 优先
    if (wellKnown.registrySet) {
      const result = await discoverFromSAI(wellKnown.registrySet, type);
      if (result) return result;
    }

    // TypeIndex 兜底
    if (wellKnown.typeIndex) {
      return discoverFromTypeIndex(wellKnown.typeIndex, type);
    }

    return null;
  }

  /**
   * 设置 TTL
   */
  setTTL(ms: number): void {
    this.ttl = ms;
  }

  /**
   * 清除缓存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 清除指定供应商的缓存
   */
  clearProvider(provider: string): void {
    this.cache.delete(provider);
  }

  /**
   * 从 Pod URL 提取供应商标识
   * https://bob.solidcommunity.net/ → solidcommunity.net
   * https://alice.inrupt.net/ → inrupt.net
   */
  private extractProvider(podUrl: string): string {
    const host = new URL(podUrl).host;
    const parts = host.split('.');
    
    // 取最后两段作为供应商标识
    // bob.solidcommunity.net → solidcommunity.net
    // pod.inrupt.com → inrupt.com
    if (parts.length >= 2) {
      return parts.slice(-2).join('.');
    }
    
    return host;
  }

  /**
   * 请求 .well-known/solid
   */
  private async fetchWellKnown(podUrl: string): Promise<WellKnownResponse> {
    const normalizedPodUrl = podUrl.endsWith('/') ? podUrl : `${podUrl}/`;
    const wellKnownUrl = `${normalizedPodUrl}.well-known/solid`;

    try {
      const response = await this.fetchFn(wellKnownUrl, {
        headers: {
          Accept: 'text/turtle, application/ld+json',
        },
      });

      if (!response.ok) {
        // .well-known 不存在，返回空
        return {};
      }

      const contentType = response.headers.get('content-type') || '';
      const text = await response.text();

      if (contentType.includes('turtle') || contentType.includes('n3')) {
        return this.parseTurtle(text, normalizedPodUrl);
      } else if (contentType.includes('json')) {
        return this.parseJsonLd(text);
      }

      // 尝试作为 Turtle 解析
      return this.parseTurtle(text, normalizedPodUrl);
    } catch {
      // 网络错误等，返回空
      return {};
    }
  }

  /**
   * 解析 Turtle 格式的 .well-known/solid
   */
  private parseTurtle(text: string, podUrl: string): WellKnownResponse {
    const result: WellKnownResponse = { raw: {} };

    // 简单的正则解析（不用完整的 RDF 解析器）
    // 按语句分隔符拆分: ; (同主语续写) 或 . (语句结束) 或换行
    // 注意：只匹配行末的 . 作为语句结束符，避免匹配 .ttl 中的 .
    const lines = text.split(/\s*;\s*|\s*\.\s*(?=\n|$)|\n/).map(l => l.trim()).filter(Boolean);

    for (const line of lines) {
      // 匹配 solid:publicTypeIndex <url>
      if (line.includes('publicTypeIndex') || line.includes(SOLID.typeIndex)) {
        const url = this.extractUrl(line);
        if (url) result.typeIndex = this.resolveUrl(url, podUrl);
      }
      
      // 匹配 solid:privateTypeIndex <url>
      if (line.includes('privateTypeIndex') || line.includes(SOLID.privateTypeIndex)) {
        const url = this.extractUrl(line);
        if (url) result.privateTypeIndex = this.resolveUrl(url, podUrl);
      }
      
      // 匹配 interop:hasRegistrySet <url>
      if (line.includes('hasRegistrySet') || line.includes(INTEROP.hasRegistrySet)) {
        const url = this.extractUrl(line);
        if (url) result.registrySet = this.resolveUrl(url, podUrl);
      }
      
      // 匹配 solid:oidcIssuer <url>
      if (line.includes('oidcIssuer') || line.includes(SOLID.oidcIssuer)) {
        const url = this.extractUrl(line);
        if (url) result.oidcIssuer = this.resolveUrl(url, podUrl);
      }
    }

    return result;
  }

  /**
   * 从行中提取 URL
   */
  private extractUrl(line: string): string | null {
    // 匹配 <url> 格式
    const angleMatch = line.match(/<([^>]+)>/g);
    if (angleMatch && angleMatch.length > 0) {
      // 取最后一个（object 位置）
      const last = angleMatch[angleMatch.length - 1];
      return last.slice(1, -1);
    }
    return null;
  }

  /**
   * 解析 JSON-LD 格式
   */
  private parseJsonLd(text: string): WellKnownResponse {
    try {
      const json = JSON.parse(text);
      const result: WellKnownResponse = { raw: {} };

      // 处理 @graph 数组或单个对象
      const items = json['@graph'] || [json];
      
      for (const item of items) {
        if (item[SOLID.typeIndex] || item['solid:publicTypeIndex']) {
          result.typeIndex = this.extractJsonLdValue(item[SOLID.typeIndex] || item['solid:publicTypeIndex']);
        }
        if (item[SOLID.privateTypeIndex] || item['solid:privateTypeIndex']) {
          result.privateTypeIndex = this.extractJsonLdValue(item[SOLID.privateTypeIndex] || item['solid:privateTypeIndex']);
        }
        if (item[INTEROP.hasRegistrySet] || item['interop:hasRegistrySet']) {
          result.registrySet = this.extractJsonLdValue(item[INTEROP.hasRegistrySet] || item['interop:hasRegistrySet']);
        }
        if (item[SOLID.oidcIssuer] || item['solid:oidcIssuer']) {
          result.oidcIssuer = this.extractJsonLdValue(item[SOLID.oidcIssuer] || item['solid:oidcIssuer']);
        }
      }

      return result;
    } catch {
      return {};
    }
  }

  /**
   * 从 JSON-LD 值中提取 URL
   */
  private extractJsonLdValue(value: unknown): string | undefined {
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value !== null) {
      return (value as Record<string, unknown>)['@id'] as string | undefined;
    }
    return undefined;
  }

  /**
   * 解析 URL（处理相对路径）
   */
  private resolveUrl(url: string, baseUrl: string): string {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    return new URL(url, baseUrl).toString();
  }

  /**
   * 从完整 URL 提取相对路径
   */
  private extractPaths(
    response: WellKnownResponse,
    podUrl: string
  ): CachedPattern['paths'] {
    const normalizedPodUrl = podUrl.endsWith('/') ? podUrl : `${podUrl}/`;
    const paths: CachedPattern['paths'] = {};

    if (response.typeIndex) {
      paths.typeIndex = this.toRelativePath(response.typeIndex, normalizedPodUrl);
    }
    if (response.privateTypeIndex) {
      paths.privateTypeIndex = this.toRelativePath(response.privateTypeIndex, normalizedPodUrl);
    }
    if (response.registrySet) {
      paths.registrySet = this.toRelativePath(response.registrySet, normalizedPodUrl);
    }
    if (response.oidcIssuer) {
      // oidcIssuer 通常是外部 URL，保持完整
      paths.oidcIssuer = response.oidcIssuer;
    }

    return paths;
  }

  /**
   * 将完整 URL 转换为相对路径
   */
  private toRelativePath(url: string, podUrl: string): string {
    if (url.startsWith(podUrl)) {
      return url.slice(podUrl.length - 1); // 保留开头的 /
    }
    // 外部 URL，保持完整
    return url;
  }

  /**
   * 将缓存的相对路径应用到指定 Pod
   */
  private applyToPod(
    paths: CachedPattern['paths'],
    podUrl: string
  ): WellKnownResponse {
    const normalizedPodUrl = podUrl.endsWith('/') ? podUrl : `${podUrl}/`;
    const response: WellKnownResponse = {};

    if (paths.typeIndex) {
      response.typeIndex = this.toAbsoluteUrl(paths.typeIndex, normalizedPodUrl);
    }
    if (paths.privateTypeIndex) {
      response.privateTypeIndex = this.toAbsoluteUrl(paths.privateTypeIndex, normalizedPodUrl);
    }
    if (paths.registrySet) {
      response.registrySet = this.toAbsoluteUrl(paths.registrySet, normalizedPodUrl);
    }
    if (paths.oidcIssuer) {
      response.oidcIssuer = paths.oidcIssuer; // 保持原样
    }

    return response;
  }

  /**
   * 将相对路径转换为完整 URL
   */
  private toAbsoluteUrl(path: string, podUrl: string): string {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }
    if (path.startsWith('/')) {
      return `${podUrl.slice(0, -1)}${path}`;
    }
    return `${podUrl}${path}`;
  }
}

// 默认实例
