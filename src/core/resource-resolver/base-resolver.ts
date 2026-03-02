/**
 * Base ResourceResolver with shared logic
 * 
 * 核心设计原则：
 * - 用户使用简单 id（如 "alice", "tag-123"）
 * - subjectTemplate 定义 id 如何映射到 URI（如 "{id}.ttl#it", "#{id}"）
 * - 写入时：id + template → relativePath → baseUrl + relativePath
 * - 读取时：subjectUri - baseUrl → relativePath → template 反向解析 → id
 */

import type { PodTable } from '../schema';
import type { QueryCondition } from '../query-conditions';
import type { ResourceResolver } from './types';

export abstract class BaseResourceResolver implements ResourceResolver {
  abstract readonly mode: 'fragment' | 'document';

  protected podBaseUrl: string;

  constructor(podBaseUrl: string) {
    this.podBaseUrl = podBaseUrl;
  }

  abstract getContainerUrl(table: PodTable): string;
  abstract getResourceUrl(table: PodTable): string;
  abstract getResourceUrlForSubject(subjectUri: string): string;

  abstract resolveSelectSources(
    table: PodTable,
    containerUrl: string,
    condition?: QueryCondition,
    listContainer?: (url?: string) => Promise<string[]>
  ): Promise<string[]>;

  abstract resolveSubjectsForMutation(
    table: PodTable,
    condition: QueryCondition,
    findSubjects: (resourceUrl: string) => Promise<string[]>,
    listContainer: () => Promise<string[]>
  ): Promise<string[]>;

  // ================= 统一的 id 解析逻辑 =================

  /**
   * 从 subject URI 解析出 id
   * 
   * 两步解析：
   * 1. relativePath = subjectUri - baseUrl
   * 2. 根据 subjectTemplate 反向解析 {id}
   * 
   * 例如：
   * - uri = "http://pod/items/alice.ttl#it", template = "{id}.ttl#it" → id = "alice"
   * - uri = "http://pod/tags.ttl#tag-1", template = "#{id}" → id = "tag-1"
   */
  parseId(table: PodTable, subjectUri: string): string {
    const baseUrl = this.getBaseUrlForTable(table);
    
    // Step 1: 计算相对路径
    let relativePath: string;
    if (subjectUri.startsWith(baseUrl)) {
      relativePath = subjectUri.substring(baseUrl.length);
    } else {
      relativePath = this.extractIdFallback(subjectUri);
    }
    
    // Step 2: 根据模板反向解析 {id}
    const template = this.getEffectiveTemplate(table);
    if (template) {
      const extractedId = this.extractIdFromTemplate(relativePath, template);
      if (extractedId !== null) {
        return extractedId;
      }
    }
    
    // 如果没有模板或解析失败，返回相对路径
    return relativePath;
  }

  /**
   * 从 id 构建完整的 subject URI
   * 
   * 两步构建：
   * 1. 根据 subjectTemplate 应用 id → relativePath
   * 2. subjectUri = baseUrl + relativePath
   */
  resolveSubject(table: PodTable, record: Record<string, any>, index?: number): string {
    const baseUrl = this.getBaseUrlForTable(table);

    // 优先使用显式提供的 id
    let id = record.id ?? record['@id'] ?? record.uri;

    // 如果 id 已经是绝对 URI，直接返回
    if (id && this.isAbsoluteUri(id)) {
      return id;
    }

    // 如果没有 id，生成 UUID
    if (id === undefined || id === null) {
      id = this.generateUuid();
    }

    // 应用模板生成相对路径
    const template = this.getEffectiveTemplate(table);
    let relativePath = this.applyTemplate(id, template);

    // Handle multi-variable templates: replace other {var} placeholders from record
    const variables = Array.from(template.matchAll(/\{([^}]+)\}/g)).map(m => m[1]);
    for (const varName of variables) {
      if (varName !== 'id' && varName !== 'index' && varName in record) {
        const value = String(record[varName]);
        relativePath = relativePath.replace(new RegExp(`\\{${varName}\\}`, 'g'), value);
      }
    }

