/**
 * Inline Object Column Handler
 *
 * 处理内联对象类型列 (object/json)，创建嵌套三元组结构
 */

import type { PodColumnBase, PodTable } from '../../schema';
import type { ColumnHandler, RdfTerm, BuildResult, BuildContext, Triple } from '../types';

const XSD = 'http://www.w3.org/2001/XMLSchema#';

/**
 * 内联对象处理器
 *
 * 内联对象存储为嵌套三元组:
 * <parent> <predicate> <childIri> .
 * <childIri> <prop1> "value1" .
 * <childIri> <prop2> "value2" .
 */
export class InlineObjectHandler implements ColumnHandler {
  readonly name = 'inline';

  canHandle(column: PodColumnBase): boolean {
    if (column.dataType === 'object' || column.dataType === 'json') {
      return true;
    }
    if (column.dataType === 'array') {
      const baseType = (column as any).elementType || column.options?.baseType;
      return baseType === 'object' || baseType === 'json';
    }
    return false;
  }

  formatValue(value: unknown, _column: PodColumnBase, _context?: BuildContext): RdfTerm {
    // 内联对象的值是子对象 URI (NamedNode)
    // 实际的 URI 在 buildTriples 中通过 context 生成
    if (typeof value === 'string') {
      return {
        termType: 'NamedNode',
        value: value,
      };
    }

    // JSON 序列化作为后备
    return {
      termType: 'Literal',
      value: JSON.stringify(value),
      datatype: { termType: 'NamedNode', value: `${XSD}json` },
    };
  }

  parseValue(term: RdfTerm, _column: PodColumnBase): unknown {
    // 如果是 JSON datatype，尝试解析
    if (term.datatype?.value?.includes('#json')) {
      try {
        return JSON.parse(term.value);
      } catch {
        return term.value;
      }
    }

    // 如果是 NamedNode，返回 URI
    if (term.termType === 'NamedNode') {
      return term.value;
    }

    return term.value;
  }

  buildTriples(
    subject: string,
    predicate: string,
    value: unknown,
    column: PodColumnBase,
    table: PodTable,
    context: BuildContext
  ): BuildResult {
    const triples: Triple[] = [];
    const childTriples: Triple[] = [];

    // 支持数组形式的内联对象
    const values = Array.isArray(value) ? value : [value];

    values.forEach((inlineValue, index) => {
      if (!inlineValue || typeof inlineValue !== 'object') return;

      const inlineObj = inlineValue as Record<string, unknown>;

      // 生成子对象 URI (通过 context)
      const childIri = context.resolveInlineChildUri(subject, column.name, inlineObj, index);

      // 父→子引用三元组
      triples.push({
        subject: { termType: 'NamedNode', value: subject },
        predicate: { termType: 'NamedNode', value: predicate },
        object: { termType: 'NamedNode', value: childIri },
      });

      // 子对象属性三元组
      const childPropertyTriples = this.buildChildTriples(childIri, inlineObj, table, context);
      childTriples.push(...childPropertyTriples);
    });

    return { triples, childTriples };
  }

  /**
   * 构建子对象的属性三元组
   */
  private buildChildTriples(
    childIri: string,
    inlineValue: Record<string, unknown>,
    table: PodTable,
    context: BuildContext
  ): Triple[] {
    const triples: Triple[] = [];
    const namespaceUri = context.getNamespaceUri(table);

    Object.entries(inlineValue).forEach(([key, raw]) => {
      // 跳过 id 字段
      if (key === 'id' || key === '@id') return;
      if (raw === undefined || raw === null) return;

      // 确定谓词 URI
      const predicateUri = this.resolvePredicateUri(key, namespaceUri);

      // 处理值 (支持数组)
      const values = Array.isArray(raw) ? raw : [raw];
      values.forEach((entry) => {
        const objectTerm = this.formatChildValue(entry);
        triples.push({
          subject: { termType: 'NamedNode', value: childIri },
          predicate: { termType: 'NamedNode', value: predicateUri },
          object: objectTerm,
        });
      });
    });

    return triples;
  }

  /**
   * 解析谓词 URI
   */
  private resolvePredicateUri(key: string, namespaceUri?: string): string {
    // 如果 key 已经是完整 URI
    if (key.startsWith('http://') || key.startsWith('https://')) {
      return key;
    }

    // 使用命名空间
    if (namespaceUri) {
      return `${namespaceUri}${key}`;
    }

    // 默认命名空间
    return `http://example.org/${key}`;
  }

  /**
   * 格式化子对象属性值
   */
  private formatChildValue(value: unknown): RdfTerm {
    if (value === null || value === undefined) {
      return {
        termType: 'Literal',
        value: '',
      };
    }

    // URI 检测
    if (typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'))) {
      return {
        termType: 'NamedNode',
        value: value,
      };
    }

    // 数字
    if (typeof value === 'number') {
      const datatype = Number.isInteger(value)
        ? `${XSD}integer`
        : `${XSD}decimal`;
      return {
        termType: 'Literal',
        value: String(value),
        datatype: { termType: 'NamedNode', value: datatype },
      };
    }

    // 布尔
    if (typeof value === 'boolean') {
      return {
        termType: 'Literal',
        value: String(value),
        datatype: { termType: 'NamedNode', value: `${XSD}boolean` },
      };
    }

    // 日期
    if (value instanceof Date) {
      return {
        termType: 'Literal',
        value: value.toISOString(),
        datatype: { termType: 'NamedNode', value: `${XSD}dateTime` },
      };
    }

    // 对象 - JSON 序列化
    if (typeof value === 'object') {
      return {
        termType: 'Literal',
        value: JSON.stringify(value),
        datatype: { termType: 'NamedNode', value: `${XSD}json` },
      };
    }

    // 默认字符串
    return {
      termType: 'Literal',
      value: String(value),
      datatype: { termType: 'NamedNode', value: `${XSD}string` },
    };
  }
}
