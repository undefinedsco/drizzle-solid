import { entityKind } from 'drizzle-orm';
import { SQL } from 'drizzle-orm';

// 命名空间配置
export interface NamespaceConfig {
  prefix: string;
  uri: string;
}

// 预定义的常用命名空间
// 列配置选项
export interface PodColumnOptions {
  primaryKey?: boolean;
  required?: boolean;
  defaultValue?: unknown;
  predicate?: string; // 可选的自定义 predicate
  referenceTarget?: string; // 引用的目标 RDF 类
  notNull?: boolean;
}

// 添加PodColumn接口扩展
export interface PodColumnInterface {
  name: string;
  dataType: 'string' | 'integer' | 'datetime' | 'boolean';
  options: PodColumnOptions;
  predicate?: string;  // RDF谓词URI
}

// 修复的ColumnBuilder，避免属性与方法命名冲突
export type ColumnBuilderDataType = 'string' | 'integer' | 'datetime' | 'boolean' | 'json' | 'object';

type RdfTermInput = string | { value: string } | { term?: { value: string } };

const hasStringValue = (input: unknown): input is { value: string } =>
  typeof input === 'object' && input !== null && typeof (input as Record<string, unknown>).value === 'string';

const hasTermValue = (input: unknown): input is { term: { value: string } } =>
  typeof input === 'object' && input !== null &&
  typeof (input as Record<string, unknown>).term === 'object' &&
  (input as Record<string, { value?: string }>).term !== null &&
  typeof (input as Record<string, { value?: string }>).term?.value === 'string';

const resolveTermIri = (input: RdfTermInput): string => {
  if (typeof input === 'string') {
    return input;
  }
  if (hasStringValue(input)) {
    return input.value;
  }
  if (hasTermValue(input)) {
    return input.term.value;
  }
  throw new Error('Term must be a string or VocabTerm with a string value');
};

export class ColumnBuilder<TType extends ColumnBuilderDataType> {
  public options: PodColumnOptions;
  private _predicateUri?: string; // 重命名单独属性

  constructor(
    public readonly name: string,
    public readonly dataType: TType,
    options: PodColumnOptions = {},
    predicate?: string
  ) {
    this.options = { ...options }; // 复制options避免引用问题
    this._predicateUri = predicate;
  }

  primaryKey(): ColumnBuilder<TType> {
    this.options = { ...this.options, primaryKey: true, required: true };
    return this;
  }

  notNull(): ColumnBuilder<TType> {
    this.options = { ...this.options, required: true, notNull: true };
    return this;
  }

  predicate(uri: RdfTermInput): ColumnBuilder<TType> {
    const resolved = resolveTermIri(uri);
    this._predicateUri = resolved;
    this.options = { ...this.options, predicate: resolved };
    return this;
  }

  default(value: unknown): ColumnBuilder<TType> {
    this.options = { ...this.options, defaultValue: value };
    return this;
  }

  reference(target: string): ColumnBuilder<TType> {
    this.options = { ...this.options, referenceTarget: target };
    return this;
  }

  // method to get predicate URI
  getPredicateUri(): string | undefined {
    return this._predicateUri;
  }
}

// 类型辅助函数 - 模仿 Drizzle 的设计
// 简化的类型定义 - 移除品牌类型系统

// 类型推断工具函数 - 基于 dataType 属性推断
export type InferColumnType<T extends PodColumnBase> =
  T extends { dataType: 'string' } ? string :
  T extends { dataType: 'integer' } ? number :
  T extends { dataType: 'boolean' } ? boolean :
  T extends { dataType: 'datetime' } ? Date :
  T extends { dataType: 'json' } ? unknown :
  T extends { dataType: 'object' } ? Record<string, unknown> :
  unknown;

// 推断表的数据类型
export type InferTableData<TTable extends PodTable<Record<string, PodColumnBase>>> = {
  [K in keyof TTable['columns']]: InferColumnType<TTable['columns'][K]>
};

