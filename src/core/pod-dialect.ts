import { entityKind } from 'drizzle-orm';
import { SQL } from 'drizzle-orm';
import { PodTable } from './pod-table';
import { QueryCondition } from './query-conditions';
import { ASTToSPARQLConverter, type SPARQLQuery } from './ast-to-sparql';
import { ComunicaSPARQLExecutor, SolidSPARQLExecutor } from './sparql-executor';
import { TypeIndexManager, TypeIndexEntry, TypeIndexConfig, DiscoveredTable } from './typeindex-manager';
import { DataDiscovery, TypeIndexDiscovery } from './discovery';
import { LdpExecutor } from './execution/ldp-executor';
import { subjectResolver } from './subject/resolver';
import type { SelectQueryPlan } from './select-plan';
import type { InsertQueryPlan, UpdateQueryPlan, DeleteQueryPlan } from './pod-session';

// 最小 Solid Session 接口定义
export interface SolidAuthSession {
  info: {
    isLoggedIn: boolean;
    webId?: string;
    sessionId?: string;
  };
  fetch: typeof fetch;
  login?: (options?: any) => Promise<void>;
  logout?: () => Promise<void>;
}

export interface PodDialectConfig {
  session: SolidAuthSession;
  typeIndex?: TypeIndexConfig;
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
    type: 'leftJoin' | 'rightJoin' | 'innerJoin' | 'fullJoin';
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

type TableResourceDescriptor =
  | {
      mode: 'ldp';
      containerUrl: string;
      resourceUrl: string;
    }
  | {
      mode: 'sparql';
      endpoint: string;
    };

export class PodDialect {
  static readonly [entityKind] = 'PodDialect';

  private session: SolidAuthSession;
  private podUrl: string;
  private webId: string;
  private connected = false;
  private sparqlConverter: ASTToSPARQLConverter;
  private sparqlExecutor: ComunicaSPARQLExecutor;
  private ldpExecutor: LdpExecutor;
  private typeIndexManager: TypeIndexManager;
  private discovery: DataDiscovery;
  public config: PodDialectConfig;
  private registeredTables: Set<string> = new Set();
  private preparedContainers: Set<string> = new Set();
  private preparedResources: Set<string> = new Set();

  constructor(config: PodDialectConfig) {
    this.config = config;
    this.session = config.session;
    
    // 从session中获取webId和podUrl
    const webId = this.session.info.webId;
    if (!webId) {
      throw new Error('Session中未找到webId');
    }
    this.webId = webId;
    
    // 从webId推导podUrl
    this.podUrl = this.derivePodUrlFromWebId(this.webId);
    
    // 设置 subjectResolver 的 Pod URL
    subjectResolver.setPodUrl(this.podUrl);
    
    // 初始化 SPARQL 转换器和轻量级执行器
    this.sparqlConverter = new ASTToSPARQLConverter(this.podUrl, this.webId);
    this.sparqlExecutor = new SolidSPARQLExecutor({
      sources: [this.podUrl],
      fetch: this.session.fetch, // 使用session的认证fetch
      logging: false
    });
    
    // 初始化 LDP Executor
    this.ldpExecutor = new LdpExecutor(this.sparqlExecutor, this.session.fetch);
    
    // 初始化 TypeIndex 管理器
    this.typeIndexManager = new TypeIndexManager(this.webId, this.podUrl, this.session.fetch);
    this.discovery = new TypeIndexDiscovery(this.typeIndexManager, this.podUrl);
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

    return (rows as Array<Record<string, any>>)
      .map((row) => this.extractSubjectFromRow(row))
      .filter((value): value is string => Boolean(value));
  }

