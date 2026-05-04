import { entityKind } from 'drizzle-orm';
import { PodDialect } from './pod-dialect';
import {
  PodAsyncSession,
  type SelectFieldMap,
  SelectQueryBuilder,
  InsertQueryBuilder,
  UpdateQueryBuilder,
  DeleteQueryBuilder
} from './pod-session';
import { PodTable, SolidSchema, isSolidSchema, type InferTableData, type ColumnBuilderDataType, PodColumnBase, type RelationDefinition, type InstantiateTableOptions } from './schema';
import { type PublicQueryCondition, type PublicWhereObject } from './query-conditions';
import { inArray } from './query-conditions';
import {
  NotificationsClient,
  type SubscribeOptions,
  type TableSubscribeOptions,
  type EntitySubscribeOptions,
  type Subscription,
  type Activity,
  type NotificationsClientConfig
} from './notifications';
import { FederatedQueryExecutor, type FederatedError } from './federated';
import type { DataDiscovery } from './discovery';
import type { OrderByExpression } from './order-by';


/**
 * 初始化表选项
 */
export interface InitOptions {
  /** 是否生成 Shape 定义 */
  generateShape?: boolean;
  /** 是否保存 Shape 到 Pod（需要 generateShape 为 true） */
  saveShape?: boolean;
  /** Shape 保存位置（容器路径或完整 URL），默认为 Pod 根目录下的 /shapes/ */
  shapeLocation?: string;
}

type GenericPodTable = PodTable;
type QueryRow = Record<string, unknown>;
type QueryOrderBy = {
  column: PodColumnBase | string | OrderByExpression;
  direction?: 'asc' | 'desc';
};
type QueryExactOptions = {
  columns?: SelectFieldMap;
  with?: Record<string, boolean | { table?: GenericPodTable }>;
};
type VirtualIdPodColumn = PodColumnBase & { _virtualId?: boolean };
type EntityLocator = Record<string, unknown>;
type QueryFindManyOptions = {
  where?: PublicWhereObject | PublicQueryCondition;
  columns?: SelectFieldMap;
  limit?: number;
  offset?: number;
  orderBy?: QueryOrderBy[] | QueryOrderBy;
  with?: Record<string, boolean | { table?: GenericPodTable }>;
};
type QueryTableHelper<TTable extends GenericPodTable = GenericPodTable> = {
  findMany<T = InferTableData<TTable>>(options?: QueryFindManyOptions): Promise<T[]>;
  findFirst<T = InferTableData<TTable>>(options?: QueryFindManyOptions): Promise<T | null>;
  findByLocator<T = InferTableData<TTable>>(locator: EntityLocator, options?: QueryExactOptions): Promise<T | null>;
  findByIri<T = InferTableData<TTable>>(iri: string, options?: QueryExactOptions): Promise<T | null>;
  count(options?: { where?: PublicWhereObject | PublicQueryCondition }): Promise<number>;
};
type QueryProxy<TSchema extends Record<string, unknown>> = {
  [K in keyof TSchema as TSchema[K] extends GenericPodTable ? K : never]:
    TSchema[K] extends GenericPodTable ? QueryTableHelper<TSchema[K]> : never;
};
type GenericPodColumn = PodColumnBase<ColumnBuilderDataType, boolean, boolean, ColumnBuilderDataType | null>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPodTable(value: unknown): value is GenericPodTable {
  return isRecord(value) && 'columns' in value && 'config' in value;
}

function hasStringValue(value: unknown): value is { value: string } {
  return isRecord(value) && typeof value.value === 'string';
}

export class PodDatabase<TSchema extends Record<string, unknown> = Record<string, never>> {
  static readonly [entityKind] = 'PodDatabase';

  private notificationsClient: NotificationsClient | null = null;
  private federatedExecutor: FederatedQueryExecutor | null = null;
  /** 最近一次联邦查询的错误（如果有） */
  private lastFederatedErrors: FederatedError[] = [];

  constructor(
    public dialect: PodDialect,
    public session: PodAsyncSession,
    public schema?: TSchema
  ) {}

  /**
   * 获取最近一次联邦查询的错误
   * 在调用 findMany 等方法后可以检查此值
   */
  getLastFederatedErrors(): FederatedError[] {
    return this.lastFederatedErrors;
  }

  /**
   * 清除联邦查询错误
   */
  clearFederatedErrors(): void {
    this.lastFederatedErrors = [];
  }

  /**
   * 获取或创建 FederatedQueryExecutor
   */
  private getFederatedExecutor(): FederatedQueryExecutor {
    if (!this.federatedExecutor) {
      this.federatedExecutor = new FederatedQueryExecutor({
        fetch: this.dialect.getAuthenticatedFetch(),
      });
    }
    return this.federatedExecutor;
  }

  /**
   * Create a table from a schema with hooks
   * 
   * This is the recommended way to create tables when you need hooks that
   * can access the database instance (e.g., for cross-table operations).
   * 
   * @param schema - The schema definition (created via solidSchema())
   * @param options - Table options including base path and hooks
   * @returns A PodTable instance with hooks bound to this database
   * 
   * @example
   * ```typescript
   * const userSchema = solidSchema('users', {
   *   id: id(),
   *   name: text('name').predicate(SCHEMA.name),
   *   email: text('email').predicate(SCHEMA.email),
   * }, {
   *   type: SCHEMA.Person,
   * });
   * 
   * const userTable = db.createTable(userSchema, {
   *   base: '/data/users/',
   *   hooks: {
   *     afterInsert: async (ctx, record) => {
   *       // ctx.db is available - can query/insert other tables
   *       await ctx.db.insert(auditTable).values({
   *         action: 'user_created',
   *         userId: record['@id'],
   *       });
   *     },
   *     afterUpdate: async (ctx, record, changes) => {
   *       if ('email' in changes) {
   *         // Send verification email via another service
   *         await ctx.db.insert(notificationTable).values({
   *           type: 'email_changed',
   *           userId: record['@id'],
   *         });
   *       }
   *     },
   *   },
   * });
   * ```
   */
  createTable<TColumns extends Record<string, PodColumnBase>>(
    schema: SolidSchema<TColumns>,
    options: InstantiateTableOptions
  ): PodTable<TColumns> {
    // Create table using schema.table() with the base path
    const table = schema.table('default', options);
    
    // Attach hooks if provided
    if (options.hooks) {
      table.config.hooks = options.hooks;
    }
    
    // Store db handle in table for hook context
    // This allows hooks to access db when invoked
    Reflect.set(table as object, '_db', this);
    
    return table;
  }

  // SELECT 查询
  select<TTable extends PodTable>(fields?: SelectFieldMap): SelectQueryBuilder<TTable> {
    return this.session.select<TTable>(fields);
  }

  // INSERT 查询
  insert<TTable extends PodTable>(table: TTable): InsertQueryBuilder<TTable> {
    return this.session.insert(table);
  }

  // UPDATE 查询
  update<TTable extends PodTable>(table: TTable): UpdateQueryBuilder<TTable> {
    return this.session.update(table);
  }

