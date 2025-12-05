/**
 * URI Column Handler
 *
 * 处理 uri 类型列，输出 NamedNode 而非 Literal
 */

import type { PodColumnBase, PodTable } from '../../pod-table';
import type { ColumnHandler, RdfTerm, BuildResult, BuildContext } from '../types';

/**
 * URI 列处理器
 *
 * URI 类型作为 NamedNode，不是 Literal
 */
export class UriHandler implements ColumnHandler {
  readonly name = 'uri';

  canHandle(column: PodColumnBase): boolean {
    return column.dataType === 'uri' || column.isReference();
  }

  formatValue(value: unknown, _column: PodColumnBase): RdfTerm {
    const uri = String(value);

    // 验证 URI 格式
    // 放宽验证：允许任何包含协议头的 URI (如 urn:, did:, oidc:)
    if (!uri.includes(':')) {
      throw new Error(`URI column requires valid URI (must contain scheme), got: ${uri}`);
    }

    return {
      termType: 'NamedNode',
      value: uri,
    };
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
