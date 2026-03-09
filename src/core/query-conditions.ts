/**
 * 查询条件构建器
 * 提供类似 Drizzle 的查询条件函数
 */

import { PodColumnBase } from './schema';
import { BinaryExpression, LogicalExpression, UnaryExpression, SPARQLExpression } from './expressions';

// 导出新的类型
export type QueryCondition = BinaryExpression | LogicalExpression | UnaryExpression;

// 定义一个宽松的列类型，接受任何 PodColumnBase 变体
type AnyColumn = PodColumnBase<any, any, any, any>;
type ConditionOperand = AnyColumn | SPARQLExpression | string;

// 等于条件
export function eq(column: ConditionOperand, value: any): QueryCondition {
  return new BinaryExpression(column, '=', value);
}

// 不等于条件
export function ne(column: ConditionOperand, value: any): QueryCondition {
  return new BinaryExpression(column, '!=', value);
}

// 大于条件
export function gt(column: ConditionOperand, value: any): QueryCondition {
  return new BinaryExpression(column, '>', value);
}

// 大于等于条件
export function gte(column: ConditionOperand, value: any): QueryCondition {
  return new BinaryExpression(column, '>=', value);
}

// 小于条件
export function lt(column: ConditionOperand, value: any): QueryCondition {
  return new BinaryExpression(column, '<', value);
}

// 小于等于条件
export function lte(column: ConditionOperand, value: any): QueryCondition {
  return new BinaryExpression(column, '<=', value);
}

// LIKE 条件（模糊匹配）
export function like(column: ConditionOperand, pattern: string): QueryCondition {
  return new BinaryExpression(column, 'LIKE', pattern);
}

// ILIKE 条件（不区分大小写匹配）
export function ilike(column: ConditionOperand, pattern: string): QueryCondition {
  return new BinaryExpression(column, 'ILIKE', pattern);
}

// BETWEEN 条件
export function between(column: ConditionOperand, min: any, max: any): QueryCondition {
  return new BinaryExpression(column, 'BETWEEN', [min, max]);
}

// NOT BETWEEN 条件
export function notBetween(column: ConditionOperand, min: any, max: any): QueryCondition {
  return new BinaryExpression(column, 'NOT BETWEEN', [min, max]);
}

// REGEX 条件（自定义正则）
export function regex(column: ConditionOperand, pattern: string, flags?: string): QueryCondition {
  return new BinaryExpression(column, 'REGEX', { pattern, flags });
}

// IN 条件
export function inArray(column: ConditionOperand, values: any[]): QueryCondition {
  return new BinaryExpression(column, 'IN', values);
}

// NOT IN 条件
export function notInArray(column: ConditionOperand, values: any[]): QueryCondition {
  return new BinaryExpression(column, 'NOT IN', values);
}

// IS NULL 条件
export function isNull(column: ConditionOperand): QueryCondition {
  return new UnaryExpression('IS NULL', column);
}

// IS NOT NULL 条件
export function isNotNull(column: ConditionOperand): QueryCondition {
  return new UnaryExpression('IS NOT NULL', column);
}

// AND 逻辑条件
export function and(...conditions: (QueryCondition | undefined | null | false)[]): QueryCondition {
  return new LogicalExpression('AND', conditions.filter(Boolean) as QueryCondition[]);
}

// OR 逻辑条件
export function or(...conditions: (QueryCondition | undefined | null | false)[]): QueryCondition {
  return new LogicalExpression('OR', conditions.filter(Boolean) as QueryCondition[]);
}

// NOT 逻辑条件
export function not(condition: QueryCondition): QueryCondition {
  return new UnaryExpression('NOT', condition);
}

// EXISTS 条件
export function exists(subquery: string): QueryCondition {
  return new UnaryExpression('EXISTS', subquery);
}

// NOT EXISTS 条件
export function notExists(subquery: string): QueryCondition {
  return new UnaryExpression('NOT EXISTS', subquery);
}

// 导出所有条件函数
export const conditions = {
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  like,
  ilike,
  between,
  notBetween,
  regex,
  inArray,
  notInArray,
  isNull,
  isNotNull,
  and,
  or,
  not,
  exists,
  notExists
};

// 默认导出
export default conditions;