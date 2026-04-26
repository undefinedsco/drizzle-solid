/**
 * URI Column Handler
 *
 * 处理 uri 类型列，输出 NamedNode 而非 Literal
 * 支持自动补全相对 URI 为完整 URL
 * 
 * 使用统一的 UriResolver 进行 URI 解析
 */

import type { PodColumnBase, PodTable } from '../../schema';
import type { ColumnHandler, RdfTerm, BuildResult, BuildContext } from '../types';
import type { UriContext } from '../../uri';
import { UriResolverImpl } from '../../uri';

/**
 * URI 列处理器
 *
 * URI 类型作为 NamedNode，不是 Literal
 * 支持根据 link 配置自动补全 URI
 */
export class UriHandler implements ColumnHandler {
  readonly name = 'uri';

  canHandle(column: PodColumnBase): boolean {
    return column.dataType === 'uri' || column.isLink();
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
      record: context.record,
      currentTable: context.currentTable,
    };
  }

  formatValue(value: unknown, column: PodColumnBase, context?: BuildContext): RdfTerm {
    const uri = String(value);
    // 传递 context 给 uriResolver，让其作为参数使用而非内部状态
    const uriContext = this.toUriContext(context);
    const resolver = context?.uriResolver ?? new UriResolverImpl();
    const resolved = resolver.resolveLink(uri, column, uriContext);

    return {
      termType: 'NamedNode',
      value: resolved,
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
    context: BuildContext
  ): BuildResult {
    const objectTerm = this.formatValue(value, column, context);

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