// 推断插入数据类型（简化版本，所有字段都可选）
export type InferInsertData<TTable extends PodTable<Record<string, PodColumnBase>>> = {
  [K in keyof TTable['columns']]?: InferColumnType<TTable['columns'][K]>
};

// 推断更新数据类型（所有列都可选）
export type InferUpdateData<TTable extends PodTable<Record<string, PodColumnBase>>> = {
  [K in keyof TTable['columns']]?: InferColumnType<TTable['columns'][K]> | null
};

// 表配置选项
export interface PodTableOptions {
  resourcePath: string;
  rdfClass: RdfTermInput;
  namespace?: NamespaceConfig; // 默认命名空间
  autoRegister?: boolean;
  /** @deprecated 将在未来版本移除，请使用 resourcePath 上的 `sparql:` 前缀 */
  resourceMode?: 'ldp' | 'sparql';
  /** @deprecated 将在未来版本移除，请使用 resourcePath 上的 `sparql:` 前缀 */
  sparqlEndpoint?: string;
  /** @deprecated 自动从 resourcePath 推导，无需手动指定 */
  containerPath?: string;
}

// 列类型基类
export abstract class PodColumnBase {
  static readonly [entityKind] = 'PodColumn';
  
  constructor(
    public name: string,
    public dataType: string,
    public options: PodColumnOptions = {},
    public tableName?: string
  ) {}

  table?: PodTable<any>;

  // 获取 RDF 谓词
  getPredicate(tableNamespace?: NamespaceConfig): string {
    if (this.options.predicate) {
      return this.options.predicate;
    }

    if (tableNamespace) {
      return `${tableNamespace.uri}${this.name}`;
    }
    throw new Error(`Missing predicate for column "${this.name}"; please set namespace or predicate explicitly.`);
  }

  // 检查是否是引用类型
  isReference(): boolean {
    return !!this.options.referenceTarget;
  }

  // 获取引用目标
  getReferenceTarget(): string | undefined {
    return this.options.referenceTarget;
  }

  // 链式方法 - 简化版本，直接返回 this
  primaryKey(): this {
    this.options.primaryKey = true;
    this.options.required = true; // 主键自动为 required
    return this;
  }

  notNull(): this {
    this.options.required = true;
    return this;
  }

  default(value: unknown): this {
    this.options.defaultValue = value;
    return this;
  }

  predicate(uri: RdfTermInput): this {
    this.options.predicate = resolveTermIri(uri);
    return this;
  }

  reference(targetClass: string): this {
    this.options.referenceTarget = targetClass;
    return this;
  }
}

export type PodColumn = PodColumnBase;

// 具体的列类型
export class PodStringColumn extends PodColumnBase {
  constructor(name: string, options: PodColumnOptions = {}) {
    super(name, 'string', options);
  }
}

export class PodIntegerColumn extends PodColumnBase {
  constructor(name: string, options: PodColumnOptions = {}) {
    super(name, 'integer', options);
  }
}

export class PodBooleanColumn extends PodColumnBase {
  constructor(name: string, options: PodColumnOptions = {}) {
    super(name, 'boolean', options);
  }
}

export class PodDateTimeColumn extends PodColumnBase {
  constructor(name: string, options: PodColumnOptions = {}) {
    super(name, 'datetime', options);
  }
}

export class PodJsonColumn extends PodColumnBase {
  constructor(name: string, options: PodColumnOptions = {}) {
    super(name, 'json', options);
  }
}

export class PodObjectColumn extends PodColumnBase {
  constructor(name: string, options: PodColumnOptions = {}) {
    super(name, 'object', options);
  }
}


// 表定义类 - 支持泛型以进行类型推断
export class PodTable<TColumns extends Record<string, PodColumnBase> = Record<string, PodColumnBase>> {
  static readonly [entityKind] = 'PodTable';
  
  public config: {
    name: string;
    containerPath: string;
    resourcePath: string;
    rdfClass: string;
    namespace?: NamespaceConfig;
    autoRegister: boolean;
    resourceMode: 'ldp' | 'sparql';
    sparqlEndpoint?: string;
  };
  
  public columns: TColumns;

