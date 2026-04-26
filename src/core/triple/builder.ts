/**
 * Triple Builder Implementation
 *
 * 统一的三元组构建器，处理所有列类型
 */

import type { PodColumnBase, PodTable, NamespaceConfig } from '../schema';
import type { UriResolver } from '../uri';
import { UriResolverImpl } from '../uri';
import type {
  TripleBuilder,
  Triple,
  BuildResult,
  BuildContext,
  RdfTerm,
} from './types';
import { handlerRegistry } from './handlers';

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const XSD = 'http://www.w3.org/2001/XMLSchema#';

/**
 * 三元组构建器实现
 */
export class TripleBuilderImpl implements TripleBuilder {
  /** 表注册表：rdfClass -> tables[]（同一 class 可能对应多个表） */
  private tableRegistry?: Map<string, PodTable[]>;

  /** 表名注册表：tableName -> table（用于明确指定表名时查找） */
  private tableNameRegistry?: Map<string, PodTable>;

  /** 基础 URI */
  private baseUri?: string;

  /** URI 解析器 */
  private uriResolver: UriResolver;

  constructor(uriResolver?: UriResolver) {
    this.uriResolver = uriResolver ?? new UriResolverImpl();
  }

  /**
   * 设置表注册表（用于 URI 引用自动补全）
   * @param classRegistry rdfClass -> tables[] 的映射
   * @param nameRegistry tableName -> table 的映射
   */
  setTableRegistry(
    classRegistry: Map<string, PodTable[]>,
    nameRegistry: Map<string, PodTable>
  ): void {
    this.tableRegistry = classRegistry;
    this.tableNameRegistry = nameRegistry;
  }

  /**
   * 设置基础 URI
   */
  setBaseUri(uri: string): void {
    this.baseUri = uri;
  }

  /**
   * 构建上下文
   */
  private createContext(record?: Record<string, unknown>, currentTable?: PodTable): BuildContext {
    return {
      resolveInlineChildUri: this.resolveInlineChildUri.bind(this),
      getNamespaceUri: this.getNamespaceUri.bind(this),
      uriResolver: this.uriResolver,
      baseUri: this.baseUri,
      tableRegistry: this.tableRegistry,
      tableNameRegistry: this.tableNameRegistry,
      record,
      currentTable,
    };
  }

  /**
   * 构建插入三元组
   */
  buildInsert(
    subject: string,
    column: PodColumnBase,
    value: unknown,
    table: PodTable
  ): BuildResult {
    const handler = handlerRegistry.getHandler(column);
    const predicate = this.getPredicateUri(column, table);
    const context = this.createContext((table as any)?.__currentRecord, table);

    return handler.buildTriples(subject, predicate, value, column, table, context);
  }

  /**
   * 构建删除三元组 (使用变量匹配)
   */
  buildDelete(
    subject: string,
    column: PodColumnBase,
    table: PodTable,
    varSuffix: string = ''
  ): BuildResult {
    const predicate = this.getPredicateUri(column, table);
    const varName = `old_${column.name}${varSuffix}`;

    // 检查是否是内联对象
    if (column.dataType === 'object' || column.dataType === 'json') {
      return this.buildInlineDeleteTriples(subject, predicate, column.name, varSuffix);
    }

    // 检查是否是逆向谓词
    if (column.options?.inverse) {
      return {
        triples: [
          {
            subject: { termType: 'Variable', value: varName },
            predicate: { termType: 'NamedNode', value: predicate },
            object: { termType: 'NamedNode', value: subject },
          },
        ],
      };
    }

    // 普通列
    return {
      triples: [
        {
          subject: { termType: 'NamedNode', value: subject },
          predicate: { termType: 'NamedNode', value: predicate },
          object: { termType: 'Variable', value: varName },
        },
      ],
    };
  }

