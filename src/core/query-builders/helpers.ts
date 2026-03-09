import { QueryCondition } from '../query-conditions';
import { BinaryExpression, LogicalExpression, UnaryExpression } from '../expressions';
import { PodColumnBase, PodTable } from '../schema';
import type { SPARQLQuery } from '../ast-to-sparql';
import type { SelectField, SelectFieldMap } from './types';


export function inferSPARQLQueryType(query: string): SPARQLQuery['type'] | undefined {
  const withoutComments = query
    .replace(/^\s*#.*$/gm, '')
    .trim();

  const withoutProlog = withoutComments
    .replace(/^(?:\s*(?:PREFIX|BASE)\s+[^\n]+\n)*/i, '')
    .trim();
  const firstKeyword = withoutProlog
    .match(/^(SELECT|ASK|INSERT|DELETE|UPDATE|WITH|LOAD|CLEAR|CREATE|DROP|COPY|MOVE|ADD|CONSTRUCT|DESCRIBE)\b/i)?.[1]
    ?.toUpperCase();

  switch (firstKeyword) {
    case 'SELECT':
    case 'ASK':
    case 'INSERT':
    case 'DELETE':
    case 'UPDATE':
      return firstKeyword;
    case 'WITH':
    case 'LOAD':
    case 'CLEAR':
    case 'CREATE':
    case 'DROP':
    case 'COPY':
    case 'MOVE':
    case 'ADD':
      return 'UPDATE';
    default:
      return undefined;
  }
}

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

export function resolveRowSubject(row: Record<string, any>): string | undefined {
  if (!row || typeof row !== 'object') {
    return undefined;
  }

  if (typeof row['@id'] === 'string' && row['@id'].length > 0) {
    return row['@id'];
  }

  if (typeof row.subject === 'string' && row.subject.length > 0) {
    return row.subject;
  }

  if (typeof row.uri === 'string' && row.uri.length > 0) {
    return row.uri;
  }

  return undefined;
}

export function orderRowsBySubjects(
  rows: Record<string, any>[],
  subjects: string[]
): Record<string, any>[] {
  if (!rows.length || !subjects.length) {
    return rows;
  }

  const grouped = new Map<string, Record<string, any>[]>();
  const unmatched: Record<string, any>[] = [];

  for (const row of rows) {
    const subject = resolveRowSubject(row);
    if (!subject) {
      unmatched.push(row);
      continue;
    }
    const existing = grouped.get(subject) ?? [];
    existing.push(row);
    grouped.set(subject, existing);
  }

  const ordered: Record<string, any>[] = [];
  for (const subject of subjects) {
    const matches = grouped.get(subject);
    if (matches?.length) {
      ordered.push(...matches);
      grouped.delete(subject);
    }
  }

  for (const matches of grouped.values()) {
    ordered.push(...matches);
  }
  ordered.push(...unmatched);

  return ordered;
}

function isSelectFieldMap(field: SelectField): field is SelectFieldMap {
  return !!field
    && typeof field === 'object'
    && !(field instanceof PodColumnBase)
    && !(field instanceof PodTable)
    && !('aggregateType' in (field as Record<string, unknown>));
}

function resolveFieldBindingCandidates(alias: string, field: SelectField): string[] {
  const candidates = new Set<string>();

  if (typeof field === 'string') {
    candidates.add(field);
    if (field.includes('.')) {
      const [fieldAlias, column] = field.split('.', 2);
      if (column) {
        candidates.add(`${fieldAlias}.${column}`);
        candidates.add(column);
      }
    }
  } else if (field instanceof PodColumnBase) {
    if (field.table?.config?.name) {
      candidates.add(`${field.table.config.name}.${field.name}`);
    }
    candidates.add(field.name);
  }

  return Array.from(candidates);
}

function isEmptyProjectedValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === 'object') {
    const entries = Object.values(value as Record<string, unknown>);
    return entries.length > 0 && entries.every((entry) => isEmptyProjectedValue(entry));
  }
  return false;
}

function projectTableRow(row: Record<string, any>, table: PodTable<any>): Record<string, any> | null {
  const alias = table.config.name;
  const projected: Record<string, any> = {};
  let hasValue = false;

  for (const columnName of Object.keys(table.columns)) {
    const candidates = alias ? [`${alias}.${columnName}`, columnName] : [columnName];
    const match = candidates.find((candidate) => row[candidate] !== undefined);
    projected[columnName] = match ? row[match] : undefined;
    if (projected[columnName] !== undefined) {
      hasValue = true;
    }
  }

  return hasValue ? projected : null;
}

function projectFieldValue(row: Record<string, any>, alias: string, field: SelectField): any {
  if (field instanceof PodTable) {
    return projectTableRow(row, field);
  }

  if (isSelectFieldMap(field)) {
    const projected: Record<string, any> = {};
    for (const [nestedKey, nestedField] of Object.entries(field)) {
      projected[nestedKey] = projectFieldValue(row, nestedKey, nestedField);
    }
    return isEmptyProjectedValue(projected) ? null : projected;
  }

  for (const candidate of resolveFieldBindingCandidates(alias, field)) {
    if (row[candidate] !== undefined) {
      return row[candidate];
    }
  }

  return row[alias];
}

export function projectReturningRow(
  row: Record<string, any>,
  fields?: SelectFieldMap | true
): Record<string, any> {
  if (!fields || fields === true) {
    return row;
  }

  const projected: Record<string, any> = {};
  for (const [alias, field] of Object.entries(fields)) {
    projected[alias] = projectFieldValue(row, alias, field);
  }

  return projected;
}

export function projectReturningRows(
  rows: Record<string, any>[],
  fields?: SelectFieldMap | true
): Record<string, any>[] {
  if (!fields || fields === true) {
    return rows;
  }

  return rows.map((row) => projectReturningRow(row, fields));
}
