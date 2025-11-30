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
  // Array support
  baseType?: ColumnBuilderDataType; // 数组元素的基础类型
  isArray?: boolean; // 是否为数组类型
  inverse?: boolean; // 是否为逆向谓词（<object> predicate <subject>）
}

// 添加PodColumn接口扩展
export interface PodColumnInterface {
  name: string;
  dataType: 'string' | 'integer' | 'datetime' | 'boolean';
  options: PodColumnOptions;
  predicate?: string;  // RDF谓词URI
}

// 修复的ColumnBuilder，避免属性与方法命名冲突
export type ColumnBuilderDataType = 'string' | 'integer' | 'datetime' | 'boolean' | 'json' | 'object' | 'array' | 'uri';

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

export class ColumnBuilder<
  TType extends ColumnBuilderDataType,
  TElement extends ColumnBuilderDataType | null = null,
  TNotNull extends boolean = false,
  THasDefault extends boolean = false
> {
  public options: PodColumnOptions;
  private _predicateUri?: string; // 重命名单独属性
  public readonly elementType: TElement;

  constructor(
    public readonly name: string,
    public readonly dataType: TType,
    options: PodColumnOptions = {},
    predicate?: string,
    elementType?: TElement
  ) {
    this.options = { ...options }; // 复制options避免引用问题
    this._predicateUri = predicate;
    this.elementType = elementType ?? null as TElement;
  }

  // 统一的值格式化方法 - Column 层负责类型转换
  formatValue(value: any): string | string[] {
    if (value === null || value === undefined) {
      throw new Error('Cannot format null or undefined value');
    }

    // 处理数组类型 - 使用多重属性
    if (this.options.isArray) {
      if (!Array.isArray(value)) {
        throw new Error('Array column requires array value');
      }
      // 返回字符串数组，每个元素会作为单独的三元组
      return value.map(item => this.formatSingleValue(item));
    }

    return this.formatSingleValue(value);
  }

  // 格式化单个值
  private formatSingleValue(value: any): string {
    const effectiveType = this.options.isArray && this.elementType ? this.elementType : this.dataType;
    // 处理引用类型
    if (this.options.referenceTarget && typeof value === 'string') {
      return `<${value}>`;
    }

    // 根据数据类型格式化
    switch (effectiveType) {
      case 'string':
        return `"${String(value).replace(/"/g, '\\"')}"`;
      
      case 'integer':
        return String(Number(value));
      
      case 'boolean':
        return `"${value}"^^<http://www.w3.org/2001/XMLSchema#boolean>`;
      
      case 'datetime': {
        const date = value instanceof Date ? value : new Date(value);
        return `"${date.toISOString()}"^^<http://www.w3.org/2001/XMLSchema#dateTime>`;
      }
      
      case 'json':
      case 'object': {
        const jsonString = JSON.stringify(value);
        return `"${jsonString.replace(/"/g, '\\"')}"^^<http://www.w3.org/2001/XMLSchema#json>`;
      }
      
      case 'uri':
        // URI 类型直接作为 NamedNode，不需要引号
        if (typeof value !== 'string' || (!value.startsWith('http://') && !value.startsWith('https://'))) {
          throw new Error(`URI column requires valid HTTP(S) URL, got: ${value}`);
        }
        return `<${value}>`;
      
      default:
        return `"${String(value).replace(/"/g, '\\"')}"`;
    }
  }

  // 统一的值解析方法 - Column 层负责类型解析
  parseValue(rdfValue: string, datatypeIri?: string): any {
    // 处理数组类型在 SPARQL 执行层会返回多个值的数组
    if (this.options.isArray) {
      // 这个方法主要用于解析单个 RDF 值，数组会在查询层处理
      return this.parseSingleValue(rdfValue, datatypeIri);
    }

    return this.parseSingleValue(rdfValue, datatypeIri);
  }

  // 解析单个值
  private parseSingleValue(rdfValue: string, datatypeIri?: string): any {
    if (!datatypeIri) {
      return rdfValue;
    }

    // 根据数据类型和 RDF 类型解析
    if (datatypeIri.includes('#integer') || datatypeIri.includes('#int')) {
      return parseInt(rdfValue, 10);
    } else if (datatypeIri.includes('#decimal') || datatypeIri.includes('#double')) {
      return parseFloat(rdfValue);
    } else if (datatypeIri.includes('#boolean')) {
      return rdfValue === 'true';
    } else if (datatypeIri.includes('#dateTime')) {
      return new Date(rdfValue);
    } else if (datatypeIri.includes('#json')) {
      try {
        return JSON.parse(rdfValue);
      } catch (error) {
        console.warn('Failed to parse JSON value:', rdfValue);
        return rdfValue;
      }
    }

    // URI 类型检测 - 如果看起来像 URI 就直接返回
    if (rdfValue.startsWith('http://') || rdfValue.startsWith('https://')) {
      return rdfValue;
    }

    return rdfValue;
  }

  primaryKey(): ColumnBuilder<TType, TElement, true, THasDefault> {
    const predicate = this.name === 'id'
      ? '@id'
      : this.options.predicate;
    this.options = {
      ...this.options,
      primaryKey: true,
      required: true,
      predicate
    };
    if (predicate) {
      this._predicateUri = predicate;
    }
    return this as unknown as ColumnBuilder<TType, TElement, true, THasDefault>;
  }

  notNull(): ColumnBuilder<TType, TElement, true, THasDefault> {
    this.options = { ...this.options, required: true, notNull: true };
    return this as unknown as ColumnBuilder<TType, TElement, true, THasDefault>;
  }

  predicate(uri: RdfTermInput): ColumnBuilder<TType, TElement, TNotNull, THasDefault> {
    const resolved = resolveTermIri(uri);
    this._predicateUri = resolved;
    this.options = { ...this.options, predicate: resolved };
    return this as unknown as ColumnBuilder<TType, TElement, TNotNull, THasDefault>;
  }

  default(value: unknown): ColumnBuilder<TType, TElement, TNotNull, true> {
    this.options = { ...this.options, defaultValue: value };
    return this as unknown as ColumnBuilder<TType, TElement, TNotNull, true>;
  }

  defaultNow(): ColumnBuilder<TType, TElement, TNotNull, true> {
    this.options = { ...this.options, defaultValue: () => new Date() };
    return this as unknown as ColumnBuilder<TType, TElement, TNotNull, true>;
  }

  inverse(value = true): ColumnBuilder<TType, TElement, TNotNull, THasDefault> {
    this.options = { ...this.options, inverse: value };
    return this as unknown as ColumnBuilder<TType, TElement, TNotNull, THasDefault>;
  }

  reference(rdfClassUri: string): ColumnBuilder<TType, TElement, TNotNull, THasDefault> {
    // 验证是否是有效的 RDF Class URI
    if (!rdfClassUri.startsWith('http://') && !rdfClassUri.startsWith('https://')) {
      throw new Error(`Invalid RDF Class URI: ${rdfClassUri}. Must be a full HTTP(S) URL.`);
    }
    
    this.options = { ...this.options, referenceTarget: rdfClassUri };
    return this as unknown as ColumnBuilder<TType, TElement, TNotNull, THasDefault>;
  }

  // Array support - similar to Drizzle ORM PostgreSQL
  array(): ColumnBuilder<'array', TType, TNotNull, THasDefault> {
    const arrayBuilder = new ColumnBuilder<'array', TType, TNotNull, THasDefault>(this.name, 'array', {
      ...this.options,
      baseType: this.dataType,
      isArray: true
    }, this._predicateUri, this.dataType);
    return arrayBuilder;
  }

  // method to get predicate URI
  getPredicateUri(): string | undefined {
    return this._predicateUri;
  }
}