  /**
   * @deprecated 此方法仅被废弃的 executeComplexUpdate 使用
   * 保留仅用于参考
   */
  private buildUpdateQueryForSubject(
    subject: string,
    data: Record<string, any>,
    table: PodTable,
    columns: string[]
  ): string | null {
    const prefixLines = this.buildPrefixLines();
    const deleteStatements: string[] = [];
    const insertTriples: string[] = [];

    columns.forEach((columnName, index) => {
      const column = table.columns[columnName];
      if (!column) {
        return;
      }

      const predicate = this.sparqlConverter.getPredicateForColumnPublic(column, table);
      deleteStatements.push(`DELETE WHERE {\n  <${subject}> <${predicate}> ?value${index} .\n}`);

      const newValue = data[columnName];
      if (newValue === null || newValue === undefined) {
        return;
      }

      const literal = this.sparqlConverter.formatLiteralValue(newValue, column);
      if (literal === 'NULL') {
        return;
      }

      insertTriples.push(`  <${subject}> <${predicate}> ${literal} .`);
    });

    if (deleteStatements.length === 0 && insertTriples.length === 0) {
      return null;
    }

    const parts: string[] = [];
    if (deleteStatements.length > 0) {
      parts.push(deleteStatements.join(';\n'));
    }
    if (insertTriples.length > 0) {
      parts.push(`INSERT DATA {\n${insertTriples.join('\n')}\n}`);
    }

    return `${prefixLines}\n${parts.join(';\n')}`;
  }

  private buildPrefixLines(): string {
    const prefixes = this.sparqlConverter.getPrefixes();
    return Object.entries(prefixes)
      .map(([prefix, uri]) => `PREFIX ${prefix}: <${uri}>`)
      .join('\n');
  }

  private isSubjectResolutionError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    return error.message.includes('requires an id or @id condition');
  }

