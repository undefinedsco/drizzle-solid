import { entityKind } from 'drizzle-orm';
import { SQL } from 'drizzle-orm';
import { PodTable } from './pod-table';
import { QueryCondition } from './query-conditions';
import { ASTToSPARQLConverter, type SPARQLQuery } from './ast-to-sparql';
import { ComunicaSPARQLExecutor, SolidSPARQLExecutor } from './sparql-executor';
import { TypeIndexManager, TypeIndexEntry, TypeIndexConfig, DiscoveredTable } from './typeindex-manager';
import type { SelectQueryPlan } from './select-plan';

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
  private typeIndexManager: TypeIndexManager;
  public config: PodDialectConfig;
  private registeredTables: Set<string> = new Set();
  private preparedContainers: Set<string> = new Set();
  private preparedResources: Set<string> = new Set();

  // 在PodDialect类中添加默认谓词映射（在constructor或类属性中）
  private defaultPredicates: Record<string, string> = {
    // 基础标识符
    'id': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#about',
    
    // 通用名称和描述
    'name': 'http://xmlns.com/foaf/0.1/name',
    'title': 'http://purl.org/dc/terms/title',
    'description': 'http://purl.org/dc/terms/description',
    'content': 'http://purl.org/dc/terms/description',  // 通用内容字段
    
    // 时间戳
    'createdAt': 'https://schema.org/dateCreated',
    'updatedAt': 'https://schema.org/dateModified',
    'created_at': 'https://schema.org/dateCreated',  // 兼容下划线命名
    'updated_at': 'https://schema.org/dateModified', // 兼容下划线命名
    
    // 联系信息
    'email': 'http://xmlns.com/foaf/0.1/mbox',
    'url': 'http://xmlns.com/foaf/0.1/homepage',
    'homepage': 'http://xmlns.com/foaf/0.1/homepage', // 别名
    
    // 通用fallback
    default: 'http://example.org/property/'
  };

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
    
    // 初始化 SPARQL 转换器和轻量级执行器
    this.sparqlConverter = new ASTToSPARQLConverter(this.podUrl, this.webId);
    this.sparqlExecutor = new SolidSPARQLExecutor({
      sources: [this.podUrl],
      fetch: this.session.fetch, // 使用session的认证fetch
      logging: false
    });
    
    // 初始化 TypeIndex 管理器
    this.typeIndexManager = new TypeIndexManager(this.webId, this.podUrl, this.session.fetch);
  }

  async executeComplexUpdate(
    operation: PodOperation,
    condition: QueryCondition
  ): Promise<any[]> {
    console.log('[PodDialect] Complex update triggered with condition:', JSON.stringify(condition, null, 2));
    const table = operation.table;
    const data = operation.data as Record<string, any>;
    const columnsToUpdate = Object.keys(data).filter((key) => key in table.columns);

    if (columnsToUpdate.length === 0) {
      console.warn('[UPDATE] No valid columns provided for complex update');
      return [];
    }

    const { containerUrl, resourceUrl } = this.resolveTableUrls(table);
    const normalizedResourceUrl = this.normalizeResourceUrl(resourceUrl);

    await this.ensureContainerExists(containerUrl);
    await this.ensureResourceExists(normalizedResourceUrl, { createIfMissing: false });

    const subjects = await this.findSubjectsForCondition(condition, table, normalizedResourceUrl);
    if (subjects.length === 0) {
      console.log('[UPDATE] Complex update matched no subjects');
      return [];
    }

    const results: Array<{ success: boolean; source: string; subject: string }> = [];

    for (const subject of subjects) {
      const updateQuery = this.buildUpdateQueryForSubject(subject, data, table, columnsToUpdate);
      if (!updateQuery) {
        continue;
      }

      console.log('[UPDATE] Complex update query for subject:', subject); 
      console.log(updateQuery);
      await this.executeOnResource(normalizedResourceUrl, {
        type: 'UPDATE',
        query: updateQuery,
        prefixes: this.sparqlConverter.getPrefixes()
      });

      results.push({ success: true, source: normalizedResourceUrl, subject });
    }

    return results;
  }

  async executeComplexDelete(
    operation: PodOperation,
    condition: QueryCondition
  ): Promise<any[]> {
    console.log('[PodDialect] Complex delete triggered with condition:', JSON.stringify(condition, null, 2));
    const table = operation.table;
    const { containerUrl, resourceUrl } = this.resolveTableUrls(table);
    const normalizedResourceUrl = this.normalizeResourceUrl(resourceUrl);

    await this.ensureContainerExists(containerUrl);
    await this.ensureResourceExists(normalizedResourceUrl, { createIfMissing: false });

    const subjects = await this.findSubjectsForCondition(condition, table, normalizedResourceUrl);
    if (subjects.length === 0) {
      console.log('[DELETE] Complex delete matched no subjects');
      return [];
    }

    const results: Array<{ success: boolean; source: string; subject: string }> = [];

    for (const subject of subjects) {
      const deleteQuery = `${this.buildPrefixLines()}\nDELETE WHERE {\n  <${subject}> ?p ?o .\n}`;
      await this.executeOnResource(normalizedResourceUrl, {
        type: 'DELETE',
        query: deleteQuery,
        prefixes: this.sparqlConverter.getPrefixes()
      });

      results.push({ success: true, source: normalizedResourceUrl, subject });
    }

    return results;
  }

  private async findSubjectsForCondition(
    condition: QueryCondition,
    table: PodTable,
    resourceUrl: string
  ): Promise<string[]> {
    const normalizedUrl = this.normalizeResourceUrl(resourceUrl);
    const prefixLines = this.buildPrefixLines();
    const whereClause = this.sparqlConverter.buildWhereClauseForCondition(condition, table);
    console.log('[UPDATE] Complex update where clause:', whereClause);

    const query = `${prefixLines}\nSELECT ?subject WHERE {\n${whereClause}\n}`;
    console.log('[UPDATE] Complex update select query:', query);

    const rows = await this.executeOnResource(normalizedUrl, {
      type: 'SELECT',
      query,
      prefixes: this.sparqlConverter.getPrefixes()
    });

    return (rows as Array<Record<string, any>>)
      .map((row) => {
        const subject = row.subject as any;
        if (!subject) return null;
        return typeof subject === 'string' ? subject : subject.value ?? null;
      })
      .filter((value): value is string => Boolean(value));
  }

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

  private isQueryCondition(value: any): value is QueryCondition {
    return value && typeof value === 'object' && 'type' in value && 'operator' in value;
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
      
      // 验证 Pod 连接
      const response = await this.session.fetch(this.podUrl);
      if (!response.ok) {
        throw new Error(`Failed to connect to Pod: ${response.status} ${response.statusText}`);
      }
      
      this.connected = true;
      console.log('Successfully connected to Solid Pod');
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
    const mode =
      typeof table.getResourceMode === 'function' ? table.getResourceMode() : (table.config.resourceMode ?? 'ldp');

    if (mode === 'sparql') {
      const endpointSource =
        (typeof table.getSparqlEndpoint === 'function' && table.getSparqlEndpoint()) ||
        table.config.sparqlEndpoint ||
        table.config.containerPath;

      if (!endpointSource) {
        throw new Error(`Table ${table.config.name} is configured for SPARQL access but no endpoint was provided`);
      }

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
    if (descriptor.mode !== 'ldp') {
      throw new Error(
        `Table ${table.config.name} is configured for SPARQL endpoint access; LDP resource URLs are not available.`
      );
    }

    return {
      containerUrl: descriptor.containerUrl,
      resourceUrl: descriptor.resourceUrl
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

    const configuredPath = table.config.containerPath || '/data/';
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

    if (configuredPath.endsWith('/')) {
      const relativeContainer = `${userPrefix}${trimmedPath}`;
      const containerUrl = ensureTrailingSlash(`${baseUrl}${relativeContainer.replace(/^\/+/, '')}`);
      return {
        containerUrl,
        resourceUrl: `${containerUrl}${table.config.name}.ttl`
      };
    }

    const resourceRelative = `${userPrefix}${trimmedPath}`;
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

    try {
      const response = await this.session.fetch(normalizedUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/turtle'
        },
        body: ''
      });

      if (!response.ok && ![201, 202, 204, 409].includes(response.status)) {
        throw new Error(`Failed to create resource: ${response.status} ${response.statusText}`);
      }

      this.markResourcePrepared(normalizedUrl);
    } catch (error) {
      console.error('[PodDialect] ensureResourceExists failed:', error);
      throw error;
    }
  }

  private async executeOnResource(resourceUrl: string, sparqlQuery: SPARQLQuery): Promise<any[]> {
    const normalizedUrl = this.normalizeResourceUrl(resourceUrl);
    return await this.sparqlExecutor.queryContainer(normalizedUrl, sparqlQuery);
  }

  /**
   * 确保表有 resourcePath，如果没有则从 TypeIndex 自动发现
   * 如果已有 resourcePath，检查是否与 TypeIndex 冲突
   */
  private async ensureTableResourcePath(table: PodTable): Promise<void> {
    const rdfClass = typeof table.config.rdfClass === 'string'
      ? table.config.rdfClass
      : (table.config.rdfClass as any).value || String(table.config.rdfClass);

    // 检查是否已经有 resourcePath
    const configuredResourcePath =
      (typeof (table as any).getResourcePath === 'function' && (table as any).getResourcePath()) ||
      (table as any).config?.resourcePath;

    const configuredContainerPath = table.config.containerPath;

    if (configuredResourcePath && configuredResourcePath.trim().length > 0) {
      // 已经有 resourcePath，检查是否与 TypeIndex 冲突
      try {
        const discoveredEntry = await this.typeIndexManager.discoverSpecificType(rdfClass);

        if (discoveredEntry) {
          const typeIndexPath = discoveredEntry.containerPath;

          // 检查冲突
          if (configuredContainerPath && configuredContainerPath !== typeIndexPath) {
            console.warn(
              `[AutoDiscover] ⚠️  CONFLICT: Table ${table.config.name} has resourcePath "${configuredResourcePath}" ` +
              `but TypeIndex points to "${typeIndexPath}". Using configured resourcePath (ignoring TypeIndex).`
            );
            // 优先使用用户配置的路径（写入优先）
          } else {
            console.log(`[AutoDiscover] Table ${table.config.name} resourcePath matches TypeIndex ✓`);
          }
        }
      } catch (error) {
        // TypeIndex 查询失败，使用配置的路径
        console.log(`[AutoDiscover] Could not check TypeIndex for ${table.config.name}, using configured path`);
      }

      return; // 已经有路径，无需自动发现
    }

    // 没有 resourcePath，从 TypeIndex 自动发现
    console.log(`[AutoDiscover] Table ${table.config.name} has no resourcePath, discovering from TypeIndex...`);

    try {
      const discoveredEntry = await this.typeIndexManager.discoverSpecificType(rdfClass);

      if (discoveredEntry) {
        // 动态设置 containerPath 和 resourcePath
        const containerPath = discoveredEntry.containerPath;
        const resourcePath = discoveredEntry.instanceContainer
          ? `${discoveredEntry.instanceContainer}${table.config.name}.ttl`
          : `${containerPath}${table.config.name}.ttl`;

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

    // 如果表没有指定 resourcePath，尝试从 TypeIndex 自动发现
    await this.ensureTableResourcePath(operation.table);

    const { containerUrl, resourceUrl } = this.resolveTableUrls(operation.table);
    const normalizedResourceUrl = this.normalizeResourceUrl(resourceUrl);

    try {
      let sparqlQuery: SPARQLQuery;

      console.log('[PodDialect] Operation type:', operation.type);
      const safeOperationLog = {
        type: operation.type,
        table: operation.table?.config?.name,
        where: operation.where,
        limit: operation.limit,
        offset: operation.offset,
        orderBy: operation.orderBy,
        distinct: operation.distinct,
        select: operation.select ? Object.keys(operation.select) : undefined,
        joins: Array.isArray(operation.joins)
          ? operation.joins.map((join) => ({
              type: join.type,
              alias: (join as any).alias ?? join.table?.config?.name
            }))
          : undefined
      };
      console.log('[PodDialect] Full operation:', JSON.stringify(safeOperationLog, null, 2));

      switch (operation.type) {
        case 'select': {
          if (operation.sql) {
            const ast = this.sparqlConverter.parseDrizzleAST(operation.sql, operation.table);
            sparqlQuery = this.sparqlConverter.convertSelect(ast, operation.table);
          } else {
            sparqlQuery = this.sparqlConverter.convertSelect({
              select: operation.select,
              where: operation.where,
              limit: operation.limit,
              offset: operation.offset,
              orderBy: operation.orderBy,
              distinct: operation.distinct
            }, operation.table);
          }
          break;
        }

        case 'insert': {
          const values = Array.isArray(operation.values) ? operation.values : [operation.values];
          if (!values || values.length === 0) {
            throw new Error('INSERT operation requires at least one value');
          }

          if (!this.preparedContainers.has(this.normalizeContainerKey(containerUrl))) {
            await this.ensureContainerExists(containerUrl);
          }
          if (!this.preparedResources.has(this.normalizeResourceKey(resourceUrl))) {
            await this.ensureResourceExists(normalizedResourceUrl, { createIfMissing: true });
          }

          const canInsert = await this.checkResourceExistence(values, operation.table, containerUrl);
          if (!canInsert) {
            throw new Error('Resource already exists, INSERT aborted');
          }

          sparqlQuery = this.sparqlConverter.convertInsert(values, operation.table);
          break;
        }

        case 'update': {
          if (!operation.data) {
            throw new Error('UPDATE operation requires data');
          }
          if (!operation.where || Object.keys(operation.where).length === 0) {
            throw new Error('UPDATE operation requires where conditions to locate target resources');
          }

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

          if (this.isQueryCondition(operation.where)) {
            return await this.executeComplexUpdate(operation, operation.where as QueryCondition);
          }

          sparqlQuery = this.sparqlConverter.convertUpdate(operation.data, operation.where, operation.table);
          break;
        }

        case 'delete': {
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

          sparqlQuery = this.sparqlConverter.convertDelete(operation.where, operation.table);
          break;
        }

        default:
          throw new Error(`Unsupported operation type: ${operation.type}`);
      }

      console.log('Generated SPARQL:', sparqlQuery.query);

      const results = await this.executeOnResource(normalizedResourceUrl, sparqlQuery);
      console.log(`${operation.type.toUpperCase()} operation completed, ${results.length} records affected`);
      return results;

    } catch (error) {
      console.error(`${operation.type.toUpperCase()} operation failed:`, error);
      throw error;
    }
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

    const skipTypeIndex = table.config.autoRegister === false;

    try {
      const descriptor = this.resolveTableResource(table);
      if (descriptor.mode === 'ldp') {
        await this.ensureContainerExists(descriptor.containerUrl);

        try {
          await this.ensureResourceExists(descriptor.resourceUrl, { createIfMissing: true });
        } catch (error: unknown) {
          console.warn(`[registerTable] ensureResourceExists failed for ${descriptor.resourceUrl}:`, error);
        }

        this.markContainerPrepared(descriptor.containerUrl);
        this.markResourcePrepared(descriptor.resourceUrl);
      }
    } catch (error: unknown) {
      console.warn(`[registerTable] Resource preparation failed for ${table.config.name}:`, error);
    }

    this.registeredTables.add(tableKey);

    if (skipTypeIndex) {
      console.log(`Table ${table.config.name} has autoRegister disabled, skipping TypeIndex registration`);
      return;
    }

    try {
      // 从 resourcePath 提取 containerPath
      const descriptor = this.resolveTableResource(table);
      let containerPath = table.config.containerPath || '/data/';
      let instanceContainer = `${this.podUrl.replace(/\/$/, '')}${containerPath}`;

      if (descriptor.mode === 'ldp') {
        // 从实际的 containerUrl 提取路径
        const containerUrl = descriptor.containerUrl;
        const podUrlBase = this.podUrl.replace(/\/$/, '');
        if (containerUrl.startsWith(podUrlBase)) {
          containerPath = containerUrl.substring(podUrlBase.length);
          instanceContainer = containerUrl.replace(/\/$/, '') + '/';
        }
      }

      const rdfClass = typeof table.config.rdfClass === 'string'
        ? table.config.rdfClass
        : (table.config.rdfClass as any).value || String(table.config.rdfClass);

      const entry: TypeIndexEntry = {
        rdfClass,
        containerPath,
        forClass: table.config.name,
        instanceContainer,
        isPublic: (table as any)._.config?.isPublic || false
      };

      // 检查 TypeIndex 中是否已存在，如果路径不同则更新
      try {
        const existingEntry = await this.typeIndexManager.discoverSpecificType(rdfClass);

        if (existingEntry && existingEntry.instanceContainer !== instanceContainer) {
          console.warn(
            `[registerTable] ⚠️  TypeIndex has different path for ${table.config.name}:\n` +
            `  - TypeIndex: ${existingEntry.instanceContainer}\n` +
            `  - Configured: ${instanceContainer}\n` +
            `  Updating TypeIndex to use configured path...`
          );
        }

        // 总是注册/更新到 TypeIndex（这会覆盖旧的注册）
        await this.typeIndexManager.registerType(entry);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('TypeIndex not found')) {
          console.warn('[registerTable] TypeIndex missing. Attempting to create.');
          try {
            // 根据 isPublic 创建对应的 TypeIndex
            const typeIndexUrl = await this.typeIndexManager.createTypeIndex(entry.isPublic || false);
            await this.typeIndexManager.registerType(entry, typeIndexUrl);
          } catch (creationError: unknown) {
            console.warn('[registerTable] Unable to create TypeIndex. Continuing without registration.', creationError);
          }
        } else {
          console.warn('[registerTable] TypeIndex registration failed. Continuing without registration.', error);
        }
      }
      console.log(`Table ${table.config.name} registered to TypeIndex with path: ${instanceContainer}`);
    } catch (error) {
      console.error(`Failed to register table ${table.config.name}:`, error);
      throw error;
    }
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
  async isTypeRegistered(rdfClass: string, typeIndexUrl?: string): Promise<boolean> {
    return this.typeIndexManager.isTypeRegistered(rdfClass, typeIndexUrl);
  }

  /**
   * 获取 TypeIndex 管理器
   */
  getTypeIndexManager(): TypeIndexManager {
    return this.typeIndexManager;
  }

  /**
   * 改进的资源存在性检查 - 使用直接 HTTP 而不是 Comunica ASK
   * 这解决了 409 冲突问题：当 ASK 查询失败时，不应该继续 INSERT
   */
  private async checkResourceExistence(values: any[], table: PodTable, containerUrl: string): Promise<boolean> {
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
    return `${table.config.containerPath || '/'}#${id}`;
  }

  // 完全替换convertSelect方法
  private convertSelect(operation: PodOperation): SPARQLQuery {
    const table = operation.table;
    const rdfClass = table.config.rdfClass || 'http://example.org/Entity';
    const namespace = table.config.namespace || '';

    const selectVars: string[] = ['?subject'];
    const wherePatterns: string[] = [`?subject a <${rdfClass}> .`];
    const prefixes = [
      'PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>',
      'PREFIX foaf: <http://xmlns.com/foaf/0.1/>',
      'PREFIX schema: <https://schema.org/>',
      'PREFIX dc: <http://purl.org/dc/terms/>',
      'PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>'
    ];

    const columnPredicates = new Map<string, string>();
    let filteredByIdentifier = false;

    // 为每个列生成变量和模式
    Object.keys(table.columns).forEach(columnName => {
      const column = table.columns[columnName];
      let predicate;

      // 尝试从ColumnBuilder获取
      if (typeof (column as any).getPredicateUri === 'function') {
        predicate = (column as any).getPredicateUri();
      } else {
        predicate = (column as any).predicate;
      }

      // 从options中获取predicate
      if (!predicate) {
        predicate = (column as any).options?.predicate;
      }

      // 如果设置了namespace，优先用namespace + columnName
      if (!predicate && namespace) {
        predicate = `${namespace}${columnName}`;
      }

      // 如果没有namespace，用默认标准映射
      if (!predicate) {
        predicate = this.defaultPredicates[columnName as keyof typeof this.defaultPredicates];
      }

      // 最后的fallback
      if (!predicate) {
        predicate = `http://example.org/${columnName}`;
      }

      // 确保predicate是完整URI
      if (predicate && !predicate.startsWith('http')) {
        predicate = `http://example.org/${predicate}`;
      }

      if (predicate) {
        columnPredicates.set(columnName, predicate);
      }

      if (predicate) {
        const varName = `?${columnName}`;
        selectVars.push(varName);

        // 检查是否必需
        const isRequired = (column as any).options?.required || false;
        if (isRequired) {
          wherePatterns.push(`?subject <${predicate}> ${varName} .`);
        } else {
          wherePatterns.push(`OPTIONAL { ?subject <${predicate}> ${varName} . }`);
        }
      }
    });

    const isUriString = (value: string): boolean => value.startsWith('http://') || value.startsWith('https://');

    const formatLiteral = (value: unknown): string | null => {
      if (value === null || value === undefined) {
        return null;
      }
      if (typeof value === 'string') {
        const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        return `"${escaped}"`;
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value.toString();
      }
      if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
      }
      if (value instanceof Date) {
        return `"${value.toISOString()}"^^xsd:dateTime`;
      }
      const asString = String(value);
      const escaped = asString.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return `"${escaped}"`;
    };

    const escapeForRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const applyWhereConditions = (conditions: Record<string, unknown>) => {
      for (const [key, rawValue] of Object.entries(conditions)) {
        if (rawValue === undefined) {
          continue;
        }

        const values = Array.isArray(rawValue) ? rawValue : [rawValue];

        if (key === 'subject' || key === '@id') {
          filteredByIdentifier = true;
          const formatted = values
            .map((value) => {
              if (typeof value !== 'string') {
                return null;
              }
              const trimmed = value.trim();
              if (!trimmed) {
                return null;
              }
              return isUriString(trimmed) ? `<${trimmed}>` : formatLiteral(trimmed);
            })
            .filter((value): value is string => Boolean(value));

          if (formatted.length === 1) {
            wherePatterns.push(`FILTER(?subject = ${formatted[0]})`);
          } else if (formatted.length > 1) {
            const valuesClause = formatted.join(' ');
            wherePatterns.push(`VALUES ?subject { ${valuesClause} }`);
          }
          continue;
        }

        if (key === 'id') {
          filteredByIdentifier = true;
          const fragments = values
            .map((value) => {
              if (typeof value !== 'string') {
                return null;
              }
              const trimmed = value.trim().replace(/^#/, '');
              return trimmed.length > 0 ? trimmed : null;
            })
            .filter((fragment): fragment is string => Boolean(fragment));

          if (fragments.length === 0) {
            continue;
          }

          const conditions = fragments.map((fragment) => {
            const escaped = escapeForRegex(fragment);
            return `REGEX(STR(?subject), "#${escaped}$")`;
          });

          const filterClause = conditions.length === 1
            ? conditions[0]
            : conditions.map((clause) => `(${clause})`).join(' || ');

          wherePatterns.push(`FILTER(${filterClause})`);
          continue;
        }

        const predicate = columnPredicates.get(key);
        if (!predicate) {
          continue;
        }

        const formattedValues = values
          .map((value) => formatLiteral(value))
          .filter((value): value is string => Boolean(value));

        if (formattedValues.length === 0) {
          continue;
        }

        if (formattedValues.length === 1) {
          wherePatterns.push(`?subject <${predicate}> ${formattedValues[0]} .`);
        } else {
          const tempVar = `?${key}_filter`;
          wherePatterns.push(`?subject <${predicate}> ${tempVar} .`);
          const filterValues = formattedValues.join(', ');
          wherePatterns.push(`FILTER(${tempVar} IN (${filterValues}))`);
        }
      }
    };

    const isPlainObject = (value: unknown): value is Record<string, unknown> => {
      return Boolean(value) && Object.getPrototypeOf(value) === Object.prototype;
    };

    if (operation.where && isPlainObject(operation.where)) {
      applyWhereConditions(operation.where);
    }

    let query = `${prefixes.join('\n')}\nSELECT ${selectVars.join(' ')} WHERE {\n  ${wherePatterns.join('\n  ')}\n}`;

    // 添加LIMIT/OFFSET
    if (operation.limit) {
      query += `\nLIMIT ${operation.limit}`;
    }
    else if (filteredByIdentifier) {
      query += '\nLIMIT 1';
    }
    if (operation.offset) {
      query += `\nOFFSET ${operation.offset}`;
    }
    
    return {
      type: 'SELECT',
      query: query.trim(),
      prefixes: {
        'rdf': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
        'schema': 'https://schema.org/',
        'foaf': 'http://xmlns.com/foaf/0.1/',
        'dc': 'http://purl.org/dc/terms/'
      }
    };
  }

  // 同时修复convertInsert方法，确保INSERT也使用正确谓词
  private convertInsert(operation: PodOperation): SPARQLQuery {
    const table = operation.table;
    const rdfClass = table.config.rdfClass || 'http://example.org/Entity';
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
