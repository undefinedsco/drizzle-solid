/**
 * Subject Resolver Implementation
 *
 * 统一的主体 URI 生成和解析
 */

import type { PodTable } from '../schema';
import type { SubjectResolver, ResourceMode, ParsedSubject, TimeContext } from './types';

/**
 * 固定的单例 fragment 列表
 */
const SINGLETON_FRAGMENTS = new Set(['#me', '#this', '#profile', '#card']);

/**
 * 主体 URI 解析器实现
 */
export class SubjectResolverImpl implements SubjectResolver {
  private podUrl: string;

  constructor(podUrl: string = '') {
    this.podUrl = podUrl.replace(/\/$/, '');
  }

  /**
   * 设置 Pod URL
   */
  setPodUrl(podUrl: string): void {
    this.podUrl = podUrl.replace(/\/$/, '');
  }

  /**
   * 生成主体 URI
   */
  resolve(table: PodTable, record: Record<string, unknown>, index?: number): string {
    // Check if record has an absolute ID override
    const explicitId = record['@id'] ?? record['id'] ?? record['uri'];
    if (typeof explicitId === 'string') {
      if (explicitId.startsWith('http://') || explicitId.startsWith('https://')) {
        return explicitId;
      }
      // Check if it's a relative URI with fragment (e.g. "file.ttl#id") that matches our resource mode
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
    const base = this.getBaseUrl(table);

    // 单例模式 - 直接返回 base + pattern
    if (this.isSingleton(table)) {
      return this.combineBaseAndPattern(base, pattern);
    }

    // 应用模板变量
    const applied = this.applyTemplate(pattern, record, index);

    if (applied) {
      if (applied.startsWith('http://') || applied.startsWith('https://')) {
        return applied;
      }
    }

    if (!applied) {
      // 如果模板应用失败，生成默认 URI
      return this.generateFallbackUri(base, mode, index);
    }

    return this.combineBaseAndPattern(base, applied);
  }

  /**
   * 解析主体 URI
   */
  parse(uri: string, table: PodTable): ParsedSubject | null {
    if (!uri) return null;

    const hashIndex = uri.indexOf('#');
    const hasFragment = hashIndex !== -1;

    const resourceUrl = hasFragment ? uri.slice(0, hashIndex) : uri;
    const fragment = hasFragment ? uri.slice(hashIndex + 1) : undefined;

    // 确定模式
    const mode = this.getResourceMode(table);

    // 提取 ID
    const id = this.extractId(uri, table);

    return {
      uri,
      resourceUrl,
      fragment,
      id,
      mode,
    };
  }

  /**
   * 获取资源 URL (用于 HTTP 请求)
   */
  getResourceUrl(subjectUri: string): string {
    const hashIndex = subjectUri.indexOf('#');
    return hashIndex !== -1 ? subjectUri.slice(0, hashIndex) : subjectUri;
  }

  /**
   * 判断资源模式
   *
   * Document mode: 每条记录一个独立文件 (e.g., /data/users/alice.ttl)
   * Fragment mode: 所有记录共享一个文件，用 URI fragment 区分 (e.g., /data/tags.ttl#tag-1)
   */
  getResourceMode(table: PodTable): ResourceMode {
    // 只有用户显式提供 subjectTemplate 时才用它来判断
    const hasCustomTemplate = table.hasCustomTemplate?.() ?? false;

    if (hasCustomTemplate) {
      const pattern = table.config?.subjectTemplate ?? '';

      // pattern 以 # 开头 → fragment 模式
      // 例如: '#me', '#{id}'
      if (pattern.startsWith('#')) {
        return 'fragment';
      }

      // pattern 不以 # 开头但包含文件扩展名 → document 模式
      // 例如: '{id}.ttl', '{yyyy}/{MM}/{slug}.ttl'
      if (pattern.includes('.ttl') || pattern.includes('.jsonld') || pattern.includes('.json')) {
        return 'document';
      }

      // 其他 pattern (如 '{id}') → document 模式
      return 'document';
    }

    // 无自定义 pattern 时，使用 containerPath 来判断原始 base 的意图
    const containerPath = table.getContainerPath();
    const tableName = table.config?.name ?? '';

    // PodTable 的 resolveBase 逻辑:
    // - base='/data/users/' (以 / 结尾) → containerPath='/data/users/', resourcePath='/data/users/users.ttl'
    // - base='/data/tags.ttl' (文件路径) → containerPath='/data/', resourcePath='/data/tags.ttl'
    //
    // 区分方法: 如果 containerPath 以 tableName + '/' 结尾，则原始 base 是容器 → document 模式
    // 例如: containerPath='/data/users/' 对于 tableName='users' → 以 'users/' 结尾 → document
    // 例如: containerPath='/data/' 对于 tableName='tags' → 不以 'tags/' 结尾 → fragment

    const normalizedContainer = containerPath.endsWith('/') ? containerPath : `${containerPath}/`;

    // 检查 containerPath 是否以 tableName/ 结尾
    if (normalizedContainer.endsWith(`${tableName}/`)) {
      return 'document';
    }

    // containerPath 不含 tableName，说明原始 base 是文件路径 → fragment 模式
    return 'fragment';
  }

  /**
   * 规范化路径用于比较
   */
  private normalizePath(path: string): string {
    if (!path) return '/';
    // 移除协议前缀进行比较
    const withoutProtocol = path.replace(/^https?:\/\/[^/]+/, '');
    // 确保以 / 开头
    return withoutProtocol.startsWith('/') ? withoutProtocol : `/${withoutProtocol}`;
  }

  /**
   * 获取默认的 subjectPattern
   * 与 PodTable.buildDefaultSubjectTemplate 保持一致
   */
  getDefaultPattern(table: PodTable): string {
    const mode = this.getResourceMode(table);

    if (mode === 'fragment') {
      return '#{id}';
    }

    // document 模式默认不带 fragment
    return '{id}.ttl';
  }

  /**
   * 生成内联对象的 URI (始终为 fragment)
   */
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

  /**
   * 检查是否为单例模式
   */
  isSingleton(table: PodTable): boolean {
    const pattern = table.config?.subjectTemplate;

    if (!pattern) return false;

    // 固定 fragment (不含变量)
    if (SINGLETON_FRAGMENTS.has(pattern)) {
      return true;
    }

    // pattern 不含任何 {} 变量
    if (!pattern.includes('{')) {
      return true;
    }

    return false;
  }

  /**
   * 获取有效的 pattern
   *
   * 只有用户显式提供 subjectTemplate 时才使用它，
   * 否则根据资源模式返回默认 pattern
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
   * 获取 base URL
   *
   * Document mode: 返回 containerPath (用于拼接 {id}.ttl)
   * Fragment mode: 返回 resourcePath (用于拼接 #{id})
   */
  private getBaseUrl(table: PodTable): string {
    const mode = this.getResourceMode(table);

    if (mode === 'document') {
      // document 模式使用 containerPath
      const containerPath = table.getContainerPath();
      return this.toAbsoluteUrl(containerPath);
    }

    // fragment 模式使用 resourcePath
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

    // 已经是绝对 URL
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }

    // 相对路径，拼接到 podUrl
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${this.podUrl}${normalizedPath}`;
  }

  /**
   * 合并 base 和 pattern
   */
  private combineBaseAndPattern(base: string, pattern: string): string {
    // pattern 以 # 开头 - fragment
    if (pattern.startsWith('#')) {
      const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
      return `${cleanBase}${pattern}`;
    }

    // base 以 / 结尾 - 直接拼接
    if (base.endsWith('/')) {
      return `${base}${pattern}`;
    }

    // base 是文件 (.ttl)，pattern 是 fragment
    if ((base.endsWith('.ttl') || base.endsWith('.jsonld')) && pattern.startsWith('#')) {
      return `${base}${pattern}`;
    }

    // 其他情况，base 后加 /
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

    // 获取时间上下文
    const timeContext = this.createTimeContext(record);

    let missingReplacement = false;

    // Regex to capture optional preceding '#' and the key inside {}
    const replaced = template.replace(/(#?)\{([^}]+)\}/g, (match, prefix, key) => {
      // 时间变量
      if (key in timeContext) {
        return prefix + (timeContext[key as keyof TimeContext] as string);
      }

      // 特殊变量: index
      if (key === 'index' && index !== undefined) {
        return prefix + String(index + 1);
      }

      // 记录字段
      let rawValue = record[key];
      if (key === 'id' && (rawValue === undefined || rawValue === null)) {
        rawValue = record['@id'] ?? record['uri'];
      }

      if (rawValue === undefined || rawValue === null) {
        missingReplacement = true;
        // Return empty string to allow other replacements to proceed if possible, 
        // but flag missingReplacement to fail eventually.
        return ''; 
      }

      let value = String(rawValue);
      
      // Handle double hash: if prefix is '#' and value starts with '#', strip one '#'
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
    // 尝试从记录中获取日期
    let date: Date;

    const createdAt = record['createdAt'] ?? record['created_at'] ?? record['dateCreated'];
    if (createdAt instanceof Date) {
      date = createdAt;
    } else if (typeof createdAt === 'string' || typeof createdAt === 'number') {
      date = new Date(createdAt);
    } else {
      date = new Date();
    }

    // 使用 UTC 时间
    const yyyy = date.getUTCFullYear().toString();
    const MM = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const dd = date.getUTCDate().toString().padStart(2, '0');
    const timestamp = Math.floor(date.getTime() / 1000).toString();

    return { date, yyyy, MM, dd, timestamp };
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
   * 
   * 两步解析：
   * 1. 先计算 relativePath = uri - baseUrl
   * 2. 再根据 subjectTemplate 反向解析出 {id}
   * 
   * 例如：
   * - uri = "http://pod/users/alice.ttl#it", template = "{id}.ttl#it" → id = "alice"
   * - uri = "http://pod/tags.ttl#tag-1", template = "#{id}" → id = "tag-1"
   */
  private extractId(uri: string, table: PodTable): string {
    const baseUrl = this.getBaseUrl(table);
    
    // Step 1: 计算相对路径
    let relativePath: string;
    if (uri.startsWith(baseUrl)) {
      relativePath = uri.substring(baseUrl.length);
    } else {
      // Fallback: 尝试其他方式
      const mode = this.getResourceMode(table);
      const hashIndex = uri.indexOf('#');

      if (mode === 'fragment' && hashIndex !== -1) {
        relativePath = uri.slice(hashIndex);
      } else {
        const lastSlash = uri.lastIndexOf('/');
        relativePath = lastSlash !== -1 ? uri.slice(lastSlash + 1) : uri;
      }
    }

    // Step 2: 根据 subjectTemplate 反向解析 {id}
    const template = this.getEffectivePattern(table);
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
   * @param relativePath 相对路径 (如 "alice.ttl#it")
   * @param template 模板 (如 "{id}.ttl#it")
   * @returns 提取的 id (如 "alice")，解析失败返回 null
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

// 默认实例
