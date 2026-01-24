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
import { PodTable, SolidSchema, isSolidSchema, type InferTableData, PodColumnBase, type RelationDefinition, type InstantiateTableOptions } from './schema';
import { QueryCondition } from './query-conditions';
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
  createTable<TColumns extends Record<string, PodColumnBase<any, any, any, any>>>(
    schema: SolidSchema<TColumns>,
    options: InstantiateTableOptions
  ): PodTable<TColumns> {
    // Create table using schema.table() with the base path
    const table = schema.table('default', options);
    
    // Attach hooks if provided
    if (options.hooks) {
      table.config.hooks = options.hooks;
    }
    
    // Store reference to db in table for hook context
    // This allows hooks to access db when invoked
    (table as any)._db = this;
    
    return table;
  }

  // SELECT 查询
  select<TTable extends PodTable<any>>(fields?: SelectFieldMap): SelectQueryBuilder<TTable> {
    return this.session.select<TTable>(fields);
  }

  // INSERT 查询
  insert<TTable extends PodTable<any>>(table: TTable): InsertQueryBuilder<TTable> {
    return this.session.insert(table);
  }

  // UPDATE 查询
  update<TTable extends PodTable<any>>(table: TTable): UpdateQueryBuilder<TTable> {
    return this.session.update(table);
  }

  // DELETE 查询
  delete<TTable extends PodTable<any>>(table: TTable): DeleteQueryBuilder<TTable> {
    return this.session.delete(table);
  }

  // Find first matching row (LIMIT 1)
  async findFirst<TTable extends PodTable<any>>(
    table: TTable,
    where?: Record<string, unknown>
  ): Promise<InferTableData<TTable> | null> {
    const builder = this.select<TTable>().from(table).limit(1);
    if (where && Object.keys(where).length > 0) {
      builder.where(where);
    }
    const rows = await builder;
    return rows.length > 0 ? rows[0] : null;
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
  async findByIri<TTable extends PodTable<any>>(
    table: TTable,
    iri: string
  ): Promise<InferTableData<TTable> | null> {
    if (!iri || typeof iri !== 'string') {
      throw new Error('findByIri requires a valid IRI string');
    }

    // 解析文档 URL（去掉 fragment）
    const { documentUrl } = this.parseIri(iri);
    
    // 用 schema.table(documentUrl) 创建指向目标位置的表
    const targetTable = table.$schema.table('target', { base: documentUrl });
    
    // 使用 whereByIri 内部方法
    const rows = await this.session
      .select()
      .from(targetTable)
      .whereByIri(iri)
      .limit(1);
    
    return (rows[0] ?? null) as InferTableData<TTable> | null;
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
  async subscribeByIri<TTable extends PodTable<any>>(
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
  async updateByIri<TTable extends PodTable<any>>(
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

    // 解析文档 URL
    const { documentUrl } = this.parseIri(iri);
    
    // 用 schema.table(documentUrl) 创建指向目标位置的表
    const targetTable = table.$schema.table('target', { base: documentUrl });

    // 使用 whereByIri 内部方法进行更新
    await this.session
      .update(targetTable)
      .set(data as any)
      .whereByIri(iri);

    // 返回更新后的数据
    return await this.findByIri(table, iri);
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
  async deleteByIri<TTable extends PodTable<any>>(
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

    // 解析文档 URL
    const { documentUrl } = this.parseIri(iri);
    
    // 用 schema.table(documentUrl) 创建指向目标位置的表
    const targetTable = table.$schema.table('target', { base: documentUrl });

    // 使用 whereByIri 内部方法进行删除
    await this.session
      .delete(targetTable)
      .whereByIri(iri);

    return true;
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
  async subscribe<TTable extends PodTable<any>>(
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
  private resolveTableTopic<TTable extends PodTable<any>>(table: TTable, iriOverride?: string): string {
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

    await this.init(table);
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

    await this.init(table);
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

  async init<TTable extends PodTable<any>>(
    tables: TTable | TTable[],
    options?: InitOptions
  ): Promise<void>;
  async init<TTable extends PodTable<any>>(...tables: Array<TTable | TTable[]>): Promise<void>;
  async init<TTable extends PodTable<any>>(
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

    const flattened: PodTable<any>[] = [];
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
  private queryProxy?: Record<string, any>;

  get query(): Record<string, any> {
    if (!this.queryProxy) {
      this.queryProxy = this.buildQueryProxy();
    }
    return this.queryProxy;
  }

  private buildQueryProxy(): Record<string, any> {
    const schemaEntries = (this.schema && typeof this.schema === 'object')
      ? Object.entries(this.schema as Record<string, any>)
      : [];
    const tableMap = new Map<string, PodTable<any>>();
    for (const [key, value] of schemaEntries) {
      if (value && typeof value === 'object' && 'columns' in value) {
        tableMap.set(key, value as PodTable<any>);
      }
    }

    const createHelper = (_tableName: string, table: PodTable<any>) => {
      const findMany = async <T = InferTableData<typeof table>>(options?: {
        where?: Record<string, unknown> | QueryCondition;
        columns?: SelectFieldMap;
        limit?: number;
        offset?: number;
        orderBy?: Array<{ column: any; direction?: 'asc' | 'desc' }> | { column: any; direction?: 'asc' | 'desc' };
        with?: Record<string, boolean | { table?: PodTable<any> }>;
      }): Promise<T[]> => {
        // 清除之前的联邦查询错误
        this.clearFederatedErrors();
        
        let builder = this.session.select(options?.columns).from(table);
        if (options?.where) {
          builder = builder.where(options.where as any);
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
        const rows = await builder;
        if (options?.with && Object.keys(options.with).length > 0) {
          return await this.eagerLoadWith(rows as any[], table, options.with, tableMap) as T[];
        }
        return rows as T[];
      };

      const findFirst = async <T = InferTableData<typeof table>>(options?: Parameters<typeof findMany>[0]) => {
        const rows = await findMany<T>({ ...options, limit: 1 });
        return rows[0] ?? null;
      };

      const findById = async <T = InferTableData<typeof table>>(id: string, options?: Parameters<typeof findMany>[0]) => {
        return await findFirst<T>({ ...options, where: { ...(options?.where ?? {}), id } });
      };

      const count = async (options?: { where?: Record<string, unknown> | QueryCondition }) => {
        const rows = await findMany({ where: options?.where, columns: undefined, limit: undefined, offset: undefined });
        return rows.length;
      };

      // Helper to create the deprecated findByIRI method without triggering deprecation warning on reference
      const self = this;
      const createFindByIRI = () => async <T = InferTableData<typeof table>>(iri: string, _options?: Parameters<typeof findMany>[0]) => {
        void _options;
        return await self.findByIri(table, iri) as T | null;
      };

      return {
        findMany,
        findFirst,
        findById,
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        /** @deprecated Use db.findByIri(table, iri) instead */
        findByIRI: createFindByIRI(),
        count
      };
    };

    const proxyTarget: Record<string, any> = {};
    return new Proxy(proxyTarget, {
      get: (_, prop: string) => {
        if (tableMap.has(prop)) {
          return createHelper(prop, tableMap.get(prop)!);
        }
        return undefined;
      }
    });
  }

  private async eagerLoadWith(
    rows: Record<string, any>[],
    parentTable: PodTable<any>,
    withOption: Record<string, boolean | { table?: PodTable<any> }>,
    tableMap: Map<string, PodTable<any>>
  ): Promise<Record<string, any>[]> {
    if (!rows || rows.length === 0) {
      return rows;
    }
    const dedupedRows = this.dedupeBySubject(rows);

    for (const [key, entry] of Object.entries(withOption)) {
      if (!entry) continue;
      const relationDef = (parentTable as any).relations?.[key] as RelationDefinition | undefined;

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
      const targetPodTable = targetTable as PodTable<any>;
      const targetType = targetPodTable.config.type;

      const candidateColumns: PodColumnBase[] = relationDef?.fields && relationDef.fields.length > 0
        ? relationDef.fields
        : (Object.values(targetPodTable.columns ?? {}) as PodColumnBase[]);
      const referenceColumns = relationDef?.fields && relationDef.fields.length > 0
        ? candidateColumns
        : candidateColumns.filter((col) =>
            col?.options?.referenceTarget === parentTable.config.type &&
            !col.isInverse?.()
          );

      if (referenceColumns.length === 0) {
        const relationReferences: PodColumnBase[] = relationDef?.references ?? [];
        const explicitInverse = relationReferences.filter(
          (col): col is PodColumnBase =>
            Boolean(
              col &&
              typeof col.isInverse === 'function' &&
              col.isInverse() &&
              col.options?.referenceTarget === targetType
            )
        );
        const parentColumns = Object.values(parentTable.columns ?? {}) as PodColumnBase[];
        const inverseCandidates = (explicitInverse.length > 0 ? explicitInverse : parentColumns).filter(
          (col) =>
            typeof col.isInverse === 'function' &&
            col.isInverse() &&
            col.options?.referenceTarget === targetType
        );

        if (inverseCandidates.length === 0) {
          continue;
        }

        const inverseValuesPerRow = dedupedRows.map((row) =>
          this.collectInverseReferenceValues(row, inverseCandidates)
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
          const related: Record<string, any>[] = [];
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
      const refColumn = referenceColumns[0];
      const referenceColumn = relationDef?.references && relationDef.references[0];
      const useReferenceIri = refColumn.isReference();

      const parentKeys = dedupedRows
        .map((row) => this.resolveParentKey(row, referenceColumn, useReferenceIri))
        .filter((value): value is string => typeof value === 'string' && value.length > 0);
      if (parentKeys.length === 0) {
        continue;
      }

      let childBuilder = this.session.select().from(targetPodTable);
      if (useReferenceIri) {
        childBuilder = childBuilder.where(inArray(refColumn, parentKeys as any));
      } else {
        childBuilder = childBuilder.where({ [refColumn.name]: parentKeys });
      }
      const childRows = await childBuilder;

      const grouped = new Map<string, Record<string, any>[]>();
      for (const child of childRows) {
        const fkValue = child[refColumn.name];
        const normalized = useReferenceIri
          ? this.normalizeReferenceValue(fkValue)
          : this.normalizeLiteralValue(fkValue);
        if (!normalized) continue;
        const arr = grouped.get(normalized) ?? [];
        arr.push(child);
        grouped.set(normalized, arr);
      }

      dedupedRows.forEach((row) => {
        const parentKey = this.resolveParentKey(row, referenceColumn, useReferenceIri);
        row[key] = parentKey ? grouped.get(parentKey) ?? [] : [];
      });
    }

    return dedupedRows;
  }

  private dedupeBySubject(rows: Record<string, any>[]): Record<string, any>[] {
    const merged = new Map<string, Record<string, any>>();
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
      const target = merged.get(key)!;
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
    return order.map((key) => merged.get(key)!);
  }

  private resolveIdFromRow(row: Record<string, any>): string | undefined {
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
    row: Record<string, any>,
    referenceColumn: PodColumnBase | undefined,
    useReferenceIri: boolean
  ): string | undefined {
    if (referenceColumn) {
      const value = row[referenceColumn.name];
      return useReferenceIri ? this.normalizeReferenceValue(value) : this.normalizeLiteralValue(value);
    }
    return useReferenceIri ? this.resolveIriFromRow(row) : this.resolveIdFromRow(row);
  }

  private resolveIriFromRow(row: Record<string, any>): string | undefined {
    if (!row) return undefined;
    if (typeof row['@id'] === 'string' && row['@id'].length > 0) {
      return row['@id'];
    }
    if (typeof row.subject === 'string' && row.subject.length > 0) {
      return row.subject;
    }
    return undefined;
  }

  private normalizeReferenceValue(value: any): string | undefined {
    if (!value) return undefined;
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'object' && typeof value.value === 'string') {
      return value.value;
    }
    return undefined;
  }

  private normalizeLiteralValue(value: any): string | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'object' && typeof value.value === 'string') {
      return value.value;
    }
    return undefined;
  }

  private collectInverseReferenceValues(row: Record<string, any>, columns: PodColumnBase[]): string[] {
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
        const normalized = this.normalizeReferenceValue(entry) ?? (typeof entry === 'string' ? entry : undefined);
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

  private groupRowsByIri(rows: Record<string, any>[]): Map<string, Record<string, any>[]> {
    const grouped = new Map<string, Record<string, any>[]>();
    for (const row of rows) {
      const iri = this.normalizeReferenceValue(row['@id']) ??
        this.normalizeReferenceValue(row.uri) ??
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