// 类型辅助函数 - 模仿 Drizzle 的设计
// 简化的类型定义 - 移除品牌类型系统

// 类型推断工具函数 - 基于 dataType 属性推断
type ColumnValueType<T extends ColumnBuilderDataType> =
  T extends 'string' ? string :
  T extends 'integer' ? number :
  T extends 'boolean' ? boolean :
  T extends 'datetime' ? Date :
  T extends 'json' ? unknown :
  T extends 'object' ? Record<string, unknown> :
  T extends 'uri' ? string :
  T extends 'array' ? unknown[] :
  unknown;

type ExtractNotNull<T extends PodColumnBase> =
  T extends PodColumnBase<any, infer TNotNull, any, any> ? TNotNull : false;

type ExtractHasDefault<T extends PodColumnBase> =
  T extends PodColumnBase<any, any, infer THasDefault, any> ? THasDefault : false;

type ColumnIsRequiredForInsert<T extends PodColumnBase> =
  ExtractNotNull<T> extends true
    ? ExtractHasDefault<T> extends true
      ? false
      : true
    : false;

type ColumnAllowsNull<T extends PodColumnBase> =
  ExtractNotNull<T> extends true ? false : true;

export type InferColumnType<T extends PodColumnBase> =
  T extends PodArrayColumn<infer ElementType, any, any>
    ? ColumnValueType<ElementType>[]
    : ColumnValueType<T['dataType']>;

