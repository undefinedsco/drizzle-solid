import { entityKind, SQL } from 'drizzle-orm';
import { PodTable } from '../pod-table';
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
      this.whereConditions = conditions;
      this.conditionTree = undefined;
    }
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
      return await this.session.execute(operation);
    }
  }

  then<TResult1 = Awaited<ReturnType<DeleteQueryBuilder<TTable>['execute']>>, TResult2 = never>(
    onfulfilled?: ((value: Awaited<ReturnType<DeleteQueryBuilder<TTable>['execute']>>) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}
