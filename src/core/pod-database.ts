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
import { PodTable, type InferTableData, PodColumnBase, type RelationDefinition } from './pod-table';
import { QueryCondition } from './query-conditions';
import { inArray } from './query-conditions';
import { 
  NotificationsClient, 
  type SubscribeOptions, 
  type TableSubscribeOptions,
  type Subscription,
  type Activity,
  type NotificationType,
  type NotificationsClientConfig
} from './notifications';

export class PodDatabase<TSchema extends Record<string, unknown> = Record<string, never>> {
  static readonly [entityKind] = 'PodDatabase';

  private notificationsClient: NotificationsClient | null = null;

  constructor(
    public dialect: PodDialect,
    public session: PodAsyncSession,
    public schema?: TSchema
  ) {}

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

    // 获取表的资源 URL（容器或文件）
    const topic = this.resolveTableTopic(table);

    // 将 TableSubscribeOptions 转换为底层 SubscribeOptions
    const subscribeOptions: SubscribeOptions = {
      channel: options.channel,
      features: options.features,
      onNotification: (event) => {
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
      },
      onError: options.onError,
      onClose: options.onClose,
    };

    return this.notificationsClient.subscribe(topic, subscribeOptions);
  }

  /**
   * 解析表对应的订阅主题 URL
   */
  private resolveTableTopic<TTable extends PodTable<any>>(table: TTable): string {
    const config = this.dialect.getConfig();
    const podUrl = config.webId
      ? new URL(config.webId).origin
      : config.podUrl;
    
    const base = table.config.base || '';
    
    // 如果 base 已经是绝对 URL，直接使用
    if (base.startsWith('http://') || base.startsWith('https://')) {
      return base;
    }
    
    // 否则拼接到 podUrl
    return `${podUrl}${base.startsWith('/') ? '' : '/'}${base}`;
  }

  // 获取连接配置
  getConfig() {
    return this.dialect.getConfig();
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

  async init<TTable extends PodTable<any>>(...tables: Array<TTable | TTable[]>): Promise<void> {
    const flattened: PodTable<any>[] = [];
    for (const entry of tables) {
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

    const createHelper = (tableName: string, table: PodTable<any>) => {
      const findMany = async <T = InferTableData<typeof table>>(options?: {
        where?: Record<string, unknown> | QueryCondition;
        columns?: SelectFieldMap;
        limit?: number;
        offset?: number;
        orderBy?: Array<{ column: any; direction?: 'asc' | 'desc' }> | { column: any; direction?: 'asc' | 'desc' };
        with?: Record<string, boolean | { table?: PodTable<any> }>;
      }): Promise<T[]> => {
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

      const findByIRI = async <T = InferTableData<typeof table>>(iri: string, options?: Parameters<typeof findMany>[0]) => {
        const where = iri.includes('://') ? { '@id': iri } : { id: iri };
        return await findFirst<T>({ ...options, where: { ...(options?.where ?? {}), ...where } });
      };

      const count = async (options?: { where?: Record<string, unknown> | QueryCondition }) => {
        const rows = await findMany({ where: options?.where, columns: undefined, limit: undefined, offset: undefined });
        return rows.length;
      };

      return {
        findMany,
        findFirst,
        findById,
        findByIRI,
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

      const candidateColumns: PodColumnBase[] = relationDef?.fields && relationDef.fields.length > 0
        ? relationDef.fields
        : (Object.values(targetTable.columns ?? {}) as PodColumnBase[]);
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
              col.options?.referenceTarget === targetTable.config.type
            )
        );
        const parentColumns = Object.values(parentTable.columns ?? {}) as PodColumnBase[];
        const inverseCandidates = (explicitInverse.length > 0 ? explicitInverse : parentColumns).filter(
          (col) =>
            typeof col.isInverse === 'function' &&
            col.isInverse() &&
            col.options?.referenceTarget === targetTable.config.type
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

        let childBuilder = this.session.select().from(targetTable);
        childBuilder = childBuilder.where({ '@id': uniqueIris });
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

      let childBuilder = this.session.select().from(targetTable);
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
