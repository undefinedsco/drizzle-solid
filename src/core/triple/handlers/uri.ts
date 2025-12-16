/**
 * URI Column Handler
 *
 * 处理 uri 类型列，输出 NamedNode 而非 Literal
 * 支持自动补全相对 URI 为完整 URL
 * 
 * URI 解析优先级：
 * 1. 如果已经是绝对 URI，直接使用
 * 2. 如果有 referenceTable（表对象），直接使用该表的 base
 * 3. 如果有 referenceTableName（表名字符串），从 tableNameRegistry 查找
 * 4. 如果有 referenceTarget（class URI），从 tableRegistry 查找（检测歧义）
 * 5. 使用 baseUri 补全
 */

import type { PodColumnBase, PodTable } from '../../pod-table';
import type { ColumnHandler, RdfTerm, BuildResult, BuildContext } from '../types';

// UUID 正则
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * URI 列处理器
 *
 * URI 类型作为 NamedNode，不是 Literal
 * 支持根据 reference 配置自动补全 URI
 */
export class UriHandler implements ColumnHandler {
  readonly name = 'uri';

  canHandle(column: PodColumnBase): boolean {
    return column.dataType === 'uri' || column.isReference();
  }

  /**
   * 检查是否为完整 URI（包含协议头）
   */
  private isAbsoluteUri(uri: string): boolean {
    return uri.includes(':') && (
      uri.startsWith('http://') ||
      uri.startsWith('https://') ||
      uri.startsWith('urn:') ||
      uri.startsWith('did:') ||
      uri.startsWith('mailto:') ||
      uri.startsWith('tel:') ||
      uri.startsWith('file://') ||
      // 其他常见协议
      /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(uri)
    );
  }

  /**
   * 从表获取基础 URL 和 subject template 信息
   */
  private getTableUriInfo(table: PodTable): { baseUrl: string; subjectTemplate: string } | undefined {
    const subjectTemplate = table.config?.subjectTemplate || '{id}.ttl';
    
    // Fragment Mode (#{id}) - 使用 resourcePath（单文件路径）
    if (subjectTemplate.startsWith('#')) {
      // Fragment Mode 需要完整的文件路径作为 base
      const base = table.config?.base;  // base 是 resourcePath，即文件路径
      if (!base) return undefined;
      // Fragment Mode 的 base 应该是完整的文件路径，不以 / 结尾
      const baseUrl = base.endsWith('/') ? base.slice(0, -1) : base;
      return { baseUrl, subjectTemplate };
    }
    
    // Document Mode - 使用容器路径
    // 优先使用 config.containerPath，其次是 getContainerPath()
    const base = table.config?.containerPath || table.getContainerPath?.();
    if (!base) return undefined;
    
    // 确保以 / 结尾（容器路径）
    const baseUrl = base.endsWith('/') ? base : `${base}/`;
    
    return { baseUrl, subjectTemplate };
  }

  /**
   * 根据 reference 配置补全 URI
   * 
   * 解析优先级：
   * 1. referenceTable（表对象）-> 直接使用
   * 2. referenceTableName（表名）-> tableNameRegistry
   * 3. referenceTarget（class URI）-> tableRegistry（检测歧义）
   * 4. baseUri 补全
   */
  private resolveUri(
    value: string,
    column: PodColumnBase,
    context?: BuildContext
  ): string {
    // 如果已经是完整 URI，直接返回
    if (this.isAbsoluteUri(value)) {
      return value;
    }

    // 如果是相对路径（以 / 或 # 开头），用 baseUri 补全
    if (value.startsWith('/') || value.startsWith('#')) {
      if (context?.baseUri) {
        return new URL(value, context.baseUri).toString();
      }
      throw new Error(
        `Cannot resolve relative URI "${value}": no baseUri in context`
      );
    }

    // 优先级 1: 检查 referenceTable（直接引用表对象）
    const referenceTable = column.getReferenceTable?.();
    if (referenceTable) {
      const uriInfo = this.getTableUriInfo(referenceTable);
      if (uriInfo) {
        return this.buildFullUri(value, uriInfo.baseUrl, uriInfo.subjectTemplate);
      }
      // 表对象没有 base，抛出错误
      throw new Error(
        `Cannot resolve URI "${value}": referenced table "${referenceTable.config?.name}" has no base configured.`
      );
    }

    // 优先级 2: 检查 referenceTableName（表名字符串）
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
      // 如果指定了表名但找不到表，抛出错误
      const availableTables = context?.tableNameRegistry 
        ? Array.from(context.tableNameRegistry.keys()).join(', ')
        : '(no tables registered)';
      throw new Error(
        `Cannot resolve URI "${value}": table "${referenceTableName}" not found in schema. ` +
        `Available tables: ${availableTables}`
      );
    }

