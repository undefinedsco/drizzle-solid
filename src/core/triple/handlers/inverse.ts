/**
 * Inverse Column Handler
 *
 * 处理逆向谓词列，交换 subject 和 object 位置
 */

import type { PodColumnBase, PodTable } from '../../schema';
import type { ColumnHandler, RdfTerm, BuildResult, BuildContext } from '../types';

const XSD = 'http://www.w3.org/2001/XMLSchema#';

/**
 * 逆向谓词处理器
 *
 * 正常三元组: <subject> <predicate> <object>
 * 逆向三元组: <object> <predicate> <subject>
 */
export class InverseHandler implements ColumnHandler {
  readonly name = 'inverse';

  canHandle(column: PodColumnBase): boolean {
    return column.options?.inverse === true;
  }

  formatValue(value: unknown, column: PodColumnBase, _context?: BuildContext): RdfTerm {
    // 逆向谓词的 object 通常是 URI 引用
    if (column.options?.referenceTarget || column.dataType === 'uri' || this.isUri(value)) {
      return {
        termType: 'NamedNode',
        value: String(value),
      };
    }

    // 如果不是引用，作为普通字面量
    return {
      termType: 'Literal',
      value: String(value),
      datatype: { termType: 'NamedNode', value: `${XSD}string` },
    };
  }

  private isUri(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    return value.startsWith('http://') || value.startsWith('https://');
  }

  parseValue(term: RdfTerm, _column: PodColumnBase): unknown {
    return term.value;
  }

  buildTriples(
    subject: string,
    predicate: string,
    value: unknown,
    column: PodColumnBase,
    _table: PodTable,
    _context: BuildContext
  ): BuildResult {
    const values = Array.isArray(value)
      ? value
      : (typeof value === 'string' && value.includes(','))
        ? value.split(',').map((v) => v.trim()).filter(Boolean)
        : [value];

    const triples = values.map((v) => ({
      subject: { termType: 'NamedNode' as const, value: toIriString(v) },
      predicate: { termType: 'NamedNode' as const, value: predicate },
      object: { termType: 'NamedNode' as const, value: subject }
    }));
    return { triples };
  }
}

function toIriString(raw: any): string {
  const str = typeof raw === 'string' ? raw.replace(/^\"|\"$/g, '') : String(raw);
  if (str.startsWith('<') && str.endsWith('>')) {
    return str.slice(1, -1);
  }
  return str;
}
