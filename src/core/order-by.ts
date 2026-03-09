import { PodColumnBase } from './schema';

export interface OrderByExpression {
  column: PodColumnBase | string;
  direction: 'asc' | 'desc';
}

export function asc(column: PodColumnBase | string): OrderByExpression {
  return { column, direction: 'asc' };
}

export function desc(column: PodColumnBase | string): OrderByExpression {
  return { column, direction: 'desc' };
}

export function isOrderByExpression(value: unknown): value is OrderByExpression {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<OrderByExpression>;
  return (
    'column' in candidate
    && (candidate.direction === 'asc' || candidate.direction === 'desc')
  );
}