  private derivePodUrlFromWebId(webId: string): string {
    try {
      const url = new URL(webId);
      return `${url.protocol}//${url.host}`;
    } catch (error) {
      throw new Error(`Invalid WebID format: ${webId}`);
    }
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    
    try {
      console.log(`Connecting to Solid Pod: ${this.podUrl}`);
      console.log(`Using WebID: ${this.webId}`);
      
      // 验证 Pod 连接；某些 Pod 根可能返回 401/403 但子路径可访问
      const response = await this.session.fetch(this.podUrl);
      if (!response.ok) {
        const status = response.status;
        if (status === 401 || status === 403) {
          console.warn(`Pod root returned ${status}, continuing (child resources may still be writable)`);
        } else {
          throw new Error(`Failed to connect to Pod: ${response.status} ${response.statusText}`);
        }
      } else {
        console.log('Successfully connected to Solid Pod');
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

  isConnected(): boolean {
    return this.connected;
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

  private resolveTableUrls(table: PodTable): { containerUrl: string; resourceUrl: string } {
    const descriptor = this.resolveTableResource(table);
    if (descriptor.mode === 'ldp') {
      return {
        containerUrl: descriptor.containerUrl,
        resourceUrl: descriptor.resourceUrl
      };
    }

    // SPARQL mode: use endpoint as both container/resource placeholder
    return {
      containerUrl: descriptor.endpoint,
      resourceUrl: descriptor.endpoint
    };
  }

  private resolveLdpResource(table: PodTable): { containerUrl: string; resourceUrl: string } {
    const configuredResourcePath =
      typeof (table as any).getResourcePath === 'function'
        ? (table as any).getResourcePath()
        : (table as any).config?.resourcePath;

    if (configuredResourcePath) {
      const absoluteResource = this.resolveAbsoluteUrl(configuredResourcePath);
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

  private collectSelectSources(plan: SelectQueryPlan): Array<string | { type: 'sparql'; value: string }> {
    const tables = new Set<PodTable<any>>();
    if (plan.baseTable) {
      tables.add(plan.baseTable);
    }

    if (Array.isArray(plan.joins)) {
      for (const join of plan.joins) {
        if (join?.table) {
          tables.add(join.table);
        }
      }
    }

    if (plan.aliasToTable instanceof Map) {
      for (const table of plan.aliasToTable.values()) {
        if (table) {
          tables.add(table);
        }
      }
    }

    const seen = new Set<string>();
    const sources: Array<string | { type: 'sparql'; value: string }> = [];

    for (const table of tables) {
      const descriptor = this.resolveTableResource(table);
      if (descriptor.mode === 'ldp') {
        const key = `ldp:${descriptor.resourceUrl}`;
        if (!seen.has(key)) {
          seen.add(key);
          sources.push(descriptor.resourceUrl);
        }
      } else {
        const key = `sparql:${descriptor.endpoint}`;
        if (!seen.has(key)) {
          seen.add(key);
          sources.push({ type: 'sparql', value: descriptor.endpoint });
        }
      }
    }

    return sources;
  }

  private async resourceExists(resourceUrl: string): Promise<boolean> {
    const normalizedUrl = this.normalizeResourceUrl(resourceUrl);
    if (this.preparedResources.has(normalizedUrl)) {
      return true;
    }
    try {
      const response = await this.session.fetch(normalizedUrl, { method: 'HEAD' });

      if (response.ok || response.status === 409) {
        this.markResourcePrepared(normalizedUrl);
        return true;
      }

      if (response.status === 404) {
        return false;
      }

      if (response.status === 405) {
        const getResponse = await this.session.fetch(normalizedUrl, {
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
        const getResponse = await this.session.fetch(normalizedUrl, {
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
      const needsUserPrefix =
        relativePath.length === 0 ||
        (relativePath !== normalizedUser && !relativePath.startsWith(userPrefixWithSlash));

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
      const response = await this.session.fetch(normalizedUrl, {
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
  ): Promise<any[]> {
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

  private async executeOnSparqlEndpoint(endpoint: string, sparqlQuery: SPARQLQuery): Promise<any[]> {
    if (sparqlQuery.type === 'SELECT' || sparqlQuery.type === 'ASK') {
      return await this.sparqlExecutor.executeQueryWithSource(sparqlQuery, endpoint);
    }

    const response = await this.session.fetch(endpoint, {
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
   * 如果已有 resourcePath，检查是否与 TypeIndex 冲突
   */
  private async ensureTableResourcePath(table: PodTable): Promise<void> {
    const rdfClass = typeof table.config.type === 'string'
      ? table.config.type
      : (table.config.type as any).value || String(table.config.type);

    // 检查是否已经有 resourcePath
    const configuredResourcePath =
      (typeof (table as any).getResourcePath === 'function' && (table as any).getResourcePath()) ||
      (table as any).config?.resourcePath;

    const configuredContainerPath = table.getContainerPath();

    if (configuredResourcePath && configuredResourcePath.trim().length > 0) {
      // 已经有 resourcePath，无需 TypeIndex 检查，直接使用配置
      return;
    }

    // 没有 resourcePath，且未要求使用 TypeIndex，直接使用默认容器
    if (!table.config.typeIndex) {
      console.log(`[AutoDiscover] Table ${table.config.name} has no resourcePath, using default container path`);
      (table as any).config.containerPath = configuredContainerPath || '/data/';
      return;
    }

    // 没有 resourcePath，从 TypeIndex 自动发现
    console.log(`[AutoDiscover] Table ${table.config.name} has no resourcePath, discovering from TypeIndex...`);

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

        // 推断 resourcePath
        // 如果是 Document 模式，resourcePath = container + name.ttl
        // 如果是 Fragment 模式，resourcePath = container (即文件本身)
        // DataLocation 语义上 container 指的是"包含数据的容器"，
        // 对于 Fragment 模式，它可能指向 .ttl 文件本身吗？
        // 回看 TypeIndexDiscovery.discover，它返回的是 instanceContainer ?? containerPath
        // TypeIndexEntry 中 instanceContainer 通常指目录。
        // 如果是 instance (单文件模式)，我们目前 TypeIndexDiscovery 还没完美处理 instance 字段
        // 但根据 TypeIndexDiscovery.ts 实现:
        // locations.push({ container: entry.instanceContainer ?? entry.containerPath ... })
        
        const resourcePath = `${containerPath}${table.config.name}.ttl`;

        console.log(`[AutoDiscover] ✓ Found resource path from TypeIndex: ${resourcePath}`);

        // 动态注入到表配置中
        (table as any).config.containerPath = containerPath;
        (table as any).config.resourcePath = resourcePath;
        if ((table as any)._) {
          (table as any)._.config.containerPath = containerPath;
          (table as any)._.config.resourcePath = resourcePath;
        }
      } else {
        console.warn(`[AutoDiscover] ⚠️  No TypeIndex entry found for ${rdfClass}, using default path /data/`);
        // 使用默认路径
        (table as any).config.containerPath = '/data/';
      }
    } catch (error) {
      console.warn('[AutoDiscover] Failed to discover resource path from TypeIndex:', error);
      // 失败时使用默认路径
      (table as any).config.containerPath = '/data/';
    }
  }

  // 核心查询方法 - 通过 Comunica 执行 SPARQL
  async query(operation: PodOperation): Promise<unknown[]> {
    if (!this.connected) {
      await this.connect();
    }

    const descriptor = this.resolveTableResource(operation.table);
    const mode = descriptor.mode;

    // 如果表没有指定 resourcePath，尝试从 TypeIndex 自动发现
    await this.ensureTableResourcePath(operation.table);

    const { containerUrl, resourceUrl } = mode === 'sparql'
      ? { containerUrl: descriptor.endpoint, resourceUrl: descriptor.endpoint }
      : this.resolveTableUrls(operation.table);
    const normalizedResourceUrl = this.normalizeResourceUrl(resourceUrl);

    try {
      let sparqlQuery: SPARQLQuery;

      // ... (omitted logging)

      switch (operation.type) {
        case 'select': {
          // ... (select logic unchanged)
          if (operation.plan && this.isSelectPlan(operation.plan)) {
            sparqlQuery = this.sparqlConverter.convertSelectPlan(operation.plan);
          } else if (operation.plan && !this.isSelectPlan(operation.plan)) {
            throw new Error('Invalid plan supplied for select operation');
          } else if (operation.sql) {
            const ast = this.sparqlConverter.parseDrizzleAST(operation.sql, operation.table);
            sparqlQuery = this.sparqlConverter.convertSelect(ast, operation.table);
          } else {
            sparqlQuery = this.sparqlConverter.convertSimpleSelect({
              table: operation.table,
              where: operation.where as Record<string, unknown>,
              limit: operation.limit,
              offset: operation.offset,
              orderBy: operation.orderBy,
              distinct: operation.distinct
            });
          }
          break;
        }

        case 'insert': {
          const values = Array.isArray(operation.values) ? operation.values : [operation.values];
          if (!values || values.length === 0) {
            throw new Error('INSERT operation requires at least one value');
          }

          if (mode === 'ldp') {
            if (!this.preparedContainers.has(this.normalizeContainerKey(containerUrl))) {
              await this.ensureContainerExists(containerUrl);
            }
            if (!this.preparedResources.has(this.normalizeResourceKey(resourceUrl))) {
              // 只有在 document 模式下，且文件不存在时才需要 createIfMissing
              // 但这里我们无法轻易区分是否是 fragment mode。
              // LdpExecutor.executeInsert 会处理具体的三元组，但它假定资源可写。
              // 为了简单起见，这里总是确保资源存在。
              // 实际上，如果使用 subjectResolver，它会决定写入哪个文件。
              // 如果 subjectResolver 决定写入不同的文件，那么这里的 normalizedResourceUrl 可能不准确。
              // 但目前的架构是 PodTable 绑定到一个 resourceUrl (或 containerUrl)。
              
              // 修正：如果 LdpExecutor 使用 SubjectResolver，它可能会根据记录生成不同的 URI。
              // 如果是 document mode，每个记录可能有自己的文件。
              // LdpExecutor.executeInsert 可能会发现需要写入不同的文件。
              // 但目前 LdpExecutor.executeInsert 接受一个 resourceUrl 参数，这意味着它是批量写入同一个文件。
              // 如果是 Document Mode，我们应该在 LdpExecutor 内部处理多文件写入，或者在此处拆分。
              // 为了保持兼容性，目前假设所有插入都针对同一个资源（Fragment Mode）或者主资源（Document Mode 的容器）。
              
              // 实际上，如果是 Document Mode，resourceUrl 可能是 containerUrl + 'new-id.ttl'。
              // 但如果是批量插入，会有多个 IDs。
              
              // 我们应该让 LdpExecutor 处理资源创建，或者在此处更智能地处理。
              // 暂时保持原样，确保主资源存在。
              await this.ensureResourceExists(normalizedResourceUrl, { createIfMissing: true });
            }
            const insertPlan = this.isInsertPlan(operation.plan)
              ? operation.plan
              : { table: operation.table, rows: values };
            
            // Delegate to LdpExecutor
            return await this.ldpExecutor.executeInsert(insertPlan.rows, insertPlan.table, normalizedResourceUrl);
          }

          const insertPlan = this.isInsertPlan(operation.plan)
            ? operation.plan
            : { table: operation.table, rows: values };
          sparqlQuery = this.sparqlConverter.convertInsert(insertPlan, insertPlan.table);
          break;
        }
        
        // ... (update/delete)


        case 'update': {
          if (!operation.data) {
            throw new Error('UPDATE operation requires data');
          }
          if (!operation.where || Object.keys(operation.where).length === 0) {
            throw new Error('UPDATE operation requires where conditions to locate target resources');
          }

          if (mode === 'ldp') {
            if (!this.preparedContainers.has(this.normalizeContainerKey(containerUrl))) {
              try {
                await this.ensureContainerExists(containerUrl);
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (message.includes('Failed to check container: 401') || message.includes('Failed to check container: 403')) {
                  console.warn(`[UPDATE] Skipping container existence check for ${containerUrl}: ${message}`);
                } else {
                  throw error;
                }
              }
            }

            if (!this.preparedResources.has(this.normalizeResourceKey(resourceUrl))) {
              await this.ensureResourceExists(normalizedResourceUrl, { createIfMissing: false });
            }
          }

          const updatePlan = this.isUpdatePlan(operation.plan)
            ? operation.plan
            : {
                table: operation.table,
                data: operation.data,
                where: operation.where as QueryCondition
              };

          const ensuredCondition = await this.ensureIdentifierCondition(
            updatePlan.where,
            updatePlan.table,
            normalizedResourceUrl
          );

          if (!ensuredCondition) {
            console.warn('[UPDATE] No matching subjects found for provided condition, skipping update.');
            return [];
          }

          const resourceMode = updatePlan.table.getResourceMode?.() ?? 'ldp';

          if (resourceMode !== 'sparql') {
            // Find subjects using Comunica (READ)
            const subjects = await this.findSubjectsForCondition(updatePlan.where, updatePlan.table, resourceUrl);
            
            if (subjects.length === 0) {
      return [];
    }
            
            // Delegate execution to LdpExecutor (WRITE)
            return await this.ldpExecutor.executeUpdate(updatePlan.table, updatePlan.data, subjects, normalizedResourceUrl);
          }

          try {
            sparqlQuery = this.sparqlConverter.convertUpdate(updatePlan.data, ensuredCondition, updatePlan.table);
          } catch (error) {
            if (this.isSubjectResolutionError(error)) {
              console.warn('[UPDATE] Subject resolution failed after rewrite:', error);
              return [];
            }
            throw error;
          }
          break;
        }

        case 'delete': {
          if (mode === 'ldp') {
            if (!this.preparedContainers.has(this.normalizeContainerKey(containerUrl))) {
              await this.ensureContainerExists(containerUrl);
            }

            const hasResource = this.preparedResources.has(this.normalizeResourceKey(resourceUrl))
              ? true
              : await this.resourceExists(normalizedResourceUrl);
            if (!hasResource) {
              console.log('[DELETE] Target resource does not exist, skipping SPARQL execution');
              return [{
                success: true,
                source: normalizedResourceUrl,
                status: 404
              }];
            }
          }

          const deletePlan = this.isDeletePlan(operation.plan)
            ? operation.plan
            : {
                table: operation.table,
                where: operation.where as QueryCondition | undefined
              };

          let deleteCondition = deletePlan.where;
          if (deleteCondition) {
            deleteCondition = await this.ensureIdentifierCondition(deleteCondition, deletePlan.table, normalizedResourceUrl);
            if (!deleteCondition) {
              console.warn('[DELETE] No matching subjects found for provided condition, skipping delete.');
              return [];
            }
          }

          if (mode === 'ldp') {
            if (!deleteCondition) {
               // Cannot delete without condition in LDP mode (safety)
               return [];
            }
            // Find subjects using Comunica (READ)
            const subjects = await this.findSubjectsForCondition(deleteCondition, deletePlan.table, normalizedResourceUrl);
            if (subjects.length === 0) {
              return [];
            }

            // Delegate execution to LdpExecutor (WRITE)
            const results = await this.ldpExecutor.executeDelete(subjects, deletePlan.table, normalizedResourceUrl);
            console.log(`[DELETE] LDP mode: Deleted ${results.length} subjects via N3 Patch`);
            return results;
          }

          try {
            sparqlQuery = this.sparqlConverter.convertDelete(deleteCondition, deletePlan.table);
          } catch (error) {
            if (this.isSubjectResolutionError(error)) {
              console.warn('[DELETE] Subject resolution failed after rewrite:', error);
              return [];
            }
            throw error;
          }
          break;
        }

        default:
          throw new Error(`Unsupported operation type: ${operation.type}`);
      }

      console.log('Generated SPARQL:', sparqlQuery.query);

      const results = await this.executeOnResource(normalizedResourceUrl, sparqlQuery, descriptor);
      console.log(`${operation.type.toUpperCase()} operation completed, ${results.length} records affected`);
      return results;

    } catch (error) {
      console.error(`${operation.type.toUpperCase()} operation failed:`, error);
      throw error;
    }
  }


  private buildIdInConditionFromSubjects(subjects: string[]): QueryCondition | undefined {
    if (!subjects || subjects.length === 0) {
      return undefined;
    }
    return {
      type: 'binary_expr',
      operator: 'IN',
      column: '@id',
      left: { column: '@id' },
      right: { value: subjects },
      value: subjects
    };
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
    const candidate = plan as Partial<DeleteQueryPlan<PodTable<any>>> & {
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

  private buildSubjectUriFromFragment(fragment: string, table: PodTable): string {
    // This method is used by rewriteWhereConditionWithSubjects and other internal logic
    // Ideally we should use SubjectResolver, but for fragment building relative to base, we need this helper.
    // Or delegate to SubjectResolver if it exposes parsing.
    // SubjectResolver.parse handles URIs.
    // For now, keep this simple helper as it was used by extractSubjectFromRow logic context.
    // Wait, extractSubjectFromRow doesn't use this.
    // But `rewriteWhereConditionWithSubjects` calls `findSubjectsForCondition`.
    // `findSubjectsForCondition` calls `buildSubjectLookupPlan` which is also missing?
    return this.sparqlConverter.generateSubjectUri({ id: fragment }, table);
  }

  private extractSubjectFromRow(row: Record<string, any>): string | null {
    const subject = (row as any).subject ?? (row as any)['?subject'];
    if (!subject) {
      return null;
    }
    if (typeof subject === 'string') {
      return subject;
    }
    if (typeof subject.value === 'string') {
      return subject.value;
    }
    return null;
  }

  private operationHasInlineObjects(table: PodTable, data: Record<string, any>): boolean {
    return Object.entries(data).some(([key, value]) => {
      if (value === undefined) return false;
      const col = (table as any).columns?.[key] as any;
      if (!col) return false;
      return this.isInlineObjectColumn(col);
    });
  }

  private isInlineObjectColumn(column: any): boolean {
    if (!column) return false;
    if (column.dataType === 'object') return true;
    if (column.dataType === 'array') {
      const elem = (column as any).elementType ?? column.options?.baseType;
      return elem === 'object';
    }
    return false;
  }

  private conditionTargetsIdentifier(condition?: QueryCondition): boolean {
    if (!condition) {
      return false;
    }
    if (condition.column && (condition.column === '@id' || condition.column === 'id')) {
      return true;
    }

    if (condition.type === 'logical_expr' && condition.conditions) {
      return condition.conditions.some((child) => this.conditionTargetsIdentifier(child));
    }

    if (condition.type === 'unary_expr' && condition.left) {
      return this.conditionTargetsIdentifier(condition.left as QueryCondition);
    }

    return false;
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
      return condition;
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
      connected: this.connected
    };
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
    return this.podUrl;
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
    const sparqlQuery = this.sparqlConverter.convert(sql);
    // 使用表定义中的容器路径，如果提供了的话
    const targetPath = table?.config?.containerPath || containerPath;
    return this.sparqlExecutor.queryContainer(targetPath, sparqlQuery);
  }

  // 获取 Pod 元数据
  async getPodMetadata(): Promise<unknown> {
    if (!this.connected) {
      throw new Error('Not connected to Pod');
    }
    
    return {
      podUrl: this.podUrl,
      webId: this.webId,
      connected: this.connected,
      sources: this.sparqlExecutor.getSources()
    };
  }

  // 直接执行 SPARQL 查询（高级用法）
  async executeSPARQL(query: string): Promise<unknown[]> {
    if (!this.connected) {
      throw new Error('Not connected to Pod');
    }
    
    const sparqlQuery = {
      type: 'SELECT' as const,
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
    const tableKey = table.config.name ?? JSON.stringify(table.config);
    if (this.registeredTables.has(tableKey)) {
      return;
    }

    try {
      const descriptor = this.resolveTableResource(table);

      if (descriptor.mode === 'sparql') {
        // Probe endpoint with a lightweight ASK
        const ask = 'ASK WHERE { ?s ?p ?o } LIMIT 1';
        await this.sparqlExecutor.executeQueryWithSource({ type: 'ASK', query: ask, prefixes: {} }, descriptor.endpoint);
      } else {
        await this.ensureContainerExists(descriptor.containerUrl);

        try {
          await this.ensureResourceExists(descriptor.resourceUrl, { createIfMissing: true });
        } catch (error: unknown) {
          console.warn(`[registerTable] ensureResourceExists failed for ${descriptor.resourceUrl}:`, error);
        }

        this.markContainerPrepared(descriptor.containerUrl);
        this.markResourcePrepared(descriptor.resourceUrl);
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
    await this.discovery.register(table);
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

  /**
   * @deprecated 此方法已废弃，不再使用
   *
   * 原因：
   * 1. 每次 GET 整个容器内容效率极低（对于大容器可能有几 MB）
   * 2. 使用字符串匹配检查资源存在性不够可靠
   * 3. SPARQL INSERT 本身不会覆盖已存在的三元组，重复插入只会添加新的三元组
   * 4. 如果需要防止重复插入，应该由业务层处理（使用 INSERT WHERE NOT EXISTS）
   *
   * 改进的资源存在性检查 - 使用直接 HTTP 而不是 Comunica ASK
   * 这解决了 409 冲突问题：当 ASK 查询失败时，不应该继续 INSERT
   */
  private async checkResourceExistence(values: any[], table: PodTable, containerUrl: string): Promise<boolean> {
    console.warn('[DEPRECATED] checkResourceExistence is deprecated and should not be used');
    try {
      let targetContainer = containerUrl.startsWith('http')
        ? containerUrl
        : this.resolveAbsoluteUrl(containerUrl);
      if (!targetContainer.endsWith('/')) {
        targetContainer = `${targetContainer}/`;
      }

      console.log(`🔍 检查资源存在性: ${targetContainer}`);

      // 直接读取容器内容，检查是否包含我们要插入的资源
      const response = await this.session.fetch(targetContainer, {
        method: 'GET',
        headers: {
          'Accept': 'text/turtle'
        }
      });

      if (!response.ok) {
        if (response.status === 404) {
          // 容器不存在，资源肯定不存在
          console.log(`✅ 容器不存在，可以执行 INSERT`);
          return true; // 可以继续 INSERT
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const turtleData = await response.text();
      console.log(`📖 容器内容长度: ${turtleData.length} 字符`);
      
      // 检查每个要插入的资源是否已存在
      for (const record of values) {
        const subjectUri = this.sparqlConverter.generateSubjectUri(record, table);
        
        // 检查 Turtle 数据中是否包含这个资源 URI
        if (turtleData.includes(subjectUri)) {
          console.log(`❌ 发现已存在的资源: ${subjectUri}`);
          return false; // 资源已存在，不能 INSERT
        }
      }

      console.log(`✅ 资源存在性检查通过，可以执行 INSERT`);
      return true; // 所有资源都不存在，可以 INSERT
      
    } catch (error) {
      console.error('❌ 资源存在性检查失败:', error);
      throw error;
    }
  }

  // 确保容器存在（递归创建父目录）
  private async ensureContainerExists(containerUrl: string): Promise<void> {
    try {
      const targetContainer = this.normalizeContainerKey(containerUrl);

      if (this.preparedContainers.has(targetContainer)) {
        return;
      }

      const checkResponse = await this.session.fetch(targetContainer, {
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
        const createResponse = await this.session.fetch(targetContainer, {
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

  // 添加getSubjectURI辅助方法
  private getSubjectURI(table: PodTable, id: string): string {
    return `${table.getContainerPath() || '/'}#${id}`;
  }

  // 同时修复convertInsert方法，确保INSERT也使用正确谓词
  private convertInsert(operation: PodOperation): SPARQLQuery {
    const table = operation.table;
    const rdfClass = table.config.type || 'http://example.org/Entity';
    const values = operation.values as Record<string, any>;
    const namespace = table.config.namespace || '';
    
    const prefixes = [
      'PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>',
      'PREFIX foaf: <http://xmlns.com/foaf/0.1/>',
      'PREFIX schema: <https://schema.org/>',
      'PREFIX dc: <http://purl.org/dc/terms/>',
      'PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>'
    ];
    
    const triples: string[] = [`<${this.getSubjectURI(table, values.id || 'new-entity')}> a <${rdfClass}> .`];
    
    Object.keys(values).forEach(key => {
      const value = values[key];
      if (value !== undefined && value !== null) {
        let predicate;

        // 尝试从ColumnBuilder获取
        if (typeof (table.columns[key] as any).getPredicateUri === 'function') {
          predicate = (table.columns[key] as any).getPredicateUri();
          console.log(`INSERT: getPredicateUri for ${key}:`, predicate);
        } else if ((table.columns[key] as any)._predicateUri) {
          predicate = (table.columns[key] as any)._predicateUri;
          console.log(`INSERT: _predicateUri for ${key}:`, predicate);
        } else {
          predicate = (table.columns[key] as any).predicate;
          console.log(`INSERT: predicate for ${key}:`, predicate);
        }

        // 从options中获取predicate
        if (!predicate) {
          predicate = (table.columns[key] as any).options?.predicate;
        }
        if (!predicate) {
          predicate = this.defaultPredicates[key as keyof typeof this.defaultPredicates];
        }
        if (!predicate) {
          predicate = `${namespace}${key}`;
        }
        if (predicate && !predicate.startsWith('http')) {
          predicate = `http://example.org/${predicate}`;
        }

        if (predicate) {
          let literal = value;
          if (typeof value === 'string') {
            literal = `"${value.replace(/"/g, '\\"')}"`;
          } else if (typeof value === 'number') {
            literal = value.toString();
          } else if (value instanceof Date) {
            literal = `"${value.toISOString()}"^^xsd:dateTime`;
          }

          triples.push(`<${this.getSubjectURI(table, values.id || 'new-entity')}> <${predicate}> ${literal} .`);
        }
      }
    });
    
    const query = `${prefixes.join('\n')}\nINSERT DATA {\n  ${triples.join('\n  ')}\n}`;
    
    return {
      type: 'INSERT',
      query: query.trim(),
      prefixes: {
        'rdf': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
        'schema': 'https://schema.org/',
        'foaf': 'http://xmlns.com/foaf/0.1/',
        'dc': 'http://purl.org/dc/terms/'
      }
    };
  }

}
