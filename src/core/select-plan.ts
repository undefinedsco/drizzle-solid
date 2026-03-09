import { PodTable, PodColumnBase } from './schema';
import { AggregateExpression } from './aggregates';
import { QueryCondition } from './query-conditions';

export type SelectField = PodColumnBase | PodTable<any> | string | AggregateExpression | SelectFieldMap;
export interface SelectFieldMap {
  [key: string]: SelectField;
}

export interface ColumnReference {
  table: PodTable<any>;
  alias: string;
  column: string;
}

export interface JoinCondition {
  left: ColumnReference;
  right: ColumnReference;
}

export type JoinType = 'leftJoin' | 'rightJoin' | 'innerJoin' | 'fullJoin' | 'crossJoin';

export interface JoinPlan {
  type: JoinType;
  table: PodTable<any>;
  alias: string;
  conditions: JoinCondition[];
  filters?: QueryCondition[];
}

export interface OrderByDescriptor {
  reference?: ColumnReference;
  rawColumn?: string;
  direction: 'asc' | 'desc';
}

export interface SelectQueryPlan {
  baseTable: PodTable<any>;
  baseAlias: string;
  select?: SelectFieldMap;
  selectAll?: boolean;
  where?: Record<string, any>;
  conditionTree?: QueryCondition;
  joins?: JoinPlan[];
  joinFilters?: QueryCondition[];
  groupBy?: ColumnReference[];
  having?: QueryCondition;
  orderBy?: OrderByDescriptor[];
  distinct?: boolean;
  limit?: number;
  offset?: number;
  aliasToTable: Map<string, PodTable<any>>;
  tableToAlias: Map<PodTable<any>, string>;
}