  // 为了兼容 drizzle-zod，添加必要的属性
  public readonly $inferSelect: InferTableData<PodTable<TColumns>>;
  public readonly $inferInsert: InferInsertData<PodTable<TColumns>>;
  public readonly $inferUpdate: InferUpdateData<PodTable<TColumns>>;

  // 添加 drizzle-zod 需要的 _ 属性
  public readonly _: {
    readonly brand: 'Table';
    readonly config: PodTableOptions;
    readonly name: string;
    readonly schema: string | undefined;
    readonly columns: TColumns;
    readonly inferSelect: InferTableData<PodTable<TColumns>>;
    readonly inferInsert: InferInsertData<PodTable<TColumns>>;
    readonly inferUpdate: InferUpdateData<PodTable<TColumns>>;
  };

  constructor(
    name: string,
    columns: TColumns,
    options: PodTableOptions
  ) {
    const resourceConfig = this.resolveResourceConfig(options);

    this.config = {
      name,
      containerPath: resourceConfig.containerPath,
      resourcePath: resourceConfig.resourcePath,
      rdfClass: resolveTermIri(options.rdfClass),
      namespace: options.namespace,
      autoRegister: options.autoRegister !== false,
      resourceMode: resourceConfig.mode,
      sparqlEndpoint: resourceConfig.sparqlEndpoint
    };
    
    this.columns = columns;

    // 将列直接添加到表对象上，以便直接访问
    Object.assign(this, columns);

    // 记录列所属的表，便于 JOIN/分组等语义解析
    for (const column of Object.values(columns)) {
      column.table = this;
      column.tableName = name;
    }

    // 初始化 drizzle-zod 兼容的属性
    this.$inferSelect = {} as InferTableData<PodTable<TColumns>>;
    this.$inferInsert = {} as InferInsertData<PodTable<TColumns>>;
    this.$inferUpdate = {} as InferUpdateData<PodTable<TColumns>>;

    // 初始化 _ 属性
    this._ = {
      brand: 'Table' as const,
      config: this.config,
      name,
      schema: undefined,
      columns,
      inferSelect: {} as InferTableData<PodTable<TColumns>>,
      inferInsert: {} as InferInsertData<PodTable<TColumns>>,
      inferUpdate: {} as InferUpdateData<PodTable<TColumns>>
    };
  }

  // 添加 drizzle-zod 需要的 getSQL 方法
  getSQL(): SQL {
    return {
      queryChunks: [this.config.name],
      params: []
    } as unknown as SQL;
  }

  // 获取容器路径
  getContainerPath(): string {
    return this.config.containerPath;
  }

  // 获取 RDF 类
  getRdfClass(): string {
    return this.config.rdfClass;
  }

  // 获取命名空间
  getNamespace(): NamespaceConfig | undefined {
    return this.config.namespace;
  }

  private resolveResourceConfig(options: PodTableOptions): {
    mode: 'ldp' | 'sparql';
    resourcePath: string;
    containerPath: string;
    sparqlEndpoint?: string;
  } {
    const rawPath = options.resourcePath.trim();
    const explicitMode = options.resourceMode;
    const containerOverride = options.containerPath?.trim();

    const { scheme, path } = this.parseResourcePath(rawPath);

    let sparqlEndpoint = options.sparqlEndpoint?.trim();
    if (!sparqlEndpoint && scheme === 'sparql') {
      sparqlEndpoint = path;
    }

    if (!sparqlEndpoint && !explicitMode && rawPath.startsWith('sparql:')) {
      sparqlEndpoint = rawPath.replace(/^sparql:\s*/, '').trim();
    }

    const inferModeFromScheme = (): 'ldp' | 'sparql' => {
      if (scheme === 'sparql') return 'sparql';
      if (scheme === 'idp' || scheme === 'ldp' || scheme === 'pod' || scheme === undefined) {
        return 'ldp';
      }
      return 'ldp';
    };

    const mode: 'ldp' | 'sparql' = explicitMode ?? (sparqlEndpoint ? 'sparql' : inferModeFromScheme());

    if (mode === 'sparql') {
      const endpointSource = sparqlEndpoint && sparqlEndpoint.length > 0
        ? sparqlEndpoint
        : path;

      const endpoint = this.normalizeSparqlEndpoint(endpointSource);

      if (!endpoint || endpoint.length === 0) {
        throw new Error('SPARQL tables require an endpoint (resourcePath can start with "sparql:")');
      }
      return {
        mode: 'sparql',
        resourcePath: endpoint,
        containerPath: containerOverride ? this.ensureTrailingSlash(containerOverride) : '/',
        sparqlEndpoint: endpoint
      };
    }

    const normalizedPath = this.normalizeResourcePath(path);
    return {
      mode: 'ldp',
      resourcePath: normalizedPath,
      containerPath: containerOverride
        ? this.ensureTrailingSlash(containerOverride)
        : this.ensureTrailingSlash(this.deriveContainerPath(normalizedPath))
    };
  }