  /**
   * 构建内联对象的删除三元组
   */
  private buildInlineDeleteTriples(
    subject: string,
    predicate: string,
    columnName: string,
    varSuffix: string
  ): BuildResult {
    const childVar = `old_${columnName}${varSuffix}`;
    const propVar = `op_${columnName}${varSuffix}`;
    const objVar = `oo_${columnName}${varSuffix}`;

    return {
      triples: [
        // 父→子引用
        {
          subject: { termType: 'NamedNode', value: subject },
          predicate: { termType: 'NamedNode', value: predicate },
          object: { termType: 'Variable', value: childVar },
        },
      ],
      childTriples: [
        // 子对象所有属性
        {
          subject: { termType: 'Variable', value: childVar },
          predicate: { termType: 'Variable', value: propVar },
          object: { termType: 'Variable', value: objVar },
        },
      ],
    };
  }

  /**
   * 构建类型三元组
   */
  buildTypeTriple(subject: string, rdfClass: string): Triple {
    return {
      subject: { termType: 'NamedNode', value: subject },
      predicate: { termType: 'NamedNode', value: RDF_TYPE },
      object: { termType: 'NamedNode', value: rdfClass },
    };
  }

  /**
   * 转换三元组为 N3 字符串格式
   */
  toN3Strings(triples: Triple[]): string[] {
    return triples.map((triple) => {
      const subject = this.termToN3(triple.subject);
      const predicate = this.termToN3(triple.predicate);
      const object = this.termToN3(triple.object);
      return `${subject} ${predicate} ${object} .`;
    });
  }

