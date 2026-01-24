/**
 * URI Resolver Implementation
 *
 * 统一的 URI 生成和解析
 * 整合了 Subject URI 和 Object/Reference URI 的解析逻辑
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
      // Check if it's a relative URI with fragment
      const hashIndex = explicitId.indexOf('#');
      if (hashIndex > 0) {
        const template = this.getEffectivePattern(table);
        if (template.startsWith('#')) {
          record = { ...record, id: explicitId.slice(hashIndex + 1) };
        }
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

    const id = this.extractId(uri, table);
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

  /**
   * 从引用 URI 中提取 ID
   * 
   * 用于读取时将完整 URI 转换回简单 ID
   * 
   * @param uri 完整的 URI (如 http://pod/.data/chat/chat-123/index.ttl#this)
   * @param column 引用列定义
   * @param context URI 上下文（包含表注册表）
   * @returns 提取的 ID (如 chat-123)，如果无法解析则返回原 URI
   */
  extractReferenceId(uri: string, column: PodColumnBase | any, context?: UriContext): string {
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
    const parsed = this.parseSubject(uri, targetTable);
    if (parsed && parsed.id) {
      return parsed.id;
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
    const cleanBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    return `${cleanBase}${result}`;
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
   * 特别处理：如果是引用列且值为 URI，则尝试提取 ID
   */
  normalizeValue(value: unknown, column?: PodColumnBase, context?: UriContext): string {
    if (value === undefined || value === null) {
      return '';
    }

    // 处理引用列：如果是引用列且值为 URI，尝试提取 ID
    if (typeof value === 'string' && this.isAbsoluteUri(value)) {
      if (column && this.isReferenceColumn(column)) {
        return this.extractReferenceId(value, column, context);
      }
    }

    return String(value);
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
    strict: boolean = true
  ): string | null {
    if (!template.includes('{')) {
      return template;
    }

    const timeContext = this.createTimeContext(record);
    const missingKeys: string[] = [];

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
        missingKeys.push(key);
        return match; // Keep original placeholder for error message
      }

      const column = (table as any)?.columns?.[key];
      const context = table ? {
        tableRegistry: (table as any)[Symbol.for('drizzle:tableRegistry')],
        tableNameRegistry: (table as any)[Symbol.for('drizzle:tableNameRegistry')]
      } : undefined;

      const value = this.normalizeValue(rawValue, column, context);

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
  private extractId(uri: string, table: PodTable): string {
    const template = table.config?.subjectTemplate || this.getDefaultPattern(table);
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

    // Step 2: 根据 subjectTemplate 反向解析 {id}
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
