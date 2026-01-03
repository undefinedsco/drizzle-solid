/**
 * Array Column Handler
 *
 * 处理数组类型列，为每个元素创建独立三元组
 */

import type { PodColumnBase, PodTable } from '../../schema';
import type { ColumnHandler, RdfTerm, BuildResult, BuildContext, Triple } from '../types';

const XSD = 'http://www.w3.org/2001/XMLSchema#';

/**
 * 数组列处理器
 *
 * RDF 中数组表示为多个三元组:
 * <subject> <predicate> "value1" .
 * <subject> <predicate> "value2" .
 */
export class ArrayHandler implements ColumnHandler {
  readonly name = 'array';

  canHandle(column: PodColumnBase): boolean {
    return column.options?.isArray === true || column.dataType === 'array';
  }

  formatValue(value: unknown, column: PodColumnBase, _context?: BuildContext): RdfTerm[] {
    if (!Array.isArray(value)) {
      throw new Error('Array column requires array value');
    }

    const elementType = column.options?.baseType ?? 'string';

    return value.map((item) => this.formatSingleValue(item, elementType));
  }

  private formatSingleValue(value: unknown, elementType: string): RdfTerm {
    switch (elementType) {
      case 'string':
        return {
          termType: 'Literal',
          value: String(value),
          datatype: { termType: 'NamedNode', value: `${XSD}string` },
        };

      case 'integer':
        return {
          termType: 'Literal',
          value: String(Number(value)),
          datatype: { termType: 'NamedNode', value: `${XSD}integer` },
        };

      case 'boolean':
        return {
          termType: 'Literal',
          value: String(Boolean(value)),
          datatype: { termType: 'NamedNode', value: `${XSD}boolean` },
        };

      case 'datetime': {
        const date = value instanceof Date ? value : new Date(value as string | number);
        return {
          termType: 'Literal',
          value: date.toISOString(),
          datatype: { termType: 'NamedNode', value: `${XSD}dateTime` },
        };
      }

      case 'uri':
        return {
          termType: 'NamedNode',
          value: String(value),
        };

      default:
        return {
          termType: 'Literal',
          value: String(value),
        };
    }
  }

  parseValue(term: RdfTerm, column: PodColumnBase): unknown {
    const elementType = column.options?.baseType ?? 'string';
    const datatypeUri = term.datatype?.value ?? '';

    switch (elementType) {
      case 'integer':
        return parseInt(term.value, 10);
      case 'boolean':
        return term.value === 'true';
      case 'datetime':
        return new Date(term.value);
      case 'uri':
        return term.value;
      default:
        // 尝试根据 datatype 推断
        if (datatypeUri.includes('#integer')) {
          return parseInt(term.value, 10);
        }
        if (datatypeUri.includes('#boolean')) {
          return term.value === 'true';
        }
        if (datatypeUri.includes('#dateTime')) {
          return new Date(term.value);
        }
        return term.value;
    }
  }

  buildTriples(
    subject: string,
    predicate: string,
    value: unknown,
    column: PodColumnBase,
    _table: PodTable,
    _context: BuildContext
  ): BuildResult {
    // 处理逗号分隔字符串的兼容
    let arrayValue: unknown[];
    if (Array.isArray(value)) {
      arrayValue = value;
    } else if (typeof value === 'string' && value.includes(',')) {
      arrayValue = value.split(',').map((v) => v.trim()).filter(Boolean);
    } else {
      arrayValue = [value];
    }

    const objectTerms = this.formatValue(arrayValue, column);
    const triples: Triple[] = objectTerms.map((objectTerm) => ({
      subject: { termType: 'NamedNode' as const, value: subject },
      predicate: { termType: 'NamedNode' as const, value: predicate },
      object: objectTerm,
    }));

    return { triples };
  }
}
