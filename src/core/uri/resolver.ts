/**
 * URI Resolver Implementation
 *
 * 统一的 URI 生成和解析
 * 整合了 Subject URI 和 Object/Link URI 的解析逻辑
 * 
 * 设计原则：
 * - 无状态，所有需要的上下文都通过参数传入
 * - 统一使用 base + subjectTemplate 来生成和解析 URI
 * - 不再区分 document/fragment 模式，模式由 template 自然表达
 */

import type { PodTable, PodColumnBase } from '../schema';
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

interface TemplateVariable {
  raw: string;
  field: string;
  transforms: string[];
}

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

  /**
   * 解析 subject URI
   * @param table 表定义
   * @param record 记录数据
   * @param index 可选的行索引
   * @param options.strict 是否严格模式（默认 true）。false 时允许部分解析，用于查询场景
   */
  resolveSubject(
    table: PodTable,
    record: Record<string, unknown>,
    index?: number,
    options?: { strict?: boolean }
  ): string {
    const strict = options?.strict ?? true;

    // Check if record has an absolute ID override
    const explicitId = record['@id'] ?? record['id'] ?? record['uri'];
    if (typeof explicitId === 'string') {
      if (this.isAbsoluteUri(explicitId)) {
        return explicitId;
      }
      const resolvedRelativeId = this.resolveBaseRelativeSubjectId(table, explicitId);
      if (resolvedRelativeId) {
        return resolvedRelativeId;
      }
    }

    const pattern = this.getEffectivePattern(table);
    const base = this.getSubjectBaseUrl(table);

    // 单例模式 - 直接返回 base + pattern
    if (this.isSingleton(table)) {
      return this.combineBaseAndPattern(base, pattern);
    }

    // 应用模板变量
    const applied = this.applyTemplate(pattern, record, index, table, strict);

    if (applied === null) {
      // 非严格模式下，applyTemplate 返回 null 表示无法完全解析
      // 使用 fallback URI（仅用于查询场景的比较）
      return this.generateFallbackUri(base, pattern, index);
    }

    if (this.isAbsoluteUri(applied)) {
      return applied;
    }

    return this.combineBaseAndPattern(base, applied);
  }

  parseSubject(uri: string, table: PodTable): ParsedSubject | null {
    if (!uri) return null;

    const hashIndex = uri.indexOf('#');
    const hasFragment = hashIndex !== -1;

    const resourceUrl = hasFragment ? uri.slice(0, hashIndex) : uri;
    const fragment = hasFragment ? uri.slice(hashIndex + 1) : undefined;

    const id = this.extractPublicId(uri, table);
    const mode = this.getResourceMode(table);

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

  /**
   * 判断资源模式
   * 简化版：直接从 subjectTemplate 判断
   */
  getResourceMode(table: PodTable): ResourceMode {
    const template = table.config?.subjectTemplate ?? this.getDefaultPattern(table);
    
    // 以 # 开头是 fragment 模式
    if (template.startsWith('#')) {
      return 'fragment';
    }
    
    // 否则是 document 模式
    return 'document';
  }

  /**
   * 获取默认模板
   * 根据 base 是否以 / 结尾判断
   * 与 PodTable.buildDefaultSubjectTemplate 保持一致
   */
  getDefaultPattern(table: PodTable): string {
    const base = table.config?.base ?? '';
    // base 以 / 结尾表示容器 → document 模式 → {id}.ttl
    // base 是文件路径 → fragment 模式 → #{id}
    if (base.endsWith('/')) {
      return '{id}.ttl';
    }
    return '#{id}';
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

  // ================= Object/Link URI 解析 =================

  /**
   * 解析 link 列的值为完整 URI
   * 
   * @param value 原始值（可能是 UUID、相对路径或完整 URI）
   * @param column 列定义（包含 link 配置）
   * @param context 解析上下文（包含 tableRegistry 等）
   */
  resolveLink(value: string, column: PodColumnBase, context?: UriContext): string {
    const rawValue = String(value ?? '');
    const record = context?.record && typeof context.record === 'object' ? context.record : undefined;

    // 1. 已经是绝对 URI，直接返回
    if (this.isAbsoluteUri(rawValue)) {
      return rawValue;
    }

    // 2. 相对路径（以 / 或 # 开头），用 baseUri 补全
    if (rawValue.startsWith('/') || rawValue.startsWith('#')) {
      const base = context?.baseUri || this.podUrl;
      if (base) {
        try {
          return new URL(rawValue, base).toString();
        } catch {
          // URL 解析失败，继续尝试其他方式
        }
      }
      throw new Error(
        `Cannot resolve relative URI "${rawValue}": no baseUri configured`
      );
    }

    // 3. 尝试通过 linkTable 解析（直接链接目标表对象，不需要 registry）
    const linkTable = column.getLinkTable?.();
    if (linkTable) {
      const uriInfo = this.getTableUriInfo(linkTable);
      if (uriInfo) {
        return this.buildFullUri(rawValue, uriInfo.baseUrl, uriInfo.subjectTemplate, linkTable, context, record);
      }
      throw new Error(
        `Cannot resolve URI "${rawValue}": linked table "${linkTable.config?.name}" has no base configured.`
      );
    }

    // 4. 尝试通过 linkTableName 解析
    const linkTableName = column.getLinkTableName?.();
    if (linkTableName) {
      if (context?.tableNameRegistry) {
        const targetTable = context.tableNameRegistry.get(linkTableName);
        if (targetTable) {
          const uriInfo = this.getTableUriInfo(targetTable);
          if (uriInfo) {
            return this.buildFullUri(rawValue, uriInfo.baseUrl, uriInfo.subjectTemplate, targetTable, context, record);
          }
        }
      }
      const availableTables = context?.tableNameRegistry
        ? Array.from(context.tableNameRegistry.keys()).join(', ')
        : '(no tables registered)';
      throw new Error(
        `Cannot resolve URI "${rawValue}": table "${linkTableName}" not found in schema. ` +
        `Available tables: ${availableTables}`
      );
    }

    // 5. 尝试通过 linkTarget (class URI) 解析
    const linkTarget = column.getLinkTarget?.();
    if (linkTarget) {
      if (!context?.tableRegistry) {
        // 有 linkTarget 但没有 tableRegistry，无法解析
        throw new Error(
          `Cannot resolve URI "${rawValue}" (links to ${linkTarget}): ` +
          `tableRegistry not configured. Ensure the schema is properly registered.`
        );
      }
      
      const targetTables = context.tableRegistry.get(linkTarget);

      if (targetTables && targetTables.length > 0) {
        if (targetTables.length > 1) {
          const tableNames = targetTables
            .map(t => t.config?.name || 'unknown')
            .join(', ');
          throw new Error(
            `Ambiguous link target: class "${linkTarget}" has multiple tables [${tableNames}]. ` +
            `Use .link('tableName') or .link(tableObject) to specify which table to use.`
          );
        }

        const targetTable = targetTables[0];
        const uriInfo = this.getTableUriInfo(targetTable);
        if (uriInfo) {
          return this.buildFullUri(rawValue, uriInfo.baseUrl, uriInfo.subjectTemplate, targetTable, context, record);
        }
      }
      
      // linkTarget 指定了但在 registry 中找不到对应的表
      throw new Error(
        `Cannot resolve URI "${rawValue}": class "${linkTarget}" not found in tableRegistry. ` +
        `Available classes: ${Array.from(context.tableRegistry.keys()).join(', ') || '(none)'}`
      );
    }

    // 6. 使用 baseUri fallback (仅当没有任何 link 配置时)
    const base = context?.baseUri || this.podUrl;
    if (base && this.isAbsoluteUri(base)) {
      const baseUrl = base.endsWith('/') ? base : `${base}/`;
      return this.buildFullUri(rawValue, baseUrl);
    }

    // 7. 无法解析，给出友好的错误信息
    throw new Error(
      `Cannot resolve URI "${rawValue}". ` +
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

  isLinkColumn(column: PodColumnBase | any): boolean {
    if (!column) return false;
    return column.dataType === 'uri' ||
      column.isLink?.() ||
      !!column.options?.linkTarget ||
      !!column.options?.linkTableName ||
      !!column.options?.linkTable;
  }

  findTargetTable(column: PodColumnBase | any, context?: UriContext): PodTable | undefined {
    // Priority 1: Direct linked table from column object
    const linkTable = column.getLinkTable?.() || column.options?.linkTable;
    if (linkTable) {
      return linkTable;
    }

    // Priority 2: Linked table by name
    const linkTableName = column.getLinkTableName?.() || column.options?.linkTableName;
    if (linkTableName && context?.tableNameRegistry) {
      const found = context.tableNameRegistry.get(linkTableName);
      if (found) {
        return found;
      }
    }

    // Priority 3: Class URI link (check for ambiguity)
    const linkTarget = column.getLinkTarget?.() || column.options?.linkTarget;
    if (linkTarget && context?.tableRegistry) {
      const tables = context.tableRegistry.get(linkTarget);
      if (tables && tables.length === 1) {
        return tables[0];
      }
    }

    return undefined;
  }

  /**
   * 从链接 URI 中提取 ID
   * 
   * 用于读取时将完整 URI 转换回简单 ID
   * 
   * @param uri 完整的 URI (如 http://pod/.data/chat/chat-123/index.ttl#this)
   * @param column 链接列定义
   * @param context URI 上下文（包含表注册表）
   * @returns 提取的 ID (如 chat-123)，如果无法解析则返回原 URI
   */
  extractLinkId(uri: string, column: PodColumnBase | any, context?: UriContext): string {
    if (uri?.startsWith('/')) {
      const base = context?.baseUri || this.podUrl;
      if (base) {
        const baseUrl = base.endsWith('/') ? base : `${base}/`;
        uri = new URL(uri.replace(/^\/+/, ''), baseUrl).toString();
      }
    }

    if (!uri || !this.isAbsoluteUri(uri)) {
      return uri;
    }

    // 找到目标表
    const targetTable = this.findTargetTable(column, context);
    if (!targetTable) {
      // 无法确定目标表，返回原 URI
      return uri;
    }

    // 使用目标表的信息提取 ID
    const templateId = this.extractTemplateIdFromSubject(uri, targetTable);
    if (templateId) {
      return templateId;
    }

    return uri;
  }

  // ================= Private Helpers =================

  /**
   * 从表获取基础 URL 和 subject template 信息
   * 简化版：统一使用 base + subjectTemplate
   */
  private getTableUriInfo(table: PodTable): { baseUrl: string; subjectTemplate: string } | undefined {
    const base = table.config?.base;
    if (!base) return undefined;

    const subjectTemplate = table.config?.subjectTemplate || this.getDefaultPattern(table);
    const baseUrl = this.toAbsoluteUrl(base);

    return { baseUrl, subjectTemplate };
  }

  /**
   * 构建完整 URI
   */
  private buildFullUri(
    value: string,
    baseUrl: string,
    subjectTemplate: string = '{id}.ttl',
    targetTable?: PodTable,
    context?: UriContext,
    record?: Record<string, unknown>,
  ): string {
    const rawValue = String(value ?? '');

    // 如果不是 UUID/ID 格式，直接拼接相对路径。模板路径变量只适用于短 id。
    if (!UUID_REGEX.test(rawValue) && rawValue.includes('/') && !rawValue.includes('{')) {
      const resolved = `${baseUrl}${rawValue}`;
      this.assertNoUnresolvedTemplate(resolved, subjectTemplate, targetTable);
      return resolved;
    }

    const templateRecord = this.buildTemplateRecord(rawValue, subjectTemplate, targetTable, context, record);
    const result = this.applyTemplate(subjectTemplate, templateRecord, undefined, targetTable, true, context);
    if (result === null) {
      throw new Error(
        `[UriResolver] Failed to resolve URI template "${subjectTemplate}" for table ` +
        `"${targetTable?.config?.name ?? 'unknown'}"`
      );
    }

    if (this.isAbsoluteUri(result)) {
      this.assertNoUnresolvedTemplate(result, subjectTemplate, targetTable);
      return result;
    }

    // 如果模板以 # 开头，是 fragment 模式
    if (result.startsWith('#')) {
      const cleanBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
      const resolved = `${cleanBase}${result}`;
      this.assertNoUnresolvedTemplate(resolved, subjectTemplate, targetTable);
      return resolved;
    }

    // Document 模式，直接拼接
    const cleanBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const resolved = `${cleanBase}${result}`;
    this.assertNoUnresolvedTemplate(resolved, subjectTemplate, targetTable);
    return resolved;
  }

  private buildTemplateRecord(
    id: string,
    template: string,
    targetTable?: PodTable,
    context?: UriContext,
    record?: Record<string, unknown>,
  ): Record<string, unknown> {
    const templateRecord: Record<string, unknown> = { ...(record ?? {}) };
    templateRecord.id = id;

    for (const match of template.matchAll(/\{([^}]+)\}/g)) {
      const variable = this.parseTemplateVariable(match[1]);
      const key = variable.field;

      if (key === 'id' || key === 'index' || key in templateRecord) {
        continue;
      }

      const resolved = this.resolveTemplateVariable(key, targetTable, context, record);
      if (resolved !== undefined && resolved !== null && resolved !== '') {
        templateRecord[key] = resolved;
      }
    }

    return templateRecord;
  }

  private resolveTemplateVariable(
    variable: string,
    targetTable?: PodTable,
    context?: UriContext,
    record?: Record<string, unknown>,
  ): unknown {
    if (!record || typeof record !== 'object') {
      return undefined;
    }

    if (variable in record) {
      const column = targetTable?.columns?.[variable];
      return this.normalizeValue(record[variable], column, context);
    }

    const directIdKey = `${variable}Id`;
    if (directIdKey in record) {
      return String(record[directIdKey]);
    }

    const targetColumn = targetTable?.columns?.[variable];
    const targetLinkedTable = targetColumn ? this.findTargetTable(targetColumn, context) : undefined;
    if (targetLinkedTable) {
      for (const [recordKey, recordValue] of Object.entries(record)) {
        const recordColumn = context?.currentTable?.columns?.[recordKey];
        const linkedTable = recordColumn ? this.findTargetTable(recordColumn, context) : undefined;
        if (linkedTable === targetLinkedTable) {
          return this.normalizeValue(recordValue, targetColumn, context);
        }
      }
    }

    return undefined;
  }

  private assertNoUnresolvedTemplate(value: string, template: string, table?: PodTable): void {
    if (/\{[^}]+\}/.test(value)) {
      const tableName = table?.config?.name || 'unknown';
      throw new Error(
        `[UriResolver] Unresolved URI template variable while resolving table "${tableName}" ` +
        `with template "${template}": ${value}`
      );
    }
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
   * 简化版：统一使用 table.config.base
   */
  private getSubjectBaseUrl(table: PodTable): string {
    const base = table.config?.base ?? '';
    return this.toAbsoluteUrl(base);
  }

  private isBaseRelativeSubjectId(value: string): boolean {
    if (!value || this.isAbsoluteUri(value) || value.startsWith('/')) {
      return false;
    }

    return (
      value.startsWith('#') ||
      value.includes('#') ||
      /\.(ttl|jsonld|json)(?:#|$)/i.test(value)
    );
  }

  private resolveBaseRelativeSubjectId(table: PodTable, value: string): string | null {
    if (!this.isBaseRelativeSubjectId(value)) {
      return null;
    }

    const base = this.getSubjectBaseUrl(table);
    if (value.startsWith('#')) {
      return `${base.endsWith('/') ? base.slice(0, -1) : base}${value}`;
    }

    if (base.endsWith('/')) {
      return `${base}${value}`;
    }

    const lastSlash = base.lastIndexOf('/');
    const containerUrl = lastSlash >= 0 ? base.slice(0, lastSlash + 1) : `${base}/`;
    return `${containerUrl}${value}`;
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
   * 将列值归一化为适合模板使用的字符串
   * 特别处理：如果是链接列且值为 URI，则尝试提取 ID
   */
  normalizeValue(value: unknown, column?: PodColumnBase, context?: UriContext): string {
    if (value === undefined || value === null) {
      return '';
    }

    // 处理链接列：如果是链接列且值为 URI，尝试提取 ID
    if (typeof value === 'string' && this.isAbsoluteUri(value)) {
      if (column && this.isLinkColumn(column)) {
        return this.extractLinkId(value, column, context);
      }
    }

    return String(value);
  }

  private parseTemplateVariable(token: string): TemplateVariable {
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

  private slugifyValue(value: string): string {
    return value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
      .replace(/^-+|-+$/g, '');
  }

  private applyTransforms(
    value: unknown,
    variable: TemplateVariable,
    column?: PodColumnBase,
    context?: UriContext,
  ): string {
    let next = this.normalizeValue(value, column, context);

    for (const transform of variable.transforms) {
      if (transform === 'id') {
        next = column && this.isLinkColumn(column)
          ? this.extractLinkId(next, column, context)
          : next;
        continue;
      }

      if (transform === 'slug') {
        next = this.slugifyValue(next);
      }
    }

    return next;
  }

  /**
   * 应用模板变量
   * @param template 模板字符串
   * @param record 记录数据
   * @param index 可选的行索引
   * @param table 可选的表定义
   * @param strict 是否严格模式（默认 true）。false 时缺少字段返回 null，不抛出异常
   */
  private applyTemplate(
    template: string,
    record: Record<string, unknown>,
    index?: number,
    table?: PodTable,
    strict: boolean = true,
    uriContext?: UriContext,
  ): string | null {
    if (!template.includes('{')) {
      return template;
    }

    const timeContext = this.createTimeContext(record);
    const missingKeys: string[] = [];

    const replaced = template.replace(/(#?)\{([^}]+)\}/g, (match, prefix, token) => {
      const variable = this.parseTemplateVariable(token);
      const key = variable.field;

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
        missingKeys.push(token);
        return match; // Keep original placeholder for error message
      }

      const column = (table as any)?.columns?.[key];
      const context = uriContext ?? (table ? {
        tableRegistry: (table as any)[Symbol.for('drizzle:tableRegistry')],
        tableNameRegistry: (table as any)[Symbol.for('drizzle:tableNameRegistry')]
      } : undefined);

      const value = this.applyTransforms(rawValue, variable, column, context);

      if (prefix === '#' && value.startsWith('#')) {
        return prefix + value.slice(1);
      }

      return prefix + value;
    });

    if (missingKeys.length > 0) {
      if (strict) {
        const tableName = table?.config?.name || 'unknown';
        throw new Error(
          `[UriResolver] Missing required fields for template "${template}" in table "${tableName}": ` +
          `[${missingKeys.join(', ')}]. ` +
          `Record keys: [${Object.keys(record).join(', ')}]. ` +
          `Record: ${JSON.stringify(record)}`
        );
      }
      // 非严格模式，返回 null 表示无法完全解析
      return null;
    }

    return replaced;
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
    const MM = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const dd = date.getUTCDate().toString().padStart(2, '0');
    const timestamp = Math.floor(date.getTime() / 1000).toString();

    return { date, yyyy, MM, dd, timestamp };
  }

  /**
   * 生成回退 URI
   * 简化版：根据 template 判断模式
   */
  private generateFallbackUri(base: string, template: string, index?: number): string {
    const suffix = index !== undefined ? `row-${index + 1}` : `row-${Date.now()}`;

    // template 以 # 开头是 fragment 模式
    if (template.startsWith('#')) {
      const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
      return `${cleanBase}#${suffix}`;
    }

    // 否则是 document 模式
    const cleanBase = base.endsWith('/') ? base : `${base}/`;
    return `${cleanBase}${suffix}.ttl`;
  }

  /**
   * 从 URI 提取 ID
   * 
   * 简化版：统一使用 base + subjectTemplate 反向解析
   * 
   * 例如：
   * - uri = "http://pod/.data/chat/chat-123/index.ttl#this"
   * - base = "http://pod/.data/chat/"
   * - relativePath = "chat-123/index.ttl#this"
   * - template = "{id}/index.ttl#this"
   * - id = "chat-123"
   */
  private extractRelativeSubjectId(uri: string, table: PodTable): string {
    const tableBase = table.config?.base ?? '';

    // Step 1: 计算相对路径
    // 核心思路：在 URI 中查找 table.config.base，提取其后的部分
    let relativePath: string = '';

    if (tableBase && uri.includes(tableBase)) {
      // 找到 base 在 URI 中的位置，提取之后的部分
      const index = uri.indexOf(tableBase);
      relativePath = uri.substring(index + tableBase.length);
      // 移除开头的 / (如果 base 不以 / 结尾)
      if (relativePath.startsWith('/')) {
        relativePath = relativePath.substring(1);
      }
    } else if (!tableBase) {
      // 没有配置 base，使用整个 URI
      relativePath = uri;
    } else {
      // base 不在 URI 中，说明 URI 格式不匹配
      // 返回空字符串，让后续的 template 匹配失败
      console.warn(`[UriResolver] Cannot extract ID: base "${tableBase}" not found in URI "${uri}"`);
      return '';
    }

    return relativePath;
  }

  private extractPublicId(uri: string, table: PodTable): string {
    return this.extractTemplateIdFromSubject(uri, table) ?? this.extractRelativeSubjectId(uri, table);
  }

  private extractTemplateIdFromSubject(uri: string, table: PodTable): string | null {
    const relativePath = this.extractRelativeSubjectId(uri, table);
    const template = table.config?.subjectTemplate || this.getDefaultPattern(table);
    return template ? this.extractIdFromTemplate(relativePath, template) : null;
  }

  /**
   * 从相对路径反向解析出 id
   * 
   * 将模板转为正则表达式，提取 {id} 对应的值
   * 
   * @param relativePath 相对路径 (如 "chat-123/index.ttl#this")
   * @param template 模板 (如 "{id}/index.ttl#this")
   * @returns 提取的 id (如 "chat-123")，解析失败返回 null
   */
  private extractIdFromTemplate(relativePath: string, template: string): string | null {
    // 构建正则表达式
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
}

// 默认单例实例
