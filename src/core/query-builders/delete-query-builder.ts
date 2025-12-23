import { entityKind, SQL } from 'drizzle-orm';
import { PodTable, HookContext } from '../pod-table';
import { PodAsyncSession, PodOperation } from '../pod-session';
import { QueryCondition } from '../query-conditions';
import { DeleteQueryPlan } from './types';
import { buildConditionTreeFromObject } from './helpers';

export class DeleteQueryBuilder<TTable extends PodTable<any> = PodTable<any>> {
  static readonly [entityKind] = 'DeleteQueryBuilder';

  public whereConditions?: Record<string, any>;
  public sql?: SQL;
  private conditionTree?: QueryCondition;

  constructor(
    public session: PodAsyncSession,
    public table: TTable
  ) {}

  where(conditions: Record<string, any> | SQL | QueryCondition) {
    if (conditions instanceof SQL) {
      this.sql = conditions;
    } else if (this.isQueryCondition(conditions)) {
      this.conditionTree = conditions;
      const simple = this.convertQueryConditionToSimple(conditions);
      this.whereConditions = Object.keys(simple).length > 0 ? simple : undefined;
    } else {
      // Check for @id usage and reject
      if (conditions && typeof conditions === 'object' && '@id' in conditions) {
        throw new Error(
          `Using '@id' in where() is not supported. ` +
          `Use db.deleteByIri(table, iri) for IRI-based deletes, ` +
          `or use { id: 'value' } for id-based deletes.`
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

  private normalizeWhereConditionsForDelete(): QueryCondition | undefined {
    if (this.conditionTree) {
      return this.conditionTree;
    }
    return buildConditionTreeFromObject(this.whereConditions);
  }

  public toIR = (): DeleteQueryPlan<TTable> => {
    const whereCondition = this.normalizeWhereConditionsForDelete();
    // DELETE operation can have no where condition (delete all of type)
    return {
      table: this.table,
      where: whereCondition
    };
  };

  async execute(): Promise<any[]> {
    if (this.sql) {
      return await this.session.executeSql(this.sql, this.table);
    } else {
      const plan = this.toIR();
      const operation: PodOperation = {
        type: 'delete',
        table: this.table,
        where: plan.where,
        plan
      };
      const results = await this.session.execute(operation);
      
      // Call afterDelete hooks
      await this.runAfterDeleteHooks(results);
      
      return results;
    }
  }

  /**
   * Run afterDelete hooks for all deleted records.
   */
  private async runAfterDeleteHooks(results: any[]): Promise<void> {
    const hooks = this.table.config.hooks;
    if (!hooks?.afterDelete) {
      return;
    }

    // Build hook context
    const ctx = this.buildHookContext();
    if (!ctx) {
      console.warn('[DeleteQueryBuilder] Cannot run hooks: missing session info');
      return;
    }

    // Run hook for each deleted record
    for (const record of results) {
      try {
        await hooks.afterDelete(ctx, record as Record<string, unknown>);
      } catch (error) {
        console.error('[DeleteQueryBuilder] afterDelete hook failed:', error);
        // Don't throw - the delete succeeded, just the hook failed
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

  then<TResult1 = Awaited<ReturnType<DeleteQueryBuilder<TTable>['execute']>>, TResult2 = never>(
    onfulfilled?: ((value: Awaited<ReturnType<DeleteQueryBuilder<TTable>['execute']>>) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}