// eslint-disable-next-line @typescript-eslint/ban-types
type Simplify<T> = { [K in keyof T]: T[K] } & {};

// 推断表的数据类型
export type InferTableData<TTable extends PodTable<Record<string, PodColumnBase<any, any, any, any>>>> = Simplify<{
  [K in keyof TTable['columns']]: InferColumnType<TTable['columns'][K]>
}>;

type InsertRequiredColumns<TTable extends PodTable<Record<string, PodColumnBase<any, any, any, any>>>> = {
  [K in keyof TTable['columns'] as ColumnIsRequiredForInsert<TTable['columns'][K]> extends true ? K : never]:
    InferColumnType<TTable['columns'][K]>;
};

type InsertOptionalColumns<TTable extends PodTable<Record<string, PodColumnBase<any, any, any, any>>>> = {
  [K in keyof TTable['columns'] as ColumnIsRequiredForInsert<TTable['columns'][K]> extends true ? never : K]?:
    InferColumnType<TTable['columns'][K]>;
};

export type InferInsertData<TTable extends PodTable<Record<string, PodColumnBase<any, any, any, any>>>> =
  Simplify<InsertRequiredColumns<TTable> & InsertOptionalColumns<TTable>>;

type UpdateColumnValue<T extends PodColumnBase<any, any, any, any>> =
  ColumnAllowsNull<T> extends true ? InferColumnType<T> | null : InferColumnType<T>;

// 推断更新数据类型
export type InferUpdateData<TTable extends PodTable<Record<string, PodColumnBase<any, any, any, any>>>> = Simplify<{
  [K in keyof TTable['columns']]?: UpdateColumnValue<TTable['columns'][K]>
}>;

// 表配置选项
export interface PodTableOptions {
  base?: string; // 资源基础路径，支持绝对或相对
  /** 可选：完整 SPARQL 1.1 端点 URL；提供时 CRUD 走 SPARQL 模式 */
  sparqlEndpoint?: string;
  type: RdfTermInput;
  namespace?: NamespaceConfig;
  typeIndex?: 'private' | 'public';
  subClassOf?: RdfTermInput | RdfTermInput[];
  subjectTemplate?: string;
  graph?: string;
  resourceMode?: 'ldp' | 'sparql';
}

export interface PodColumnMapping {
  column: string;
  predicate: string;
  kind: 'datatype' | 'object';
  datatype?: string;
  referenceTarget?: string;
  isArray?: boolean;
  inverse?: boolean;
}

export interface PodTableMapping {
  name: string;
  type: string;
  subjectTemplate: string;
  graph?: string;
  namespace?: NamespaceConfig;
  subClassOf?: string[];
  columns: Record<string, PodColumnMapping>;
  relations?: Record<string, RelationDefinition>;
}

export type RelationKind = 'one' | 'many';

export interface RelationDefinition {
  type: RelationKind;
  table: PodTable<any>;
  fields?: PodColumnBase[];
  references?: PodColumnBase[];
  relationName?: string;
}

// 列类型基类
export abstract class PodColumnBase<
  TType extends ColumnBuilderDataType = ColumnBuilderDataType,
  TNotNull extends boolean = false,
  THasDefault extends boolean = false,
  TElement extends ColumnBuilderDataType | null = null