    // 优先级 3: 尝试根据 referenceTarget (class URI) 查找目标表
    const referenceTarget = column.getReferenceTarget?.();
    if (referenceTarget && context?.tableRegistry) {
      const targetTables = context.tableRegistry.get(referenceTarget);
      
      if (targetTables && targetTables.length > 0) {
        // 检测歧义：同一 class 有多个表
        if (targetTables.length > 1) {
          const tableNames = targetTables
            .map(t => t.config?.name || 'unknown')
            .join(', ');
          throw new Error(
            `Ambiguous reference: class "${referenceTarget}" has multiple tables [${tableNames}]. ` +
            `Use .reference('tableName') or .reference(tableObject) to specify which table to use.`
          );
        }
        
        // 只有一个表，使用它的 base
        const targetTable = targetTables[0];
        const uriInfo = this.getTableUriInfo(targetTable);
        if (uriInfo) {
          return this.buildFullUri(value, uriInfo.baseUrl, uriInfo.subjectTemplate);
        }
      }
    }

    // 优先级 4: 最后尝试用 baseUri 补全
    if (context?.baseUri) {
      const baseUrl = context.baseUri.endsWith('/')
        ? context.baseUri
        : context.baseUri.substring(0, context.baseUri.lastIndexOf('/') + 1);
      return this.buildFullUri(value, baseUrl);
    }

    // 无法补全，抛出友好的错误信息
    const refInfo = column.getReferenceTarget?.()
      ? ` (references ${column.getReferenceTarget()})`
      : '';
    throw new Error(
      `Cannot resolve URI "${value}"${refInfo}. ` +
      `Either provide a full URI (https://...), or ensure the referenced table is in the schema.`
    );
  }

  /**
   * 构建完整 URI
   * 
   * 根据 subjectTemplate 决定 URI 格式：
   * - '{id}.ttl' -> baseUrl + id + '.ttl' (无 fragment)
   * - '{id}.ttl#me' -> baseUrl + id + '.ttl#me'
   * - '{id}.ttl#it' -> baseUrl + id + '.ttl#it'
   * - '#{id}' -> baseUrl (去掉尾部/) + '#' + id (fragment 模式)
   */
  private buildFullUri(value: string, baseUrl: string, subjectTemplate: string = '{id}.ttl'): string {
    // 如果不是 UUID/ID 格式，直接拼接
    if (!UUID_REGEX.test(value) && value.includes('/')) {
      return `${baseUrl}${value}`;
    }

    // 用 value 替换模板中的 {id}
    let result = subjectTemplate.replace(/\{id\}/g, value);
    
    // 如果替换后的结果已经是完整 URL，直接返回
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

  formatValue(value: unknown, column: PodColumnBase, context?: BuildContext): RdfTerm {
    const uri = String(value);
    const resolved = this.resolveUri(uri, column, context);

    return {
      termType: 'NamedNode',
      value: resolved,
    };
  }

  parseValue(term: RdfTerm, _column: PodColumnBase): unknown {
    return term.value;
  }

  buildTriples(
    subject: string,
    predicate: string,
    value: unknown,
    column: PodColumnBase,
    _table: PodTable,
    context: BuildContext
  ): BuildResult {
    const objectTerm = this.formatValue(value, column, context);

    return {
      triples: [
        {
          subject: { termType: 'NamedNode', value: subject },
          predicate: { termType: 'NamedNode', value: predicate },
          object: objectTerm,
        },
      ],
    };
  }
}
