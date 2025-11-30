/**
 * Default Column Handler
 *
 * 处理基本类型: string, integer, boolean, datetime
 */

import type { PodColumnBase, PodTable } from '../../pod-table';
import type { ColumnHandler, RdfTerm, BuildResult, BuildContext } from '../types';

const XSD = 'http://www.w3.org/2001/XMLSchema#';

/**
 * 默认列处理器
 *
 * 处理 string, integer, boolean, datetime 类型
 */
export class DefaultHandler implements ColumnHandler {
  readonly name = 'default';

  canHandle(column: PodColumnBase): boolean {
    const type = column.dataType;
    return type === 'string' || type === 'integer' || type === 'boolean' || type === 'datetime';
  }

  formatValue(value: unknown, column: PodColumnBase): RdfTerm {
    switch (column.dataType) {
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

      default:
        return {
          termType: 'Literal',
          value: String(value),
        };
    }
  }

  parseValue(term: RdfTerm, column: PodColumnBase): unknown {
    const datatypeUri = term.datatype?.value ?? '';

    switch (column.dataType) {
      case 'integer':
        return parseInt(term.value, 10);

      case 'boolean':
        return term.value === 'true';

      case 'datetime':
        return new Date(term.value);

      case 'string':
      default:
        // 尝试根据 datatype 推断
        if (datatypeUri.includes('#integer') || datatypeUri.includes('#int')) {
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
    const objectTerm = this.formatValue(value, column);

    return {
      triples: [
        {
          subject: { termType: 'NamedNode', value: subject },
          predicate: { termType: 'NamedNode', value: predicate },
          object: objectTerm,
        },
      ],
    };
  }
}
