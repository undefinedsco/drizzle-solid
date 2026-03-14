import { entityKind } from 'drizzle-orm';
import { SQL } from 'drizzle-orm';
import { PodColumnBase, PodTable } from './schema';
import { QueryCondition } from './query-conditions';
import { BinaryExpression, LogicalExpression, UnaryExpression } from './expressions';
import { ASTToSPARQLConverter, type SPARQLQuery } from './ast-to-sparql';
import { ComunicaSPARQLExecutor } from './sparql-executor';
import { TypeIndexManager, TypeIndexEntry, TypeIndexConfig, DiscoveredTable } from './typeindex-manager';
import { DataDiscovery } from './discovery';
import type { ExecutionStrategy, ExecutionStrategyFactoryImpl, LdpExecutor } from './execution';
import { PodExecutor } from './execution/pod-executor';
import type { TableResourceDescriptor } from './execution/pod-executor-types';
import { UriResolverImpl } from './uri';
import type { SelectQueryPlan } from './select-plan';
import type { InsertQueryPlan, UpdateQueryPlan, DeleteQueryPlan } from './pod-session';
import { ShapeManager } from './shape';
import { isSameOrigin, getFetchForOrigin } from './utils/origin-auth';
import type { ResourceResolver, ResourceResolverFactoryImpl } from './resource-resolver';
import { PodRuntime } from './runtime/pod-runtime';
import { PodServices } from './services/pod-services';
import { DebugLogger, setGlobalDebugLogger } from './utils/debug-logger';
import type { SPARQLQueryEngineFactory } from './sparql-engine';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasStringValue(value: unknown): value is { value: string } {
  return isRecord(value) && typeof value.value === 'string';
}

// 最小 Solid Session 接口定义
export interface SolidAuthSession {
  info: {
    isLoggedIn: boolean;
    webId?: string;
    sessionId?: string;
    clientId?: string;
    client_id?: string;
  };
  fetch: typeof fetch;
  login?: (options?: Record<string, unknown>) => Promise<void>;
  logout?: () => Promise<void>;
}

import type { ChannelType } from './notifications';

export interface PodDialectConfig {
  session: SolidAuthSession;
  typeIndex?: TypeIndexConfig;
  createQueryEngine?: SPARQLQueryEngineFactory;
  disableInteropDiscovery?: boolean;
  /**
   * 通知通道偏好顺序，默认 ['streaming-http', 'websocket']
   * 会根据服务器支持的通道自动选择第一个匹配的
   */
  preferredChannels?: ChannelType[];
  /**
   * Storage 缓存过期时间（毫秒），默认 5 分钟
   * 用于 IdP-SP 分离场景，控制从 profile 重新读取 pim:storage 的频率
   */
  storageTTL?: number;
  /**
   * 启用 debug 模式，输出查询信息
   */
  debug?: boolean;
}

// Pod 操作类型 - 现在包含 SQL AST 和 JOIN
export interface PodOperation {
  type: 'select' | 'insert' | 'update' | 'delete';
  table: PodTable;
  sql?: SQL; // Drizzle SQL AST
  data?: unknown;
  where?: Record<string, unknown> | QueryCondition;
  select?: Record<string, unknown>;
  values?: unknown | unknown[];
  plan?: SelectQueryPlan | InsertQueryPlan | UpdateQueryPlan | DeleteQueryPlan;
  joins?: Array<{
    type: 'leftJoin' | 'rightJoin' | 'innerJoin' | 'fullJoin' | 'crossJoin';
    table: PodTable;
    condition: unknown;
  }>;
  limit?: number;
  offset?: number;
  orderBy?: Array<{
    column: string;
    direction: 'asc' | 'desc';
  }>;
  distinct?: boolean;
}

export class PodDialect {
  static readonly [entityKind] = 'PodDialect';

  private runtime: PodRuntime;
  private services: PodServices;
  private podUrl: string;
  private webId: string;
  private sparqlConverter: ASTToSPARQLConverter;
  private sparqlExecutor: ComunicaSPARQLExecutor;
  private ldpExecutor: LdpExecutor;
  private strategyFactory: ExecutionStrategyFactoryImpl;
  private executor: PodExecutor;
  private typeIndexManager: TypeIndexManager;
  private discovery: DataDiscovery;
  private shapeManager: ShapeManager;
  private resolverFactory: ResourceResolverFactoryImpl;
  private uriResolver: UriResolverImpl;
  public config: PodDialectConfig;
  private registeredTables: Set<string> = new Set();
  private preparedContainers: Set<string> = new Set();
  private preparedResources: Set<string> = new Set();
  private debugLogger: DebugLogger;

  constructor(config: PodDialectConfig) {
    this.config = config;
    const session = config.session;

    // Initialize debug logger
    this.debugLogger = new DebugLogger(config.debug || false);
    setGlobalDebugLogger(this.debugLogger);

    this.debugLogger.log('Initializing PodDialect with config:', {
      debug: config.debug,
      disableInteropDiscovery: config.disableInteropDiscovery,
      storageTTL: config.storageTTL,
    });

    // 从session中获取webId
    const webId = session.info.webId;
    const clientId = session.info.clientId || session.info.client_id || process.env.SOLID_CLIENT_ID; 

    if (!webId) {
      throw new Error('Session中未找到webId');
    }

    this.runtime = new PodRuntime({
      session,
      webId,
      podUrl: 'podUrl' in config ? (config as PodDialectConfig & { podUrl?: string }).podUrl : undefined,
      storageTTL: config.storageTTL,
    });
    this.webId = this.runtime.getWebId();
    this.podUrl = this.runtime.getPodUrl();

    this.services = new PodServices({
      runtime: this.runtime,
      clientId,
      createQueryEngine: config.createQueryEngine,
      disableInteropDiscovery: config.disableInteropDiscovery,
      listContainerResources: (containerUrl) => this.listContainerResources(containerUrl),
      findSubjectsForCondition: (condition, table, resourceUrl) =>
        this.findSubjectsForCondition(condition, table, resourceUrl),
    });

    this.uriResolver = this.services.getUriResolver();
    this.sparqlConverter = this.services.getSparqlConverter();
    this.sparqlExecutor = this.services.getSparqlExecutor();
    this.ldpExecutor = this.services.getLdpExecutor();
    this.typeIndexManager = this.services.getTypeIndexManager();
    this.discovery = this.services.getDiscovery();
    this.shapeManager = this.services.getShapeManager();
    this.resolverFactory = this.services.getResolverFactory();
    this.strategyFactory = this.services.getStrategyFactory();

    this.executor = new PodExecutor({
      ensureConnected: async () => {
        if (!this.runtime.isConnected()) {
          await this.connect();
        }
      },
      ensureTableResourcePath: (table) => this.ensureTableResourcePath(table),
      resolveTableResource: (table) => this.resolveTableResource(table),
      resolveTableUrls: (table) => this.resolveTableUrls(table),
      normalizeResourceUrl: (resourceUrl) => this.normalizeResourceUrl(resourceUrl),
      normalizeContainerKey: (containerUrl) => this.normalizeContainerKey(containerUrl),
      normalizeResourceKey: (resourceUrl) => this.normalizeResourceKey(resourceUrl),
      ensureContainerExists: (containerUrl) => this.ensureContainerExists(containerUrl),
      ensureResourceExists: (resourceUrl, options) => this.ensureResourceExists(resourceUrl, options),
      ensureIdentifierCondition: (condition, table, resourceUrl) =>
        this.ensureIdentifierCondition(condition, table, resourceUrl),
      resourceExists: (resourceUrl) => this.resourceExists(resourceUrl),
      getStrategy: (table) => this.getStrategy(table),
      getLdpStrategy: () => this.strategyFactory.getLdpStrategy(),
      preparedContainers: this.preparedContainers,
      preparedResources: this.preparedResources,
      sparqlConverter: this.sparqlConverter,
      sparqlExecutor: this.sparqlExecutor,
      isSelectPlan: (plan): plan is SelectQueryPlan => this.isSelectPlan(plan as PodOperation['plan']),
      isInsertPlan: (plan): plan is InsertQueryPlan => this.isInsertPlan(plan as PodOperation['plan']),
      isUpdatePlan: (plan): plan is UpdateQueryPlan => this.isUpdatePlan(plan as PodOperation['plan']),
      isDeletePlan: (plan): plan is DeleteQueryPlan => this.isDeletePlan(plan as PodOperation['plan']),
    });
  }