  private parseResourcePath(rawPath: string): { scheme?: string; path: string } {
    const trimmed = rawPath.trim();
    if (trimmed.length === 0) {
      throw new Error('podTable requires a non-empty resourcePath');
    }

    const schemeMatch = trimmed.match(/^([a-zA-Z][\w+.-]*):\/\/(.*)$/);
    if (schemeMatch) {
      const [, scheme, remainder] = schemeMatch;
      const remainderTrimmed = remainder.trim();
      const normalizedScheme = scheme.toLowerCase();

      if (normalizedScheme === 'http' || normalizedScheme === 'https') {
        const rest = remainderTrimmed.length === 0 ? '' : remainderTrimmed;
        return { scheme: normalizedScheme, path: `${normalizedScheme}://${rest}` };
      }

      const normalizedRemainder = remainderTrimmed.length === 0 ? '/' : remainderTrimmed;
      return { scheme: normalizedScheme, path: normalizedRemainder.startsWith('/') ? normalizedRemainder : `/${normalizedRemainder}` };
    }

    if (trimmed.startsWith('sparql:')) {
      const remainder = trimmed.replace(/^sparql:\s*/, '').trim();
      return { scheme: 'sparql', path: remainder.length === 0 ? '/' : remainder };
    }

    return { path: trimmed };
  }

  private normalizeSparqlEndpoint(endpoint: string): string {
    const trimmed = endpoint.trim();
    if (trimmed.length === 0) {
      return trimmed;
    }

    if (/^[a-zA-Z][\w+.-]*:\/\//.test(trimmed)) {
      return trimmed;
    }

    const normalized = trimmed.startsWith('/') ? trimmed : trimmed.replace(/^\.\/?/, '/');
    return this.normalizeResourcePath(normalized);
  }

  private normalizeResourcePath(resourcePath: string): string {
    if (typeof resourcePath !== 'string' || resourcePath.trim().length === 0) {
      throw new Error('podTable requires a non-empty resourcePath');
    }
    if (/^[a-zA-Z][\w+.-]*:\/\//.test(resourcePath)) {
      return resourcePath;
    }

    const trimmed = resourcePath.trim().replace(/^(\.\/)+/, '');
    const normalized = trimmed.replace(/\/+/g, '/');
    if (normalized.startsWith('/')) {
      return normalized;
    }
    return `/${normalized}`;
  }

  private deriveContainerPath(resourcePath: string): string {
    const withoutTrailingSlash = resourcePath.endsWith('/')
      ? resourcePath.slice(0, -1)
      : resourcePath;
    const lastSlash = withoutTrailingSlash.lastIndexOf('/');
    if (lastSlash === -1) {
      return '/';
    }
    return withoutTrailingSlash.slice(0, lastSlash + 1);
  }

  private ensureTrailingSlash(path: string): string {
    return path.endsWith('/') ? path : `${path}/`;
  }

  // 获取资源访问模式
  getResourceMode(): 'ldp' | 'sparql' {
    return this.config.resourceMode;
  }

  // 获取 SPARQL 端点（仅在 resourceMode === 'sparql' 时使用）
  getSparqlEndpoint(): string | undefined {
    return this.config.sparqlEndpoint;
  }

