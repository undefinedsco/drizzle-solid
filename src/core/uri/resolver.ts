/**
 * URI Resolver Implementation
 *
 * 统一的 URI 生成和解析
 * 整合了 Subject URI 和 Object/Reference URI 的解析逻辑
 * 
 * 设计原则：无状态，所有需要的上下文都通过参数传入
 */

import type { PodTable, PodColumnBase } from '../pod-table';
import type {
  UriResolver,
  UriContext,
  ResourceMode,
  ParsedSubject,
  TimeContext,
} from './types';

/**
 * UUID 正则
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 固定的单例 fragment 列表
 */
const SINGLETON_FRAGMENTS = new Set(['#me', '#this', '#profile', '#card']);

/**
 * URI 解析器实现
 * 
 * 无状态设计：所有上下文信息通过参数传入
 */
export class UriResolverImpl implements UriResolver {
  private podUrl: string;

  constructor(podUrl: string = '') {
    this.podUrl = podUrl.replace(/\/$/, '');
  }

  // ================= 配置方法 =================

  setPodUrl(podUrl: string): void {
    this.podUrl = podUrl.replace(/\/$/, '');
  }

  // ================= Subject URI 解析 =================

  resolveSubject(table: PodTable, record: Record<string, unknown>, index?: number): string {
    // Check if record has an absolute ID override
    const explicitId = record['@id'] ?? record['id'] ?? record['uri'];
    if (typeof explicitId === 'string') {
      if (this.isAbsoluteUri(explicitId)) {
        return explicitId;
      }
      // Check if it's a relative URI with fragment
      const hashIndex = explicitId.indexOf('#');
      if (hashIndex > 0) {
        const mode = this.getResourceMode(table);
        if (mode === 'fragment') {
          record = { ...record, id: explicitId.slice(hashIndex + 1) };
        }
      }
    }

    const pattern = this.getEffectivePattern(table);
    const mode = this.getResourceMode(table);
    const base = this.getSubjectBaseUrl(table);

    // 单例模式 - 直接返回 base + pattern
    if (this.isSingleton(table)) {
      return this.combineBaseAndPattern(base, pattern);
    }

    // 应用模板变量
    const applied = this.applyTemplate(pattern, record, index);

    if (applied) {
      if (this.isAbsoluteUri(applied)) {
        return applied;
      }
    }

    if (!applied) {
      // 如果模板应用失败，生成默认 URI
      return this.generateFallbackUri(base, mode, index);
    }

    return this.combineBaseAndPattern(base, applied);
  }

  parseSubject(uri: string, table: PodTable): ParsedSubject | null {
    if (!uri) return null;

    const hashIndex = uri.indexOf('#');
    const hasFragment = hashIndex !== -1;

    const resourceUrl = hasFragment ? uri.slice(0, hashIndex) : uri;
    const fragment = hasFragment ? uri.slice(hashIndex + 1) : undefined;

    const mode = this.getResourceMode(table);
    const id = this.extractId(uri, table);

    return {
      uri,
      resourceUrl,
      fragment,
      id,
      mode,
    };
  }

  getResourceUrl(subjectUri: string): string {
    const hashIndex = subjectUri.indexOf('#');
    return hashIndex !== -1 ? subjectUri.slice(0, hashIndex) : subjectUri;
  }

  getResourceMode(table: PodTable): ResourceMode {
    // 只有用户显式提供 subjectTemplate 时才用它来判断
    const hasCustomTemplate = table.hasCustomTemplate?.() ?? false;

    if (hasCustomTemplate) {
      const pattern = table.config?.subjectTemplate ?? '';

      if (pattern.startsWith('#')) {
        return 'fragment';
      }

      if (pattern.includes('.ttl') || pattern.includes('.jsonld') || pattern.includes('.json')) {
        return 'document';
      }

      return 'document';
    }

    const containerPath = table.getContainerPath();
    const tableName = table.config?.name ?? '';

    const normalizedContainer = containerPath.endsWith('/') ? containerPath : `${containerPath}/`;

    if (normalizedContainer.endsWith(`${tableName}/`)) {
      return 'document';
    }

    return 'fragment';
  }

  getDefaultPattern(table: PodTable): string {
    const mode = this.getResourceMode(table);
    return mode === 'fragment' ? '#{id}' : '{id}.ttl';
  }