  /**
   * Get the ResourceResolver for a table
   */
  getResolver(table: PodTable): ResourceResolver {
    return this.resolverFactory.getResolver(table);
  }

  /**
   * Get the ExecutionStrategy for a table
   */
  getStrategy(table: PodTable): ExecutionStrategy {
    return this.strategyFactory.getStrategy(table);
  }

  /**
   * 获取 ShapeManager 实例
   */
  getShapeManager(): ShapeManager {
    return this.services.getShapeManager();
  }

  /**
   * 获取 UriResolver 实例
   */
  getUriResolver(): UriResolverImpl {
    return this.services.getUriResolver();
  }

  /**
   * 获取 DataDiscovery 实例
   */
  getDiscovery(): DataDiscovery {
    return this.services.getDiscovery();
  }

  /**
   * 设置 schema（表注册表）
   * 用于 URI 引用字段的自动补全
   * 
   * 构建两个注册表：
   * - tableRegistry: rdfClass -> tables[]（同一 class 可能对应多个表）
   * - tableNameRegistry: tableName -> table（用于明确指定表名时查找）
   */
  setSchema(schema: Record<string, unknown>): void {
    const tableRegistry = new Map<string, PodTable[]>();
    const tableNameRegistry = new Map<string, PodTable>();
    
    for (const [key, value] of Object.entries(schema)) {
      if (value && typeof value === 'object' && 'config' in value) {
        const table = value as PodTable;
        const rdfClass = table.getType?.() || table.config?.type;
        const tableName = table.config?.name || key;
        
        // 添加到表名注册表
        tableNameRegistry.set(tableName, table);
        
        // 添加到 class 注册表（同一 class 可能对应多个表）
        if (rdfClass) {
          const existing = tableRegistry.get(rdfClass) || [];
          existing.push(table);
          tableRegistry.set(rdfClass, existing);
        }
      }
    }
    
    this.ldpExecutor.setTableRegistry(tableRegistry, tableNameRegistry);
    this.ldpExecutor.setBaseUri(this.podUrl);
    
    // Also set table registry for SPARQL converter (for link URI resolution in queries)
    this.sparqlConverter.setTableRegistry(tableRegistry, tableNameRegistry, this.podUrl);
  }

  private async findSubjectsForCondition(
    condition: QueryCondition,
    table: PodTable,
    resourceUrl: string
  ): Promise<string[]> {
    const plan = this.buildSubjectLookupPlan(table, condition);
    const sparqlQuery = this.sparqlConverter.convertSelectPlan(plan);
    
    const normalizedUrl = this.normalizeResourceUrl(resourceUrl);
    const rows = await this.executeOnResource(normalizedUrl, sparqlQuery);

    return (rows as Array<Record<string, unknown>>)
      .map((row) => this.extractSubjectFromRow(row))
      .filter((value): value is string => Boolean(value));
  }

  async connect(): Promise<void> {
    await this.runtime.connect();
  }

  async disconnect(): Promise<void> {
    await this.runtime.disconnect();
  }

  isConnected(): boolean {
    return this.runtime.isConnected();
  }

  // 从 webId 中提取用户路径
  private extractUserPathFromWebId(): string {
    if (!this.webId) {
      return '';
    }
    
    try {
      const url = new URL(this.webId);
      // 从 webId 中提取路径，例如：
      // http://localhost:3000/alice/profile/card#me -> /alice/
      // http://localhost:3000/bob/profile/card#me -> /bob/
      const pathParts = url.pathname.split('/');
      if (pathParts.length >= 2) {
        const username = pathParts[1]; // 获取用户名部分
        return `/${username}/`;
      }
    } catch (error) {
      console.warn('Failed to parse webId:', this.webId, error);
    }
    
    return '';
  }

  private resolveTableResource(table: PodTable): TableResourceDescriptor {
    const endpointSource = table.getSparqlEndpoint?.();
    if (endpointSource) {
      const endpoint = this.isAbsoluteUrl(endpointSource)
        ? endpointSource
        : this.resolveAbsoluteUrl(endpointSource);
      return { mode: 'sparql', endpoint };
    }

    const { containerUrl, resourceUrl } = this.resolveLdpResource(table);
    return { mode: 'ldp', containerUrl, resourceUrl };
  }

  /**
   * Resolve LDP container/resource URLs for a table.
   * 
   * Always returns the physical LDP storage location, regardless of whether
   * the table has a sparqlEndpoint configured. SPARQL strategy will resolve
   * the endpoint URL separately via table.getSparqlEndpoint().
   */
  private resolveTableUrls(table: PodTable): { containerUrl: string; resourceUrl: string } {
    return this.resolveLdpResource(table);
  }