  // DELETE 查询
  delete<TTable extends PodTable>(table: TTable): DeleteQueryBuilder<TTable> {
    return this.session.delete(table);
  }

  // 直接执行 SPARQL 查询（高级 escape hatch）
  async execute(query: string): Promise<unknown[]> {
    return await this.executeSPARQL(query);
  }

  // 显式 SPARQL 执行入口
  async executeSPARQL(query: string): Promise<unknown[]> {
    if (typeof query !== 'string' || query.trim().length === 0) {
      throw new Error('executeSPARQL requires a non-empty SPARQL query string');
    }
    return await this.dialect.executeSPARQL(query);
  }

  // 顺序执行一组操作，保持与 Drizzle batch 类似的调用方式
  async batch<TOperations extends readonly unknown[]>(operations: TOperations): Promise<{ [K in keyof TOperations]: Awaited<TOperations[K]> }> {
    const results: unknown[] = [];

    for (const operation of operations) {
      results.push(await operation);
    }

    return results as { [K in keyof TOperations]: Awaited<TOperations[K]> };
  }

  // Find first matching row (LIMIT 1)
  async findFirst<TTable extends PodTable>(
    table: TTable,
    where?: PublicWhereObject
  ): Promise<InferTableData<TTable> | null> {
    const builder = this.select<TTable>().from(table).limit(1);
    if (where && Object.keys(where).length > 0) {
      builder.where(where);
    }
    const rows = await builder;
    return rows.length > 0 ? rows[0] : null;
  }

  private getLocatorTemplate(table: PodTable): string {
    return table.getSubjectTemplate?.() ?? table.config?.subjectTemplate ?? '{id}';
  }