  resolveInlineChild(
    parentSubject: string,
    columnName: string,
    value: Record<string, unknown>,
    index: number
  ): string {
    // 优先使用显式 ID
    const explicitId = value['@id'] ?? value['id'];
    if (typeof explicitId === 'string') {
      return explicitId;
    }

    // 生成 fragment URI
    const resourceUrl = this.getResourceUrl(parentSubject);
    return `${resourceUrl}#${columnName}-${index + 1}`;
  }

  isSingleton(table: PodTable): boolean {
    const pattern = table.config?.subjectTemplate;

    if (!pattern) return false;

    if (SINGLETON_FRAGMENTS.has(pattern)) {
      return true;
    }

    if (!pattern.includes('{')) {
      return true;
    }

    return false;
  }

  // ================= Object/Reference URI 解析 =================

  /**
   * 解析 reference 列的值为完整 URI
   * 
   * @param value 原始值（可能是 UUID、相对路径或完整 URI）
   * @param column 列定义（包含 reference 配置）
   * @param context 解析上下文（包含 tableRegistry 等）
   */
  resolveReference(value: string, column: PodColumnBase, context?: UriContext): string {
    // 1. 已经是绝对 URI，直接返回
    if (this.isAbsoluteUri(value)) {
      return value;
    }

    // 2. 相对路径（以 / 或 # 开头），用 baseUri 补全
    if (value.startsWith('/') || value.startsWith('#')) {
      const base = context?.baseUri || this.podUrl;
      if (base) {
        try {
          return new URL(value, base).toString();
        } catch {
          // URL 解析失败，继续尝试其他方式
        }
      }
      throw new Error(
        `Cannot resolve relative URI "${value}": no baseUri configured`
      );
    }

    // 3. 尝试通过 referenceTable 解析（直接引用表对象，不需要 registry）
    const referenceTable = column.getReferenceTable?.();
    if (referenceTable) {
      const uriInfo = this.getTableUriInfo(referenceTable);
      if (uriInfo) {
        return this.buildFullUri(value, uriInfo.baseUrl, uriInfo.subjectTemplate);
      }
      throw new Error(
        `Cannot resolve URI "${value}": referenced table "${referenceTable.config?.name}" has no base configured.`
      );
    }

    // 4. 尝试通过 referenceTableName 解析
    const referenceTableName = column.getReferenceTableName?.();
    if (referenceTableName) {
      if (context?.tableNameRegistry) {
        const targetTable = context.tableNameRegistry.get(referenceTableName);
        if (targetTable) {
          const uriInfo = this.getTableUriInfo(targetTable);
          if (uriInfo) {
            return this.buildFullUri(value, uriInfo.baseUrl, uriInfo.subjectTemplate);
          }
        }
      }
      const availableTables = context?.tableNameRegistry
        ? Array.from(context.tableNameRegistry.keys()).join(', ')
        : '(no tables registered)';
      throw new Error(
        `Cannot resolve URI "${value}": table "${referenceTableName}" not found in schema. ` +
        `Available tables: ${availableTables}`
      );
    }

    // 5. 尝试通过 referenceTarget (class URI) 解析
    const referenceTarget = column.getReferenceTarget?.();
    if (referenceTarget) {
      if (!context?.tableRegistry) {
        // 有 referenceTarget 但没有 tableRegistry，无法解析
        throw new Error(
          `Cannot resolve URI "${value}" (references ${referenceTarget}): ` +
          `tableRegistry not configured. Ensure the schema is properly registered.`
        );
      }
      
      const targetTables = context.tableRegistry.get(referenceTarget);

      if (targetTables && targetTables.length > 0) {
        if (targetTables.length > 1) {
          const tableNames = targetTables
            .map(t => t.config?.name || 'unknown')
            .join(', ');
          throw new Error(
            `Ambiguous reference: class "${referenceTarget}" has multiple tables [${tableNames}]. ` +
            `Use .reference('tableName') or .reference(tableObject) to specify which table to use.`
          );
        }

        const targetTable = targetTables[0];
        const uriInfo = this.getTableUriInfo(targetTable);
        if (uriInfo) {
          return this.buildFullUri(value, uriInfo.baseUrl, uriInfo.subjectTemplate);
        }
      }
      
      // referenceTarget 指定了但在 registry 中找不到对应的表
      throw new Error(
        `Cannot resolve URI "${value}": class "${referenceTarget}" not found in tableRegistry. ` +
        `Available classes: ${Array.from(context.tableRegistry.keys()).join(', ') || '(none)'}`
      );
    }

    // 6. 使用 baseUri fallback (仅当没有任何 reference 配置时)
    const base = context?.baseUri || this.podUrl;
    if (base && this.isAbsoluteUri(base)) {
      const baseUrl = base.endsWith('/') ? base : `${base}/`;
      return this.buildFullUri(value, baseUrl);
    }

    // 7. 无法解析，给出友好的错误信息
    throw new Error(
      `Cannot resolve URI "${value}". ` +
      `Either provide a full URI (https://...), or configure baseUri.`
    );
  }