  private resolveLdpResource(table: PodTable): { containerUrl: string; resourceUrl: string } {
    const configuredResourcePath =
      typeof table.getResourcePath === 'function'
        ? table.getResourcePath()
        : undefined;

    if (configuredResourcePath) {
      const absoluteResource = this.resolveAbsoluteUrl(configuredResourcePath);
      
      // Check if this is a container path (ends with /)
      const isContainer = configuredResourcePath.endsWith('/');
      
      if (isContainer) {
        // Document mode: resourceUrl is the container
        // Actual resource files are determined by subjectTemplate at query time
        const containerUrl = absoluteResource.endsWith('/') ? absoluteResource : `${absoluteResource}/`;
        return {
          containerUrl,
          resourceUrl: containerUrl
        };
      }
      
      // File mode (Fragment mode or explicit file path): derive container from resource path
      const normalizedResource = this.normalizeResourceUrl(absoluteResource);
      const lastSlash = normalizedResource.lastIndexOf('/');
      const containerUrl =
        lastSlash >= 0 ? `${normalizedResource.slice(0, lastSlash + 1)}` : `${normalizedResource}/`;

      return {
        containerUrl,
        resourceUrl: normalizedResource
      };
    }

    const configuredPath = table.getContainerPath() || '/data/';
    const isAbsolute = configuredPath.startsWith('http://') || configuredPath.startsWith('https://');
    const ensureTrailingSlash = (value: string): string => (value.endsWith('/') ? value : `${value}/`);

    if (isAbsolute) {
      if (configuredPath.endsWith('/')) {
        const containerUrl = ensureTrailingSlash(configuredPath);
        return {
          containerUrl,
          resourceUrl: `${containerUrl}${table.config.name}.ttl`
        };
      }

      const normalizedResource = configuredPath;
      const lastSlash = normalizedResource.lastIndexOf('/');
      if (lastSlash === -1) {
        throw new Error(`Invalid containerPath for table ${table.config.name}: ${configuredPath}`);
      }
      const containerUrl = ensureTrailingSlash(normalizedResource.slice(0, lastSlash + 1));
      return {
        containerUrl,
        resourceUrl: normalizedResource
      };
    }

    const userPath = this.extractUserPathFromWebId();
    const trimmedPath = configuredPath.replace(/^\/+/, '');
    const baseUrl = this.podUrl.endsWith('/') ? this.podUrl : `${this.podUrl}/`;
    const userPrefix = userPath.replace(/^\/+/, '');
    const trimHasUserPrefix = userPrefix && trimmedPath.startsWith(userPrefix);

    if (configuredPath.endsWith('/')) {
      const relativeContainer = trimHasUserPrefix ? trimmedPath : `${userPrefix}${trimmedPath}`;
      const containerUrl = ensureTrailingSlash(`${baseUrl}${relativeContainer.replace(/^\/+/, '')}`);
      return {
        containerUrl,
        resourceUrl: `${containerUrl}${table.config.name}.ttl`
      };
    }

    const resourceRelative = trimHasUserPrefix ? trimmedPath : `${userPrefix}${trimmedPath}`;
    const lastSlash = resourceRelative.lastIndexOf('/');
    const containerRelative = lastSlash >= 0 ? resourceRelative.slice(0, lastSlash + 1) : userPrefix;

    const containerUrl = ensureTrailingSlash(`${baseUrl}${containerRelative.replace(/^\/+/, '')}`);
    const resourceUrl = `${baseUrl}${resourceRelative.replace(/^\/+/, '')}`;

    return { containerUrl, resourceUrl };
  }

  private async resourceExists(resourceUrl: string): Promise<boolean> {
    const normalizedUrl = this.normalizeResourceUrl(resourceUrl);
    if (this.preparedResources.has(normalizedUrl)) {
      return true;
    }
    try {
      const response = await this.runtime.getFetch()(normalizedUrl, { method: 'HEAD' });

      if (response.ok || response.status === 409) {
        this.markResourcePrepared(normalizedUrl);
        return true;
      }

      if (response.status === 404) {
        return false;
      }

      if (response.status === 405) {
        const getResponse = await this.runtime.getFetch()(normalizedUrl, {
          method: 'GET',
          headers: { 'Accept': 'text/turtle' }
        });
        if (getResponse.ok) {
          this.markResourcePrepared(normalizedUrl);
          return true;
        }
        return false;
      }

      if (response.status === 401 || response.status === 403) {
        // 无法验证是否存在，假定存在以避免破坏流程
        this.markResourcePrepared(normalizedUrl);
        return true;
      }

      return response.ok;
    } catch (error) {
      console.warn('[PodDialect] Failed to check resource existence via HEAD, falling back to GET', error);
      try {
        const getResponse = await this.runtime.getFetch()(normalizedUrl, {
          method: 'GET',
          headers: { 'Accept': 'text/turtle' }
        });
        if (getResponse.ok) {
          this.markResourcePrepared(normalizedUrl);
          return true;
        }
        return false;
      } catch (fallbackError) {
        console.warn('[PodDialect] Resource existence fallback GET failed', fallbackError);
        return false;
      }
    }
  }

  private normalizeResourceUrl(resourceUrl: string): string {
    if (!resourceUrl) {
      return resourceUrl;
    }

    let normalized = resourceUrl;
    while (normalized.endsWith('/') && !normalized.endsWith('://')) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  }

  private normalizeContainerKey(containerUrl: string): string {
    const absoluteContainer = containerUrl.startsWith('http')
      ? containerUrl
      : this.resolveAbsoluteUrl(containerUrl);
    return absoluteContainer.endsWith('/') ? absoluteContainer : `${absoluteContainer}/`;
  }

  private normalizeResourceKey(resourceUrl: string): string {
    const absoluteResource = resourceUrl.startsWith('http')
      ? resourceUrl
      : this.resolveAbsoluteUrl(resourceUrl);
    return this.normalizeResourceUrl(absoluteResource);
  }

  private markContainerPrepared(containerUrl: string): void {
    this.preparedContainers.add(this.normalizeContainerKey(containerUrl));
  }

  private markResourcePrepared(resourceUrl: string): void {
    this.preparedResources.add(this.normalizeResourceKey(resourceUrl));
  }

  private isAbsoluteUrl(value: string): boolean {
    return /^https?:\/\//i.test(value);
  }