> {
  static readonly [entityKind] = 'PodColumn';
  
  public declare readonly _traits: [TNotNull, THasDefault, TElement];

  constructor(
    public name: string,
    public readonly dataType: TType,
    public options: PodColumnOptions = {},
    public tableName?: string
  ) {}

  table?: PodTable<any>;
  relationName?: string;

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
    if (!this.options.predicate && this.name === 'id') {
      this.options.predicate = '@id';
    }
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

  inverse(value = true): this {
    this.options.inverse = value;
    return this;
  }

  isInverse(): boolean {
    return this.options.inverse === true;
  }

  // 统一的值格式化方法 - Column 层负责类型转换
  formatValue(value: any): string | string[] {
    if (value === null || value === undefined) {
      throw new Error('Cannot format null or undefined value');
    }

    // 处理数组类型 - 使用多重属性
    if (this.options.isArray) {
      if (!Array.isArray(value)) {
        throw new Error('Array column requires array value');
      }
      // 返回字符串数组，每个元素会作为单独的三元组
      return value.map(item => this.formatSingleValue(item));
    }

    return this.formatSingleValue(value);
  }

  // 格式化单个值
  protected formatSingleValue(value: any): string {
    // 处理引用类型
    if (this.options.referenceTarget && typeof value === 'string') {
      return `<${value}>`;
    }

    // 根据数据类型格式化
    switch (this.dataType) {
      case 'string':
        return `"${String(value).replace(/"/g, '\\"')}"`;

      case 'integer':
        return `"${Number(value)}"^^<http://www.w3.org/2001/XMLSchema#integer>`;

      case 'boolean':
        return `"${value}"^^<http://www.w3.org/2001/XMLSchema#boolean>`;

      case 'datetime': {
        const date = value instanceof Date ? value : new Date(value);
        return `"${date.toISOString()}"^^<http://www.w3.org/2001/XMLSchema#dateTime>`;
      }

      case 'json':
      case 'object': {
        const jsonString = JSON.stringify(value);
        return `"${jsonString.replace(/"/g, '\\"')}"^^<http://www.w3.org/2001/XMLSchema#json>`;
      }

      case 'uri':
        // URI 类型直接作为 NamedNode，不需要引号
        if (typeof value !== 'string' || (!value.startsWith('http://') && !value.startsWith('https://'))) {
          throw new Error(`URI column requires valid HTTP(S) URL, got: ${value}`);
        }
        return `<${value}>`;

      default:
        return `"${String(value).replace(/"/g, '\\"')}"`;
    }
  }
}

export type PodColumn = PodColumnBase<ColumnBuilderDataType>;

// 具体的列类型
export class PodStringColumn<
  TNotNull extends boolean = false,
  THasDefault extends boolean = false
> extends PodColumnBase<'string', TNotNull, THasDefault> {
  constructor(name: string, options: PodColumnOptions = {}) {
    super(name, 'string', options);
  }
}

export class PodIntegerColumn<
  TNotNull extends boolean = false,
  THasDefault extends boolean = false
> extends PodColumnBase<'integer', TNotNull, THasDefault> {
  constructor(name: string, options: PodColumnOptions = {}) {
    super(name, 'integer', options);
  }
}

export class PodBooleanColumn<
  TNotNull extends boolean = false,
  THasDefault extends boolean = false
> extends PodColumnBase<'boolean', TNotNull, THasDefault> {
  constructor(name: string, options: PodColumnOptions = {}) {
    super(name, 'boolean', options);
  }
}

export class PodDateTimeColumn<
  TNotNull extends boolean = false,
  THasDefault extends boolean = false
> extends PodColumnBase<'datetime', TNotNull, THasDefault> {
  constructor(name: string, options: PodColumnOptions = {}) {
    super(name, 'datetime', options);
  }
}

export class PodJsonColumn<
  TNotNull extends boolean = false,
  THasDefault extends boolean = false
> extends PodColumnBase<'json', TNotNull, THasDefault> {
  constructor(name: string, options: PodColumnOptions = {}) {
    super(name, 'json', options);
  }
}

export class PodObjectColumn<
  TNotNull extends boolean = false,
  THasDefault extends boolean = false
> extends PodColumnBase<'object', TNotNull, THasDefault> {
  constructor(name: string, options: PodColumnOptions = {}) {
    super(name, 'object', options);
  }
}

export class PodUriColumn<
  TNotNull extends boolean = false,
  THasDefault extends boolean = false
> extends PodColumnBase<'uri', TNotNull, THasDefault> {
  constructor(name: string, options: PodColumnOptions = {}) {
    super(name, 'uri', options);
  }
}

export class PodArrayColumn<
  TElement extends ColumnBuilderDataType = ColumnBuilderDataType,
  TNotNull extends boolean = false,
  THasDefault extends boolean = false
> extends PodColumnBase<'array', TNotNull, THasDefault, TElement> {
  constructor(
    name: string,
    public readonly elementType: TElement,
    options: PodColumnOptions = {}
  ) {
    super(name, 'array', options);
  }
}


// 表定义类 - 支持泛型以进行类型推断
export class PodTable<TColumns extends Record<string, PodColumnBase<any, any, any, any>> = Record<string, PodColumnBase<any, any, any, any>>> {
  static readonly [entityKind] = 'PodTable';
  
