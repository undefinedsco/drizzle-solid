/**
 * Fragment Mode ResourceResolver
 *
 * In fragment mode, all records are stored in a single file (e.g., tags.ttl)
 * Each record has a subject URI with a fragment identifier (e.g., tags.ttl#uuid)
 * 
 * 设计原则：
 * - base = resourcePath (如 http://pod/.data/tags.ttl)
 * - 默认模板: #{id}
 * - 写入: id = "tag-1" → relativePath = "#tag-1" → uri = base + relativePath
 * - 读取: uri - base = "#tag-1" → 反向解析模板 → id = "tag-1"
 */

import type { PodTable } from '../schema';
import type { QueryCondition } from '../query-conditions';
import { BaseResourceResolver } from './base-resolver';

/**
 * 默认的 fragment 模板
 */
const DEFAULT_TEMPLATE = '#{id}';

export class FragmentResourceResolver extends BaseResourceResolver {
  readonly mode = 'fragment' as const;

  /**
   * 获取默认模板
   */
  protected getDefaultTemplate(): string {
    return DEFAULT_TEMPLATE;
  }

  getContainerUrl(table: PodTable): string {
    const resourceUrl = this.getResourceUrl(table);
    const lastSlash = resourceUrl.lastIndexOf('/');
    return resourceUrl.substring(0, lastSlash + 1);
  }

  getResourceUrl(table: PodTable): string {
    return this.resolveBaseUrl(table);
  }

  /**
   * 获取表的 base URL
   * 
   * Fragment 模式下，base 是资源文件路径（不含 fragment）
   */
  protected getBaseUrlForTable(table: PodTable): string {
    return this.getResourceUrl(table);
  }

  getResourceUrlForSubject(subjectUri: string): string {
    // Remove fragment to get resource URL
    const hashIndex = subjectUri.indexOf('#');
    if (hashIndex === -1) {
      return subjectUri;
    }
    return subjectUri.substring(0, hashIndex);
  }

  async resolveSelectSources(
    table: PodTable,
    containerUrl: string,
    condition?: QueryCondition,
    _listContainer?: (url?: string) => Promise<string[]>
  ): Promise<string[]> {
    // Fragment mode: always query the single resource file
    return [this.getResourceUrl(table)];
  }

  async resolveSubjectsForMutation(
    table: PodTable,
    condition: QueryCondition,
    findSubjects: (resourceUrl: string) => Promise<string[]>,
    _listContainer: () => Promise<string[]>
  ): Promise<string[]> {
    // With id condition: resolve subjects directly from ids
    const idValues = this.extractIdValues(condition);
    if (idValues.length > 0) {
      return idValues.map(id => this.resolveSubject(table, { id }));
    }

    // Fragment mode: query the single resource file for matching subjects
    const resourceUrl = this.getResourceUrl(table);
    return findSubjects(resourceUrl);
  }
}
