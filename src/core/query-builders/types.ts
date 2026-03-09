import { PodColumnBase, type InferInsertData, type InferUpdateData, PodTable } from '../schema';
import { QueryCondition } from '../query-conditions';
import { AggregateExpression } from '../aggregates';
import { PodOperation } from '../pod-dialect';
import { SQL } from 'drizzle-orm';

export type SelectField = PodColumnBase | PodTable<any> | string | AggregateExpression | SelectFieldMap;
export interface SelectFieldMap {
  [key: string]: SelectField;
}

export interface InsertQueryPlan<TTable extends PodTable<any> = PodTable<any>> {
  table: TTable;
  rows: InferInsertData<TTable>[];
}

export interface UpdateQueryPlan<TTable extends PodTable<any> = PodTable<any>> {
  table: TTable;
  data: InferUpdateData<TTable>;
  where: QueryCondition;
}

export interface DeleteQueryPlan<TTable extends PodTable<any> = PodTable<any>> {
  table: TTable;
  where?: QueryCondition;
}

export type JoinType = 'leftJoin' | 'rightJoin' | 'innerJoin' | 'fullJoin' | 'crossJoin';

export interface ColumnReference {
  table: PodTable<any>;
  alias: string;
  column: string;
}

export interface ResolvedJoinCondition {
  left: ColumnReference;
  right: ColumnReference;
}

export interface SessionInterface {
  execute(operation: PodOperation): Promise<any[]>;
  executeSql(sql: SQL, table: PodTable): Promise<any[]>;
  getDialect(): any;
  select(fields?: SelectFieldMap): any;
}