  getResourcePath(): string {
    return this.config.resourcePath;
  }

  // 获取所有列
  getColumns(): Record<string, PodColumnBase> {
    return this.columns;
  }

  // 获取指定列
  getColumn(name: string): PodColumnBase | undefined {
    return this.columns[name];
  }

  // 检查列是否存在
  hasColumn(name: string): boolean {
    return name in this.columns;
  }
}

// 便捷的列定义函数 - 类似标准 Drizzle API
export function text(name: string, options: PodColumnOptions = {}): ColumnBuilder<'string'> {
  return new ColumnBuilder(name, 'string', options);
}

export function varchar(name: string, options: PodColumnOptions = {}): ColumnBuilder<'string'> {
  return new ColumnBuilder(name, 'string', options);
}

export function boolean(name: string, options: PodColumnOptions = {}): ColumnBuilder<'boolean'> {
  return new ColumnBuilder(name, 'boolean', options);
}

export function timestamp(name: string, options: PodColumnOptions = {}): ColumnBuilder<'datetime'> {
  return new ColumnBuilder(name, 'datetime', options);
}

export function datetime(name: string, options: PodColumnOptions = {}): ColumnBuilder<'datetime'> {
  return new ColumnBuilder(name, 'datetime', options);
}

export function json(name: string, options: PodColumnOptions = {}): ColumnBuilder<'json'> {
  return new ColumnBuilder(name, 'json', options);
}

export function object(name: string, options: PodColumnOptions = {}): ColumnBuilder<'object'> {
  return new ColumnBuilder(name, 'object', options);
}

// Pod 专用的列定义函数（保留向后兼容）
export function podString(name: string, options: PodColumnOptions = {}): PodStringColumn {
  return new PodStringColumn(name, options);
}

export function podInteger(name: string, options: PodColumnOptions = {}): PodIntegerColumn {
  return new PodIntegerColumn(name, options);
}

export function podBoolean(name: string, options: PodColumnOptions = {}): PodBooleanColumn {
  return new PodBooleanColumn(name, options);
}

export function podDateTime(name: string, options: PodColumnOptions = {}): PodDateTimeColumn {
  return new PodDateTimeColumn(name, options);
}

export function podJson(name: string, options: PodColumnOptions = {}): PodJsonColumn {
  return new PodJsonColumn(name, options);
}

export function podObject(name: string, options: PodColumnOptions = {}): PodObjectColumn {
  return new PodObjectColumn(name, options);
}

// 创建类型安全的builder函数
export function string(name: string, options: PodColumnOptions = {}): ColumnBuilder<'string'> {
  return new ColumnBuilder(name, 'string', options);
}

export function int(name: string, options: PodColumnOptions = {}): ColumnBuilder<'integer'> {
  return new ColumnBuilder(name, 'integer', options);
}

export function integer(name: string, options: PodColumnOptions = {}): ColumnBuilder<'integer'> {
  return new ColumnBuilder(name, 'integer', options);
}

export function date(name: string, options: PodColumnOptions = {}): ColumnBuilder<'datetime'> {
  return new ColumnBuilder(name, 'datetime', options);
}


// 类型安全的podTable函数
type ColumnInput = PodColumnBase | ColumnBuilder<ColumnBuilderDataType>;

type ResolveColumn<T> = T extends ColumnBuilder<'string'> ? PodStringColumn
  : T extends ColumnBuilder<'integer'> ? PodIntegerColumn
  : T extends ColumnBuilder<'boolean'> ? PodBooleanColumn
  : T extends ColumnBuilder<'datetime'> ? PodDateTimeColumn
  : T extends ColumnBuilder<'json'> ? PodJsonColumn
  : T extends ColumnBuilder<'object'> ? PodObjectColumn
  : T extends PodColumnBase ? T
  : PodColumnBase;

type ResolvedColumns<T extends Record<string, ColumnInput>> = {
  [K in keyof T]: ResolveColumn<T[K]>;
};

