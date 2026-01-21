/**
 * Inverse Column Handler
 *
 * 处理逆向谓词列，交换 subject 和 object 位置
 */

import type { PodColumnBase, PodTable } from '../../schema';
import type { ColumnHandler, RdfTerm, BuildResult, BuildContext } from '../types';
import type { UriContext } from '../../uri';
import { UriResolverImpl } from '../../uri';

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

  /**
   * 将 BuildContext 转换为 UriContext
   */
  private toUriContext(context?: BuildContext): UriContext | undefined {
    if (!context) return undefined;

    return {
      baseUri: context.baseUri,
      tableRegistry: context.tableRegistry,
      tableNameRegistry: context.tableNameRegistry,
    };
  }

  formatValue(value: unknown, column: PodColumnBase, context?: BuildContext): RdfTerm {
    // 如果是 URI 引用类型，使用 UriResolver 解析
    if (column.options?.referenceTarget || column.dataType === 'uri' || column.isReference?.()) {
      const uri = String(value);
      const uriContext = this.toUriContext(context);
      const resolver = context?.uriResolver ?? new UriResolverImpl();
      const resolved = resolver.resolveReference(uri, column, uriContext);

      return {
        termType: 'NamedNode',
        value: resolved,
      };
    }

    // 如果是普通 URI 字符串
    if (this.isUri(value)) {
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
    context: BuildContext
  ): BuildResult {
    const values = Array.isArray(value)
      ? value
      : (typeof value === 'string' && value.includes(','))
        ? value.split(',').map((v) => v.trim()).filter(Boolean)
        : [value];

    const triples = values.map((v) => {
      // 使用 formatValue 来正确处理 URI 解析
      const objectTerm = this.formatValue(v, column, context);

      return {
        subject: objectTerm,  // 逆向：引用值作为 subject
        predicate: { termType: 'NamedNode' as const, value: predicate },
        object: { termType: 'NamedNode' as const, value: subject }  // 当前记录作为 object
      };
    });

    return { triples };
  }
}
