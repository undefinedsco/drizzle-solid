import { entityKind, SQL } from 'drizzle-orm';
import { PodTable, InferUpdateData } from '../pod-table';
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
      return await this.session.execute(operation);
    } else {
      throw new Error('No data specified for UPDATE query');
    }
  }

  then<TResult1 = Awaited<ReturnType<UpdateQueryBuilder<TTable>['execute']>>, TResult2 = never>(
    onfulfilled?: ((value: Awaited<ReturnType<UpdateQueryBuilder<TTable>['execute']>>) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}
