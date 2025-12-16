/**
 * Triple Builder Types
 *
 * 三元组构建相关的类型定义
 */

import type { PodColumnBase, PodTable } from '../pod-table';

/**
 * RDF 项类型
 */
export type RdfTermType = 'NamedNode' | 'Literal' | 'BlankNode' | 'Variable';

/**
 * RDF 项
 */
export interface RdfTerm {
  termType: RdfTermType;
  value: string;
  datatype?: RdfTerm;
  language?: string;
}

/**
 * RDF 三元组
 */
export interface Triple {
  subject: RdfTerm;
  predicate: RdfTerm;
  object: RdfTerm;
}

/**
 * 三元组构建结果
 */
export interface BuildResult {
  /** 主三元组 */
  triples: Triple[];

  /** 子对象三元组 (内联对象) */
  childTriples?: Triple[];
}

/**
 * N3 Patch 构建选项
 */
export interface N3PatchOptions {
  /** 是否包含 WHERE 子句 */
  includeWhere?: boolean;
}

/**
 * 列处理器接口
 *
 * 每种特殊列类型有自己的处理器
 */
export interface ColumnHandler {
  /**
   * 处理器名称 (用于调试)
   */
  readonly name: string;

  /**
   * 是否能处理此列
   * @param column 列定义
   */
  canHandle(column: PodColumnBase): boolean;

  /**
   * 格式化值为 RDF 项
   * @param value 原始值
   * @param column 列定义
   * @param context 构建上下文（可选，用于 URI 补全等）
   */
  formatValue(value: unknown, column: PodColumnBase, context?: BuildContext): RdfTerm | RdfTerm[];

  /**
   * 解析 RDF 值为 JS 值
   * @param term RDF 项
   * @param column 列定义
   */
  parseValue(term: RdfTerm, column: PodColumnBase): unknown;

  /**
   * 构建三元组
   * @param subject 主体 URI
   * @param predicate 谓词 URI
   * @param value 值
   * @param column 列定义
   * @param table 表定义
   * @param context 构建上下文
   */
  buildTriples(
    subject: string,
    predicate: string,
    value: unknown,
    column: PodColumnBase,
    table: PodTable,
    context: BuildContext
  ): BuildResult;
}

/**
 * 构建上下文
 */
export interface BuildContext {
  /** 生成内联子对象 URI 的函数 */
  resolveInlineChildUri: (
    parentSubject: string,
    columnName: string,
    value: Record<string, unknown>,
    index: number
  ) => string;

  /** 获取命名空间 URI */
  getNamespaceUri: (table: PodTable) => string | undefined;

  /** 基础 URI，用于解析相对 URI */
  baseUri?: string;

  /** 表注册表：rdfClass -> table[]，用于引用字段自动补全 URI */
  tableRegistry?: Map<string, PodTable[]>;

  /** 表名注册表：tableName -> table，用于明确指定表名时查找 */
  tableNameRegistry?: Map<string, PodTable>;
}

/**
 * 三元组构建器接口
 */
export interface TripleBuilder {
  /**
   * 构建插入三元组
   * @param subject 主体 URI
   * @param column 列定义
   * @param value 值
   * @param table PodTable 定义
   */
  buildInsert(
    subject: string,
    column: PodColumnBase,
    value: unknown,
    table: PodTable
  ): BuildResult;

  /**
   * 构建删除三元组 (使用变量匹配)
   * @param subject 主体 URI
   * @param column 列定义
   * @param table PodTable 定义
   * @param varSuffix 变量后缀 (避免冲突)
   */
  buildDelete(
    subject: string,
    column: PodColumnBase,
    table: PodTable,
    varSuffix?: string
  ): BuildResult;

  /**
   * 构建类型三元组
   * @param subject 主体 URI
   * @param rdfClass RDF 类型
   */
  buildTypeTriple(subject: string, rdfClass: string): Triple;

  /**
   * 转换三元组为 N3 字符串格式
   * @param triples 三元组数组
   */
  toN3Strings(triples: Triple[]): string[];

  /**
   * 构建 N3 Patch 请求体
   * @param deleteTriples 删除三元组字符串
   * @param insertTriples 插入三元组字符串
   * @param wherePatterns WHERE 条件字符串
   */
  buildN3Patch(
    deleteTriples: string[],
    insertTriples: string[],
    wherePatterns?: string[]
  ): string;

  /**
   * 获取列的谓词 URI
   * @param column 列定义
   * @param table 表定义
   */
  getPredicateUri(column: PodColumnBase, table: PodTable): string;

  /**
   * 格式化值 (供外部使用)
   * @param value 原始值
   * @param column 列定义
   */
  formatValue(value: unknown, column?: PodColumnBase): string | string[];
}