  public config: {
    name: string;
    base: string;
    type: string;
    namespace?: NamespaceConfig;
    typeIndex?: 'private' | 'public';
    subClassOf?: string[];
    subjectTemplate: string;
    graph?: string;
    containerPath?: string;
    resourcePath?: string;
  };
  public mapping: PodTableMapping;
  public relations?: Record<string, RelationDefinition>;
  
  private resourcePath: string;
  private containerPath: string;
  private initialized = false;
  private subjectTemplate: string;
  private hasCustomSubjectTemplate: boolean;
  private resourceMode?: 'ldp' | 'sparql';
  private sparqlEndpoint?: string;
  private registerTypeIndexEnabled: boolean;
  private parentClasses: string[];
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
    const typeInput = options.type;
    if (!typeInput) {
      throw new Error('podTable requires a type (RDF class) via options.type');
    }
    const typeIndexOption = options.typeIndex;
    const validTypeIndex = typeIndexOption === 'private' || typeIndexOption === 'public';
    if (typeIndexOption && !validTypeIndex) {
      console.warn(`Invalid typeIndex value "${typeIndexOption}", disabling TypeIndex registration.`);
    }
    const baseConfig = this.resolveBase(options.base, name);
    this.resourcePath = baseConfig.resourcePath;
    this.containerPath = baseConfig.containerPath;
    const subjectTemplateInfo = this.resolveSubjectTemplate(
      options.subjectTemplate,
      baseConfig.resourcePath,
      name
    );
    this.subjectTemplate = subjectTemplateInfo.template;
    this.hasCustomSubjectTemplate = subjectTemplateInfo.isCustom;
    this.resourceMode = options.resourceMode ?? (options.sparqlEndpoint ? 'sparql' : undefined);
    this.sparqlEndpoint = options.sparqlEndpoint;
    // TypeIndex 注册默认取决于是否提供 typeIndex
    this.registerTypeIndexEnabled = validTypeIndex;

    this.config = {
      name,
      base: baseConfig.resourcePath,
      type: resolveTermIri(typeInput),
      namespace: options.namespace,
      typeIndex: validTypeIndex ? typeIndexOption : undefined,
      subjectTemplate: this.subjectTemplate,
      graph: options.graph
    };
    this.parentClasses = this.normalizeParents(options.subClassOf ?? []);
    if (this.parentClasses.length > 0) {
      this.config.subClassOf = [...this.parentClasses];
    }
    
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