  private resolveAbsoluteUrl(path: string): string {
    if (!path) {
      return this.podUrl.replace(/\/$/, '');
    }

    if (this.isAbsoluteUrl(path)) {
      return path;
    }

    const sanitizedPath = path.replace(/^(\.\/)+/, '');
    const base = this.podUrl.endsWith('/') ? this.podUrl : `${this.podUrl}/`;
    const hasTrailingSlash = sanitizedPath.endsWith('/');

    const rawUserPath = this.extractUserPathFromWebId();
    const normalizedUser = rawUserPath.replace(/^\/+|\/+$/g, '');
    const trimmedPath = sanitizedPath.replace(/^\/+/, '');

    let relativePath = trimmedPath;
    const userPrefixWithSlash = normalizedUser.length > 0 ? `${normalizedUser}/` : '';

    if (normalizedUser.length > 0) {
      let podPathHasUser = false;
      try {
        const podPath = new URL(base).pathname.replace(/^\/+|\/+$/g, '');
        podPathHasUser = podPath.startsWith(normalizedUser);
      } catch {
        podPathHasUser = false;
      }

      const needsUserPrefix =
        (!podPathHasUser) &&
        (relativePath.length === 0 ||
          (relativePath !== normalizedUser && !relativePath.startsWith(userPrefixWithSlash)));

      if (needsUserPrefix) {
        relativePath = relativePath.length > 0
          ? `${normalizedUser}/${relativePath}`
          : normalizedUser;
      }
    }

    if (hasTrailingSlash && !relativePath.endsWith('/')) {
      relativePath = `${relativePath}/`;
    }

    const absolute = new URL(relativePath, base).toString();

    if (!hasTrailingSlash && absolute.endsWith('/')) {
      return absolute.replace(/\/$/, '');
    }

    return absolute;
  }

  private async ensureResourceExists(
    resourceUrl: string,
    options: { createIfMissing?: boolean } = {}
  ): Promise<void> {
    const { createIfMissing = true } = options;
    const normalizedUrl = this.normalizeResourceUrl(resourceUrl);

    if (this.preparedResources.has(normalizedUrl)) {
      return;
    }

    const exists = await this.resourceExists(normalizedUrl);
    if (exists) {
      this.markResourcePrepared(normalizedUrl);
      return;
    }

    if (!createIfMissing) {
      throw new Error(`Resource not found: ${normalizedUrl}`);
    }

    for (let i = 0; i < 3; i++) {
    try {
      const response = await this.runtime.getFetch()(normalizedUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/turtle'
        },
        body: ''
      });

        if (response.ok || [201, 202, 204, 409].includes(response.status)) {
          // Invalidate cache for the new resource
          await this.sparqlExecutor.invalidateHttpCache(normalizedUrl);
          this.markResourcePrepared(normalizedUrl);
          return;
        }
        
        if (response.status >= 500) {
           console.warn(`[PodDialect] ensureResourceExists attempt ${i + 1}/3 failed with ${response.status}, retrying...`);
           await new Promise(r => setTimeout(r, 1000));
           continue;
        }

        throw new Error(`Failed to create resource: ${response.status} ${response.statusText}`);
    } catch (error) {
        if (i === 2) {
          console.error('[PodDialect] ensureResourceExists failed after 3 attempts:', error);
      throw error;
        }
        console.warn(`[PodDialect] ensureResourceExists attempt ${i + 1}/3 failed with error:`, error);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  private async executeOnResource(
    resourceUrl: string,
    sparqlQuery: SPARQLQuery,
    descriptor?: TableResourceDescriptor
  ): Promise<unknown[]> {
    const normalizedUrl = this.normalizeResourceUrl(resourceUrl);
    if (descriptor?.mode === 'sparql') {
      return await this.executeOnSparqlEndpoint(descriptor.endpoint, sparqlQuery);
    }
    // LDP 模式：仅允许 SELECT/ASK 通过 Comunica；UPDATE 走 N3 Patch
    if (sparqlQuery.type === 'SELECT' || sparqlQuery.type === 'ASK') {
      return await this.sparqlExecutor.queryContainer(normalizedUrl, sparqlQuery);
    }
    throw new Error('LDP mode does not support SPARQL UPDATE; use N3 patch helpers instead.');
  }

  /**
   * Get the appropriate fetch function for a SPARQL endpoint
   * - Same-origin endpoints (e.g., CSS SPARQL sidecar): use authenticated session.fetch
   * - Cross-origin endpoints: use unauthenticated fetch (standard SPARQL endpoint behavior)
   */
  private getFetchForEndpoint(endpoint: string): typeof fetch {
    return getFetchForOrigin(endpoint, this.podUrl, this.runtime.getFetch());
  }

  private async executeOnSparqlEndpoint(endpoint: string, sparqlQuery: SPARQLQuery): Promise<unknown[]> {
    const fetchFn = this.getFetchForEndpoint(endpoint);

    if (sparqlQuery.type === 'SELECT' || sparqlQuery.type === 'ASK') {
      // For SELECT/ASK, we need to create a temporary executor with the appropriate fetch
      if (isSameOrigin(endpoint, this.podUrl)) {
        // Same origin: use authenticated executor
        return await this.sparqlExecutor.executeQueryWithSource(sparqlQuery, endpoint, 'sparql');
      } else {
        // Cross-origin: create an unauthenticated executor
        const unauthExecutor = new ComunicaSPARQLExecutor({
          sources: [endpoint],
          fetch: fetch, // Use standard fetch without auth
          logging: false,
          createQueryEngine: this.config.createQueryEngine
        });
        return await unauthExecutor.executeQueryWithSource(sparqlQuery, endpoint, 'sparql');
      }
    }

    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sparql-update' },
      body: sparqlQuery.query
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`SPARQL endpoint update failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`);
    }

