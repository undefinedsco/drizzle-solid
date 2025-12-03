/**
 * 查询条件构建器
 * 提供类似 Drizzle 的查询条件函数
 */

import { PodColumnBase } from './pod-table';

// 查询条件类型
export interface QueryCondition {
  type: 'binary_expr' | 'unary_expr' | 'logical_expr';
  operator: string;
  left?: any;
  right?: any;
  column?: string;
  value?: any;
  conditions?: QueryCondition[];
  table?: string;
}

// 二元操作符条件构建器
function createBinaryCondition(
  column: PodColumnBase | string,
  operator: string,
  value: any
): QueryCondition {
  const { tableName, columnName } = resolveColumnAndTable(column);
  
  return {
    type: 'binary_expr',
    operator,
    left: { column: columnName },
    right: { value },
    column: columnName,
    value,
    table: tableName
  };
}

function resolveColumnAndTable(column: PodColumnBase | string): { columnName: string; tableName?: string } {
  if (typeof column === 'string') {
    if (column.includes('.')) {
      const [table, col] = column.split('.', 2);
      return { columnName: col, tableName: table };
    }
    return { columnName: column };
  }

  return { columnName: column.name, tableName: column.tableName };
}

// 等于条件
export function eq(column: PodColumnBase | string, value: any): QueryCondition {
  return createBinaryCondition(column, '=', value);
}

// 不等于条件
export function ne(column: PodColumnBase | string, value: any): QueryCondition {
  return createBinaryCondition(column, '!=', value);
}

// 大于条件
export function gt(column: PodColumnBase | string, value: any): QueryCondition {
  return createBinaryCondition(column, '>', value);
}

// 大于等于条件
export function gte(column: PodColumnBase | string, value: any): QueryCondition {
  return createBinaryCondition(column, '>=', value);
}

// 小于条件
export function lt(column: PodColumnBase | string, value: any): QueryCondition {
  return createBinaryCondition(column, '<', value);
}

// 小于等于条件
export function lte(column: PodColumnBase | string, value: any): QueryCondition {
  return createBinaryCondition(column, '<=', value);
}

// LIKE 条件（模糊匹配）
export function like(column: PodColumnBase | string, pattern: string): QueryCondition {
  return createBinaryCondition(column, 'LIKE', pattern);
}

// ILIKE 条件（不区分大小写匹配）
export function ilike(column: PodColumnBase | string, pattern: string): QueryCondition {
  return createBinaryCondition(column, 'ILIKE', pattern);
}

// BETWEEN 条件
export function between(column: PodColumnBase | string, min: any, max: any): QueryCondition {
  const { columnName, tableName } = resolveColumnAndTable(column);
  return {
    type: 'binary_expr',
    operator: 'BETWEEN',
    left: { column: columnName },
    right: { value: [min, max] },
    column: columnName,
    value: [min, max],
    table: tableName
  };
}

// NOT BETWEEN 条件
export function notBetween(column: PodColumnBase | string, min: any, max: any): QueryCondition {
  const { columnName, tableName } = resolveColumnAndTable(column);
  return {
    type: 'binary_expr',
    operator: 'NOT BETWEEN',
    left: { column: columnName },
    right: { value: [min, max] },
    column: columnName,
    value: [min, max],
    table: tableName
  };
}

// REGEX 条件（自定义正则）
export function regex(column: PodColumnBase | string, pattern: string, flags?: string): QueryCondition {
  return createBinaryCondition(column, 'REGEX', { pattern, flags });
}

// IN 条件
export function inArray(column: PodColumnBase | string, values: any[]): QueryCondition {
  const { columnName, tableName } = resolveColumnAndTable(column);
  return {
    type: 'binary_expr',
    operator: 'IN',
    left: { column: columnName },
    right: { value: values },
    column: columnName,
    value: values,
    table: tableName
  };
}

// NOT IN 条件
export function notInArray(column: PodColumnBase | string, values: any[]): QueryCondition {
  const { columnName, tableName } = resolveColumnAndTable(column);
  return {
    type: 'binary_expr',
    operator: 'NOT IN',
    left: { column: columnName },
    right: { value: values },
    column: columnName,
    value: values,
    table: tableName
  };
}

// IS NULL 条件
export function isNull(column: PodColumnBase | string): QueryCondition {
  const { columnName, tableName } = resolveColumnAndTable(column);
  return {
    type: 'unary_expr',
    operator: 'IS NULL',
    column: columnName,
    left: { column: columnName },
    table: tableName
  };
}

// IS NOT NULL 条件
export function isNotNull(column: PodColumnBase | string): QueryCondition {
  const { columnName, tableName } = resolveColumnAndTable(column);
  return {
    type: 'unary_expr',
    operator: 'IS NOT NULL',
    column: columnName,
    left: { column: columnName },
    table: tableName
  };
}

// AND 逻辑条件
export function and(...conditions: QueryCondition[]): QueryCondition {
  return {
    type: 'logical_expr',
    operator: 'AND',
    conditions
  };
}

// OR 逻辑条件
export function or(...conditions: QueryCondition[]): QueryCondition {
  return {
    type: 'logical_expr',
    operator: 'OR',
    conditions
  };
}

// NOT 逻辑条件
export function not(condition: QueryCondition): QueryCondition {
  return {
    type: 'unary_expr',
    operator: 'NOT',
    left: condition
  };
}

// EXISTS 条件（传入子查询字符串或条件表达式）
export function exists(subquery: string): QueryCondition {
  return {
    type: 'unary_expr',
    operator: 'EXISTS',
    left: { value: subquery }
  };
}

// NOT EXISTS 条件
export function notExists(subquery: string): QueryCondition {
  return {
    type: 'unary_expr',
    operator: 'NOT EXISTS',
    left: { value: subquery }
  };
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
