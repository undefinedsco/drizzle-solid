/**
 * URI Resolver Types
 *
 * 统一的 URI 解析类型定义
 */

import type { PodTable, PodColumnBase } from '../pod-table';

/**
 * 资源模式
 *
 * - document: 每条记录一个独立文件，可单独 GET
 * - fragment: 所有记录共享一个文件，用 URI fragment 区分
 */
export type ResourceMode = 'document' | 'fragment';

/**
 * 解析后的主体 URI
 */
export interface ParsedSubject {
  /** 完整 URI */
  uri: string;

  /** 资源 URL (不含 fragment) */
  resourceUrl: string;

  /** Fragment 部分 (如果有，不含 #) */
  fragment?: string;

  /** 提取的 ID */
  id: string;

  /** 资源模式 */
  mode: ResourceMode;
}

/**
 * 时间变量上下文
 */
export interface TimeContext {
  /** 日期对象 */
  date: Date;

  /** 年份 (4位) */
  yyyy: string;

  /** 月份 (2位) */
  mm: string;

  /** 日期 (2位) */
  dd: string;

  /** Unix 时间戳 */
  timestamp: string;
}

/**
 * URI 解析上下文
 * 
 * 用于 reference 列的 URI 解析，作为参数传入而非内部状态
 */
export interface UriContext {
  /** 基础 URI (Pod URL) */
  baseUri?: string;

  /** rdfClass -> tables[] 的映射 */
  tableRegistry?: Map<string, PodTable[]>;

  /** tableName -> table 的映射 */
  tableNameRegistry?: Map<string, PodTable>;
}

/**
 * URI 解析器接口
 * 
 * 无状态设计：除了 podUrl，所有上下文信息都通过参数传入
 */
export interface UriResolver {
  // ================= 配置方法 =================

  /**
   * 设置 Pod URL（用于相对路径解析）
   */
  setPodUrl(podUrl: string): void;

  // ================= Subject URI 解析 =================

  /**
   * 生成主体 URI
   * @param table PodTable 定义
   * @param record 数据记录
   * @param index 批量插入时的索引 (可选)
   */
  resolveSubject(table: PodTable, record: Record<string, unknown>, index?: number): string;

  /**
   * 解析主体 URI
   * @param uri 主体 URI
   * @param table PodTable 定义
   */
  parseSubject(uri: string, table: PodTable): ParsedSubject | null;

  /**
   * 获取资源 URL (用于 HTTP 请求，去掉 fragment)
   * @param subjectUri 主体 URI
   */
  getResourceUrl(subjectUri: string): string;

  /**
   * 判断资源模式
   * @param table PodTable 定义
   */
  getResourceMode(table: PodTable): ResourceMode;

  /**
   * 获取默认的 subjectPattern
   * @param table PodTable 定义
   */
  getDefaultPattern(table: PodTable): string;

  /**
   * 生成内联对象的 URI (始终为 fragment)
   * @param parentSubject 父实体 URI
   * @param columnName 列名
   * @param value 内联对象值
   * @param index 数组索引
   */
  resolveInlineChild(
    parentSubject: string,
    columnName: string,
    value: Record<string, unknown>,
    index: number
  ): string;

  /**
   * 检查是否为单例模式 (如 #me, #this)
   * @param table PodTable 定义
   */
  isSingleton(table: PodTable): boolean;

  // ================= Object/Reference URI 解析 =================

  /**
   * 解析 reference 列的值为完整 URI
   * 
   * @param value 原始值（可能是 UUID、相对路径或完整 URI）
   * @param column 列定义（包含 reference 配置）
   * @param context 解析上下文（包含 tableRegistry 等），作为参数传入
   * @returns 完整 URI
   * @throws 如果无法解析且不能 fallback
   */
  resolveReference(value: string, column: PodColumnBase, context?: UriContext): string;

  /**
   * 检查值是否为绝对 URI
   */
  isAbsoluteUri(value: string): boolean;

  /**
   * 检查列是否为 reference 类型
   */
  isReferenceColumn(column: PodColumnBase | any): boolean;

  /**
   * 根据 reference 配置查找目标表
   * 
   * 解析优先级：
   * 1. referenceTable（直接引用表对象）
   * 2. referenceTableName（表名 -> tableNameRegistry）
   * 3. referenceTarget（class URI -> tableRegistry，需无歧义）
   * 
   * @param column 列定义
   * @param context 解析上下文
   */
  findTargetTable(column: PodColumnBase | any, context?: UriContext): PodTable | undefined;
}

// 为了向后兼容，保留原来的 SubjectResolver 类型别名
export type SubjectResolver = Pick<UriResolver,
  | 'resolveSubject'
  | 'parseSubject'
  | 'getResourceUrl'
  | 'getResourceMode'
  | 'getDefaultPattern'
  | 'resolveInlineChild'
  | 'isSingleton'
> & {
  // 兼容旧接口名称
  resolve: UriResolver['resolveSubject'];
  parse: UriResolver['parseSubject'];
};