    return [{ success: true, source: endpoint, status: response.status, via: 'sparql-endpoint' }];
  }

  /**
   * 确保表有 resourcePath，如果没有则从 TypeIndex 自动发现
   * 如果设置了 typeIndex，优先使用发现的位置（覆盖配置的 base）
   */
  private async ensureTableResourcePath(table: PodTable): Promise<void> {
    const rdfClass = typeof table.config.type === 'string'
      ? table.config.type
      : String(table.config.type);

    // 检查是否已经有 resourcePath
    const configuredResourcePath =
      table.getResourcePath?.();

    // 如果没有设置 typeIndex，使用配置的 resourcePath（如果有）
    if (!table.config.typeIndex) {
      if (configuredResourcePath && configuredResourcePath.trim().length > 0) {
        // 已经有 resourcePath，直接使用配置
        return;
      }
      // 没有 resourcePath，使用默认容器
      console.log(`[AutoDiscover] Table ${table.config.name} has no resourcePath, using default container path`);
      table.config.containerPath = '/data/';
      return;
    }

    // 设置了 typeIndex，尝试从 TypeIndex/SAI 发现位置
    // 发现的位置会覆盖配置的 base，实现动态路由
    console.log(`[AutoDiscover] Table ${table.config.name} has typeIndex enabled, discovering from TypeIndex/SAI...`);

    try {
      const locations = await this.discovery.discover(rdfClass);
      const location = locations[0]; // 使用第一个发现的位置

      if (location) {
        // 动态设置 containerPath 和 resourcePath
        // 假设 location.container 是 containerPath 或 URL
        let containerPath = location.container;
        
        // 如果返回的是绝对 URL，尝试转为相对路径（可选，但保持一致性较好）
        // 这里暂时直接使用
        if (!containerPath.endsWith('/')) {
           containerPath += '/';
        }

        // 如果发现了 subjectTemplate，应用到表配置
        if (location.subjectTemplate) {
          table.setSubjectTemplate(location.subjectTemplate);
          console.log(`[AutoDiscover] ✓ Applied subjectTemplate from discovery: ${location.subjectTemplate}`);
        }

        // 推断 resourcePath
        // 根据资源模式决定 resourcePath:
        // - Document 模式：resourcePath = containerPath (每条记录独立文件，查询扫描整个容器)
        // - Fragment 模式：resourcePath = containerPath + tableName.ttl (所有记录在同一文件)
        const resourceMode = this.uriResolver.getResourceMode(table);
        let resourcePath: string;
        
        if (resourceMode === 'document') {
          // Document 模式：resourcePath 就是容器本身
          // SELECT 查询会扫描容器下的所有 .ttl 文件
          resourcePath = containerPath;
        } else {
          // Fragment 模式：resourcePath 指向单个文件
          resourcePath = `${containerPath}${table.config.name}.ttl`;
        }

        console.log(`[AutoDiscover] ✓ Found resource path from TypeIndex: ${resourcePath} (mode: ${resourceMode})`);

        // 动态注入到表配置中
        // 使用 setBase 更新内部状态和 config.base，确保 SubjectResolver 能获取到正确路径
        table.setBase(resourcePath);

        // 尝试自动发现 SPARQL endpoint
        await this.tryDiscoverSparqlEndpoint(table, containerPath);
      } else {
        // Discovery 没有找到位置
        if (configuredResourcePath && configuredResourcePath.trim().length > 0) {
          // 有配置的 resourcePath，使用它作为 fallback
          console.log(`[AutoDiscover] No discovery result, using configured path: ${configuredResourcePath}`);
          return;
        }
        // 没有配置的 resourcePath，抛出错误
        throw new Error(`[AutoDiscover] No data location found for type ${rdfClass}. Please ensure the data is registered in TypeIndex or SAI Registry.`);
      }
    } catch (error) {
      // 发现过程出错
      if (configuredResourcePath && configuredResourcePath.trim().length > 0) {
        // 有配置的 resourcePath，使用它作为 fallback
        console.warn('[AutoDiscover] Discovery process failed, using configured path:', configuredResourcePath);
        return;
      }
      console.warn('[AutoDiscover] Discovery process failed:', error);
      throw error; // Re-throw
    }
  }

  /**
   * 尝试自动发现 SPARQL endpoint
   * 按约定：${base}/-/sparql
   */
  private async tryDiscoverSparqlEndpoint(table: PodTable, base: string): Promise<void> {
    // 如果表已经配置了 sparqlEndpoint，跳过
    if (table.getSparqlEndpoint()) {
      return;
    }

    // 构建约定的 endpoint URL
    const potentialEndpoint = `${base.replace(/\/$/, '')}/-/sparql`;
    
    try {
      const response = await this.runtime.getFetch()(potentialEndpoint, { method: 'HEAD' });
      if (response.ok) {
        console.log(`[AutoDiscover] ✓ Found SPARQL endpoint: ${potentialEndpoint}`);
        table.setSparqlEndpoint(potentialEndpoint);
      }
    } catch {
      // SPARQL endpoint 不存在，继续使用 LDP 模式
    }
  }

  // 核心查询方法 - 通过 ExecutionStrategy 执行
  async query(operation: PodOperation): Promise<unknown[]> {
    return this.executor.query(operation);
  }

  /**
   * Collect all resource URLs involved in a query plan.
   * Used for resolving data sources for SPARQL queries.
   */
  private collectSelectSources(plan: SelectQueryPlan): string[] {
    const sources = new Set<string>();

    // Base table
    const { resourceUrl } = this.resolveTableUrls(plan.baseTable);
    sources.add(resourceUrl);

    // Joined tables
    if (plan.joins) {
      for (const join of plan.joins) {
        const { resourceUrl: joinUrl } = this.resolveTableUrls(join.table);
        sources.add(joinUrl);
      }
    }

    return Array.from(sources);
  }

  private buildIdInConditionFromSubjects(subjects: string[]): QueryCondition | undefined {
    if (!subjects || subjects.length === 0) {
      return undefined;
    }
    return new BinaryExpression('@id', 'IN', subjects);
  }

  private isInsertPlan(plan: PodOperation['plan']): plan is InsertQueryPlan {
    return Boolean(plan && typeof (plan as InsertQueryPlan).table !== 'undefined' && Array.isArray((plan as InsertQueryPlan).rows));
  }

  private isUpdatePlan(plan: PodOperation['plan']): plan is UpdateQueryPlan {
    return Boolean(plan && typeof (plan as UpdateQueryPlan).table !== 'undefined' && 'data' in (plan as UpdateQueryPlan));
  }

  private isDeletePlan(plan: PodOperation['plan']): plan is DeleteQueryPlan {
    if (!plan) {
      return false;
    }
      const candidate = plan as Partial<DeleteQueryPlan<PodTable>> & {
        rows?: unknown;
        data?: unknown;
      };
    if (typeof candidate.table === 'undefined') {
      return false;
    }
    return typeof candidate.rows === 'undefined' && typeof candidate.data === 'undefined';
  }

  private isSelectPlan(plan: PodOperation['plan']): plan is SelectQueryPlan {
    if (!plan) {
      return false;
    }
    return typeof (plan as SelectQueryPlan).baseTable !== 'undefined';
  }

  private buildSubjectLookupPlan(table: PodTable, condition: QueryCondition): SelectQueryPlan {
    const alias = table.config.name ?? 'table';
    return {
      baseTable: table,
      baseAlias: alias,
      selectAll: true,
      conditionTree: condition,
      aliasToTable: new Map([[alias, table]]),
      tableToAlias: new Map([[table, alias]])
    };
  }

  private isQueryConditionNode(value: unknown): value is QueryCondition {
    return value instanceof BinaryExpression
      || value instanceof LogicalExpression
      || value instanceof UnaryExpression;
  }

  private extractSubjectFromRow(row: Record<string, unknown>): string | null {
    const subject = row.subject ?? row['?subject'];
    if (!subject) {
      return null;
    }
    if (typeof subject === 'string') {
      return subject;
    }
    if (hasStringValue(subject)) {
      return subject.value;
    }
    return null;
  }

  private conditionTargetsIdentifier(condition?: QueryCondition): boolean {
    if (!condition) {
      return false;
    }

    // BinaryExpression: check 'left' property
    if (condition.type === 'binary_expr') {
      const left = condition.left;
      const colName = typeof left === 'string'
        ? left
        : left instanceof PodColumnBase
          ? left.name
          : undefined;
      if (colName === '@id' || colName === 'id') {
        return true;
      }
    }

    // LogicalExpression: check 'expressions' property
    if (condition.type === 'logical_expr') {
      const exprs = condition.expressions;
      if (Array.isArray(exprs)) {
        return exprs.some((child) =>
          this.isQueryConditionNode(child) && this.conditionTargetsIdentifier(child)
        );
      }
    }

    // UnaryExpression: check 'value' property
    if (condition.type === 'unary_expr') {
      const val = condition.value;
      if (val && typeof val === 'object' && 'type' in val) {
        return this.conditionTargetsIdentifier(val as QueryCondition);
      }
    }

    return false;
  }

  private async rewriteIdentifierConditionWithSubjects(
    condition: QueryCondition,
    table: PodTable
  ): Promise<QueryCondition | undefined> {
    const resolver = this.getResolver(table);

    try {
      const subjects = await resolver.resolveSubjectsForMutation(
        table,
        condition,
        async () => [],
        async () => []
      );
      return this.buildIdInConditionFromSubjects(subjects);
    } catch (error) {
      const template = table.getSubjectTemplate?.() ?? table.config?.subjectTemplate ?? '{id}';
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes('missing required variable')) {
        throw new Error(
          `Cannot resolve mutation target for table "${table.config.name ?? 'unknown'}" ` +
          `with subjectTemplate "${template}" from where() alone. ` +
          `Use an explicit @id via db.updateByIri()/db.deleteByIri() ` +
          `(or the internal whereByIri()).`
        );
      }

      throw error;
    }
  }

  private async ensureIdentifierCondition(
    condition: QueryCondition | undefined,
    table: PodTable,
    resourceUrl: string
  ): Promise<QueryCondition | undefined> {
    if (!condition) {
      return undefined;
    }

    if (this.conditionTargetsIdentifier(condition)) {
      return await this.rewriteIdentifierConditionWithSubjects(condition, table);
    }

    return await this.rewriteWhereConditionWithSubjects(condition, table, resourceUrl);
  }

  private async rewriteWhereConditionWithSubjects(
    condition: QueryCondition | undefined,
    table: PodTable,
    resourceUrl: string
  ): Promise<QueryCondition | undefined> {
    if (!condition) {
      return undefined;
    }
    const subjects = await this.findSubjectsForCondition(condition, table, resourceUrl);
    return this.buildIdInConditionFromSubjects(subjects);
  }

  // 处理 Drizzle 的 SQL 对象
  async executeSql(sql: SQL, table: PodTable): Promise<unknown[]> {
    // 解析 SQL 对象确定操作类型
    const sqlString = sql.queryChunks.join('');
    let operationType: 'select' | 'insert' | 'update' | 'delete';
    
    if (sqlString.toLowerCase().includes('select')) {
      operationType = 'select';
    } else if (sqlString.toLowerCase().includes('insert')) {
      operationType = 'insert';
    } else if (sqlString.toLowerCase().includes('update')) {
      operationType = 'update';
    } else if (sqlString.toLowerCase().includes('delete')) {
      operationType = 'delete';
    } else {
      throw new Error(`Unsupported SQL operation: ${sqlString}`);
    }

    const operation: PodOperation = {
      type: operationType,
      table,
      sql,
      values: (sql as { params?: unknown[] }).params || [] // 参数作为值
    };

    return this.query(operation);
  }

  // 添加自定义命名空间到 SPARQL 转换器
  addNamespace(prefix: string, uri: string): void {
    this.sparqlConverter.addPrefix(prefix, uri);
  }

  // 获取配置信息
  getConfig() {
    return {
      podUrl: this.podUrl,
      webId: this.webId,
      connected: this.runtime.isConnected()
    };
  }

  /**
   * 获取认证的 fetch 函数
   * 用于需要认证访问的操作（如 Notifications）
   */
  getAuthenticatedFetch(): typeof fetch {
    return this.runtime.getFetch();
  }

  // 获取 SPARQL 转换器（用于调试）
  getSPARQLConverter(): ASTToSPARQLConverter {
    return this.sparqlConverter;
  }

  // 获取 SPARQL 执行器（用于调试）
  getSPARQLExecutor(): ComunicaSPARQLExecutor {
    return this.sparqlExecutor;
  }

  getPodUrl(): string {
    return this.runtime.getPodUrl();
  }

  /**
   * 获取用户的 WebID
   */
  getWebId(): string {
    return this.runtime.getWebId();
  }

  /**
   * 发现特定 RDF 类型的数据位置
   * 通过 TypeIndex 和 Interop 发现
   * 
   * @param rdfClass RDF 类型 URI
   * @returns 数据位置列表
   */
  async discoverDataLocations(rdfClass: string, options?: import('./discovery').DiscoverOptions): Promise<import('./discovery').DataLocation[]> {
    return this.discovery.discover(rdfClass, options);
  }

  /**
   * 获取所有数据注册信息
   */
  async discoverAll(): Promise<import('./discovery').DataRegistrationInfo[]> {
    if (this.discovery.discoverAll) {
      return this.discovery.discoverAll();
    }
    return [];
  }

  /**
   * 按应用 ID 发现数据位置
   */
  async discoverByApp(appId: string): Promise<import('./discovery').DataLocation[]> {
    if (this.discovery.discoverByApp) {
      return this.discovery.discoverByApp(appId);
    }
    return [];
  }

  // 添加数据源进行联邦查询（高级用法）
  // 注意：正常情况下不需要手动添加数据源，表定义中的 containerPath 会自动使用
  addSource(source: string): void {
    console.warn('⚠️  addSource 是高级用法，通常不需要手动管理数据源。表定义中的 containerPath 会自动使用。');
    this.sparqlExecutor.addSource(source);
  }

  // 移除数据源
  removeSource(source: string): void {
    this.sparqlExecutor.removeSource(source);
  }

  // 获取当前数据源列表
  getSources(): string[] {
    return this.sparqlExecutor.getSources();
  }

  // 自动从 TypeIndex 添加数据源（推荐用法）
  async addSourcesFromTypeIndex(): Promise<void> {
    try {
      const typeIndexEntries = await this.typeIndexManager.discoverTypes();
      
      for (const entry of typeIndexEntries) {
        if (entry.instanceContainer) {
          // 使用实例容器路径作为数据源
          this.sparqlExecutor.addSource(entry.instanceContainer);
        } else if (entry.containerPath) {
          // 使用容器路径作为数据源
          const fullPath = entry.containerPath.startsWith('http') 
            ? entry.containerPath 
            : `${this.podUrl}${entry.containerPath}`;
          this.sparqlExecutor.addSource(fullPath);
        }
      }
      
      console.log(`✅ 从 TypeIndex 自动添加了 ${typeIndexEntries.length} 个数据源`);
    } catch (error) {
      console.warn('⚠️  无法从 TypeIndex 自动添加数据源:', error);
    }
  }

  // 查询特定容器
  async queryContainer(containerPath: string, sql: SQL, table: PodTable): Promise<unknown[]> {
    // Use proper AST conversion with table context
    const ast = this.sparqlConverter.parseDrizzleAST(sql, table);
    const sparqlQuery = this.sparqlConverter.convertSelect(ast, table);
    // 使用表定义中的容器路径，如果提供了的话
    const targetPath = table?.config?.containerPath || containerPath;
    return this.sparqlExecutor.queryContainer(targetPath, sparqlQuery);
  }

  // 获取 Pod 元数据
  async getPodMetadata(): Promise<unknown> {
    if (!this.runtime.isConnected()) {
      throw new Error('Not connected to Pod');
    }
    
    return {
      podUrl: this.podUrl,
      webId: this.webId,
      connected: this.runtime.isConnected(),
      sources: this.sparqlExecutor.getSources()
    };
  }

  private stripSPARQLProlog(query: string): string {
    const withoutComments = query
      .replace(/^\s*#.*$/gm, '')
      .trim();

    return withoutComments.replace(/^(?:\s*(?:PREFIX|BASE)\s+[^\n]+\n)*/i, '').trim();
  }

  private looksLikeRawSQL(query: string): boolean {
    const normalized = this.stripSPARQLProlog(query);

    if (/^SELECT\b[\s\S]*\bFROM\b\s+(?!<|[?$])/i.test(normalized) && !/\{/m.test(normalized)) {
      return true;
    }

    if (/^INSERT\s+INTO\b/i.test(normalized)) {
      return true;
    }

    if (/^UPDATE\s+[A-Za-z_`"][\w$`"]*\s+SET\b/i.test(normalized)) {
      return true;
    }

    if (/^DELETE\s+FROM\b/i.test(normalized)) {
      return true;
    }

    return false;
  }

  private inferSPARQLQueryType(query: string): SPARQLQuery['type'] | undefined {
    const withoutProlog = this.stripSPARQLProlog(query);
    const firstKeyword = withoutProlog.match(/^(SELECT|ASK|INSERT|DELETE|UPDATE|WITH|LOAD|CLEAR|CREATE|DROP|COPY|MOVE|ADD|CONSTRUCT|DESCRIBE)\b/i)?.[1]?.toUpperCase();

    switch (firstKeyword) {
      case 'SELECT':
      case 'ASK':
      case 'INSERT':
      case 'DELETE':
      case 'UPDATE':
        return firstKeyword;
      case 'WITH':
      case 'LOAD':
      case 'CLEAR':
      case 'CREATE':
      case 'DROP':
      case 'COPY':
      case 'MOVE':
      case 'ADD':
        return 'UPDATE';
      default:
        return undefined;
    }
  }

  // 直接执行 SPARQL 查询（高级用法）
  async executeSPARQL(query: string): Promise<unknown[]> {
    if (!this.runtime.isConnected()) {
      throw new Error('Not connected to Pod');
    }

    if (this.looksLikeRawSQL(query)) {
      throw new Error('executeSPARQL only accepts SPARQL text; raw SQL is not supported in Solid dialect');
    }

    const type = this.inferSPARQLQueryType(query);
    if (!type) {
      throw new Error('Unsupported SPARQL query type. Supported types: SELECT, ASK, INSERT, DELETE, UPDATE');
    }

    const sparqlQuery: SPARQLQuery = {
      type,
      query,
      prefixes: {}
    };

    return this.sparqlExecutor.executeQuery(sparqlQuery);
  }

  // 事务支持
  async transaction<T>(
    transaction: (tx: PodDialect) => Promise<T>
  ): Promise<T> {
    console.log('Starting transaction');
    try {
      const result = await transaction(this);
      console.log('Transaction completed successfully');
      return result;
    } catch (error) {
      console.error('Transaction failed:', error);
      throw error;
    }
  }

  // ========== TypeIndex 相关方法 ==========

  /**
   * 注册表到 TypeIndex
   */
  async registerTable(table: PodTable): Promise<void> {
    if (table.config.autoRegister === false) {
      return;
    }

    const tableKey = table.config.name ?? JSON.stringify(table.config);
    if (this.registeredTables.has(tableKey)) {
      return;
    }

    try {
      const descriptor = this.resolveTableResource(table);

      if (descriptor.mode === 'sparql') {
        // No probe needed - if endpoint fails, the actual query will report the error
      } else {
        await this.ensureContainerExists(descriptor.containerUrl);

        try {
          await this.ensureResourceExists(descriptor.resourceUrl, { createIfMissing: true });
          this.markResourcePrepared(descriptor.resourceUrl);
        } catch (error: unknown) {
          console.warn(`[registerTable] ensureResourceExists failed for ${descriptor.resourceUrl}:`, error);
          // 不标记为已准备，让后续 INSERT 有机会重试创建
        }

        this.markContainerPrepared(descriptor.containerUrl);
        // 将表的 base 固定为已解析的绝对资源路径，避免后续重复 TypeIndex 解析
        try {
          table.setBase?.(descriptor.resourceUrl);
        } catch (error) {
          console.warn(`[registerTable] setBase failed for ${table.config.name}:`, error);
        }
      }
    } catch (error: unknown) {
      console.warn(`[registerTable] Resource preparation failed for ${table.config.name}:`, error);
    }

    this.registeredTables.add(tableKey);

    // 委托给 DataDiscovery 进行注册
    await this.discovery.register(table, {
      registryPath: table.config.saiRegistryPath,
    });
  }

  /**
   * 查找用户的 TypeIndex
   */
  async findTypeIndex(): Promise<string | null> {
    return this.typeIndexManager.findTypeIndex();
  }

  /**
   * 创建 TypeIndex
   */
  async createTypeIndex(): Promise<string> {
    return this.typeIndexManager.createTypeIndex();
  }

  /**
   * 发现已注册的类型
   */
  async discoverTypes(typeIndexUrl?: string): Promise<TypeIndexEntry[]> {
    return this.typeIndexManager.discoverTypes(typeIndexUrl);
  }

  /**
   * 自动发现和注册类型（用于数据消费方）
   */
  async autoDiscoverAndRegister(webId?: string): Promise<TypeIndexEntry[]> {
    return this.typeIndexManager.autoDiscoverAndRegister(webId);
  }

  /**
   * 从 Profile 中自动发现类型（不依赖 TypeIndex）
   */
  async discoverTypesFromProfile(): Promise<TypeIndexEntry[]> {
    return this.typeIndexManager.discoverTypesFromProfile();
  }

  /**
   * 发现特定的类型定义（按需发现）
   * @param rdfClassUri 要发现的 RDF 类型 URI
   */
  async discoverSpecificType(rdfClassUri: string): Promise<TypeIndexEntry | null> {
    return this.typeIndexManager.discoverSpecificType(rdfClassUri);
  }

  /**
   * 发现多个特定类型
   * @param rdfClassUris 要发现的 RDF 类型 URI 数组
   */
  async discoverSpecificTypes(rdfClassUris: string[]): Promise<TypeIndexEntry[]> {
    return this.typeIndexManager.discoverSpecificTypes(rdfClassUris);
  }

  /**
   * 发现并创建可用的表定义
   * @param rdfClassUri 要发现的 RDF 类型 URI
   * @returns 可用的表定义，如果未找到则返回 null
   */
  async discoverTable(rdfClassUri: string): Promise<DiscoveredTable | null> {
    return this.typeIndexManager.discoverTable(rdfClassUri);
  }

  /**
   * 发现并创建多个可用的表定义
   * @param rdfClassUris 要发现的 RDF 类型 URI 数组
   * @returns 可用的表定义数组
   */
  async discoverTables(rdfClassUris: string[]): Promise<DiscoveredTable[]> {
    return this.typeIndexManager.discoverTables(rdfClassUris);
  }

  /**
   * 检查类型是否已注册
   */
  async isTypeRegistered(type: string, typeIndexUrl?: string): Promise<boolean> {
    return this.typeIndexManager.isTypeRegistered(type, typeIndexUrl);
  }

  /**
   * 获取 TypeIndex 管理器
   */
  getTypeIndexManager(): TypeIndexManager {
    return this.typeIndexManager;
  }

  // 确保容器存在（递归创建父目录）
  private async ensureContainerExists(containerUrl: string): Promise<void> {
    try {
      const targetContainer = this.normalizeContainerKey(containerUrl);

      if (this.preparedContainers.has(targetContainer)) {
        return;
      }

      const checkResponse = await this.runtime.getFetch()(targetContainer, {
        method: 'HEAD'
      });

      if (checkResponse.status === 401 || checkResponse.status === 403) {
        console.log(`[Container] ${targetContainer} 不允许 HEAD，视为已存在`);
        this.markContainerPrepared(targetContainer);
        return;
      }

      if (checkResponse.status === 404) {
        // 先递归创建父容器
        const parentContainer = this.getParentContainer(targetContainer);
        if (parentContainer && parentContainer !== targetContainer) {
          console.log(`[Container] 先创建父容器: ${parentContainer}`);
          await this.ensureContainerExists(parentContainer);
        }

        // 再创建当前容器
        console.log(`[Container] 创建容器: ${targetContainer}`);
        const createResponse = await this.runtime.getFetch()(targetContainer, {
          method: 'PUT',
          headers: {
            'Content-Type': 'text/turtle',
            'Link': '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"'
          }
        });

        if (createResponse.ok) {
          console.log(`[Container] 容器创建成功: ${createResponse.status}`);
          await this.sparqlExecutor.invalidateHttpCache(targetContainer);
          this.markContainerPrepared(targetContainer);
        } else if (createResponse.status === 409) {
          console.log(`[Container] 容器已存在（409冲突）: ${targetContainer}`);
          this.markContainerPrepared(targetContainer);
        } else {
          throw new Error(`Failed to create container: ${createResponse.status} ${createResponse.statusText}`);
        }
      } else if (checkResponse.status === 200) {
        console.log(`[Container] 容器已存在: ${targetContainer}`);
        this.markContainerPrepared(targetContainer);
      } else if (checkResponse.status === 409) {
        console.log(`[Container] 容器已存在（409冲突）: ${targetContainer}`);
        this.markContainerPrepared(targetContainer);
      } else if (!checkResponse.ok) {
        throw new Error(`Failed to check container: ${checkResponse.status} ${checkResponse.statusText}`);
      }
    } catch (error) {
      console.error('[Container] 确保容器存在时出错:', error);
      throw error;
    }
  }

  /**
   * 获取父容器 URL
   * 例如: https://pod.com/alice/data/users/ -> https://pod.com/alice/data/
   */
  private getParentContainer(containerUrl: string): string | null {
    try {
      const url = new URL(containerUrl);
      const pathParts = url.pathname.split('/').filter(part => part.length > 0);

      // 如果已经是根目录或只有一层，返回 null
      if (pathParts.length <= 1) {
        return null;
      }

      // 移除最后一个路径部分
      pathParts.pop();

      // 重建父容器 URL
      url.pathname = '/' + pathParts.join('/') + '/';
      return url.toString();
    } catch (error) {
      console.error('[Container] 解析父容器 URL 失败:', error);
      return null;
    }
  }

  /**
   * List all resources in a container
   * Uses LDP containment triples to discover resources
   */
  private async listContainerResources(containerUrl: string): Promise<string[]> {
    const normalizedUrl = this.normalizeContainerKey(containerUrl);
    const resources: string[] = [];

    try {
      // Query the container for ldp:contains relationships via SPARQL
      // This is more reliable than parsing Turtle as it handles all serialization formats
      const sparql = {
        type: 'SELECT' as const,
        query: `
          PREFIX ldp: <http://www.w3.org/ns/ldp#>
          SELECT ?resource WHERE {
            <${normalizedUrl}> ldp:contains ?resource .
          }
        `,
        prefixes: { ldp: 'http://www.w3.org/ns/ldp#' }
      };

      const results = await this.sparqlExecutor.queryContainer(normalizedUrl, sparql);

      for (const row of results) {
        const resource = (row as Record<string, unknown>).resource;
        if (resource) {
          const resourceUrl = hasStringValue(resource)
            ? resource.value
            : String(resource);
          resources.push(resourceUrl);
        }
      }
    } catch (e) {
      console.warn('[listContainerResources] SPARQL query failed:', e);
    }

    return resources;
  }
}
