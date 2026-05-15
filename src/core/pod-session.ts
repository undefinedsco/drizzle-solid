import { entityKind } from 'drizzle-orm';
import { SQL } from 'drizzle-orm';
import { PodDialect, type PodOperation } from './pod-dialect';
import { PodTable } from './schema';
import { generateSubjectUri } from './sparql/helpers';

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

type GenericPodTable = PodTable<any>;
type ResourcePreparationMode = 'strict' | 'best-effort' | 'off';

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
    const preparationMode: ResourcePreparationMode =
      typeof (this.dialect as unknown as { getResourcePreparationMode?: () => ResourcePreparationMode }).getResourcePreparationMode === 'function'
        ? (this.dialect as unknown as { getResourcePreparationMode: () => ResourcePreparationMode }).getResourcePreparationMode()
        : 'strict';

    if (preparationMode === 'off') {
      if (table && typeof table.markInitialized === 'function') {
        table.markInitialized(true);
      }
      return;
    }

    if (table && typeof table.isInitialized === 'function') {
      if (!table.isInitialized()) {
        try {
          if (typeof table.init === 'function') {
            await table.init(this.dialect);
          } else {
            await this.dialect.registerTable(table);
          }
        } catch (error) {
          if (preparationMode !== 'best-effort') {
            throw error;
          }
          table.markInitialized?.(true);
        }
      }
      return;
    }

    if (table) {
      try {
        await this.dialect.registerTable(table);
      } catch (error) {
        if (preparationMode !== 'best-effort') {
          throw error;
        }
      }
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

    const result = await this.dialect.query(operation);
    this.updateSubjectIndex(operation, result);
    return result;
  }

  private updateSubjectIndex(operation: PodOperation, result: unknown[]): void {
    if (operation.type === 'select') {
      return;
    }

    const dialect = this.dialect as unknown as {
      registerResourceSubject?: (table: GenericPodTable, subject: string) => void;
      unregisterResourceSubject?: (table: GenericPodTable, subject: string) => void;
    };
    if (
      typeof dialect.registerResourceSubject !== 'function'
      && typeof dialect.unregisterResourceSubject !== 'function'
    ) {
      return;
    }

    const subjects = this.resolveOperationSubjects(operation, result);
    if (operation.type === 'delete') {
      subjects.forEach((subject) => dialect.unregisterResourceSubject?.(operation.table, subject));
      return;
    }
    subjects.forEach((subject) => dialect.registerResourceSubject?.(operation.table, subject));
  }

  private resolveOperationSubjects(operation: PodOperation, result: unknown[]): string[] {
    const subjects = new Set<string>();
    for (const row of result) {
      const subject = this.getKnownRowIri(row);
      if (subject) {
        subjects.add(subject);
      }
    }

    if (operation.type === 'insert') {
      const plan = operation.plan as InsertQueryPlan<GenericPodTable> | undefined;
      const rows = Array.isArray(plan?.rows) ? plan.rows : [];
      rows.forEach((row: Record<string, unknown>) => {
        try {
          subjects.add(generateSubjectUri(row, operation.table, this.dialect.getUriResolver?.()));
        } catch {
          // Operation result rows remain the primary source when subject generation is unavailable.
        }
      });
    }

    return Array.from(subjects);
  }

  private getKnownRowIri(row: unknown): string | null {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return null;
    }
    const record = row as Record<string, unknown>;
    for (const key of ['@id', 'subject', 'uri', 'source']) {
      const value = record[key];
      if (typeof value === 'string' && /^https?:\/\//.test(value)) {
        return value;
      }
    }
    return null;
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