  private getRequiredLocatorKeys(table: PodTable): string[] {
    const template = this.getLocatorTemplate(table);
    const keys = Array.from(template.matchAll(/\{([^}]+)\}/g))
      .map((match) => match[1])
      .filter((key) => key !== 'index');
    return Array.from(new Set(keys));
  }

  private resolveLocatorSubject<TTable extends PodTable>(
    table: TTable,
    locator: EntityLocator,
    methodName: 'findByLocator' | 'updateByLocator' | 'deleteByLocator',
  ): string {
    if (!isRecord(locator) || Array.isArray(locator)) {
      throw new Error(`${methodName} requires a locator object`);
    }

    if ('@id' in locator) {
      throw new Error(`${methodName} does not accept '@id'. Use ${methodName.replace('Locator', 'Iri')}(table, iri) instead.`);
    }

    const idValue = locator.id;
    if (typeof idValue === 'string' && (idValue.startsWith('http://') || idValue.startsWith('https://'))) {
      throw new Error(`${methodName} does not accept a full IRI in locator.id. Use ${methodName.replace('Locator', 'Iri')}(table, iri) instead.`);
    }

    const requiredKeys = this.getRequiredLocatorKeys(table);
    const missingKeys = requiredKeys.filter((key) => locator[key] === undefined || locator[key] === null);
    if (missingKeys.length > 0) {
      const template = this.getLocatorTemplate(table);
      throw new Error(
        `${methodName} requires a complete locator for subjectTemplate '${template}'. ` +
        `Missing [${missingKeys.join(', ')}]. ` +
        `Use ${methodName.replace('Locator', 'Iri')}(table, iri) when you already have a full IRI.`
      );
    }

    const resolver = this.dialect.getResolver(table);
    return resolver.resolveSubject(table, locator);
  }

  async findByLocator<TTable extends PodTable>(
    table: TTable,
    locator: EntityLocator,
  ): Promise<InferTableData<TTable> | null> {
    const iri = this.resolveLocatorSubject(table, locator, 'findByLocator');
    return await this.findByIri(table, iri);
  }

  /**
   * 通过完整 IRI 查询单个实体
   * 
   * @param table - 表定义（用于解析 schema）
   * @param iri - 完整 IRI，本地或远程
   * @returns 实体数据，如果不存在则返回 null
   * 
   * @example
   * ```typescript
   * // 本地 Agent
   * db.findByIri(agentTable, 'https://my.pod/agents/translator')
   * 
   * // 远程 Profile  
   * db.findByIri(solidProfileTable, 'https://alice.pod/profile/card#me')
   * 
   * // 业务层不区分本地远程
   * db.findByIri(agentTable, contact.entityUri)
   * ```
   */
  async findByIri<TTable extends PodTable>(
    table: TTable,
    iri: string
  ): Promise<InferTableData<TTable> | null> {
    if (!iri || typeof iri !== 'string') {
      throw new Error('findByIri requires a valid IRI string');
    }

    const exactRead = await this.findByIriViaExactSparql(table, iri);
    if (exactRead !== undefined) {
      return exactRead as InferTableData<TTable>;
    }

    // 保持原始表上下文，让 subjectTemplate/base 反解保持一致。
    // whereByIri() 已经会把 SELECT 精确定位到目标资源，不需要把表重绑到具体文档。
    const rows = await this.session
      .select()
      .from(table)
      .whereByIri(iri)
      .limit(1);
    
    return (rows[0] ?? null) as InferTableData<TTable> | null;
  }

  private getColumnPredicate(table: PodTable, column: PodColumnBase): string | undefined {
    return column.options?.predicate ?? column.getPredicate?.(table.config.namespace);
  }

  private async findByIriViaExactSparql<TTable extends PodTable>(
    table: TTable,
    iri: string,
  ): Promise<Record<string, unknown> | null | undefined> {
    if (!isPodTable(table)) {
      return undefined;
    }
    if (
      typeof this.dialect.resolveTableResource !== 'function'
      || typeof this.dialect.executeOnResource !== 'function'
    ) {
      return undefined;
    }

    const documentUrl = this.parseIri(iri).documentUrl;
    const descriptor = this.dialect.resolveTableResource(table);
    const query = {
      type: 'SELECT' as const,
      query: descriptor.mode === 'sparql'
        ? `SELECT ?p ?o WHERE { GRAPH <${documentUrl}> { <${iri}> ?p ?o . } }`
        : `SELECT ?p ?o WHERE { <${iri}> ?p ?o . }`,
      prefixes: {}
    };
    const rows = descriptor.mode === 'sparql'
      ? await this.dialect.executeOnResource(documentUrl, query, descriptor)
      : await this.dialect.executeOnResource(documentUrl, query);
    const mapped = this.mapPredicateObjectRows(table, iri, rows);
    if (mapped) {
      return mapped;
    }

    return null;
  }

  private mapPredicateObjectRows(
    table: PodTable,
    iri: string,
    rows: unknown[],
  ): Record<string, unknown> | null {
    if (!Array.isArray(rows) || rows.length === 0) {
      return null;
    }

    const row: Record<string, unknown> = {
      subject: iri,
      '@id': iri,
      uri: iri,
    };
    const derivedId = this.extractIdFromIri(table, iri);
    if (derivedId !== undefined) {
      row.id = derivedId;
    }

    let hasType = false;
    let hasAnyMappedPredicate = false;

    for (const result of rows) {
      if (!isRecord(result)) {
        continue;
      }

      const predicate = result.p ?? result.predicate ?? result['?p'];
      const object = result.o ?? result.object ?? result['?o'];
      if (typeof predicate !== 'string') {
        continue;
      }

      if (
        predicate === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
        && object === table.config.type
      ) {
        hasType = true;
      }

      for (const [key, column] of Object.entries(table.columns ?? {}) as Array<[string, VirtualIdPodColumn]>) {
        if (column._virtualId) {
          continue;
        }

        const columnPredicate = this.getColumnPredicate(table, column);
        if (!columnPredicate || columnPredicate === '@id' || columnPredicate !== predicate) {
          continue;
        }

        const isArray = column.options?.isArray || column.dataType === 'array';
        if (isArray) {
          const existing = Array.isArray(row[key]) ? row[key] : row[key] === undefined ? [] : [row[key]];
          row[key] = [...existing, object];
        } else if (row[key] === undefined) {
          row[key] = object;
        }
        hasAnyMappedPredicate = true;
      }
    }

    if (!hasType && !hasAnyMappedPredicate) {
      return null;
    }
    return row;
  }

  private extractIdFromIri(table: PodTable, iri: string): string | undefined {
    try {
      const parsedId = this.dialect.getResolver(table).parseId(table, iri);
      if (parsedId) {
        return parsedId;
      }
    } catch {
      // Fall through to conservative legacy parsing for non-standard tables.
    }

    const template = table.getSubjectTemplate?.() ?? table.config?.subjectTemplate;
    if (!template) {
      return undefined;
    }

    if (template === '{id}.ttl') {
      const fileName = iri.split('/').pop() ?? '';
      return fileName.endsWith('.ttl') ? fileName.slice(0, -4) : fileName || undefined;
    }

    if (template === '{id}.ttl#it') {
      const withoutFragment = iri.split('#')[0];
      const fileName = withoutFragment.split('/').pop() ?? '';
      return fileName.endsWith('.ttl') ? fileName.slice(0, -4) : fileName || undefined;
    }

    const hashIndex = iri.indexOf('#');
    if (hashIndex >= 0 && template.includes('{id}') && template.startsWith('#')) {
      return decodeURIComponent(iri.slice(hashIndex + 1));
    }

    const fileName = iri.split('#')[0].split('/').pop() ?? '';
    return fileName.endsWith('.ttl') ? fileName.slice(0, -4) : undefined;
  }

  /**
   * 解析 IRI 为文档 URL 和 fragment
   */
  private parseIri(iri: string): { documentUrl: string; fragment: string | null } {
    const hashIndex = iri.indexOf('#');
    if (hashIndex >= 0) {
      return {
        documentUrl: iri.substring(0, hashIndex),
        fragment: iri.substring(hashIndex + 1)
      };
    }
    return { documentUrl: iri, fragment: null };
  }

  /**
   * 通过完整 IRI 订阅单个实体的变更
   * 
   * @param table - 表定义
   * @param iri - 完整 IRI，本地或远程
   * @param options - 订阅选项
   * @returns 取消订阅函数
   * 
   * @example
   * ```typescript
   * const unsubscribe = await db.subscribeByIri(
   *   solidProfileTable,
   *   'https://alice.pod/profile/card#me',
   *   {
   *     onUpdate: (data) => {
   *       console.log('Profile updated:', data.name)
   *     },
   *     onDelete: () => {
   *       console.log('Profile deleted')
   *     },
   *     onError: (error) => {
   *       console.log('Subscription error:', error)
   *     }
   *   }
   * )
   * 
   * // 离开时取消订阅
   * unsubscribe()
   * ```
   */
  async subscribeByIri<TTable extends PodTable>(
    table: TTable,
    iri: string,
    options: EntitySubscribeOptions<InferTableData<TTable>>
  ): Promise<() => void> {
    if (!iri || typeof iri !== 'string') {
      throw new Error('subscribeByIri requires a valid IRI string');
    }

    if (!iri.startsWith('http://') && !iri.startsWith('https://')) {
      throw new Error(`subscribeByIri requires an absolute IRI, got: ${iri}`);
    }

    // 懒初始化 NotificationsClient
    if (!this.notificationsClient) {
      const authenticatedFetch = this.dialect.getAuthenticatedFetch();
      const config: NotificationsClientConfig = {
        preferredChannels: this.dialect.config.preferredChannels ?? ['streaming-http', 'websocket'],
      };
      this.notificationsClient = new NotificationsClient(authenticatedFetch, config);
    }

    // 解析文档 URL（订阅文档，而不是 fragment）
    const { documentUrl } = this.parseIri(iri);

    // 订阅文档变更
    const subscription = await this.notificationsClient.subscribe(documentUrl, {
      channel: options.channel,
      features: options.features,
      onNotification: async (event) => {
        try {
          if (event.type === 'Update') {
            // 重新获取数据
            const data = await this.findByIri(table, iri);
            if (data) {
              await options.onUpdate(data);
            }
          } else if (event.type === 'Delete') {
            await options.onDelete?.();
          }
        } catch (error) {
          options.onError?.(error as Error);
        }
      },
      onError: options.onError,
    });

    // 返回取消订阅函数
    return () => subscription.unsubscribe();
  }

  /**
   * 通过完整 IRI 更新单个实体
   * 
   * @param table - 表定义
   * @param iri - 完整 IRI
   * @param data - 要更新的数据
   * @returns 更新后的实体数据
   * 
   * @example
   * ```typescript
   * const updated = await db.updateByIri(
   *   agentTable,
   *   'https://my.pod/agents/translator#agent',
   *   { name: 'New Name', description: 'Updated description' }
   * )
   * ```
   */
  async updateByIri<TTable extends PodTable>(
    table: TTable,
    iri: string,
    data: Partial<Omit<InferTableData<TTable>, '@id' | 'id'>>
  ): Promise<InferTableData<TTable> | null> {
    if (!iri || typeof iri !== 'string') {
      throw new Error('updateByIri requires a valid IRI string');
    }

    if (!iri.startsWith('http://') && !iri.startsWith('https://')) {
      throw new Error(`updateByIri requires an absolute IRI, got: ${iri}`);
    }

    const updateData = data as Parameters<UpdateQueryBuilder<typeof table>['set']>[0];

    // 使用 whereByIri 内部方法进行更新
    await this.session
      .update(table)
      .set(updateData)
      .whereByIri(iri);

    // 返回更新后的数据
    return await this.findByIri(table, iri);
  }

  async updateByLocator<TTable extends PodTable>(
    table: TTable,
    locator: EntityLocator,
    data: Partial<Omit<InferTableData<TTable>, '@id' | 'id'>>
  ): Promise<InferTableData<TTable> | null> {
    const iri = this.resolveLocatorSubject(table, locator, 'updateByLocator');
    return await this.updateByIri(table, iri, data);
  }

  /**
   * 通过完整 IRI 删除单个实体
   * 
   * @param table - 表定义
   * @param iri - 完整 IRI
   * @returns 是否删除成功
   * 
   * @example
   * ```typescript
   * const deleted = await db.deleteByIri(
   *   agentTable,
   *   'https://my.pod/agents/translator#agent'
   * )
   * ```
   */
  async deleteByIri<TTable extends PodTable>(
    table: TTable,
    iri: string
  ): Promise<boolean> {
    if (!iri || typeof iri !== 'string') {
      throw new Error('deleteByIri requires a valid IRI string');
    }

    if (!iri.startsWith('http://') && !iri.startsWith('https://')) {
      throw new Error(`deleteByIri requires an absolute IRI, got: ${iri}`);
    }

    // 先检查实体是否存在
    const existing = await this.findByIri(table, iri);
    if (!existing) {
      return false;
    }

    // 使用 whereByIri 内部方法进行删除
    await this.session
      .delete(table)
      .whereByIri(iri);

    return true;
  }

  async deleteByLocator<TTable extends PodTable>(
    table: TTable,
    locator: EntityLocator,
  ): Promise<boolean> {
    const iri = this.resolveLocatorSubject(table, locator, 'deleteByLocator');
    return await this.deleteByIri(table, iri);
  }

  // 事务支持
  async transaction<T>(
    transaction: (tx: PodDatabase<TSchema>) => Promise<T>
  ): Promise<T> {
    return await this.session.transaction(async (txSession) => {
      const txDb = new PodDatabase(this.dialect, txSession, this.schema);
      return await transaction(txDb);
    });
  }

  // 获取方言信息
  getDialect() {
    return this.dialect;
  }

  // 获取会话信息
  getSession() {
    return this.session;
  }

  // 获取模式信息
  getSchema() {
    return this.schema;
  }

  /**
   * 数据发现入口（TypeIndex + SAI 组合策略）
   */
  get discovery(): DataDiscovery {
    return this.dialect.getDiscovery();
  }

  // 连接状态
  async connect() {
    return await this.dialect.connect();
  }

  // 断开连接
  async disconnect() {
    // 取消所有订阅
    if (this.notificationsClient) {
      this.notificationsClient.unsubscribeAll();
    }
    return await this.dialect.disconnect();
  }

  /**
   * 订阅表/资源的变化通知
   * 
   * @param table - 要订阅的表（会订阅其容器或资源）
   * @param options - 订阅选项，支持按类型分开的回调
   * @returns 订阅句柄，可用于取消订阅
   * 
   * @example
   * ```typescript
   * const subscription = await db.subscribe(posts, {
   *   onCreate: async (activity) => {
   *     console.log('Created:', activity.object);
   *     const latest = await db.select().from(posts);
   *   },
   *   onUpdate: async (activity) => {
   *     console.log('Updated:', activity.object);
   *     const latest = await db.select().from(posts);
   *   },
   *   onDelete: (activity) => {
   *     console.log('Deleted:', activity.object);
   *   },
   *   onError: (error) => {
   *     console.error('Subscription error:', error);
   *   }
   * });
   * 
   * // 取消订阅
   * subscription.unsubscribe();
   * ```
   */
  async subscribe<TTable extends PodTable>(
    table: TTable,
    options: TableSubscribeOptions
  ): Promise<Subscription> {
    // 懒初始化 NotificationsClient
    if (!this.notificationsClient) {
      const authenticatedFetch = this.dialect.getAuthenticatedFetch();
      const config: NotificationsClientConfig = {
        preferredChannels: this.dialect.config.preferredChannels ?? ['streaming-http', 'websocket'],
      };
      this.notificationsClient = new NotificationsClient(authenticatedFetch, config);
    }

    // 获取表的资源 URL（容器或文件），支持 iri 覆盖
    const topic = this.resolveTableTopic(table, options.iri);

    // 将 TableSubscribeOptions 转换为底层 SubscribeOptions
    const subscribeOptions: SubscribeOptions = {
      channel: options.channel,
      features: options.features,
      onNotification: (event) => {
        options.onNotification?.(event);

        const hasTypedHandlers = Boolean(
          options.onCreate || options.onUpdate || options.onDelete || options.onAdd || options.onRemove
        );

        if (hasTypedHandlers) {
          // 构造 Activity 对象
          const activity: Activity = {
            id: event.id,
            type: event.type,
            object: event.object,
            published: event.published,
            state: event.state,
          };

          // 根据类型分发到对应回调
          switch (event.type) {
            case 'Create':
              options.onCreate?.(activity);
              break;
            case 'Update':
              options.onUpdate?.(activity);
              break;
            case 'Delete':
              options.onDelete?.(activity);
              break;
            case 'Add':
              options.onAdd?.(activity);
              break;
            case 'Remove':
              options.onRemove?.(activity);
              break;
          }
        }
      },
      onError: options.onError,
      onClose: options.onClose,
    };

    return this.notificationsClient.subscribe(topic, subscribeOptions);
  }

  /**
   * 解析表对应的订阅主题 URL
   * @param table 表定义
   * @param iriOverride 可选的 IRI 覆盖（用于订阅其他 Pod 的资源）
   */
  private resolveTableTopic<TTable extends PodTable>(table: TTable, iriOverride?: string): string {
    // 如果提供了 iri 覆盖，直接使用
    if (iriOverride) {
      if (!iriOverride.startsWith('http://') && !iriOverride.startsWith('https://')) {
        throw new Error(`iri must be an absolute URL, got: ${iriOverride}`);
      }
      return iriOverride;
    }

    const base = table.config.base || '';
    
    // 如果 base 已经是绝对 URL，直接使用
    if (base.startsWith('http://') || base.startsWith('https://')) {
      return base;
    }
    
    // 使用 dialect.getPodUrl() 获取正确的 Pod 根路径
    // 这确保与其他 URL 解析逻辑一致（如 TypeIndex、SPARQL endpoint 等）
    const podUrl = this.dialect.getPodUrl();
    const baseUrl = podUrl.endsWith('/') ? podUrl : `${podUrl}/`;
    const relativeBase = base.startsWith('/') ? base.slice(1) : base;
    
    return `${baseUrl}${relativeBase}`;
  }

  // 获取连接配置
  getConfig() {
    return this.dialect.getConfig();
  }

  /**
   * 通过 RDF 类型自动发现并生成表定义
   * 
   * 流程：
   * 1. 通过 TypeIndex/Interop 发现数据位置
   * 2. 如果有 ShapeTree/Shape，加载并解析
   * 3. 从 Shape 生成 PodTable 定义
   * 
   * @param rdfClass RDF 类型 URI (如 'http://schema.org/Person')
   * @returns 生成的 PodTable，如果未发现则返回 null
   * 
   * @example
   * ```typescript
   * // 自动发现 Person 类型的表
   * const persons = await db.discoverTable('http://schema.org/Person');
   * if (persons) {
   *   const data = await db.select().from(persons);
   * }
   * ```
   */
  async discoverTable(rdfClass: string): Promise<PodTable | null> {
    // 1. 发现数据位置
    const locations = await this.dialect.discoverDataLocations(rdfClass);
    
    if (locations.length === 0) {
      console.log(`[discoverTable] No data locations found for ${rdfClass}`);
      return null;
    }

    const location = locations[0]; // 使用第一个发现的位置
    const shapeUrl = location.shapes[0]?.url;
    console.log(`[discoverTable] Found location: ${location.container}, shape: ${shapeUrl || 'none'}`);

    // 2. 如果有 Shape，加载并生成表
    if (shapeUrl) {
      const shapeManager = this.dialect.getShapeManager();
      const shape = await shapeManager.loadShape(shapeUrl, this.dialect.getAuthenticatedFetch());
      
      if (shape) {
        console.log(`[discoverTable] Loaded shape with ${shape.properties.length} properties`);
        const generated = shapeManager.shapeToTable(shape, location.container);
        
        // 初始化表
        await this.init(generated.table);
        
        return generated.table;
      }
    }

    // 3. 没有 Shape，使用基础表定义（仅 id 列）
    console.log(`[discoverTable] No shape available, creating basic table`);
    const { podTable, string } = await import('./schema');
    
    const tableName = this.extractClassName(rdfClass);
    const table = podTable(tableName, {
      id: string('id').primaryKey()
    }, {
      type: rdfClass,
      base: location.container
    });

    await this.init(table as unknown as PodTable<Record<string, GenericPodColumn>>);
    return table as unknown as PodTable;
  }

  /**
   * 发现多个类型的表
   */
  async discoverTables(rdfClasses: string[]): Promise<PodTable[]> {
    const tables: PodTable[] = [];
    
    for (const rdfClass of rdfClasses) {
      const table = await this.discoverTable(rdfClass);
      if (table) {
        tables.push(table);
      }
    }
    
    return tables;
  }

  /**
   * 发现某类型数据的所有位置
   * @param rdfClass RDF 类型 URI
   * @param options 可选的过滤选项
   * @returns 数据位置列表
   * 
   * @example
   * ```typescript
   * // 发现所有 Person 类型的数据位置
   * const locations = await db.discover('https://schema.org/Person');
   * 
   * // 按 appId 过滤
   * const acmeLocations = await db.discover('https://schema.org/Person', { 
   *   appId: 'https://acme.com/app#id' 
   * });
   * ```
   */
  async discover(rdfClass: string, options?: import('./discovery').DiscoverOptions): Promise<import('./discovery').DataLocation[]> {
    return this.dialect.discoverDataLocations(rdfClass, options);
  }

  /**
   * 获取所有数据注册信息
   * @returns 所有注册的数据信息列表
   * 
   * @example
   * ```typescript
   * const allRegistrations = await db.discoverAll();
   * for (const reg of allRegistrations) {
   *   console.log(`${reg.rdfClass} at ${reg.container}`);
   *   console.log(`  Shape: ${reg.shape}`);
   *   console.log(`  Registered by: ${reg.registeredBy}`);
   * }
   * ```
   */
  async discoverAll(): Promise<import('./discovery').DataRegistrationInfo[]> {
    return this.dialect.discoverAll();
  }

  /**
   * 按应用 ID 发现数据位置
   * @param appId 应用标识符
   * @returns 该应用注册的数据位置列表
   * 
   * @example
   * ```typescript
   * const acmeData = await db.discoverByApp('https://acme.com/app#id');
   * ```
   */
  async discoverByApp(appId: string): Promise<import('./discovery').DataLocation[]> {
    return this.dialect.discoverByApp(appId);
  }

  /**
   * 从 DataLocation 创建 PodTable
   * 如果 location 有 shape，会加载 Shape 并生成完整的表定义
   * 
   * @param location 数据位置信息
   * @param options 转换选项，可指定使用哪个 Shape
   * @returns PodTable 实例
   * 
   * @example
   * ```typescript
   * // 使用第一个可用的 Shape
   * const table = await db.locationToTable(location);
   * 
   * // 指定使用某个 app 注册的 Shape
   * const table = await db.locationToTable(location, { 
   *   appId: 'https://acme.com/app#id' 
   * });
   * 
   * // 直接传入 ShapeInfo 对象
   * const table = await db.locationToTable(location, { 
   *   shape: location.shapes[0] 
   * });
   * 
   * // 或者传入 Shape URL
   * const table = await db.locationToTable(location, { 
   *   shape: 'https://shapes.example/Person.shacl' 
   * });
   * ```
   */
  async locationToTable(
    location: import('./discovery').DataLocation, 
    options?: import('./discovery').LocationToTableOptions
  ): Promise<PodTable> {
    const opts = options ?? {};

    // 1. 选择 Shape（按优先级：shape > appId > 默认第一个）
    let selectedShape: import('./discovery').ShapeInfo | undefined;
    
    if (opts.shape) {
      // 直接指定 Shape
      if (typeof opts.shape === 'string') {
        // Shape URL
        selectedShape = location.shapes.find(s => s.url === opts.shape);
        if (!selectedShape) {
          // URL 不在 shapes 列表中，创建临时 ShapeInfo
          selectedShape = { url: opts.shape, source: 'config' };
        }
      } else {
        // ShapeInfo 对象
        selectedShape = opts.shape;
      }
    } else if (opts.appId) {
      // 按 appId 选择
      selectedShape = location.shapes.find(s => s.registeredBy === opts.appId);
      if (!selectedShape) {
        throw new Error(`[locationToTable] No shape found for appId: ${opts.appId}`);
      }
    } else {
      // 默认使用第一个
      selectedShape = location.shapes[0];
    }

    // 2. 如果有 Shape，加载并生成表
    if (selectedShape?.url) {
      const shapeManager = this.dialect.getShapeManager();
      const shape = await shapeManager.loadShape(selectedShape.url, this.dialect.getAuthenticatedFetch());
      
      if (shape) {
        console.log(`[locationToTable] Loaded shape: ${selectedShape.url} (${shape.properties.length} properties)`);
        if (selectedShape.registeredBy) {
          console.log(`[locationToTable] -> registeredBy: ${selectedShape.registeredBy}`);
        }
        const generated = shapeManager.shapeToTable(shape, location.container);
        
        // 初始化表
        await this.init(generated.table);
        return generated.table;
      }
    }

    // 3. 没有 Shape，返回仅含 id 的基础表
    console.log(`[locationToTable] No shape available, creating basic table for container: ${location.container}`);
    const { podTable, string } = await import('./schema');
    
    const tableName = this.extractContainerName(location.container);
    
    const table = podTable(tableName, {
      id: string('id').primaryKey()
    }, {
      type: 'http://www.w3.org/2000/01/rdf-schema#Resource',
      base: location.container
    });

    await this.init(table as unknown as PodTable<Record<string, GenericPodColumn>>);
    return table as unknown as PodTable;
  }

  /**
   * 从容器 URL 提取表名
   */
  private extractContainerName(containerUrl: string): string {
    // 去掉末尾斜杠
    const url = containerUrl.replace(/\/$/, '');
    const lastSlash = url.lastIndexOf('/');
    if (lastSlash >= 0) {
      return url.substring(lastSlash + 1).toLowerCase() || 'data';
    }
    return 'data';
  }

  /**
   * 发现并转换为表 - 支持按 appId 过滤
   * 
   * @param rdfClass RDF 类型 URI
   * @param options 发现选项
   * @param tableOptions 转表选项（指定使用哪个 Shape）
   * 
   * @example
   * ```typescript
   * // 发现所有 Person 表
   * const allPersonTables = await db.discoverTablesFor('schema:Person');
   * 
   * // 只要 Acme app 的 Person 表，并使用 Acme 的 Shape
   * const acmePersonTable = await db.discoverTablesFor('schema:Person', 
   *   { appId: 'https://acme.com/app#id' },
   *   { appId: 'https://acme.com/app#id' }
   * );
   * ```
   */
  async discoverTablesFor(
    rdfClass: string, 
    options?: import('./discovery').DiscoverOptions,
    tableOptions?: import('./discovery').LocationToTableOptions
  ): Promise<PodTable[]> {
    const locations = await this.discover(rdfClass, options);
    const tables: PodTable[] = [];
    
    for (const location of locations) {
      const table = await this.locationToTable(location, tableOptions);
      tables.push(table);
    }
    
    return tables;
  }

  /**
   * 从 RDF 类型 URI 提取类名
   */
  private extractClassName(rdfClass: string): string {
    const hashIndex = rdfClass.lastIndexOf('#');
    if (hashIndex >= 0) {
      return rdfClass.substring(hashIndex + 1).toLowerCase();
    }
    
    const slashIndex = rdfClass.lastIndexOf('/');
    if (slashIndex >= 0) {
      return rdfClass.substring(slashIndex + 1).toLowerCase();
    }
    
    return rdfClass.toLowerCase();
  }

  // 数据源管理方法
  addSource(source: string): void {
    this.dialect.addSource(source);
  }

  removeSource(source: string): void {
    this.dialect.removeSource(source);
  }

  getSources(): string[] {
    return this.dialect.getSources();
  }

  async addSourcesFromTypeIndex(): Promise<void> {
    return await this.dialect.addSourcesFromTypeIndex();
  }

  async init<
    TColumns extends Record<string, GenericPodColumn>,
    TTable extends PodTable<TColumns>
  >(
    tables: TTable | TTable[],
    options?: InitOptions
  ): Promise<void>;
  async init<
    TColumns extends Record<string, GenericPodColumn>,
    TTable extends PodTable<TColumns>
  >(...tables: Array<TTable | TTable[]>): Promise<void>;
  async init<
    TColumns extends Record<string, GenericPodColumn>,
    TTable extends PodTable<TColumns>
  >(
    ...args: Array<TTable | TTable[] | InitOptions>
  ): Promise<void> {
    // 解析参数：最后一个参数可能是 options
    let options: InitOptions | undefined;
    let tableArgs: Array<TTable | TTable[]>;
    
    const lastArg = args[args.length - 1];
    if (lastArg && typeof lastArg === 'object' && !Array.isArray(lastArg) && !('columns' in lastArg)) {
      // 最后一个参数是 options
      options = lastArg as InitOptions;
      tableArgs = args.slice(0, -1) as Array<TTable | TTable[]>;
    } else {
      tableArgs = args as Array<TTable | TTable[]>;
    }

    const flattened: PodTable[] = [];
    for (const entry of tableArgs) {
      if (!entry) continue;
      if (Array.isArray(entry)) {
        for (const table of entry) {
          if (table) {
            flattened.push(table);
          }
        }
      } else {
        flattened.push(entry);
      }
    }

    for (const table of flattened) {
      if (typeof table.init === 'function') {
        await table.init(this.dialect);
      } else {
        await this.dialect.registerTable(table);
      }

      // 如果需要生成 Shape
      if (options?.generateShape || options?.saveShape) {
        const shapeManager = this.dialect.getShapeManager();
        const shape = shapeManager.generateShape(table);
        
        // 如果需要保存 Shape
        if (options?.saveShape) {
          const podUrl = this.dialect.getPodUrl();
          let shapeLocation = options.shapeLocation;
          
          if (!shapeLocation) {
            // 默认保存到 /shapes/ 目录
            shapeLocation = `${podUrl}shapes/`;
          } else if (!shapeLocation.startsWith('http')) {
            // 相对路径转绝对路径
            shapeLocation = `${podUrl}${shapeLocation.replace(/^\//, '')}`;
          }
          
          // 确保以 / 结尾（容器）
          if (!shapeLocation.endsWith('/')) {
            shapeLocation += '/';
          }
          
          const shapeUrl = `${shapeLocation}${table.config.name}Shape.ttl`;
          
          try {
            await shapeManager.saveShape(shape, shapeUrl);
            console.log(`[init] Shape saved to: ${shapeUrl}`);
          } catch (error) {
            console.warn(`[init] Failed to save Shape to ${shapeUrl}:`, error);
          }
        }
      }
    }
  }

  // Drizzle 风格的 query facade
  private queryProxy?: QueryProxy<TSchema>;

  get query(): QueryProxy<TSchema> {
    if (!this.queryProxy) {
      this.queryProxy = this.buildQueryProxy();
    }
    return this.queryProxy;
  }

  private buildQueryProxy(): QueryProxy<TSchema> {
    const schemaEntries = (this.schema && typeof this.schema === 'object')
      ? Object.entries(this.schema as Record<string, unknown>)
      : [];
    const tableMap = new Map<string, GenericPodTable>();
    for (const [key, value] of schemaEntries) {
      if (isPodTable(value)) {
        tableMap.set(key, value);
      }
    }

    const createHelper = (_tableName: string, table: GenericPodTable): QueryTableHelper<typeof table> => {
      const createLazy = <T>(executor: () => Promise<T>): Promise<T> => {
        let promise: Promise<T> | null = null;
        const run = () => {
          if (!promise) {
            promise = executor();
          }
          return promise;
        };

        return {
          then: (onfulfilled, onrejected) => run().then(onfulfilled, onrejected),
          catch: (onrejected) => run().catch(onrejected),
          finally: (onfinally) => run().finally(onfinally),
          [Symbol.toStringTag]: 'Promise',
        } as Promise<T>;
      };

      const projectColumns = (
        row: QueryRow,
        columns: SelectFieldMap,
        withOption?: QueryFindManyOptions['with']
      ): QueryRow => {
        const projected: QueryRow = {};
        for (const [alias, field] of Object.entries(columns)) {
          if (field instanceof PodColumnBase) {
            projected[alias] = row[field.name];
            continue;
          }
          if (typeof field === 'string') {
            projected[alias] = row[field] ?? row[field.split('.').pop() ?? field];
            continue;
          }
          const name = (field as { name?: unknown })?.name;
          if (typeof name === 'string') {
            projected[alias] = row[name];
            continue;
          }
          projected[alias] = row[alias];
        }

        if (withOption) {
          for (const relationName of Object.keys(withOption)) {
            projected[relationName] = row[relationName] ?? [];
          }
        }

        return projected;
      };

      const executeFindMany = async <T = InferTableData<typeof table>>(options?: QueryFindManyOptions): Promise<T[]> => {
        this.clearFederatedErrors();

        let builder = this.session.select().from(table);
        if (options?.where) {
          builder = builder.where(options.where);
        }
        if (options?.orderBy) {
          const orderItems = Array.isArray(options.orderBy) ? options.orderBy : [options.orderBy];
          orderItems.forEach((item) => {
            builder = builder.orderBy(item.column, item.direction ?? 'asc');
          });
        }
        if (typeof options?.limit === 'number') {
          builder = builder.limit(options.limit);
        }
        if (typeof options?.offset === 'number') {
          builder = builder.offset(options.offset);
        }

        let rows = await builder as QueryRow[];
        if (options?.with && Object.keys(options.with).length > 0) {
          rows = await this.eagerLoadWith(rows, table, options.with, tableMap);
        }
        const columns = options?.columns;
        if (columns) {
          rows = rows.map((row) => projectColumns(row, columns, options.with));
        }
        return rows as T[];
      };

      const findMany = <T = InferTableData<typeof table>>(options?: QueryFindManyOptions): Promise<T[]> =>
        createLazy(() => executeFindMany<T>(options));

      const applyExactOptions = async <T = InferTableData<typeof table>>(
        row: QueryRow | null,
        options?: QueryExactOptions,
      ): Promise<T | null> => {
        if (!row) {
          return null;
        }

        let rows: QueryRow[] = [row];
        if (options?.with && Object.keys(options.with).length > 0) {
          rows = await this.eagerLoadWith(rows, table, options.with, tableMap);
        }
        const columns = options?.columns;
        if (columns) {
          rows = rows.map((item) => projectColumns(item, columns, options.with));
        }
        return (rows[0] ?? null) as T | null;
      };

      const findFirst = <T = InferTableData<typeof table>>(options?: QueryFindManyOptions): Promise<T | null> =>
        createLazy(async () => {
          const rows = await executeFindMany<T>({ ...options, limit: 1 });
          return rows[0] ?? null;
        });

      const count = (options?: { where?: PublicWhereObject | PublicQueryCondition }): Promise<number> =>
        createLazy(async () => {
          const rows = await executeFindMany({ where: options?.where, columns: undefined, limit: undefined, offset: undefined });
          return rows.length;
        });

      const createFindByLocator = () => <T = InferTableData<typeof table>>(locator: EntityLocator, options?: QueryExactOptions): Promise<T | null> =>
        createLazy(async () => await applyExactOptions<T>(await this.findByLocator(table, locator) as QueryRow | null, options));

      const createFindByIri = () => <T = InferTableData<typeof table>>(iri: string, options?: QueryExactOptions): Promise<T | null> =>
        createLazy(async () => await applyExactOptions<T>(await this.findByIri(table, iri) as QueryRow | null, options));

      return {
        findMany,
        findFirst,
        findByLocator: createFindByLocator(),
        findByIri: createFindByIri(),
        count
      };
    };

    const proxyTarget = {} as unknown as QueryProxy<TSchema>;
    return new Proxy(proxyTarget, {
      get: (_, prop) => {
        if (typeof prop !== 'string') {
          return undefined;
        }
        const table = tableMap.get(prop);
        if (table) {
          return createHelper(prop, table);
        }
        return undefined;
      }
    }) as QueryProxy<TSchema>;
  }

  private async eagerLoadWith(
    rows: QueryRow[],
    parentTable: PodTable,
    withOption: Record<string, boolean | { table?: GenericPodTable }>,
    tableMap: Map<string, GenericPodTable>
  ): Promise<QueryRow[]> {
    if (!rows || rows.length === 0) {
      return rows;
    }
    const dedupedRows = this.dedupeBySubject(rows);

    for (const [key, entry] of Object.entries(withOption)) {
      if (!entry) continue;
      const relationDef = parentTable.relations?.[key] as RelationDefinition | undefined;

      const targetTable = (typeof entry === 'object' && entry.table)
        ? entry.table
        : relationDef?.table ?? tableMap.get(key);
      if (!targetTable) continue;

      // 联邦查询：使用 FederatedQueryExecutor
      if (isSolidSchema(targetTable) || relationDef?.isFederated) {
        if (relationDef && relationDef.discover) {
          try {
            const executor = this.getFederatedExecutor();
            const result = await executor.execute(dedupedRows, {
              ...relationDef,
              relationName: key,
            });
            
            // 收集错误
            if (result.errors && result.errors.length > 0) {
              this.lastFederatedErrors.push(...result.errors);
            }
            
            // 结果已经被添加到 dedupedRows 中
          } catch (error) {
            console.warn(`Federated relation "${key}" failed:`, error);
            // 设置空数组作为默认值
            dedupedRows.forEach((row) => {
              row[key] = [];
            });
          }
        } else {
          console.warn(`Federated relation "${key}" missing discover function, skipping.`);
          dedupedRows.forEach((row) => {
            row[key] = [];
          });
        }
        continue;
      }

      // 此时 targetTable 一定是 PodTable
      const targetPodTable = targetTable as GenericPodTable;
      const targetType = targetPodTable.config.type;

      const candidateColumns: PodColumnBase[] = relationDef?.fields && relationDef.fields.length > 0
        ? relationDef.fields
        : (Object.values(targetPodTable.columns ?? {}) as PodColumnBase[]);
      const matchesParentLink = (col: PodColumnBase | undefined): boolean => Boolean(
        col && (
          col.options?.linkTarget === parentTable.config.type ||
          col.options?.linkTable === parentTable ||
          col.getLinkTable?.() === parentTable
        )
      );
      const matchesTargetLink = (col: PodColumnBase | undefined): boolean => Boolean(
        col && (
          col.options?.linkTarget === targetType ||
          col.options?.linkTable === targetPodTable ||
          col.getLinkTable?.() === targetPodTable
        )
      );
      const linkColumns = relationDef?.fields && relationDef.fields.length > 0
        ? candidateColumns
        : candidateColumns.filter((col) => matchesParentLink(col) && !col.isInverse?.());

      if (linkColumns.length === 0) {
        const relationReferenceFields: PodColumnBase[] = relationDef?.references ?? [];
        const explicitInverse = relationReferenceFields.filter(
          (col): col is PodColumnBase =>
            Boolean(
              col &&
              typeof col.isInverse === 'function' &&
              col.isInverse() &&
              matchesTargetLink(col)
            )
        );
        const parentColumns = Object.values(parentTable.columns ?? {}) as PodColumnBase[];
        const inverseCandidates = (explicitInverse.length > 0 ? explicitInverse : parentColumns).filter(
          (col) =>
            typeof col.isInverse === 'function' &&
            col.isInverse() &&
            matchesTargetLink(col)
        );

        if (inverseCandidates.length === 0) {
          continue;
        }

        const inverseValuesPerRow = dedupedRows.map((row) =>
          this.collectInverseLinkValues(row, inverseCandidates)
        );
        const uniqueIris = Array.from(
          new Set(
            inverseValuesPerRow
              .flat()
              .filter((iri): iri is string => typeof iri === 'string' && iri.length > 0)
          )
        );

        if (uniqueIris.length === 0) {
          rows.forEach((row) => {
            row[key] = [];
          });
          continue;
        }

        let childBuilder = this.session.select().from(targetPodTable);
        childBuilder = childBuilder.whereByIri(uniqueIris);
        const childRows = await childBuilder;
        const groupedByIri = this.groupRowsByIri(childRows);

        dedupedRows.forEach((row, index) => {
          const iris = inverseValuesPerRow[index];
          const related: QueryRow[] = [];
          iris.forEach((iri) => {
            const matches = groupedByIri.get(iri);
            if (matches && matches.length > 0) {
              related.push(...matches);
            }
          });
          row[key] = related;
        });

        continue;
      }
      const refColumn = linkColumns[0];
      const linkColumn = relationDef?.references && relationDef.references[0];
      const useLinkIri = refColumn.isLink();

      const parentKeys = dedupedRows
        .map((row) => this.resolveParentKey(row, linkColumn, useLinkIri))
        .filter((value): value is string => typeof value === 'string' && value.length > 0);
      if (parentKeys.length === 0) {
        continue;
      }

      let childBuilder = this.session.select().from(targetPodTable);
      if (useLinkIri) {
        childBuilder = childBuilder.where(inArray(refColumn, parentKeys));
      } else {
        childBuilder = childBuilder.where({ [refColumn.name]: parentKeys });
      }
      const childRows = await childBuilder;

      const grouped = new Map<string, QueryRow[]>();
      for (const child of childRows) {
        const fkValue = child[refColumn.name];
        const normalizedFkValue = this.normalizeLiteralValue(fkValue);
        const lookupKeys = useLinkIri
          ? this.collectLinkLookupKeys(fkValue)
          : (normalizedFkValue ? [normalizedFkValue] : []);
        for (const lookupKey of lookupKeys) {
          const arr = grouped.get(lookupKey) ?? [];
          arr.push(child);
          grouped.set(lookupKey, arr);
        }
      }

      dedupedRows.forEach((row) => {
        const parentKeys = useLinkIri
          ? Array.from(new Set([
              this.resolveParentKey(row, linkColumn, true),
              this.resolveIdFromRow(row),
            ].filter((value): value is string => typeof value === 'string' && value.length > 0)))
          : [this.resolveParentKey(row, linkColumn, false)].filter((value): value is string => typeof value === 'string' && value.length > 0);

        const related: QueryRow[] = [];
        for (const parentKey of parentKeys) {
          const matches = grouped.get(parentKey) ?? [];
          for (const match of matches) {
            if (!related.includes(match)) {
              related.push(match);
            }
          }
        }

        row[key] = related;
      });
    }

    return dedupedRows;
  }

  private dedupeBySubject(rows: QueryRow[]): QueryRow[] {
    const merged = new Map<string, QueryRow>();
    const order: string[] = [];
    for (const row of rows) {
      const key = this.resolveIriFromRow(row) ?? this.resolveIdFromRow(row);
      if (!key) {
        order.push(`__anon_${order.length}`);
        merged.set(order[order.length - 1], { ...row });
        continue;
      }
      if (!merged.has(key)) {
        merged.set(key, { ...row });
        order.push(key);
        continue;
      }
      const target = merged.get(key);
      if (!target) {
        continue;
      }
      for (const [col, value] of Object.entries(row)) {
        if (value === undefined) continue;
        const existing = target[col];
        if (existing === undefined) {
          target[col] = value;
          continue;
        }
        const existingArr = Array.isArray(existing) ? existing : [existing];
        const incomingArr = Array.isArray(value) ? value : [value];
        const mergedArr = [...existingArr];
        for (const incoming of incomingArr) {
          if (!mergedArr.some((item) => item === incoming)) {
            mergedArr.push(incoming);
          }
        }
        target[col] = mergedArr.length === 1 ? mergedArr[0] : mergedArr;
      }
    }
    return order
      .map((key) => merged.get(key))
      .filter((row): row is QueryRow => row !== undefined);
  }

  private resolveIdFromRow(row: QueryRow): string | undefined {
    if (!row) return undefined;
    if (typeof row.id === 'string' && row.id.length > 0) {
      return row.id;
    }
    const iri = typeof row['@id'] === 'string' ? row['@id'] : undefined;
    if (iri) {
      return this.extractFragment(iri);
    }
    return undefined;
  }

  private resolveParentKey(
    row: QueryRow,
    linkColumn: PodColumnBase | undefined,
    useLinkIri: boolean
  ): string | undefined {
    if (linkColumn) {
      const value = row[linkColumn.name];
      return useLinkIri ? this.normalizeLinkValue(value) : this.normalizeLiteralValue(value);
    }
    return useLinkIri ? this.resolveIriFromRow(row) : this.resolveIdFromRow(row);
  }

  private resolveIriFromRow(row: QueryRow): string | undefined {
    if (!row) return undefined;
    if (typeof row['@id'] === 'string' && row['@id'].length > 0) {
      return row['@id'];
    }
    if (typeof row.subject === 'string' && row.subject.length > 0) {
      return row.subject;
    }
    return undefined;
  }

  private collectLinkLookupKeys(value: unknown): string[] {
    const keys: string[] = [];
    const normalized = this.normalizeLinkValue(value) ?? this.normalizeLiteralValue(value);
    if (normalized) {
      keys.push(normalized);
      const fragment = this.extractFragment(normalized);
      if (fragment && !keys.includes(fragment)) {
        keys.push(fragment);
      }
    }
    return keys;
  }

  private normalizeLinkValue(value: unknown): string | undefined {
    if (!value) return undefined;
    if (typeof value === 'string') {
      return value;
    }
    if (hasStringValue(value)) {
      return value.value;
    }
    return undefined;
  }

  private normalizeLiteralValue(value: unknown): string | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }
    if (typeof value === 'string') {
      return value;
    }
    if (hasStringValue(value)) {
      return value.value;
    }
    return undefined;
  }

  private collectInverseLinkValues(row: QueryRow, columns: PodColumnBase[]): string[] {
    if (!columns.length) {
      return [];
    }
    const collected: string[] = [];
    for (const column of columns) {
      const raw = row[column.name];
      if (raw === undefined || raw === null) {
        continue;
      }
      const appendValue = (entry: unknown) => {
        const normalized = this.normalizeLinkValue(entry) ?? (typeof entry === 'string' ? entry : undefined);
        if (normalized) {
          collected.push(normalized);
        }
      };
      if (Array.isArray(raw)) {
        raw.forEach(appendValue);
      } else {
        appendValue(raw);
      }
    }
    return collected;
  }

  private groupRowsByIri(rows: QueryRow[]): Map<string, QueryRow[]> {
    const grouped = new Map<string, QueryRow[]>();
    for (const row of rows) {
      const iri = this.normalizeLinkValue(row['@id']) ??
        this.normalizeLinkValue(row.uri) ??
        (typeof row['@id'] === 'string' ? row['@id'] : undefined);
      if (!iri) {
        continue;
      }
      const bucket = grouped.get(iri) ?? [];
      bucket.push(row);
      grouped.set(iri, bucket);
    }
    return grouped;
  }

  private extractFragment(value: string): string {
    const hashPart = value.includes('#') ? value.split('#').pop() : undefined;
    if (hashPart && hashPart.length > 0) {
      return hashPart;
    }
    const parts = value.split('/');
    return parts.pop() ?? value;
  }
}
