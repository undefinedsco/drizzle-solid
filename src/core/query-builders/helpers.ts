import { QueryCondition } from '../query-conditions';
import { PodColumnBase } from '../pod-table';

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

export function createLiteralCondition(
  alias: string | undefined,
  column: string,
  value: any
): QueryCondition {
  if (value === undefined || value === null) {
    return {
      type: 'unary_expr',
      operator: 'IS NULL',
      column,
      left: { column },
      table: alias
    };
  }

  if (Array.isArray(value)) {
    return {
      type: 'binary_expr',
      operator: 'IN',
      column,
      left: { column },
      right: { value },
      value,
      table: alias
    };
  }

  return {
    type: 'binary_expr',
    operator: '=',
    column,
    left: { column },
    right: { value },
    value,
    table: alias
  };
}

export function buildConditionTreeFromObject(
  conditions: Record<string, any> | undefined,
  alias?: string
): QueryCondition | undefined {
  if (!conditions) {
    return undefined;
  }

  const entries = Object.entries(conditions);
  if (entries.length === 0) {
    return undefined;
  }

  const nodes = entries.map(([column, value]) =>
    createLiteralCondition(alias, column, value)
  );

  if (nodes.length === 1) {
    return nodes[0];
  }

  return {
    type: 'logical_expr',
    operator: 'AND',
    conditions: nodes
  };
}
