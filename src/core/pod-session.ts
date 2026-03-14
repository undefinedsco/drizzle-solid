import { entityKind } from 'drizzle-orm';
import { SQL } from 'drizzle-orm';
import { PodDialect, type PodOperation } from './pod-dialect';
import { PodColumnBase, PodTable } from './schema';

// Import the new Query Builders and types
import { SelectQueryBuilder } from './query-builders/select-query-builder';
import { InsertQueryBuilder } from './query-builders/insert-query-builder';
import { UpdateQueryBuilder } from './query-builders/update-query-builder';
import { DeleteQueryBuilder } from './query-builders/delete-query-builder';
import type { InsertQueryPlan, UpdateQueryPlan, DeleteQueryPlan, SelectFieldMap } from './query-builders/types';

// Re-export types from query-builders for external API if needed
export type { SelectFieldMap, InsertQueryPlan, UpdateQueryPlan, DeleteQueryPlan };
export type { PodOperation } from './pod-dialect';
export { SelectQueryBuilder, InsertQueryBuilder, UpdateQueryBuilder, DeleteQueryBuilder };

type GenericPodTable = PodTable<Record<string, PodColumnBase>>;

export class PodAsyncSession {
  static readonly [entityKind] = 'PodAsyncSession';

  constructor(
    private dialect: PodDialect,
    private _schema?: unknown,
    private options: { logger?: boolean } = {}
  ) {}

  /**
   * 获取会话关联的 schema
   */
  getSchema(): unknown {
    return this._schema;
  }

  /**
   * 检查连接状态
   */
  isConnected(): boolean {
    return this.dialect.isConnected();
  }

  /**
   * 获取方言实例
   */
  getDialect(): PodDialect {
    return this.dialect;
  }

  /**
   * 获取会话选项
   */
  getOptions(): { logger?: boolean } {
    return this.options;
  }

  private async ensureInitialized(table: GenericPodTable): Promise<void> {
    if (table && typeof table.isInitialized === 'function') {
      if (!table.isInitialized()) {
        if (typeof table.init === 'function') {
          await table.init(this.dialect);
        } else {
          await this.dialect.registerTable(table);
        }
      }
      return;
    }

    if (table) {
      await this.dialect.registerTable(table);
    }
  }

  // 执行查询操作
  async execute(operation: PodOperation): Promise<unknown[]> {
    if (this.options.logger) {
      console.log('Executing operation:', operation);
    }
    
    // 验证操作类型
    if (!operation || !operation.type) {
      throw new Error('Invalid operation: missing type');
    }
    
    // 验证表定义
    if (!operation.table) {
      throw new Error('Invalid operation: missing table');
    }
    
    // 验证操作类型是否支持
    const supportedTypes = ['select', 'insert', 'update', 'delete'];
    if (!supportedTypes.includes(operation.type)) {
      throw new Error(`Unsupported operation type: ${operation.type}`);
    }
    
    await this.ensureInitialized(operation.table);

    if (Array.isArray(operation.joins)) {
      for (const join of operation.joins) {
        if (join?.table) {
          await this.ensureInitialized(join.table);
        }
      }
    }

    return await this.dialect.query(operation);
  }

  // 执行 SQL（Drizzle AST）
  async executeSql(sql: SQL, table: GenericPodTable): Promise<unknown[]> {
    if (this.options.logger) {
      console.log('Executing SQL AST:', sql);
    }
    await this.ensureInitialized(table);
    return await this.dialect.executeSql(sql, table);
  }

  // SELECT 查询构建器
  select<TTable extends GenericPodTable>(fields?: SelectFieldMap): SelectQueryBuilder<TTable> {
    return new SelectQueryBuilder<TTable>(this, fields);
  }

  // INSERT 查询构建器
  insert<TTable extends GenericPodTable>(table: TTable): InsertQueryBuilder<TTable> {
    return new InsertQueryBuilder<TTable>(this, table);
  }

  // UPDATE 查询构建器
  update<TTable extends GenericPodTable>(table: TTable): UpdateQueryBuilder<TTable> {
    return new UpdateQueryBuilder<TTable>(this, table);
  }

  // DELETE 查询构建器
  delete<TTable extends GenericPodTable>(table: TTable): DeleteQueryBuilder<TTable> {
    return new DeleteQueryBuilder<TTable>(this, table);
  }

  // 事务支持
  async transaction<T>(
    transaction: (tx: PodAsyncSession) => Promise<T>
  ): Promise<T> {
    const result = await transaction(this);
    return result;
  }
}
