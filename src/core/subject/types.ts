/**
 * Subject Resolver Types
 *
 * 主体 URI 解析相关的类型定义
 */

import type { PodTable } from '../schema';

/**
 * 资源模式
 *
 * - document: 每条记录一个独立文件，可单独 GET
 * - fragment: 所有记录共享一个文件，用 URI fragment 区分
 */
export type ResourceMode = 'document' | 'fragment';

/**
 * 主体 URI 解析结果
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
 *
 * 变量命名遵循 Java/ISO 风格 (SimpleDateFormat):
 * - yyyy: 年份 (4位)
 * - MM: 月份 (2位，大写以区分分钟)
 * - dd: 日期 (2位)
 *
 * 示例: {yyyy}/{MM}/{dd} → 2026/01/20
 */
export interface TimeContext {
  /** 日期对象 */
  date: Date;

  /** 年份 (4位) */
  yyyy: string;

  /** 月份 (2位) */
  MM: string;

  /** 日期 (2位) */
  dd: string;

  /** Unix 时间戳 */
  timestamp: string;
}

/**
 * 主体 URI 解析器接口
 */
export interface SubjectResolver {
  /**
   * 生成主体 URI
   * @param table PodTable 定义
   * @param record 数据记录
   * @param index 批量插入时的索引 (可选)
   */
  resolve(table: PodTable, record: Record<string, unknown>, index?: number): string;

  /**
   * 解析主体 URI
   * @param uri 主体 URI
   * @param table PodTable 定义
   */
  parse(uri: string, table: PodTable): ParsedSubject | null;

  /**
   * 获取资源 URL (用于 HTTP 请求)
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
}
