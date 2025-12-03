import { entityKind, SQL } from 'drizzle-orm';
import { PodTable, PodColumnBase, InferInsertData, InferTableData } from '../pod-table';
import { PodAsyncSession, PodOperation } from '../pod-session'; // Import PodAsyncSession
import { InsertQueryPlan } from './types';

export class InsertQueryBuilder<TTable extends PodTable<any> = PodTable<any>> {
  static readonly [entityKind] = 'InsertQueryBuilder';

  public insertValues?: InferInsertData<TTable> | InferInsertData<TTable>[];
  public sql?: SQL;

  constructor(
    public session: PodAsyncSession,
    public table: TTable
  ) {}

  values(values: InferInsertData<TTable> | InferInsertData<TTable>[] | SQL) {
    if (values instanceof SQL) {
      this.sql = values;
    } else {
      this.insertValues = values;
    }
    return this;
  }

  public toIR = (): InsertQueryPlan<TTable> => {
    const rows = this.getRowsWithDefaults();
    return {
      table: this.table,
      rows
    };
  };

  async execute(): Promise<InferTableData<TTable>[]> {
    if (this.sql) {
      return await this.session.executeSql(this.sql, this.table) as InferTableData<TTable>[];
    } else if (this.insertValues) {
      const rows = this.getRowsWithDefaults();
      const operation: PodOperation = {
        type: 'insert',
        table: this.table,
        values: Array.isArray(this.insertValues) ? rows : rows[0],
        plan: {
          table: this.table,
          rows
        }
      };
      return await this.session.execute(operation) as InferTableData<TTable>[];
    } else {
      throw new Error('No values specified for INSERT query');
    }
  }

  then<TResult1 = Awaited<ReturnType<InsertQueryBuilder<TTable>['execute']>>, TResult2 = never>(
    onfulfilled?: ((value: Awaited<ReturnType<InsertQueryBuilder<TTable>['execute']>>) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private getRowsWithDefaults(): InferInsertData<TTable>[] {
    const values = this.insertValues;
    if (!values) {
      throw new Error('No values specified for INSERT query');
    }
    const rows = Array.isArray(values) ? values : [values];
    return rows.map((row) => this.applyDefaultValues(row));
  }

  private applyDefaultValues(row: InferInsertData<TTable>): InferInsertData<TTable> {
    const normalized: Record<string, any> = { ...(row as Record<string, any>) };
    const columns = (this.table?.columns ?? {}) as Record<string, PodColumnBase>;
    for (const [columnName, column] of Object.entries(columns)) {
      if (normalized[columnName] === undefined) {
        const defaultValue = column.options?.defaultValue;
        if (defaultValue !== undefined) {
          normalized[columnName] = typeof defaultValue === 'function'
            ? (defaultValue as () => unknown)()
            : defaultValue;
        }
      }
    }
    return normalized as InferInsertData<TTable>;
  }
}