  /**
   * RDF Term 转 N3 字符串
   */
  private termToN3(term: RdfTerm): string {
    switch (term.termType) {
      case 'NamedNode':
        return `<${term.value}>`;

      case 'Variable':
        return `?${term.value}`;

      case 'BlankNode':
        return `_:${term.value}`;

      case 'Literal': {
        // 如果值包含换行符，使用三引号字符串避免转义问题
        const hasNewlines = term.value.includes('\n') || term.value.includes('\r');

        if (hasNewlines) {
          // 使用三引号字符串
          // 需要处理的特殊情况：
          // 1. 内容包含 """ 序列需要转义
          // 2. 内容以 " 或 "" 结尾需要转义最后的引号，避免和闭合三引号形成 """" 或 """""
          let escaped = term.value;

          // 转义三引号序列
          escaped = escaped.replace(/"""/g, '"\\"\\""');

          // 如果内容以引号结尾，转义最后一个引号
          // 这避免了 """content"""" 这样的无效序列
          if (escaped.endsWith('"')) {
            // 检查结尾有多少个引号
            const match = escaped.match(/"*$/);
            const trailingQuotes = match ? match[0].length : 0;
            if (trailingQuotes > 0) {
              // 转义所有结尾引号
              escaped = escaped.slice(0, -trailingQuotes) + '\\"'.repeat(trailingQuotes);
            }
          }

          if (term.language) {
            return `"""${escaped}"""@${term.language}`;
          }

          if (term.datatype) {
            const datatypeUri = term.datatype.value;
            if (datatypeUri === `${XSD}string`) {
              return `"""${escaped}"""`;
            }
            if (datatypeUri === `${XSD}integer`) {
              return term.value;
            }
            return `"""${escaped}"""^^<${datatypeUri}>`;
          }

          return `"""${escaped}"""`;
        }

        // 普通字符串，转义反斜杠和引号
        const escaped = term.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

        if (term.language) {
          return `"${escaped}"@${term.language}`;
        }

        if (term.datatype) {
          const datatypeUri = term.datatype.value;

          // 简化常见类型
          if (datatypeUri === `${XSD}string`) {
            return `"${escaped}"`;
          }
          if (datatypeUri === `${XSD}integer`) {
            return term.value; // 整数不需要引号
          }

          return `"${escaped}"^^<${datatypeUri}>`;
        }

        return `"${escaped}"`;
      }

      default:
        return `"${term.value}"`;
    }
  }

  /**
   * 构建 N3 Patch 请求体
   */
  buildN3Patch(
    deleteTriples: string[],
    insertTriples: string[],
    wherePatterns: string[] = []
  ): string {
    const normalize = (t: string): string =>
      t.trim().endsWith('.') ? t.trim() : `${t.trim()} .`;

    const normalizedDeletes = deleteTriples.map(normalize);
    const normalizedInserts = insertTriples.map(normalize);
    const normalizedWhere = wherePatterns.map(normalize);

    const hasDelete = normalizedDeletes.length > 0;
    const hasWhere = normalizedWhere.length > 0;

    const deleteBlock = hasDelete
      ? `  solid:delete {\n${normalizedDeletes.map((t) => `    ${t}`).join('\n')}\n  };\n`
      : '';

    const insertBlock =
      normalizedInserts.length > 0
        ? `  solid:insert {\n${normalizedInserts.map((t) => `    ${t}`).join('\n')}\n  };\n`
        : '';

    const whereBlock = hasWhere
      ? `  solid:where {\n${normalizedWhere.map((w) => `    ${w}`).join('\n')}\n  }.\n`
      : '';

    const header = '@prefix solid: <http://www.w3.org/ns/solid/terms#>.\n_:patch a solid:InsertDeletePatch;\n';

    // 纯插入模式
    if (!hasDelete && !hasWhere) {
      const body = insertBlock.endsWith(';\n')
        ? insertBlock.replace(/;\n$/, '.\n')
        : insertBlock || '  solid:insert { }.\n';
      return `${header}${body}`;
    }

    return `${header}${deleteBlock}${insertBlock}${whereBlock}`.replace(/;\n$/, '.\n');
  }

  /**
   * 获取列的谓词 URI
   */
  getPredicateUri(column: PodColumnBase, table: PodTable): string {
    // 特殊处理 @id
    if (column.options?.predicate === '@id') {
      return '@id';
    }

    // 优先使用显式定义的 predicate
    if (column.options?.predicate) {
      return column.options.predicate;
    }

    // 使用表的命名空间
    const namespace = table.config?.namespace;
    if (namespace) {
      const nsUri = typeof namespace === 'string' ? namespace : (namespace as NamespaceConfig).uri;
      return `${nsUri}${column.name}`;
    }

    // 回退到默认命名空间
    return `http://example.org/${column.name}`;
  }

  /**
   * 格式化值 (供外部使用)
   */
  formatValue(value: unknown, column?: PodColumnBase): string | string[] {
    if (value === null || value === undefined) {
      return '""';
    }

    // 如果没有列定义，进行类型推断
    if (!column) {
      return this.formatValueByInference(value);
    }

    const handler = handlerRegistry.getHandler(column);
    const terms = handler.formatValue(value, column);

    if (Array.isArray(terms)) {
      return terms.map((term) => this.termToN3(term));
    }

    return this.termToN3(terms);
  }

  /**
   * 根据值类型推断格式化
   */
  private formatValueByInference(value: unknown): string {
    if (typeof value === 'string') {
      // URI 检测
      if (value.startsWith('http://') || value.startsWith('https://')) {
        return `<${value}>`;
      }
      const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
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

    if (typeof value === 'object') {
      const json = JSON.stringify(value).replace(/"/g, '\\"');
      return `"${json}"^^<${XSD}json>`;
    }

    return `"${String(value)}"`;
  }

  /**
   * 生成内联子对象 URI
   */
  private resolveInlineChildUri(
    parentSubject: string,
    columnName: string,
    value: Record<string, unknown>,
    index: number
  ): string {
    // 优先使用显式 ID
    const explicit =
      typeof value['@id'] === 'string'
        ? value['@id']
        : typeof value.id === 'string'
          ? value.id
          : undefined;

    if (explicit) {
      return explicit;
    }

    // 生成 fragment URI
    const hashIndex = parentSubject.indexOf('#');
    const base = hashIndex >= 0 ? parentSubject.slice(0, hashIndex) : parentSubject;
    const withFragment = base.endsWith('#') ? base : `${base}#`;

    return `${withFragment}${columnName}-${index + 1}`;
  }

  /**
   * 获取表的命名空间 URI
   */
  private getNamespaceUri(table: PodTable): string | undefined {
    const namespace = table.config?.namespace;
    if (!namespace) return undefined;

    if (typeof namespace === 'string') {
      return namespace;
    }

    return (namespace as NamespaceConfig).uri;
  }
}

// 默认实例导出
export const tripleBuilder = new TripleBuilderImpl(new UriResolverImpl());