    return baseUrl + relativePath;
  }

  /**
   * 获取表的 base URL，用于 id 解析
   */
  protected getBaseUrlForTable(table: PodTable): string {
    return this.resolveBaseUrl(table);
  }

  /**
   * 获取有效的 subjectTemplate
   */
  protected getEffectiveTemplate(table: PodTable): string {
    // 如果有自定义模板，使用它
    if (table.config?.subjectTemplate) {
      return table.config.subjectTemplate;
    }
    // 否则使用默认模板
    return this.getDefaultTemplate();
  }

  /**
   * 获取默认模板
   * 子类应该重写此方法
   */
  protected abstract getDefaultTemplate(): string;

  /**
   * 生成 UUID
   */
  protected generateUuid(): string {
    // 简单的 UUID v4 生成（可以被子类重写）
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * 应用模板生成相对路径
   * 
   * @param id 简单 id (如 "alice")
   * @param template 模板 (如 "{id}.ttl#it")
   * @returns 相对路径 (如 "alice.ttl#it")
   */
  protected applyTemplate(id: string, template: string): string {
    return template.replace(/\{id\}/g, id);
  }

  /**
   * 从相对路径反向解析出 id
   * 
   * @param relativePath 相对路径 (如 "alice.ttl#it")
   * @param template 模板 (如 "{id}.ttl#it")
   * @returns 提取的 id (如 "alice")，解析失败返回 null
   */
  protected extractIdFromTemplate(relativePath: string, template: string): string | null {
    // 将模板转为正则表达式
    // 1. 转义特殊字符
    // 2. 将 {id} 替换为捕获组 (.+?)
    // 3. 将其他 {xxx} 占位符替换为非捕获组 (?:.+?)
    
    let regexStr = template
      // 转义正则特殊字符（除了 { 和 }）
      .replace(/[.+?^$[\]\\()]/g, '\\$&')
      // 将 {id} 替换为命名捕获组
      .replace(/\{id\}/g, '(?<id>.+?)')
      // 将其他 {xxx} 占位符替换为非捕获组
      .replace(/\{[^}]+\}/g, '(?:.+?)');
    
    // 添加锚点
    regexStr = `^${regexStr}$`;

    try {
      const regex = new RegExp(regexStr);
      const match = relativePath.match(regex);
      
      if (match && match.groups?.id) {
        return match.groups.id;
      }
      
      // 兼容不支持命名捕获组的环境
      if (match && match[1]) {
        return match[1];
      }
    } catch (e) {
      // 正则解析失败，忽略
    }

    return null;
  }

  /**
   * Extract id values from a query condition
   * Shared logic for both fragment and document mode
   */
  extractIdValues(condition: QueryCondition | Record<string, any> | undefined): string[] {
    if (!condition) return [];

    const ids: string[] = [];

    // Handle simple object: { id: 'value' } or { id: ['v1', 'v2'] }
    if (typeof condition === 'object' && !('type' in condition) && 'id' in condition) {
      const idValue = (condition as any).id;
      if (Array.isArray(idValue)) {
        ids.push(...idValue.map(String));
      } else if (idValue != null) {
        ids.push(String(idValue));
      }
      return ids;
    }

    this.collectIdValues(condition, ids);
    return ids;
  }

  /**
   * Extract values for specific columns from a query condition
   * Used for subjectTemplate variable resolution
   */
  extractTemplateValues(condition: QueryCondition | Record<string, any> | undefined, columns: string[]): Record<string, string> {
    if (!condition || columns.length === 0) return {};

    const values: Record<string, string> = {};

    // Handle simple object: { col: 'value' }
    if (typeof condition === 'object' && !('type' in condition)) {
      for (const col of columns) {
        if (col in condition) {
          const val = (condition as any)[col];
          if (val != null && !Array.isArray(val)) {
             values[col] = String(val);
          }
        }
      }
      return values;
    }

    // Handle QueryCondition structure
    for (const col of columns) {
      const found = this.collectColumnValue(condition, col);
      if (found !== undefined) {
        values[col] = found;
      }
    }

    return values;
  }

  protected collectColumnValue(condition: any, targetCol: string): string | undefined {
    if (!condition) return undefined;

    // BinaryExpression: { type: 'binary_expr', left: ..., operator: ..., right: ... }
    if (condition.type === 'binary_expr') {
      let colName: string | undefined;
      const left = condition.left;

      if (typeof left === 'string') {
        colName = left;
      } else if (left && typeof left === 'object') {
        colName = left.name;
      }

      if (colName === targetCol) {
        if (condition.operator === '=' && condition.right != null) {
          return String(condition.right);
        }
      }
    }

    // LogicalExpression: { type: 'logical_expr', operator: 'AND', expressions: [...] }
    // Note: We only support AND for deterministic path resolution. 
    // OR would require returning multiple paths which is more complex (TODO).
    if (condition.type === 'logical_expr' && condition.operator === 'AND' && Array.isArray(condition.expressions)) {
      for (const expr of condition.expressions) {
        const val = this.collectColumnValue(expr, targetCol);
        if (val !== undefined) return val;
      }
    }

    return undefined;
  }

  protected collectIdValues(condition: any, ids: string[]): void {
    if (!condition) return;

    // BinaryExpression: { type: 'binary_expr', left: ..., operator: ..., right: ... }
    if (condition.type === 'binary_expr') {
      let colName: string | undefined;
      const left = condition.left;

      if (typeof left === 'string') {
        colName = left;
      } else if (left && typeof left === 'object') {
        // PodColumnBase or similar object with name property
        colName = left.name;
      }

      if (colName === 'id') {
        if (condition.operator === '=' && condition.right != null) {
          ids.push(String(condition.right));
        } else if (condition.operator === 'IN' && Array.isArray(condition.right)) {
          ids.push(...condition.right.map(String));
        }
      }
    }

    // LogicalExpression: { type: 'logical_expr', operator: 'AND'|'OR', expressions: [...] }
    if (condition.type === 'logical_expr' && Array.isArray(condition.expressions)) {
      for (const expr of condition.expressions) {
        this.collectIdValues(expr, ids);
      }
    }
  }

  /**
   * Resolve base URL for a table's base configuration
   */
  protected resolveBaseUrl(table: PodTable): string {
    const base = table.config.base || table.config.name;

    // Absolute URL
    if (base.startsWith('http://') || base.startsWith('https://')) {
      return base;
    }

    // Relative path - resolve against pod base
    // Note: paths starting with '/' should be relative to pod base, not origin
    // e.g., '/.data/tags.ttl' with pod base 'http://localhost:3000/test/'
    // should resolve to 'http://localhost:3000/test/.data/tags.ttl'
    const podBase = this.podBaseUrl.endsWith('/') ? this.podBaseUrl : `${this.podBaseUrl}/`;
    const normalizedPath = base.startsWith('/') ? base.slice(1) : base;
    return new URL(normalizedPath, podBase).toString();
  }

  // ================= 辅助方法 =================

  /**
   * 检查是否为绝对 URI
   */
  protected isAbsoluteUri(value: string): boolean {
    return value.startsWith('http://') || value.startsWith('https://') || value.startsWith('urn:');
  }

  /**
   * Fallback id 提取（当 subjectUri 不以 baseUrl 开头时）
   */
  protected extractIdFallback(subjectUri: string): string {
    // 尝试提取 fragment
    const hashIndex = subjectUri.indexOf('#');
    if (hashIndex !== -1) {
      return subjectUri.substring(hashIndex); // 包含 #
    }
    
    // 尝试提取文件名
    const lastSlash = subjectUri.lastIndexOf('/');
    if (lastSlash !== -1) {
      return subjectUri.substring(lastSlash + 1);
    }
    
    return subjectUri;
  }
}
