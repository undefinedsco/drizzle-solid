import { PodColumnBase } from './pod-table';

export type AggregateFunction = 'count' | 'sum' | 'avg' | 'min' | 'max';

export interface AggregateExpression {
  kind: 'aggregate';
  func: AggregateFunction;
  column?: PodColumnBase | string;
  distinct?: boolean;
}

interface AggregateOptions {
  distinct?: boolean;
}

function normalizeOptions(options?: AggregateOptions): AggregateOptions {
  return options ? { ...options } : {};
}

function toColumnName(column?: PodColumnBase | string): PodColumnBase | string | undefined {
  return column;
}

function ensureColumn(func: Exclude<AggregateFunction, 'count'>, column?: PodColumnBase | string) {
  if (!column) {
    throw new Error(`${func.toUpperCase()} aggregate requires a column reference`);
  }
}

function createAggregate(
  func: AggregateFunction,
  column?: PodColumnBase | string,
  options?: AggregateOptions
): AggregateExpression {
  const normalized = normalizeOptions(options);
  return {
    kind: 'aggregate',
    func,
    column: toColumnName(column),
    distinct: normalized.distinct
  };
}

export function count(
  column?: PodColumnBase | string,
  options?: AggregateOptions
): AggregateExpression {
  return createAggregate('count', column, options);
}

export function sum(
  column: PodColumnBase | string,
  options?: AggregateOptions
): AggregateExpression {
  ensureColumn('sum', column);
  return createAggregate('sum', column, options);
}

export function avg(
  column: PodColumnBase | string,
  options?: AggregateOptions
): AggregateExpression {
  ensureColumn('avg', column);
  return createAggregate('avg', column, options);
}

export function min(
  column: PodColumnBase | string,
  options?: AggregateOptions
): AggregateExpression {
  ensureColumn('min', column);
  return createAggregate('min', column, options);
}

export function max(
  column: PodColumnBase | string,
  options?: AggregateOptions
): AggregateExpression {
  ensureColumn('max', column);
  return createAggregate('max', column, options);
}

export function isAggregateExpression(value: unknown): value is AggregateExpression {
  return !!value && typeof value === 'object' && (value as AggregateExpression).kind === 'aggregate';
}
