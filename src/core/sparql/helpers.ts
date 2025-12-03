import { PodTable, PodColumnBase } from '../pod-table';
import { subjectResolver } from '../subject';

const XSD = 'http://www.w3.org/2001/XMLSchema#';

export interface RdfTerm {
  termType: 'NamedNode' | 'Literal' | 'BlankNode' | 'Variable';
  value: string;
  datatype?: RdfTerm;
  language?: string;
}

export function getPredicateForColumn(column: PodColumnBase | any, table: PodTable): string {
  if (!column) {
    return 'http://example.org/unknown';
  }

  // 0. 尝试从 getMapping 获取 (Test compatibility)
  if (typeof (table as any).getMapping === 'function') {
    const mapping = (table as any).getMapping();
    const mapped = mapping?.columns?.[column.name];
    if (mapped?.predicate) {
      return mapped.predicate;
    }
  }

  // 1. 尝试从 ColumnBuilder 获取
  if (typeof (column as any).getPredicateUri === 'function') {
    return (column as any).getPredicateUri();
  }
  if ((column as any)._predicateUri) {
    return (column as any)._predicateUri;
  }
  if (column.predicate && typeof column.predicate === 'string') {
    return column.predicate;
  }
  
  // 1.5 Check legacy getPredicate function (used in tests)
  if (typeof (column as any).getPredicate === 'function') {
    try {
      const ns = table.config.namespace;
      return (column as any).getPredicate(ns);
    } catch (e) {
      // ignore
    }
  }

  // 2. 从 options 获取
  if (column.options?.predicate) {
    return column.options.predicate;
  }

  // 3. 使用 Namespace
  const namespace = table.config.namespace;
  if (namespace) {
    const nsUri = typeof namespace === 'string' ? namespace : namespace.uri;
    return `${nsUri}${column.name}`;
  }

  // Debugging for test
  if (column.name === 'id') {
     console.log(`[DEBUG] getPredicateForColumn 'id' fallback to example.org. Column:`, column);
  }

  // 4. 默认 fallback
  return `http://example.org/${column.name}`;
}

export function formatValue(value: any, column?: PodColumnBase | any): string | string[] {
  if (Array.isArray(value)) {
    return value.map((v) => formatSingleValue(v, column));
  }
  return formatSingleValue(value, column);
}

function formatSingleValue(value: any, column?: PodColumnBase | any): string {
  if (value === null || value === undefined) {
    return '""';
  }

  // 如果是 URI 列，始终作为 URI 处理
  if (column?.dataType === 'uri' || column?.options?.referenceTarget) {
    const str = String(value);
    if (str.startsWith('<')) return str;
    return `<${str}>`;
  }

  if (typeof value === 'string') {
    // 简单的 URI 检测 (如果未指定列类型)
    if (!column && (value.startsWith('http://') || value.startsWith('https://'))) {
      return `<${value}>`;
    }
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\"');
    return `"${escaped}"`;
  }

  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return String(value);
    }
    return `"${value}"^^<${XSD}decimal>`;
  }

  if (typeof value === 'boolean') {
    return `"${value}"^^<${XSD}boolean>`;
  }

  if (value instanceof Date) {
    return `"${value.toISOString()}"^^<${XSD}dateTime>`;
  }

  return `"${String(value)}"`;
}

export function buildLiteralTerm(value: any): RdfTerm {
  if (typeof value === 'string') {
    if (value.startsWith('http://') || value.startsWith('https://')) {
      return { termType: 'NamedNode', value };
    }
    return { termType: 'Literal', value };
  }
  if (typeof value === 'number') {
    return {
      termType: 'Literal',
      value: String(value),
      datatype: { termType: 'NamedNode', value: Number.isInteger(value) ? `${XSD}integer` : `${XSD}decimal` }
    };
  }
  if (typeof value === 'boolean') {
    return {
      termType: 'Literal',
      value: String(value),
      datatype: { termType: 'NamedNode', value: `${XSD}boolean` }
    };
  }
  if (value instanceof Date) {
    return {
      termType: 'Literal',
      value: value.toISOString(),
      datatype: { termType: 'NamedNode', value: `${XSD}dateTime` }
    };
  }
  return { termType: 'Literal', value: String(value) };
}

export function resolveColumn(field: unknown, table: PodTable): PodColumnBase {
  if (field && typeof field === 'object' && field instanceof PodColumnBase) {
    return field;
  }

  if (field && typeof field === 'object' && 'name' in (field as Record<string, unknown>)) {
    const potential = (field as { name?: unknown }).name;
    if (typeof potential === 'string' && table.columns[potential]) {
      return table.columns[potential];
    }
  }

  if (typeof field === 'string') {
    const column = table.columns[field];
    if (column) {
      return column;
    }
  }

  throw new Error(`Unable to resolve column reference for select field: ${String(field)}`);
}

export function generateSubjectUri(record: any, table: PodTable): string {
  const uri = subjectResolver.resolve(table, record);
  if (!uri) {
    throw new Error('Failed to generate subject URI');
  }
  return uri;
}
