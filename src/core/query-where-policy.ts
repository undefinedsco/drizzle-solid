import type { QueryCondition } from './query-conditions';
import { PodColumnBase } from './schema';

type PublicWhereAction = 'select' | 'update' | 'delete';
type VirtualIdPodColumn = PodColumnBase & { _virtualId?: boolean };

function isReservedIdentifierKey(key: string): boolean {
  return key === 'id'
    || key === '@id'
    || key.endsWith('.id')
    || key.endsWith('.@id');
}

function isReservedIdentifierOperand(value: unknown): boolean {
  if (value instanceof PodColumnBase) {
    const column = value as VirtualIdPodColumn;
    return value.name === 'id'
      || value.options?.predicate === '@id'
      || column._virtualId === true;
  }

  if (typeof value === 'string') {
    return isReservedIdentifierKey(value);
  }

  return false;
}

export function conditionTargetsReservedIdentifier(condition: QueryCondition): boolean {
  if (condition.type === 'binary_expr') {
    if (isReservedIdentifierOperand(condition.left) || isReservedIdentifierOperand(condition.right)) {
      return true;
    }
    return false;
  }

  if (condition.type === 'logical_expr') {
    return condition.expressions.some((expression) =>
      expression != null
      && typeof expression === 'object'
      && 'type' in expression
      && conditionTargetsReservedIdentifier(expression as QueryCondition)
    );
  }

  if (condition.type === 'unary_expr') {
    return condition.value != null
      && typeof condition.value === 'object'
      && 'type' in condition.value
      && conditionTargetsReservedIdentifier(condition.value as QueryCondition);
  }

  return false;
}

function createWhereIdentifierError(action: PublicWhereAction): string {
  switch (action) {
    case 'select':
      return [
        `Using 'id' or '@id' in where() is not supported.`,
        `Use findByLocator(locator) for template-based exact lookups,`,
        `or findByIri(iri) for IRI-based exact lookups.`,
      ].join(' ');
    case 'update':
      return [
        `Using 'id' or '@id' in where() is not supported.`,
        `Use updateByLocator(locator, data) for template-based exact updates,`,
        `or updateByIri(iri, data) for IRI-based exact updates.`,
      ].join(' ');
    case 'delete':
      return [
        `Using 'id' or '@id' in where() is not supported.`,
        `Use deleteByLocator(locator) for template-based exact deletes,`,
        `or deleteByIri(iri) for IRI-based exact deletes.`,
      ].join(' ');
  }
}

export function assertPublicWhereObject(
  action: PublicWhereAction,
  conditions: Record<string, unknown> | undefined,
): void {
  if (!conditions) {
    return;
  }

  for (const key of Object.keys(conditions)) {
    if (isReservedIdentifierKey(key)) {
      throw new Error(createWhereIdentifierError(action));
    }
  }
}

export function assertPublicWhereCondition(
  action: PublicWhereAction,
  condition: QueryCondition,
): void {
  if (conditionTargetsReservedIdentifier(condition)) {
    throw new Error(createWhereIdentifierError(action));
  }
}
