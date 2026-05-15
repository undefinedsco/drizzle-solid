/**
 * Base ResourceResolver with shared logic
 * 
 * 核心设计原则：
 * - 用户写入时可以使用简单 local id（如 "alice", "tag-123"）
 * - subjectTemplate 定义 local id 如何映射到 URI（如 "{id}.ttl#it", "#{id}"）
 * - 写入时：local id + template → relativePath → baseUrl + relativePath
 * - 读取时：row.id 是 base-relative resource id，可从 base 下精确定位资源
 */

import type { PodTable } from '../schema';
import type { QueryCondition } from '../query-conditions';
import type { ResourceResolver } from './types';

interface TemplateVariable {
  raw: string;
  field: string;
  transforms: string[];
}

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
   * 从 subject URI 解析出 ORM row id。
   *
   * `id()` 是虚拟列，不写入 RDF 谓词；读取时它暴露 base-relative
   * resource id，而不是 subjectTemplate 中的本地 `{id}` slot。需要本地
   * slot 时使用 parsePodResourceRef(...).templateValues.id 或
   * extractPodResourceTemplateValue。
   *
   * 例如：
   * - uri = "http://pod/items/alice.ttl#it", template = "{id}.ttl#it" → id = "alice.ttl#it"
   * - uri = "http://pod/tags.ttl#tag-1", template = "#{id}" → id = "tags.ttl#tag-1"
   * - uri = "http://pod/a/2026/05/07.ttl#x", template = "{yyyy}/{MM}/{dd}.ttl#{id}" → id = "2026/05/07.ttl#x"
   */
  parseId(table: PodTable, subjectUri: string): string {
    return this.extractBaseRelativeResourceId(table, subjectUri);
  }

  /**
   * 从 id 构建完整的 subject URI
   * 
   * 两步构建：
   * 1. 根据 subjectTemplate 应用 id → relativePath
   * 2. subjectUri = baseUrl + relativePath
   */
  resolveSubject(table: PodTable, record: Record<string, any>, index?: number): string {
    const baseUrl = this.getSubjectBaseUrl(table);

    // 优先使用显式提供的 id
    let id = record.id ?? record['@id'] ?? record.uri;

    // 如果 id 已经是绝对 URI，直接返回
    if (id && this.isAbsoluteUri(id)) {
      return id;
    }

    if (typeof id === 'string') {
      const subjectFromRelativeId = this.resolveBaseRelativeSubjectId(table, id);
      if (subjectFromRelativeId) {
        return subjectFromRelativeId;
      }
      if (id.startsWith('#')) {
        id = id.slice(1);
      }
    }

    // 如果没有 id，生成 UUID
    if (id === undefined || id === null) {
      id = this.generateUuid();
    }

    // 应用模板生成相对路径
    const template = this.getEffectiveTemplate(table);
    const relativePath = this.applyTemplate({ ...record, id }, template, table, index);

    return baseUrl + relativePath;
  }

  /**
   * Extract the local template `{id}` variable for template transforms and link
   * normalization. This is distinct from the public `id()` resource locator.
   */
  protected parseTemplateId(table: PodTable, subjectUri: string): string | null {
    const relativePath = this.extractTemplateRelativeSubjectId(table, subjectUri);
    return this.extractIdFromTemplate(relativePath, this.getEffectiveTemplate(table));
  }

  protected extractRelativeSubjectId(table: PodTable, subjectUri: string): string {
    const baseUrl = this.getBaseUrlForTable(table);

    if (subjectUri.startsWith(baseUrl)) {
      return subjectUri.substring(baseUrl.length);
    }

    return this.extractIdFallback(subjectUri);
  }

  protected extractBaseRelativeResourceId(table: PodTable, subjectUri: string): string {
    const containerUrl = this.getContainerUrl(table);

    if (subjectUri.startsWith(containerUrl)) {
      return subjectUri.substring(containerUrl.length);
    }

    return this.extractRelativeSubjectId(table, subjectUri);
  }

  private extractTemplateRelativeSubjectId(table: PodTable, subjectUri: string): string {
    const baseUrl = this.resolveBaseUrl(table);

    if (subjectUri.startsWith(baseUrl)) {
      return subjectUri.substring(baseUrl.length);
    }

    return this.extractRelativeSubjectId(table, subjectUri);
  }

  protected isBaseRelativeSubjectId(value: string): boolean {
    if (!value || this.isAbsoluteUri(value) || value.startsWith('/')) {
      return false;
    }

    return (
      value.startsWith('#') ||
      value.includes('#') ||
      /\.(ttl|jsonld|json)(?:#|$)/i.test(value)
    );
  }

  protected acceptsFragmentOnlyResourceId(table: PodTable): boolean {
    const template = this.getEffectiveTemplate(table);
    const variables = this.getTemplateVariables(template);
    return template === '#{id}'
      || (
        template.startsWith('#')
        && variables.length === 1
        && variables[0].field === 'id'
      );
  }

  protected resolveBaseRelativeSubjectId(table: PodTable, value: string): string | null {
    if (!this.isBaseRelativeSubjectId(value)) {
      return null;
    }

    const baseUrl = this.getSubjectBaseUrl(table);
    if (value.startsWith('#')) {
      if (!this.acceptsFragmentOnlyResourceId(table)) {
        return null;
      }
      return `${baseUrl}${value}`;
    }

    if (baseUrl.endsWith('/')) {
      return `${baseUrl}${value}`;
    }

    const lastSlash = baseUrl.lastIndexOf('/');
    const containerUrl = lastSlash >= 0 ? baseUrl.slice(0, lastSlash + 1) : `${baseUrl}/`;
    return `${containerUrl}${value}`;
  }

  protected hasVirtualIdColumn(table: PodTable): boolean {
    return Boolean((table as any).columns?.id?._virtualId);
  }

  /**
   * 获取表的 base URL，用于 id 解析
   */
  protected getBaseUrlForTable(table: PodTable): string {
    return this.resolveBaseUrl(table);
  }

  protected getSubjectBaseUrl(table: PodTable): string {
    return this.acceptsFragmentOnlyResourceId(table)
      ? this.getResourceUrl(table)
      : this.getBaseUrlForTable(table);
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
   * @param record 记录数据
   * @param template 模板 (如 "{id}.ttl#it")
   * @returns 相对路径 (如 "alice.ttl#it")
   */
  protected applyTemplate(
    record: Record<string, any>,
    template: string,
    table?: PodTable,
    index?: number,
  ): string {
    if (!template.includes('{')) {
      return template;
    }

    const timeContext = this.createTimeContext(record);

    return template.replace(/(#?)\{([^}]+)\}/g, (_match, prefix, token) => {
      const variable = this.parseTemplateVariable(token);
      const field = variable.field;

      if (field === 'index' && index !== undefined) {
        return prefix + String(index + 1);
      }

      if (field in timeContext) {
        return prefix + timeContext[field as keyof typeof timeContext];
      }

      let rawValue = record[field];
      if (field === 'id' && (rawValue === undefined || rawValue === null)) {
        rawValue = record['@id'] ?? record.uri;
      }

      if (rawValue === undefined || rawValue === null) {
        return `${prefix}{${token}}`;
      }

      const value = this.applyTemplateTransforms(rawValue, variable, table, field);
      if (prefix === '#' && value.startsWith('#')) {
        return prefix + value.slice(1);
      }
      return prefix + value;
    });
  }

  /**
   * 从相对路径反向解析出所有模板变量
   *
   * @param relativePath 相对路径 (如 "room1/index.ttl#alice")
   * @param template 模板 (如 "{chatId}/index.ttl#{id}")
   * @returns 所有变量的键值对，解析失败返回 null
   */
  protected extractVarsFromTemplate(
    relativePath: string, template: string
  ): Record<string, string> | null {
    let groupIndex = 0;
    const groupToField = new Map<string, string>();

    let regexStr = template
      .replace(/[.+?^$[\]\\()]/g, '\\$&')
      .replace(/\{([^}]+)\}/g, (_match, token) => {
        const variable = this.parseTemplateVariable(token);
        const groupName = `var${groupIndex++}`;
        groupToField.set(groupName, variable.field);
        return `(?<${groupName}>.+?)`;
      });
    regexStr = `^${regexStr}$`;

    try {
      const match = relativePath.match(new RegExp(regexStr));
      if (!match?.groups) {
        return null;
      }

      const values: Record<string, string> = {};
      for (const [groupName, value] of Object.entries(match.groups)) {
        const field = groupToField.get(groupName);
        if (!field || value === undefined) {
          continue;
        }
        if (field in values && values[field] !== value) {
          return null;
        }
        values[field] = value;
      }

      return values;
    } catch {
      return null;
    }
  }

  /**
   * 从相对路径反向解析出 id（向后兼容）
   */
  protected extractIdFromTemplate(relativePath: string, template: string): string | null {
    const vars = this.extractVarsFromTemplate(relativePath, template);
    return vars?.id ?? null;
  }

  /**
   * Extract id values from a query condition
   * Shared logic for both fragment and document mode
   */
  extractIdValues(condition: QueryCondition | Record<string, any> | undefined): string[] {
    if (!condition) return [];

    const ids: string[] = [];

    // Handle simple object: { id: 'value' }, { id: ['v1', 'v2'] }, or { '@id': 'iri' }
    if (typeof condition === 'object' && !('type' in condition)) {
      for (const [rawKey, rawValue] of Object.entries(condition)) {
        const key = this.normalizeConditionColumnName(rawKey);
        if (key !== 'id' && key !== '@id') {
          continue;
        }
        if (Array.isArray(rawValue)) {
          ids.push(...rawValue.map(String));
        } else if (rawValue != null) {
          ids.push(String(rawValue));
        }
      }
      if (ids.length > 0) {
        return ids;
      }
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

    const normalizedColumns = Array.from(
      new Set(columns.map((column) => this.parseTemplateVariable(column).field)),
    );
    const values: Record<string, string> = {};

    // Handle simple object: { col: 'value' }
    if (typeof condition === 'object' && !('type' in condition)) {
      for (const [rawKey, rawValue] of Object.entries(condition)) {
        const key = this.normalizeConditionColumnName(rawKey);
        if (!normalizedColumns.includes(key)) {
          continue;
        }
        if (rawValue != null && !Array.isArray(rawValue)) {
          values[key] = String(rawValue);
        }
      }
      return values;
    }

    // Handle QueryCondition structure
    for (const col of normalizedColumns) {
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
      const colName = this.normalizeConditionColumnName(condition.left);

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
      const colName = this.normalizeConditionColumnName(condition.left);

      if (colName === 'id' || colName === '@id') {
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

  protected normalizeConditionColumnName(target: unknown): string {
    let rawName: string | undefined;

    if (typeof target === 'string') {
      rawName = target;
    } else if (target && typeof target === 'object' && 'name' in target) {
      const candidate = (target as { name?: unknown }).name;
      rawName = typeof candidate === 'string' ? candidate : undefined;
    }

    if (!rawName) {
      return '';
    }

    return rawName.includes('.') ? rawName.split('.').pop() ?? rawName : rawName;
  }

  protected parseTemplateVariable(token: string): TemplateVariable {
    const [field, ...transforms] = token
      .split('|')
      .map((part) => part.trim())
      .filter(Boolean);

    return {
      raw: token,
      field: field || token,
      transforms,
    };
  }

  protected getTemplateVariables(template: string): TemplateVariable[] {
    return Array.from(template.matchAll(/\{([^}]+)\}/g)).map((match) =>
      this.parseTemplateVariable(match[1]),
    );
  }

  protected createTimeContext(record: Record<string, any>) {
    let date: Date;

    const createdAt = record.createdAt ?? record.created_at ?? record.dateCreated;
    if (createdAt instanceof Date) {
      date = createdAt;
    } else if (typeof createdAt === 'string' || typeof createdAt === 'number') {
      date = new Date(createdAt);
    } else {
      date = new Date();
    }

    return {
      yyyy: date.getUTCFullYear().toString(),
      MM: String(date.getUTCMonth() + 1).padStart(2, '0'),
      dd: String(date.getUTCDate()).padStart(2, '0'),
      HH: String(date.getUTCHours()).padStart(2, '0'),
      mm: String(date.getUTCMinutes()).padStart(2, '0'),
      ss: String(date.getUTCSeconds()).padStart(2, '0'),
    };
  }

  protected applyTemplateTransforms(
    value: unknown,
    variable: TemplateVariable,
    table?: PodTable,
    field?: string,
  ): string {
    let next = this.normalizeTemplateValue(value, table, field);

    for (const transform of variable.transforms) {
      if (transform === 'id') {
        next = this.extractTemplateId(next, table, field);
        continue;
      }

      if (transform === 'slug') {
        next = this.slugifyValue(next);
      }
    }

    return next;
  }

  protected normalizeTemplateValue(value: unknown, table?: PodTable, field?: string): string {
    const stringValue = String(value);

    if (!table || !field || !this.isAbsoluteUri(stringValue)) {
      return stringValue;
    }

    const column = (table as any).columns?.[field];
    if (!this.isLinkColumn(column)) {
      return stringValue;
    }

    return this.extractTemplateId(stringValue, table, field);
  }

  protected extractTemplateId(value: string, table?: PodTable, field?: string): string {
    if (value.startsWith('/')) {
      const podBase = this.podBaseUrl.endsWith('/') ? this.podBaseUrl : `${this.podBaseUrl}/`;
      value = new URL(value.replace(/^\/+/, ''), podBase).toString();
    }

    if (!this.isAbsoluteUri(value)) {
      return value;
    }

    const column = table && field ? (table as any).columns?.[field] : undefined;
    const linkedTable = column?.getLinkTable?.() ?? column?.options?.linkTable;

    if (linkedTable) {
      return this.parseTemplateId(linkedTable, value) ?? this.parseId(linkedTable, value);
    }

    const fallback = this.extractIdFallback(value);
    return fallback.startsWith('#') ? fallback.slice(1) : fallback.replace(/\.ttl$/i, '');
  }

  protected isLinkColumn(column: any): boolean {
    return !!(
      column?.getLinkTable?.() ||
      column?.options?.linkTable ||
      column?.getLinkTableName?.() ||
      column?.options?.linkTableName ||
      column?.getLinkTarget?.() ||
      column?.options?.linkTarget
    );
  }

  protected slugifyValue(value: string): string {
    return value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
      .replace(/^-+|-+$/g, '');
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