  isAbsoluteUri(value: string): boolean {
    if (!value || typeof value !== 'string') return false;
    return value.includes(':') && (
      value.startsWith('http://') ||
      value.startsWith('https://') ||
      value.startsWith('urn:') ||
      value.startsWith('did:') ||
      value.startsWith('mailto:') ||
      value.startsWith('tel:') ||
      value.startsWith('file://') ||
      /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)
    );
  }

  isReferenceColumn(column: PodColumnBase | any): boolean {
    if (!column) return false;
    return column.dataType === 'uri' ||
      column.isReference?.() ||
      !!column.options?.referenceTarget ||
      !!column.options?.referenceTableName ||
      !!column.options?.referenceTable;
  }

  findTargetTable(column: PodColumnBase | any, context?: UriContext): PodTable | undefined {
    // Priority 1: Direct table reference from column object
    const referenceTable = column.getReferenceTable?.() || column.options?.referenceTable;
    if (referenceTable) {
      return referenceTable;
    }

    // Priority 2: Table name reference
    const referenceTableName = column.getReferenceTableName?.() || column.options?.referenceTableName;
    if (referenceTableName && context?.tableNameRegistry) {
      const found = context.tableNameRegistry.get(referenceTableName);
      if (found) {
        return found;
      }
    }

    // Priority 3: Class URI reference (check for ambiguity)
    const referenceTarget = column.getReferenceTarget?.() || column.options?.referenceTarget;
    if (referenceTarget && context?.tableRegistry) {
      const tables = context.tableRegistry.get(referenceTarget);
      if (tables && tables.length === 1) {
        return tables[0];
      }
    }

    return undefined;
  }

  // ================= Private Helpers =================

  /**
   * 从表获取基础 URL 和 subject template 信息
   */
  private getTableUriInfo(table: PodTable): { baseUrl: string; subjectTemplate: string } | undefined {
    const subjectTemplate = table.config?.subjectTemplate || '{id}.ttl';

    // Fragment Mode (#{id}) - 使用 resourcePath
    if (subjectTemplate.startsWith('#')) {
      const base = table.config?.base;
      if (!base) return undefined;
      const baseUrl = base.endsWith('/') ? base.slice(0, -1) : base;
      return { baseUrl: this.toAbsoluteUrl(baseUrl), subjectTemplate };
    }

    // Document Mode - 使用容器路径
    const base = table.config?.containerPath || table.getContainerPath?.();
    if (!base) return undefined;

    const baseUrl = base.endsWith('/') ? base : `${base}/`;

    return { baseUrl: this.toAbsoluteUrl(baseUrl), subjectTemplate };
  }

  /**
   * 构建完整 URI
   */
  private buildFullUri(value: string, baseUrl: string, subjectTemplate: string = '{id}.ttl'): string {
    // 如果不是 UUID/ID 格式，直接拼接
    if (!UUID_REGEX.test(value) && value.includes('/')) {
      return `${baseUrl}${value}`;
    }

    // 用 value 替换模板中的 {id}
    let result = subjectTemplate.replace(/\{id\}/g, value);

    if (this.isAbsoluteUri(result)) {
      return result;
    }

    // 如果模板以 # 开头，是 fragment 模式
    if (result.startsWith('#')) {
      const cleanBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
      return `${cleanBase}${result}`;
    }

    // Document 模式，直接拼接
    return `${baseUrl}${result}`;
  }

  /**
   * 获取有效的 pattern
   */
  private getEffectivePattern(table: PodTable): string {
    const hasCustomTemplate = table.hasCustomTemplate?.() ?? false;

    if (hasCustomTemplate) {
      const explicitPattern = table.config?.subjectTemplate;
      if (explicitPattern && explicitPattern.trim().length > 0) {
        return explicitPattern;
      }
    }

    return this.getDefaultPattern(table);
  }

  /**
   * 获取 Subject base URL
   */
  private getSubjectBaseUrl(table: PodTable): string {
    const mode = this.getResourceMode(table);

    if (mode === 'document') {
      const containerPath = table.getContainerPath();
      return this.toAbsoluteUrl(containerPath);
    }

    const resourcePath = table.getResourcePath?.() ?? table.config?.base ?? '';
    return this.toAbsoluteUrl(resourcePath);
  }

  /**
   * 将路径转换为绝对 URL
   */
  private toAbsoluteUrl(path: string): string {
    if (!path) {
      return this.podUrl;
    }

    if (this.isAbsoluteUri(path)) {
      return path;
    }

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${this.podUrl}${normalizedPath}`;
  }

  /**
   * 合并 base 和 pattern
   */
  private combineBaseAndPattern(base: string, pattern: string): string {
    if (pattern.startsWith('#')) {
      const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
      return `${cleanBase}${pattern}`;
    }

    if (base.endsWith('/')) {
      return `${base}${pattern}`;
    }

    if ((base.endsWith('.ttl') || base.endsWith('.jsonld')) && pattern.startsWith('#')) {
      return `${base}${pattern}`;
    }

    return `${base}/${pattern}`;
  }

  /**
   * 应用模板变量
   */
  private applyTemplate(
    template: string,
    record: Record<string, unknown>,
    index?: number
  ): string | null {
    if (!template.includes('{')) {
      return template;
    }

    const timeContext = this.createTimeContext(record);
    let missingReplacement = false;

    const replaced = template.replace(/(#?)\{([^}]+)\}/g, (match, prefix, key) => {
      if (key in timeContext) {
        return prefix + (timeContext[key as keyof TimeContext] as string);
      }

      if (key === 'index' && index !== undefined) {
        return prefix + String(index + 1);
      }

      let rawValue = record[key];
      if (key === 'id' && (rawValue === undefined || rawValue === null)) {
        rawValue = record['@id'] ?? record['uri'];
      }

      if (rawValue === undefined || rawValue === null) {
        missingReplacement = true;
        return '';
      }

      let value = String(rawValue);

      if (prefix === '#' && value.startsWith('#')) {
        value = value.slice(1);
      }

      return prefix + value;
    });

    return missingReplacement ? null : replaced;
  }

  /**
   * 创建时间上下文
   */
  private createTimeContext(record: Record<string, unknown>): TimeContext {
    let date: Date;

    const createdAt = record['createdAt'] ?? record['created_at'] ?? record['dateCreated'];
    if (createdAt instanceof Date) {
      date = createdAt;
    } else if (typeof createdAt === 'string' || typeof createdAt === 'number') {
      date = new Date(createdAt);
    } else {
      date = new Date();
    }

    const yyyy = date.getUTCFullYear().toString();
    const mm = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const dd = date.getUTCDate().toString().padStart(2, '0');
    const timestamp = Math.floor(date.getTime() / 1000).toString();

    return { date, yyyy, mm, dd, timestamp };
  }

  /**
   * 生成回退 URI
   */
  private generateFallbackUri(base: string, mode: ResourceMode, index?: number): string {
    const suffix = index !== undefined ? `row-${index + 1}` : `row-${Date.now()}`;

    if (mode === 'fragment') {
      const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
      return `${cleanBase}#${suffix}`;
    }

    const cleanBase = base.endsWith('/') ? base : `${base}/`;
    return `${cleanBase}${suffix}.ttl`;
  }

  /**
   * 从 URI 提取 ID
   */
  private extractId(uri: string, table: PodTable): string {
    const mode = this.getResourceMode(table);
    const hashIndex = uri.indexOf('#');

    if (mode === 'fragment' && hashIndex !== -1) {
      return uri.slice(hashIndex + 1);
    }

    const urlWithoutFragment = hashIndex !== -1 ? uri.slice(0, hashIndex) : uri;
    const lastSlash = urlWithoutFragment.lastIndexOf('/');

    if (lastSlash !== -1) {
      let filename = urlWithoutFragment.slice(lastSlash + 1);

      const extIndex = filename.lastIndexOf('.');
      if (extIndex !== -1) {
        filename = filename.slice(0, extIndex);
      }

      return filename;
    }

    return uri;
  }
}

// 默认单例实例
