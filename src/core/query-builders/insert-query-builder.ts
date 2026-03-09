import { entityKind, SQL } from 'drizzle-orm';
import { PodTable, PodColumnBase, InferInsertData, HookContext } from '../schema';
import { PodAsyncSession, PodOperation } from '../pod-session';
import { generateSubjectUri } from '../sparql/helpers';
import { InsertQueryPlan, type SelectFieldMap } from './types';
import { inferSPARQLQueryType, orderRowsBySubjects, projectReturningRows } from './helpers';

export class InsertQueryBuilder<TTable extends PodTable<any> = PodTable<any>> {
  static readonly [entityKind] = 'InsertQueryBuilder';

  public insertValues?: InferInsertData<TTable> | InferInsertData<TTable>[];
  public sql?: SQL;
  private returningFields?: SelectFieldMap | true;

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

  returning(fields?: SelectFieldMap) {
    this.returningFields = fields ?? true;
    return this;
  }

  public toIR = (): InsertQueryPlan<TTable> => {
    const rows = this.getRowsWithDefaults();
    return {
      table: this.table,
      rows
    };
  };


  private buildSPARQLQuery(methodName = 'toSPARQL()') {
    if (this.sql) {
      const query = this.sql.queryChunks.join('');
      const type = inferSPARQLQueryType(query);
      if (!type) {
        throw new Error(`${methodName} could not infer SPARQL query type from raw AST input`);
      }
      return { type, query, prefixes: {} as Record<string, string> };
    }

    const converter = this.session.getDialect().getSPARQLConverter?.();
    if (!converter) {
      throw new Error(`${methodName} requires dialect SPARQL converter support`);
    }

    return converter.convertInsert(this.toIR());
  }

  toSPARQL() {
    return this.buildSPARQLQuery('toSPARQL()');
  }

  toSparql() {
    return this.toSPARQL();
  }

  async execute(): Promise<any[]> {
    if (this.sql) {
      if (this.returningFields) {
        throw new Error('returning() is not supported for raw SQL insert in Solid dialect');
      }
      return await this.session.executeSql(this.sql, this.table);
    } else if (this.insertValues) {
      const rows = this.getRowsWithDefaults();
      const subjects = this.returningFields ? this.getSubjectUris(rows) : [];
      const operation: PodOperation = {
        type: 'insert',
        table: this.table,
        values: Array.isArray(this.insertValues) ? rows : rows[0],
        plan: {
          table: this.table,
          rows
        }
      };
      const results = await this.session.execute(operation);
      const finalResults = this.returningFields
        ? await this.fetchReturningRowsBySubjects(subjects)
        : results;

      await this.runAfterInsertHooks(finalResults);

      return finalResults;
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

  private async fetchReturningRowsBySubjects(subjects: string[]): Promise<any[]> {
    if (subjects.length === 0) {
      return [];
    }

    const rows = await this.session.select().from(this.table).whereByIri(subjects) as Record<string, any>[];
    return projectReturningRows(orderRowsBySubjects(rows, subjects), this.returningFields);
  }

  private getSubjectUris(rows: InferInsertData<TTable>[]): string[] {
    const resolver = this.session.getDialect().getUriResolver?.();
    if (!resolver) {
      throw new Error('returning() requires dialect URI resolver support');
    }

    return rows.map((row) => generateSubjectUri(row, this.table, resolver));
  }

  /**
   * Run afterInsert hooks for all inserted records.
   */
  private async runAfterInsertHooks(results: any[]): Promise<void> {
    const hooks = this.table.config.hooks;
    if (!hooks?.afterInsert) {
      return;
    }

    const ctx = this.buildHookContext();
    if (!ctx) {
      console.warn('[InsertQueryBuilder] Cannot run hooks: missing session info');
      return;
    }

    for (const record of results) {
      try {
        await hooks.afterInsert(ctx, record as Record<string, unknown>);
      } catch (error) {
        console.error('[InsertQueryBuilder] afterInsert hook failed:', error);
      }
    }
  }

  /**
   * Build the HookContext from session info.
   */
  private buildHookContext(): HookContext | null {
    const dialect = this.session.getDialect();
    const webId = dialect.getWebId();
    const fetchFn = dialect.getAuthenticatedFetch();

    if (!webId || !fetchFn) {
      return null;
    }

    return {
      session: {
        info: {
          isLoggedIn: true,
          webId,
        },
        fetch: fetchFn,
      },
      table: this.table,
      db: (this.table as any)._db ?? null,
    };
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
