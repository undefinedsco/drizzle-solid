/**
 * Federated Query Executor
 * 
 * 执行跨 Pod 的联邦查询
 */

import type { SolidSchema, PodTable, RelationDefinition, DiscoverFunction } from '../pod-table';
import { ProviderCache, type WellKnownResponse } from '../discovery/provider-cache';
import type { 
  FederatedResult, 
  FederatedError, 
  FederatedQueryOptions,
  DiscoveredLocation,
  FederatedQueryContext 
} from './types';

/**
 * 联邦查询执行器
 */
export class FederatedQueryExecutor {
  private providerCache: ProviderCache;
  private fetchFn: typeof fetch;
  private defaultTimeout: number;

  constructor(options?: {
    providerCache?: ProviderCache;
    fetch?: typeof fetch;
    timeout?: number;
  }) {
    this.providerCache = options?.providerCache ?? new ProviderCache();
    this.fetchFn = options?.fetch ?? fetch;
    this.defaultTimeout = options?.timeout ?? 30000;
  }

  /**
   * 执行联邦查询
   * 
   * @param parentRows 父表的查询结果
   * @param relationDef 关系定义
   * @param options 查询选项
   */
  async execute<T extends Record<string, unknown>>(
    parentRows: T[],
    relationDef: RelationDefinition,
    options?: FederatedQueryOptions
  ): Promise<FederatedResult<T[]>> {
    const errors: FederatedError[] = [];
    const resultRows = [...parentRows];

    if (!relationDef.isFederated || !relationDef.discover) {
      return { data: resultRows };
    }

    const targetSchema = relationDef.table as SolidSchema<any>;
    const discoverFn = relationDef.discover;
    const relationName = relationDef.relationName ?? 'items';
    const targetType = targetSchema.type;

    // 收集所有需要发现的 WebID
    const discoveryTasks: Array<{
      index: number;
      webIds: string[];
    }> = [];

    for (let i = 0; i < parentRows.length; i++) {
      const row = parentRows[i];
      const webIdResult = discoverFn(row);
      
      if (!webIdResult) {
        (resultRows[i] as any)[relationName] = [];
        continue;
      }

      const webIds = Array.isArray(webIdResult) ? webIdResult : [webIdResult];
      const validWebIds = webIds.filter(
        (id): id is string => typeof id === 'string' && id.length > 0
      );

      if (validWebIds.length === 0) {
        (resultRows[i] as any)[relationName] = [];
        continue;
      }

      discoveryTasks.push({ index: i, webIds: validWebIds });
    }

    // 并行发现和查询
    const parallel = options?.parallel ?? true;
    const maxConcurrency = options?.maxConcurrency ?? 5;

    if (parallel) {
      await this.executeParallel(
        resultRows,
        discoveryTasks,
        targetType,
        relationName,
        errors,
        maxConcurrency,
        options?.timeout ?? this.defaultTimeout
      );
    } else {
      await this.executeSequential(
        resultRows,
        discoveryTasks,
        targetType,
        relationName,
        errors,
        options?.timeout ?? this.defaultTimeout
      );
    }

    return {
      data: resultRows,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * 并行执行发现和查询
   */
  private async executeParallel<T extends Record<string, unknown>>(
    resultRows: T[],
    tasks: Array<{ index: number; webIds: string[] }>,
    targetType: string,
    relationName: string,
    errors: FederatedError[],
    maxConcurrency: number,
    timeout: number
  ): Promise<void> {
    // 按 maxConcurrency 分批处理
    for (let i = 0; i < tasks.length; i += maxConcurrency) {
      const batch = tasks.slice(i, i + maxConcurrency);
      
      await Promise.all(
        batch.map(async (task) => {
          try {
            const results = await this.discoverAndQuery(
              task.webIds,
              targetType,
              timeout
            );
            (resultRows[task.index] as any)[relationName] = results;
          } catch (error) {
            (resultRows[task.index] as any)[relationName] = [];
            errors.push(this.createError(
              [task.index, relationName],
              error,
              task.webIds[0]
            ));
          }
        })
      );
    }
  }

  /**
   * 顺序执行发现和查询
   */
  private async executeSequential<T extends Record<string, unknown>>(
    resultRows: T[],
    tasks: Array<{ index: number; webIds: string[] }>,
    targetType: string,
    relationName: string,
    errors: FederatedError[],
    timeout: number
  ): Promise<void> {
    for (const task of tasks) {
      try {
        const results = await this.discoverAndQuery(
          task.webIds,
          targetType,
          timeout
        );
        (resultRows[task.index] as any)[relationName] = results;
      } catch (error) {
        (resultRows[task.index] as any)[relationName] = [];
        errors.push(this.createError(
          [task.index, relationName],
          error,
          task.webIds[0]
        ));
      }
    }
  }

  /**
   * 发现并查询数据
   */
  private async discoverAndQuery(
    webIds: string[],
    targetType: string,
    timeout: number
  ): Promise<Record<string, unknown>[]> {
    const allResults: Record<string, unknown>[] = [];

    for (const webId of webIds) {
      // 从 WebID 提取 Pod URL
      const podUrl = this.extractPodUrl(webId);
      if (!podUrl) continue;

      // 获取 .well-known 信息
      const wellKnown = await this.providerCache.getWellKnown(podUrl);

      // 发现数据位置
      const containerUrl = await this.discoverContainer(
        podUrl,
        wellKnown,
        targetType
      );

      if (!containerUrl) continue;

      // 查询数据
      const results = await this.queryContainer(containerUrl, targetType, timeout);
      allResults.push(...results);
    }

    return allResults;
  }

  /**
   * 从 WebID 提取 Pod URL
   */
  private extractPodUrl(webId: string): string | null {
    try {
      const url = new URL(webId);
      // 通常 WebID 是 https://pod.example/profile/card#me
      // Pod URL 是 https://pod.example/
      return `${url.protocol}//${url.host}/`;
    } catch {
      return null;
    }
  }

  /**
   * 发现数据容器位置
   */
  private async discoverContainer(
    podUrl: string,
    wellKnown: WellKnownResponse,
    targetType: string
  ): Promise<string | null> {
    // SAI 优先
    if (wellKnown.registrySet) {
      const container = await this.discoverFromSAI(
        wellKnown.registrySet,
        targetType
      );
      if (container) return container;
    }

    // TypeIndex 兜底
    if (wellKnown.typeIndex) {
      const container = await this.discoverFromTypeIndex(
        wellKnown.typeIndex,
        targetType
      );
      if (container) return container;
    }

    return null;
  }

  /**
   * 从 SAI Registry 发现数据位置
   * 
   * 简化版本：直接解析 RegistrySet -> DataRegistry -> DataRegistration
   */
  private async discoverFromSAI(
    registrySetUrl: string,
    targetType: string
  ): Promise<string | null> {
    try {
      // 1. 获取 RegistrySet
      const registrySetResponse = await this.fetchFn(registrySetUrl, {
        headers: { Accept: 'text/turtle' },
      });
      if (!registrySetResponse.ok) return null;
      
      const registrySetText = await registrySetResponse.text();
      
      // 查找 hasDataRegistry
      const dataRegistryMatch = registrySetText.match(
        /hasDataRegistry>\s*<([^>]+)>/
      );
      if (!dataRegistryMatch) return null;
      
      const dataRegistryUrl = this.resolveUrl(dataRegistryMatch[1], registrySetUrl);
      
      // 2. 获取 DataRegistry
      const dataRegistryResponse = await this.fetchFn(dataRegistryUrl, {
        headers: { Accept: 'text/turtle' },
      });
      if (!dataRegistryResponse.ok) return null;
      
      const dataRegistryText = await dataRegistryResponse.text();
      
      // 查找所有 hasDataRegistration
      const registrationMatches = dataRegistryText.matchAll(
        /hasDataRegistration>\s*<([^>]+)>/g
      );
      
      for (const match of registrationMatches) {
        const registrationUrl = this.resolveUrl(match[1], dataRegistryUrl);
        
        // 3. 获取 DataRegistration
        const registrationResponse = await this.fetchFn(registrationUrl, {
          headers: { Accept: 'text/turtle' },
        });
        if (!registrationResponse.ok) continue;
        
        const registrationText = await registrationResponse.text();
        
        // 查找 registeredShapeTree
        const shapeTreeMatch = registrationText.match(
          /registeredShapeTree>\s*<([^>]+)>/
        );
        if (!shapeTreeMatch) continue;
        
        const shapeTreeUrl = this.resolveUrl(shapeTreeMatch[1], registrationUrl);
        
        // 4. 检查 ShapeTree 的 expectsType
        const shapeTreeResponse = await this.fetchFn(shapeTreeUrl, {
          headers: { Accept: 'text/turtle' },
        });
        if (!shapeTreeResponse.ok) continue;
        
        const shapeTreeText = await shapeTreeResponse.text();
        
        // 检查 expectsType 是否匹配
        if (shapeTreeText.includes(targetType)) {
          // 找到匹配的 registration，返回其 URL 作为容器
          return registrationUrl.endsWith('/') ? registrationUrl : registrationUrl + '/';
        }
      }
      
      return null;
    } catch {
      return null;
    }
  }

  /**
   * 解析相对 URL
   */
  private resolveUrl(url: string, baseUrl: string): string {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    return new URL(url, baseUrl).toString();
  }

  /**
   * 从 TypeIndex 发现数据位置
   */
  private async discoverFromTypeIndex(
    typeIndexUrl: string,
    targetType: string
  ): Promise<string | null> {
    try {
      const response = await this.fetchFn(typeIndexUrl, {
        headers: { Accept: 'text/turtle' },
      });

      if (!response.ok) return null;

      const text = await response.text();
      
      // 简单解析 TypeIndex
      // 查找 solid:forClass <targetType> 的注册
      // 返回对应的 solid:instance 或 solid:instanceContainer
      const lines = text.split(/\s*[;.]\s*|\n/).map(l => l.trim()).filter(Boolean);
      
      let inMatchingRegistration = false;
      let instanceUrl: string | null = null;
      
      for (const line of lines) {
        if (line.includes('forClass') && line.includes(targetType)) {
          inMatchingRegistration = true;
        }
        
        if (inMatchingRegistration) {
          if (line.includes('instance') && !line.includes('instanceContainer')) {
            const match = line.match(/<([^>]+)>/);
            if (match) {
              instanceUrl = match[1];
              break;
            }
          }
          if (line.includes('instanceContainer')) {
            const match = line.match(/<([^>]+)>/);
            if (match) {
              instanceUrl = match[1];
              break;
            }
          }
        }
      }

      return instanceUrl;
    } catch {
      return null;
    }
  }

  /**
   * 查询容器中的数据
   * 
   * 使用 LDP 获取容器内容并解析
   */
  private async queryContainer(
    containerUrl: string,
    targetType: string,
    timeout: number
  ): Promise<Record<string, unknown>[]> {
    try {
      // 创建带超时的请求
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await this.fetchFn(containerUrl, {
        headers: { Accept: 'text/turtle' },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error(`403 Forbidden: ${containerUrl}`);
        }
        if (response.status === 404) {
          throw new Error(`404 Not Found: ${containerUrl}`);
        }
        return [];
      }

      const text = await response.text();
      
      // 解析 Turtle 并提取匹配类型的资源
      return this.parseTurtleResources(text, containerUrl, targetType);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Timeout: ${containerUrl}`);
      }
      throw error;
    }
  }

  /**
   * 解析 Turtle 内容，提取匹配类型的资源
   */
  private parseTurtleResources(
    turtle: string,
    baseUrl: string,
    targetType: string
  ): Record<string, unknown>[] {
    const resources: Record<string, unknown>[] = [];
    
    // 简单的 Turtle 解析：按主语分组
    // 格式: <subject> <predicate> <object> .
    // 或者使用 prefix 和 blank nodes
    
    // 提取前缀定义
    const prefixes: Record<string, string> = {};
    const prefixPattern = /@prefix\s+(\w+):\s*<([^>]+)>\s*\./g;
    let match;
    while ((match = prefixPattern.exec(turtle)) !== null) {
      prefixes[match[1]] = match[2];
    }
    
    // 查找所有声明为 targetType 的主语
    // 匹配 <subject> a <type> 或 <subject> rdf:type <type>
    const typePattern = new RegExp(
      `<([^>]+)>\\s+(?:a|rdf:type|<http://www\\.w3\\.org/1999/02/22-rdf-syntax-ns#type>)\\s+<${this.escapeRegex(targetType)}>`,
      'g'
    );
    
    const subjectsOfType: string[] = [];
    while ((match = typePattern.exec(turtle)) !== null) {
      subjectsOfType.push(match[1]);
    }
    
    // 对每个主语，提取所有属性
    for (const subject of subjectsOfType) {
      const resource = this.extractResourceProperties(turtle, subject, prefixes, baseUrl);
      if (resource) {
        resources.push(resource);
      }
    }
    
    return resources;
  }

  /**
   * 从 Turtle 中提取特定主语的所有属性
   */
  private extractResourceProperties(
    turtle: string,
    subject: string,
    prefixes: Record<string, string>,
    baseUrl: string
  ): Record<string, unknown> | null {
    const resource: Record<string, unknown> = {
      '@id': subject,
      id: this.extractIdFromUri(subject),
    };
    
    // 简单匹配：<subject> <predicate> <object/literal> 
    const escapedSubject = this.escapeRegex(subject);
    
    // 匹配 URI 对象
    const uriPattern = new RegExp(
      `<${escapedSubject}>\\s+<([^>]+)>\\s+<([^>]+)>`,
      'g'
    );
    
    let match;
    while ((match = uriPattern.exec(turtle)) !== null) {
      const predicate = match[1];
      const object = match[2];
      const propName = this.extractLocalName(predicate);
      
      // 跳过 rdf:type
      if (predicate.includes('22-rdf-syntax-ns#type')) continue;
      
      resource[propName] = object;
    }
    
    // 匹配字符串字面量
    const literalPattern = new RegExp(
      `<${escapedSubject}>\\s+<([^>]+)>\\s+"([^"]*)"`,
      'g'
    );
    
    while ((match = literalPattern.exec(turtle)) !== null) {
      const predicate = match[1];
      const value = match[2];
      const propName = this.extractLocalName(predicate);
      resource[propName] = value;
    }
    
    return resource;
  }

  /**
   * 从 URI 提取 ID
   */
  private extractIdFromUri(uri: string): string {
    // 处理 fragment
    if (uri.includes('#')) {
      return uri.split('#').pop() ?? uri;
    }
    // 处理路径
    const parts = uri.split('/');
    const last = parts.pop() ?? '';
    // 去掉扩展名
    return last.replace(/\.[^.]+$/, '');
  }

  /**
   * 从 URI 提取本地名称（作为属性名）
   */
  private extractLocalName(uri: string): string {
    if (uri.includes('#')) {
      return uri.split('#').pop() ?? uri;
    }
    return uri.split('/').pop() ?? uri;
  }

  /**
   * 转义正则表达式特殊字符
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 创建错误对象
   */
  private createError(
    path: (string | number)[],
    error: unknown,
    url?: string
  ): FederatedError {
    const message = error instanceof Error ? error.message : String(error);
    
    let code: FederatedError['code'] = 'NETWORK_ERROR';
    
    if (message.includes('403') || message.includes('Forbidden')) {
      code = 'FORBIDDEN';
    } else if (message.includes('404') || message.includes('Not Found')) {
      code = 'NOT_FOUND';
    } else if (message.includes('timeout') || message.includes('Timeout')) {
      code = 'TIMEOUT';
    } else if (message.includes('discover')) {
      code = 'DISCOVERY_FAILED';
    }

    return {
      path,
      code,
      message,
      url,
    };
  }
}

// 默认实例
export const federatedQueryExecutor = new FederatedQueryExecutor();