export function podTable<
  TName extends string,
  TColumns extends Record<string, ColumnInput>
>(
  name: TName,
  columns: TColumns,
  options: PodTableOptions
): PodTable<ResolvedColumns<TColumns>> {
  const processedColumns = {} as Record<string, PodColumnBase>;

  for (const [key, value] of Object.entries(columns)) {
    let column: PodColumnBase;

    if (value instanceof PodColumnBase) {
      column = value;
    } else {
      // ColumnBuilder 情况
      switch (value.dataType) {
        case 'integer':
          column = new PodIntegerColumn(value.name, value.options);
          break;
        case 'datetime':
          column = new PodDateTimeColumn(value.name, value.options);
          break;
        case 'boolean':
          column = new PodBooleanColumn(value.name, value.options);
          break;
        case 'json':
          column = new PodJsonColumn(value.name, value.options);
          break;
        case 'object':
          column = new PodObjectColumn(value.name, value.options);
          break;
        case 'string':
        default:
          column = new PodStringColumn(value.name, value.options);
          break;
      }

      const predicateUri = value.getPredicateUri();
      if (predicateUri) {
        column.predicate(predicateUri);
      }
    }

    processedColumns[key] = column;
  }

  return new PodTable(name, processedColumns as ResolvedColumns<TColumns>, options);
}


// 常用的 RDF 谓词常量
export const RDF_PREDICATES = {
  // Schema.org 常用谓词
  SCHEMA_NAME: 'https://schema.org/name',
  SCHEMA_EMAIL: 'https://schema.org/email',
  SCHEMA_IDENTIFIER: 'https://schema.org/identifier',
  SCHEMA_DATE_CREATED: 'https://schema.org/dateCreated',
  SCHEMA_DATE_MODIFIED: 'https://schema.org/dateModified',
  SCHEMA_DESCRIPTION: 'https://schema.org/description',
  SCHEMA_URL: 'https://schema.org/url',
  SCHEMA_TITLE: 'https://schema.org/title',
  SCHEMA_TEXT: 'https://schema.org/text',
  SCHEMA_AUTHOR: 'https://schema.org/author',
  SCHEMA_DATE_PUBLISHED: 'https://schema.org/datePublished',
  
  // FOAF 常用谓词
  FOAF_NAME: 'http://xmlns.com/foaf/0.1/name',
  FOAF_MBOX: 'http://xmlns.com/foaf/0.1/mbox',
  FOAF_HOMEPAGE: 'http://xmlns.com/foaf/0.1/homepage',
  
  // Dublin Core 常用谓词
  DC_TITLE: 'http://purl.org/dc/terms/title',
  DC_DESCRIPTION: 'http://purl.org/dc/terms/description',
  DC_CREATED: 'http://purl.org/dc/terms/created',
  DC_MODIFIED: 'http://purl.org/dc/terms/modified',
} as const;

// 常用的 RDF 类型常量
export const RDF_CLASSES = {
  // Schema.org 常用类型
  SCHEMA_PERSON: 'https://schema.org/Person',
  SCHEMA_BLOG_POSTING: 'https://schema.org/BlogPosting',
  SCHEMA_ARTICLE: 'https://schema.org/Article',
  SCHEMA_ORGANIZATION: 'https://schema.org/Organization',
  SCHEMA_EVENT: 'https://schema.org/Event',
  SCHEMA_PLACE: 'https://schema.org/Place',
  
  // FOAF 常用类型
  FOAF_PERSON: 'http://xmlns.com/foaf/0.1/Person',
  FOAF_ORGANIZATION: 'http://xmlns.com/foaf/0.1/Organization',
  
  // 自定义应用类型示例
  APP_USER: 'https://myapp.com/vocab#User',
  APP_POST: 'https://myapp.com/vocab#Post',
  APP_COMMENT: 'https://myapp.com/vocab#Comment',
  APP_TAG: 'https://myapp.com/vocab#Tag',
} as const;

// 类型导出
export type PodColumnType = PodStringColumn | PodIntegerColumn | PodBooleanColumn | PodDateTimeColumn;
