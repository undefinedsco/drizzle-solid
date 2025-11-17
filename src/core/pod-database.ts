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
import { PodTable, type InferTableData } from './pod-table';

export class PodDatabase<TSchema extends Record<string, unknown> = Record<string, never>> {
  static readonly [entityKind] = 'PodDatabase';

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
    return await this.dialect.disconnect();
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
}