    this.mapping = this.buildTableMapping();
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
    return this.containerPath;
  }

  // 获取 RDF 类
  getType(): string {
    return this.config.type;
  }

  /**
   * @deprecated 使用 getType()
   */
  getRdfClass(): string {
    return this.getType();
  }

  // 获取命名空间
  getNamespace(): NamespaceConfig | undefined {
    return this.config.namespace;
  }

  getSubjectTemplate(): string {
    return this.subjectTemplate;
  }

  /**
   * 检查是否有用户提供的 subjectTemplate
   */
  hasCustomTemplate(): boolean {
    return this.hasCustomSubjectTemplate;
  }

  getSubClassOf(): string[] {
    return [...this.parentClasses];
  }

  getMapping(): PodTableMapping {
    return this.mapping;
  }

  private resolveBase(base: string | undefined, tableName: string): { resourcePath: string; containerPath: string } {
    if (!base || base.trim().length === 0) {
      return {
        resourcePath: '',
        containerPath: '/data/'
      };
    }

    const normalizedInput = this.normalizeBaseInput(base);
    const normalizedPath = this.normalizeResourcePath(normalizedInput);

    if (normalizedPath.endsWith('/')) {
      const containerPath = this.ensureTrailingSlash(normalizedPath);
      return {
        resourcePath: `${containerPath}${tableName}.ttl`,
        containerPath
      };
    }

    const containerPath = this.ensureTrailingSlash(this.deriveContainerPath(normalizedPath));
    return {
      resourcePath: normalizedPath,
      containerPath,
    };
  }

  private normalizeBaseInput(rawBase: string): string {
    const trimmed = rawBase.trim();
    if (trimmed.length === 0) {
      throw new Error('podTable requires a non-empty base');
    }

    const schemeMatch = trimmed.match(/^([a-zA-Z][\w+.-]*):\/\/(.*)$/);
    if (schemeMatch) {
      const [, scheme, remainder] = schemeMatch;
      const normalizedScheme = scheme.toLowerCase();
      const remainderTrimmed = remainder.trim();

      if (normalizedScheme === 'http' || normalizedScheme === 'https') {
        const rest = remainderTrimmed.length === 0 ? '' : remainderTrimmed;
        return `${normalizedScheme}://${rest}`;
      }

      const normalizedRemainder = remainderTrimmed.length === 0 ? '/' : remainderTrimmed;
      return normalizedRemainder.startsWith('/') ? normalizedRemainder : `/${normalizedRemainder}`;
    }

    return trimmed;
  }

  private normalizeResourcePath(resourcePath: string): string {
    if (typeof resourcePath !== 'string' || resourcePath.trim().length === 0) {
      throw new Error('podTable requires a non-empty base');
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

  getResourcePath(): string {
    return this.resourcePath;
  }

  getResourceMode(): 'ldp' | 'sparql' | undefined {
    return this.resourceMode;
  }

  getSparqlEndpoint(): string | undefined {
    return this.sparqlEndpoint;
  }

  shouldRegisterTypeIndex(): boolean {
    return this.registerTypeIndexEnabled;
  }

  async init(initializer: PodTableInitializer): Promise<void> {
    await initializer.registerTable(this);
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  markInitialized(initialized = true): void {
    this.initialized = initialized;
  }

  /**
   * 动态更新 base（TypeIndex 自动发现等场景）
   */
  setBase(base: string): void {
    const resolved = this.resolveBase(base, this.config.name);
    this.resourcePath = resolved.resourcePath;
    this.containerPath = resolved.containerPath;
    this.config.base = resolved.resourcePath;
    if ((this as any)._?.config) {
      (this as any)._!.config.base = this.config.base;
    }
    if (!this.hasCustomSubjectTemplate) {
      this.subjectTemplate = this.buildDefaultSubjectTemplate(this.config.base, this.config.name);
      this.config.subjectTemplate = this.subjectTemplate;
      if ((this as any)._?.config) {
        (this as any)._!.config.subjectTemplate = this.subjectTemplate;
      }
    }
    this.mapping = this.buildTableMapping();
  }

  // 获取所有列
  getColumns(): TColumns {
    return this.columns;
  }

  // 获取指定列
  getColumn<TKey extends keyof TColumns>(name: TKey): TColumns[TKey];
  getColumn(name: string): PodColumnBase | undefined;
  getColumn(name: string): PodColumnBase | undefined {
    return this.columns[name as keyof TColumns];
  }

  // 检查列是否存在
  hasColumn(name: string): boolean {
    return name in this.columns;
  }

  private resolveSubjectTemplate(
    template: string | undefined,
    resourcePath: string,
    tableName: string
  ): { template: string; isCustom: boolean } {
    if (template && template.trim().length > 0) {
      return { template: template.trim(), isCustom: true };
    }
    return {
      template: this.buildDefaultSubjectTemplate(resourcePath, tableName),
      isCustom: false
    };
  }

  private buildDefaultSubjectTemplate(resourcePath: string, tableName = 'resource'): string {
    const basePath =
      resourcePath && resourcePath.length > 0
        ? resourcePath
        : `/${tableName}.ttl`;
    const trimmed = basePath.endsWith('#') ? basePath.slice(0, -1) : basePath;
    if (trimmed.includes('{')) {
      return trimmed;
    }
    return `${trimmed}#{id}`;
  }

  private buildTableMapping(): PodTableMapping {
    const mappedColumns: Record<string, PodColumnMapping> = {};
    for (const column of Object.values(this.columns)) {
      mappedColumns[column.name] = this.buildColumnMapping(column);
    }

    return {
      name: this.config.name,
      type: this.config.type,
      subjectTemplate: this.subjectTemplate,
      graph: this.config.graph,
      namespace: this.config.namespace,
      subClassOf: this.parentClasses.length > 0 ? [...this.parentClasses] : undefined,
      columns: mappedColumns,
      relations: this.relations
    };
  }

  private buildColumnMapping(column: PodColumnBase): PodColumnMapping {
    const predicate = (column as any)._virtualId
      ? '@id'
      : column.getPredicate(this.config.namespace);
    return {
      column: column.name,
      predicate,
      kind: column.isReference() ? 'object' : 'datatype',
      datatype: this.inferColumnDatatype(column),
      referenceTarget: column.getReferenceTarget(),
      isArray: column.options.isArray ?? false,
      inverse: column.isInverse()
    };
  }


  private inferColumnDatatype(column: PodColumnBase): string | undefined {
    switch (column.dataType) {
      case 'string':
        return 'http://www.w3.org/2001/XMLSchema#string';
      case 'integer':
        return 'http://www.w3.org/2001/XMLSchema#integer';
      case 'boolean':
        return 'http://www.w3.org/2001/XMLSchema#boolean';
      case 'datetime':
        return 'http://www.w3.org/2001/XMLSchema#dateTime';
      case 'json':
      case 'object':
        return 'http://www.w3.org/2001/XMLSchema#json';
      case 'uri':
        return undefined;
      default:
        return undefined;
    }
  }

  private normalizeParents(value?: RdfTermInput | RdfTermInput[]): string[] {
    if (!value) {
      return [];
    }
    const entries = Array.isArray(value) ? value : [value];
    const normalized = entries
      .map((entry) => resolveTermIri(entry))
      .filter((entry) => entry && entry.length > 0);
    return Array.from(new Set(normalized));
  }
}

export interface PodTableInitializer {
  registerTable(table: PodTable<any>): Promise<void>;
}

export function boolean(name: string, options: PodColumnOptions = {}): ColumnBuilder<'boolean'> {
  return new ColumnBuilder(name, 'boolean', options);
}

export function timestamp(name: string, options: PodColumnOptions = {}): ColumnBuilder<'datetime'> {
  return new ColumnBuilder(name, 'datetime', options);
}

export function json(name: string, options: PodColumnOptions = {}): ColumnBuilder<'json'> {
  return new ColumnBuilder(name, 'json', options);
}

export function object(name: string, options: PodColumnOptions = {}): ColumnBuilder<'object'> {
  return new ColumnBuilder(name, 'object', options);
}

export function uri(name: string, options: PodColumnOptions = {}): ColumnBuilder<'uri'> {
  return new ColumnBuilder(name, 'uri', options);
}

// IRI 别名，方便习惯使用 IRI 术语的场景
export function iri(name: string, options: PodColumnOptions = {}): ColumnBuilder<'uri'> {
  return uri(name, options);
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

// 专用 ID 列，自动 predicate 为 @id，便于构造 subject IRI
// 特殊 ID 列：不单独存储谓词，只用于生成/解析 subject/@id（最多一个）
export function id(name = 'id', options: PodColumnOptions = {}): PodStringColumn {
  const col = new PodStringColumn(name, { ...options, predicate: '@id', primaryKey: true, required: true });
  // 标记为“虚拟 ID 列”，生成/解析 subject 时使用，但不额外输出三元组
  (col as any)._virtualId = true;
  return col;
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

// 时间相关列类型别名
export function datetime(name: string, options: PodColumnOptions = {}): ColumnBuilder<'datetime'> {
  return new ColumnBuilder(name, 'datetime', options);
}

// 文本相关列类型别名
export function text(name: string, options: PodColumnOptions = {}): ColumnBuilder<'string'> {
  return new ColumnBuilder(name, 'string', options);
}

export function varchar(name: string, options: PodColumnOptions = {}): ColumnBuilder<'string'> {
  return new ColumnBuilder(name, 'string', options);
}

export function char(name: string, options: PodColumnOptions = {}): ColumnBuilder<'string'> {
  return new ColumnBuilder(name, 'string', options);
}

// 数字相关列类型别名  
export function bigint(name: string, options: PodColumnOptions = {}): ColumnBuilder<'integer'> {
  return new ColumnBuilder(name, 'integer', options);
}

export function smallint(name: string, options: PodColumnOptions = {}): ColumnBuilder<'integer'> {
  return new ColumnBuilder(name, 'integer', options);
}

export function tinyint(name: string, options: PodColumnOptions = {}): ColumnBuilder<'integer'> {
  return new ColumnBuilder(name, 'integer', options);
}

export function mediumint(name: string, options: PodColumnOptions = {}): ColumnBuilder<'integer'> {
  return new ColumnBuilder(name, 'integer', options);
}

export function serial(name: string, options: PodColumnOptions = {}): ColumnBuilder<'integer'> {
  return new ColumnBuilder(name, 'integer', options);
}

// 浮点数相关列类型别名
export function real(name: string, options: PodColumnOptions = {}): ColumnBuilder<'integer'> {
  return new ColumnBuilder(name, 'integer', options);
}

export function decimal(name: string, options: PodColumnOptions = {}): ColumnBuilder<'integer'> {
  return new ColumnBuilder(name, 'integer', options);
}

export function numeric(name: string, options: PodColumnOptions = {}): ColumnBuilder<'integer'> {
  return new ColumnBuilder(name, 'integer', options);
}

export function float(name: string, options: PodColumnOptions = {}): ColumnBuilder<'integer'> {
  return new ColumnBuilder(name, 'integer', options);
}

export function double(name: string, options: PodColumnOptions = {}): ColumnBuilder<'integer'> {
  return new ColumnBuilder(name, 'integer', options);
}

// JSON相关别名
export function jsonb(name: string, options: PodColumnOptions = {}): ColumnBuilder<'json'> {
  return new ColumnBuilder(name, 'json', options);
}


// 类型安全的podTable函数
type ColumnInput =
  | PodColumnBase
  | ColumnBuilder<ColumnBuilderDataType, ColumnBuilderDataType | null, boolean, boolean>;

type ResolveColumn<T> =
  T extends ColumnBuilder<'string', any, infer TNotNull, infer THasDefault>
    ? PodStringColumn<TNotNull, THasDefault>
  : T extends ColumnBuilder<'integer', any, infer TNotNull, infer THasDefault>
    ? PodIntegerColumn<TNotNull, THasDefault>
  : T extends ColumnBuilder<'boolean', any, infer TNotNull, infer THasDefault>
    ? PodBooleanColumn<TNotNull, THasDefault>
  : T extends ColumnBuilder<'datetime', any, infer TNotNull, infer THasDefault>
    ? PodDateTimeColumn<TNotNull, THasDefault>
  : T extends ColumnBuilder<'json', any, infer TNotNull, infer THasDefault>
    ? PodJsonColumn<TNotNull, THasDefault>
  : T extends ColumnBuilder<'object', any, infer TNotNull, infer THasDefault>
    ? PodObjectColumn<TNotNull, THasDefault>
  : T extends ColumnBuilder<'uri', any, infer TNotNull, infer THasDefault>
    ? PodUriColumn<TNotNull, THasDefault>
  : T extends ColumnBuilder<'array', infer TElement, infer TNotNull, infer THasDefault>
    ? PodArrayColumn<
        TElement extends ColumnBuilderDataType ? TElement : ColumnBuilderDataType,
        TNotNull,
        THasDefault
      >
  : T extends PodColumnBase ? T
  : PodColumnBase;

type ResolvedColumns<T extends Record<string, ColumnInput>> = {
  [K in keyof T]: ResolveColumn<T[K]>;
};

type RelationBuilder = {
  one: (table: PodTable<any>, options?: RelationOptions) => RelationDefinition;
  many: (table: PodTable<any>, options?: RelationOptions) => RelationDefinition;
};

export interface RelationOptions {
  fields?: PodColumnBase[];
  references?: PodColumnBase[];
  relationName?: string;
}

export function podTable<
  TName extends string,
  TColumns extends Record<string, ColumnInput>
>(
  name: TName,
  columns: TColumns,
  options: PodTableOptions
): PodTable<ResolvedColumns<TColumns>> {
  const processedColumns: Partial<ResolvedColumns<TColumns>> = {};

  for (const [key, value] of Object.entries(columns)) {
    if (value instanceof PodColumnBase) {
      processedColumns[key as keyof TColumns] = value as ResolveColumn<TColumns[typeof key & keyof TColumns]>;
      continue;
    }

    let column: PodColumnBase<any, any, any, any>;
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
      case 'array': {
        const elementType = (value.elementType ?? value.options.baseType ?? 'string') as ColumnBuilderDataType;
        column = new PodArrayColumn(value.name, elementType, value.options);
        break;
      }
      case 'uri':
        column = new PodUriColumn(value.name, value.options);
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

    processedColumns[key as keyof TColumns] = column as ResolveColumn<TColumns[typeof key & keyof TColumns]>;
  }

  return new PodTable(name, processedColumns as ResolvedColumns<TColumns>, options);
}

export function relations<TTable extends PodTable<any>>(
  table: TTable,
  builder: (helpers: RelationBuilder) => Record<string, RelationDefinition>
): Record<string, RelationDefinition> {
  const helpers: RelationBuilder = {
    one: (target, options = {}) => ({
      type: 'one',
      table: target,
      fields: options.fields,
      references: options.references,
      relationName: options.relationName
    }),
    many: (target, options = {}) => ({
      type: 'many',
      table: target,
      fields: options.fields,
      references: options.references,
      relationName: options.relationName
    })
  };

  const defs = builder(helpers);
  (table as any).relations = defs;
  return defs;
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
