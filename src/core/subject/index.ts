/**
 * Subject Module
 *
 * 主体 URI 解析模块
 * 
 * @deprecated 此模块已被 ../uri 模块取代，保留此导出仅为向后兼容
 */

// 从新模块重新导出类型
export type {
  ResourceMode,
  ParsedSubject,
  TimeContext,
} from '../uri/types';

// 保留旧的 SubjectResolver 类型定义以保持兼容
export type { SubjectResolver } from './types';

// 创建向后兼容的包装对象
import { UriResolverImpl } from '../uri/resolver';
import type { PodTable } from '../pod-table';

/**
 * 向后兼容的 SubjectResolver 包装器
 * 
 * 将旧的 `resolve`/`parse` 方法映射到新的 `resolveSubject`/`parseSubject`
 */
class SubjectResolverCompat {
  private resolver: UriResolverImpl;

  constructor(podUrl?: string) {
    this.resolver = new UriResolverImpl(podUrl ?? '');
    if (podUrl) {
      this.resolver.setPodUrl(podUrl);
    }
  }

  setPodUrl(podUrl: string): void {
    this.resolver.setPodUrl(podUrl);
  }

  resolve(table: PodTable, record: Record<string, unknown>, index?: number): string {
    return this.resolver.resolveSubject(table, record, index);
  }

  parse(uri: string, table: PodTable) {
    return this.resolver.parseSubject(uri, table);
  }

  getResourceUrl(subjectUri: string): string {
    return this.resolver.getResourceUrl(subjectUri);
  }

  getResourceMode(table: PodTable) {
    return this.resolver.getResourceMode(table);
  }

  getDefaultPattern(table: PodTable): string {
    return this.resolver.getDefaultPattern(table);
  }

  resolveInlineChild(
    parentSubject: string,
    columnName: string,
    value: Record<string, unknown>,
    index: number
  ): string {
    return this.resolver.resolveInlineChild(parentSubject, columnName, value, index);
  }

  isSingleton(table: PodTable): boolean {
    return this.resolver.isSingleton(table);
  }
}

// 为了向后兼容，导出 SubjectResolverImpl 类名
export { SubjectResolverCompat as SubjectResolverImpl };
