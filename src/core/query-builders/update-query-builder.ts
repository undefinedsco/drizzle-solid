import { entityKind, SQL } from 'drizzle-orm';
import { PodTable, PodColumnBase, InferUpdateData, HookContext } from '../pod-table';
import { PodAsyncSession, PodOperation } from '../pod-session';
import { QueryCondition } from '../query-conditions';
import { UpdateQueryPlan } from './types';
import { buildConditionTreeFromObject } from './helpers';

export class UpdateQueryBuilder<TTable extends PodTable<any> = PodTable<any>> {
  static readonly [entityKind] = 'UpdateQueryBuilder';

  public updateData?: InferUpdateData<TTable>;
  public whereConditions?: Record<string, any>;
  public sql?: SQL;
  private conditionTree?: QueryCondition;

  constructor(
    public session: PodAsyncSession,
    public table: TTable
  ) {}

  set(data: InferUpdateData<TTable> | SQL) {
    if (data instanceof SQL) {
      this.sql = data;
    } else {
      this.updateData = data;
    }
    return this;
  }

  where(conditions: Record<string, any> | SQL | QueryCondition) {
    // console.log('[UpdateQueryBuilder] where() received:', conditions);
    if (conditions instanceof SQL) {
      if (!this.sql) {
        this.sql = conditions;
      }
    } else if (this.isQueryCondition(conditions)) {
      this.conditionTree = conditions;
      const simple = this.convertQueryConditionToSimple(conditions);
      this.whereConditions = Object.keys(simple).length > 0 ? simple : undefined;
    } else {
      // Check for @id usage and reject
      if (conditions && typeof conditions === 'object' && '@id' in conditions) {
        throw new Error(
          `Using '@id' in where() is not supported. ` +
          `Use db.updateByIri(table, iri, data) for IRI-based updates, ` +
          `or use { id: 'value' } for id-based updates.`
        );
      }
      this.whereConditions = conditions;
      this.conditionTree = undefined;
    }
    return this;
  }

  /**
   * Internal method that allows @id in conditions.
   * Used by *ByIri methods internally.
   * @internal
   */
  whereByIri(iri: string) {
    this.whereConditions = { '@id': iri };
    this.conditionTree = undefined;
    return this;
  }

  private isQueryCondition(obj: any): obj is QueryCondition {
    return obj && typeof obj === 'object' && 'type' in obj && 'operator' in obj;
  }

  private convertQueryConditionToSimple(condition: QueryCondition): Record<string, any> {
    if (condition.type === 'binary_expr') {
      const left = (condition as any).left;
      const right = (condition as any).right;
      const colName = typeof left === 'string' ? left : left?.name;
      if (colName && right !== undefined) {
        return { [colName]: right };
      }
    }
    // For complex conditions, temporarily return empty object; can be extended later
    return {};
  }

  private normalizeWhereConditionsForUpdate(): QueryCondition | undefined {
    if (this.conditionTree) {
      return this.conditionTree;
    }
    return buildConditionTreeFromObject(this.whereConditions);
  }

  public toIR = (): UpdateQueryPlan<TTable> => {
    if (!this.updateData) {
      throw new Error('No data specified for UPDATE query');
    }
    const whereCondition = this.normalizeWhereConditionsForUpdate();
    if (!whereCondition) {
      throw new Error('UPDATE operation requires where conditions to locate target resources');
    }
    return {
      table: this.table,
      data: this.updateData,
      where: whereCondition
    };
  };

  async execute(): Promise<any[]> {
    if (this.sql) {
      return await this.session.executeSql(this.sql, this.table);
    } else if (this.updateData) {
      const plan = this.toIR();
      const operation: PodOperation = {
        type: 'update',
        table: this.table,
        data: plan.data,
        where: plan.where,
        plan
      };
      const results = await this.session.execute(operation);
      
      // Call afterUpdate hooks
      await this.runAfterUpdateHooks(results);
      
      return results;
    } else {
      throw new Error('No data specified for UPDATE query');
    }
  }

  /**
   * Run afterUpdate hooks for all updated records.
   */
  private async runAfterUpdateHooks(results: any[]): Promise<void> {
    const hooks = this.table.config.hooks;
    if (!hooks?.afterUpdate) {
      return;
    }

    // Build hook context
    const ctx = this.buildHookContext();
    if (!ctx) {
      console.warn('[UpdateQueryBuilder] Cannot run hooks: missing session info');
      return;
    }

    // Get the changes that were made
    const changes = (this.updateData ?? {}) as Record<string, unknown>;

    // Run hook for each updated record
    for (const record of results) {
      try {
        await hooks.afterUpdate(ctx, record as Record<string, unknown>, changes);
      } catch (error) {
        console.error('[UpdateQueryBuilder] afterUpdate hook failed:', error);
        // Don't throw - the update succeeded, just the hook failed
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
    };
  }

  then<TResult1 = Awaited<ReturnType<UpdateQueryBuilder<TTable>['execute']>>, TResult2 = never>(
    onfulfilled?: ((value: Awaited<ReturnType<UpdateQueryBuilder<TTable>['execute']>>) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}
