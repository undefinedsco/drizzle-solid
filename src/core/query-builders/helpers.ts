import { QueryCondition } from '../query-conditions';
import { BinaryExpression, LogicalExpression, UnaryExpression } from '../expressions';
import { PodColumnBase } from '../pod-table';

export function createLiteralCondition(
  alias: string | undefined,
  column: string,
  value: any
): QueryCondition {
  const colRef = alias ? `${alias}.${column}` : column;

  if (value === undefined || value === null) {
    return new UnaryExpression('IS NULL', colRef);
  }

  if (Array.isArray(value)) {
    return new BinaryExpression(colRef, 'IN', value);
  }

  return new BinaryExpression(colRef, '=', value);
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

  return new LogicalExpression('AND', nodes);
}