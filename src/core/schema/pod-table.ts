import { entityKind } from 'drizzle-orm';
import { 
  NamespaceConfig, PodTableOptions, PodTableMapping, 
  PodColumnMapping, resolveTermIri, RdfTermInput, TableHooks,
  ColumnBuilderDataType
} from './defs';
import { 
  PodColumnBase, PodIntegerColumn, PodDateTimeColumn, PodBooleanColumn, 
  PodJsonColumn, PodObjectColumn, PodArrayColumn, PodUriColumn, 
  PodStringColumn 
} from './columns';
import { 
  InferTableData, InferInsertData, InferUpdateData,
  ColumnInput, ResolvedColumns, ResolveColumn
} from './types';
import { SolidSchema } from './solid-schema';
import { deepClone } from '../../utils/helpers';

/**
 * PodTable with columns accessible as direct properties.
 * This type combines PodTable with its column definitions.
 */
export type PodTableWithColumns<TColumns extends Record<string, PodColumnBase<any, any, any, any>>> = 
  PodTable<TColumns> & TColumns;

export interface PodTableInitializer {
  registerTable(table: PodTable<any>): Promise<void>;
}

export class PodTable<TColumns extends Record<string, PodColumnBase<any, any, any, any>> = Record<string, PodColumnBase<any, any, any, any>>> {
  static readonly [entityKind] = 'PodTable';
  
  public config: {
    name: string;
    base: string;
    type: string;
    namespace?: NamespaceConfig;
    typeIndex?: 'private' | 'public';
    saiRegistryPath?: string;
    subClassOf?: string[];
    subjectTemplate: string;
    containerPath?: string;
    resourcePath?: string;
    autoRegister?: boolean;
    hooks?: TableHooks;
  };
  public mapping: PodTableMapping;
  public relations?: Record<string, any>;
  
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

  public readonly $inferSelect: InferTableData<PodTable<TColumns>>;
  public readonly $inferInsert: InferInsertData<PodTable<TColumns>>;
  public readonly $inferUpdate: InferUpdateData<PodTable<TColumns>>;

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
    
    const baseConfig = this.resolveBase(options.base, name);
    this.resourcePath = baseConfig.resourcePath;
    this.containerPath = baseConfig.containerPath;
    
    const subjectTemplateInfo = this.resolveSubjectTemplate(
      options.subjectTemplate,
      baseConfig.resourcePath,
      baseConfig.containerPath,
      name
    );
    this.subjectTemplate = subjectTemplateInfo.template;
    this.hasCustomSubjectTemplate = subjectTemplateInfo.isCustom;
    this.resourceMode = options.resourceMode ?? (options.sparqlEndpoint ? 'sparql' : undefined);
    this.sparqlEndpoint = options.sparqlEndpoint;
    this.registerTypeIndexEnabled = validTypeIndex && options.autoRegister !== false;

    this.config = {
      name,
      base: baseConfig.resourcePath,
      type: resolveTermIri(typeInput),
      namespace: options.namespace,
      typeIndex: validTypeIndex ? typeIndexOption : undefined,
      saiRegistryPath: options.saiRegistryPath,
      subjectTemplate: this.subjectTemplate,
      autoRegister: options.autoRegister,
      containerPath: baseConfig.containerPath,
      hooks: options.hooks,
    };
    this.parentClasses = this.normalizeParents(options.subClassOf ?? []);
    if (this.parentClasses.length > 0) {
      this.config.subClassOf = [...this.parentClasses];
    }
    
    this.columns = columns;
    Object.assign(this, columns);

    let primaryKeyCount = 0;
    for (const column of Object.values(columns)) {
      if (column.options.primaryKey) primaryKeyCount++;
      column.table = this;
      column.tableName = name;

      if (!column.options.predicate && !((column as any)._virtualId) && !options.namespace) {
        throw new Error(`Column "${column.name}" in table "${name}" is missing a predicate.`);
      }
    }

    if (primaryKeyCount !== 1) {
      throw new Error(`PodTable "${name}" must have exactly one primary key column. Found ${primaryKeyCount}.`);
    }

    this.$inferSelect = {} as any;
    this.$inferInsert = {} as any;
    this.$inferUpdate = {} as any;

    this._ = {
      brand: 'Table' as const,
      config: this.config,
      name,
      schema: undefined,
      columns,
      inferSelect: {} as any,
      inferInsert: {} as any,
      inferUpdate: {} as any
    };

    this.mapping = this.buildTableMapping();
  }

  getContainerPath(): string { return this.containerPath; }
  getType(): string { return this.config.type; }
  getRdfClass(): string { return this.getType(); }
  getNamespace(): NamespaceConfig | undefined { return this.config.namespace; }
  getSubjectTemplate(): string { return this.subjectTemplate; }
  hasCustomTemplate(): boolean { return this.hasCustomSubjectTemplate; }
  getSubClassOf(): string[] { return [...this.parentClasses]; }
  getMapping(): PodTableMapping { return this.mapping; }

  get $schema(): SolidSchema<TColumns> {
    return new SolidSchema(this.columns, {
      type: this.config.type,
      namespace: this.config.namespace,
      subjectTemplate: this.subjectTemplate,
      subClassOf: this.parentClasses.length > 0 ? [...this.parentClasses] : undefined,
    });
  }

  resolveUri(id: string): string {
    const template = this.subjectTemplate;
    const resolved = template.replace(/\{id\}/g, id);
    if (resolved.startsWith('#')) {
      return `${this.resourcePath}${resolved}`;
    }
    const normalizedContainer = this.containerPath.endsWith('/') ? this.containerPath : `${this.containerPath}/`;
    return `${normalizedContainer}${resolved}`;
  }

  private resolveBase(base: string | undefined, tableName: string): { resourcePath: string; containerPath: string } {
    if (!base || base.trim().length === 0) {
      throw new Error(`podTable '${tableName}' requires a 'base' option.`);
    }
    const normalizedInput = this.normalizeBaseInput(base);
    const normalizedPath = this.normalizeResourcePath(normalizedInput);
    if (normalizedPath.endsWith('/')) {
      const containerPath = this.ensureTrailingSlash(normalizedPath);
      return { resourcePath: containerPath, containerPath };
    }
    const containerPath = this.ensureTrailingSlash(this.deriveContainerPath(normalizedPath));
    return { resourcePath: normalizedPath, containerPath };
  }

  private normalizeBaseInput(rawBase: string): string {
    const trimmed = rawBase.trim();
    const schemeMatch = trimmed.match(/^([a-zA-Z][\w+.-]*):\/\/(.*)$/);
    if (schemeMatch) {
      const [, scheme, remainder] = schemeMatch;
      const normalizedScheme = scheme.toLowerCase();
      const remainderTrimmed = remainder.trim();
      if (normalizedScheme === 'http' || normalizedScheme === 'https') {
        return `${normalizedScheme}://${remainderTrimmed}`;
      }
      return remainderTrimmed.startsWith('/') ? remainderTrimmed : `/${remainderTrimmed}`;
    }
    return trimmed;
  }

  private normalizeResourcePath(resourcePath: string): string {
    if (/^[a-zA-Z][\w+.-]*:\/\//.test(resourcePath)) return resourcePath;
    const trimmed = resourcePath.trim().replace(/^(\.\/)+/, '');
    const normalized = trimmed.replace(/\/+/g, '/');
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
  }

  private deriveContainerPath(resourcePath: string): string {
    const withoutTrailingSlash = resourcePath.endsWith('/') ? resourcePath.slice(0, -1) : resourcePath;
    const lastSlash = withoutTrailingSlash.lastIndexOf('/');
    return lastSlash === -1 ? '/' : withoutTrailingSlash.slice(0, lastSlash + 1);
  }

  private ensureTrailingSlash(path: string): string {
    return path.endsWith('/') ? path : `${path}/`;
  }

  getResourcePath(): string { return this.resourcePath; }
  getResourceMode(): 'ldp' | 'sparql' | undefined { return this.resourceMode; }
  getSparqlEndpoint(): string | undefined { return this.sparqlEndpoint; }
  shouldRegisterTypeIndex(): boolean { return this.registerTypeIndexEnabled; }

  async init(initializer: PodTableInitializer): Promise<void> {
    await initializer.registerTable(this);
  }

  isInitialized(): boolean { return this.initialized; }
  markInitialized(initialized = true): void { this.initialized = initialized; }

  setBase(base: string): void {
    const resolved = this.resolveBase(base, this.config.name);
    this.resourcePath = resolved.resourcePath;
    this.containerPath = resolved.containerPath;
    this.config.base = resolved.resourcePath;
    this.config.containerPath = resolved.containerPath;
    if ((this as any)._?.config) {
      (this as any)._!.config.base = this.config.base;
      (this as any)._!.config.containerPath = this.config.containerPath;
    }
    if (!this.hasCustomSubjectTemplate) {
      this.subjectTemplate = this.buildDefaultSubjectTemplate(this.config.base);
      this.config.subjectTemplate = this.subjectTemplate;
      if ((this as any)._?.config) {
        (this as any)._!.config.subjectTemplate = this.subjectTemplate;
      }
    }
    this.mapping = this.buildTableMapping();
  }

  setSubjectTemplate(template: string): void {
    this.subjectTemplate = template;
    this.hasCustomSubjectTemplate = true;
    this.config.subjectTemplate = template;
    if ((this as any)._?.config) {
      (this as any)._!.config.subjectTemplate = template;
    }
    this.mapping = this.buildTableMapping();
  }

  setSparqlEndpoint(endpoint: string): void {
    this.sparqlEndpoint = endpoint;
    if (!this.resourceMode) this.resourceMode = 'sparql';
  }

  getColumns(): TColumns { return this.columns; }
  getColumn<TKey extends keyof TColumns>(name: TKey): TColumns[TKey];
  getColumn(name: string): PodColumnBase | undefined;
  getColumn(name: string): PodColumnBase | undefined { return this.columns[name as keyof TColumns]; }
  hasColumn(name: string): boolean { return name in this.columns; }

  private resolveSubjectTemplate(template: string | undefined, resourcePath: string, _containerPath: string, _tableName: string): { template: string; isCustom: boolean } {
    if (template && template.trim().length > 0) return { template: template.trim(), isCustom: true };
    return { template: this.buildDefaultSubjectTemplate(resourcePath), isCustom: false };
  }

  /**
   * 构建默认的 subjectTemplate
   * 根据 base 路径判断
   * - base 以 / 结尾 → document 模式 → {id}.ttl
   * - base 是文件路径 → fragment 模式 → #{id}
   */
  private buildDefaultSubjectTemplate(base: string): string {
    // base 以 / 结尾表示容器 → document 模式
    if (base.endsWith('/')) {
      return '{id}.ttl';
    }
    // base 包含模板变量，直接使用
    if (base.includes('{')) {
      return base;
    }
    // base 是文件路径 → fragment 模式
    return '#{id}';
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
      namespace: this.config.namespace,
      subClassOf: this.parentClasses.length > 0 ? [...this.parentClasses] : undefined,
      columns: mappedColumns,
      relations: this.relations
    };
  }

  private buildColumnMapping(column: PodColumnBase): PodColumnMapping {
    const predicate = (column as any)._virtualId ? '@id' : column.getPredicate(this.config.namespace);
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
      case 'string': return 'http://www.w3.org/2001/XMLSchema#string';
      case 'integer': return 'http://www.w3.org/2001/XMLSchema#integer';
      case 'boolean': return 'http://www.w3.org/2001/XMLSchema#boolean';
      case 'datetime': return 'http://www.w3.org/2001/XMLSchema#dateTime';
      case 'json':
      case 'object': return 'http://www.w3.org/2001/XMLSchema#json';
      default: return undefined;
    }
  }

  private normalizeParents(value?: RdfTermInput | RdfTermInput[]): string[] {
    if (!value) return [];
    const entries = Array.isArray(value) ? value : [value];
    const normalized = entries.map((entry) => resolveTermIri(entry)).filter((entry) => entry && entry.length > 0);
    return Array.from(new Set(normalized));
  }
}


function clonePodColumn<TColumn extends PodColumnBase<any, any, any, any>>(column: TColumn): TColumn {
  const options = deepClone(column.options);
  let cloned: PodColumnBase<any, any, any, any>;

  switch (column.dataType) {
    case 'integer':
      cloned = new PodIntegerColumn(column.name, options);
      break;
    case 'datetime':
      cloned = new PodDateTimeColumn(column.name, options);
      break;
    case 'boolean':
      cloned = new PodBooleanColumn(column.name, options);
      break;
    case 'json':
      cloned = new PodJsonColumn(column.name, options);
      break;
    case 'object':
      cloned = new PodObjectColumn(column.name, options);
      break;
    case 'array': {
      const elementType = (column as any).elementType ?? column.options.baseType ?? 'string';
      cloned = new PodArrayColumn(column.name, elementType, options);
      break;
    }
    case 'uri':
      cloned = new PodUriColumn(column.name, options);
      break;
    case 'string':
    default:
      cloned = new PodStringColumn(column.name, options);
      break;
  }

  if ((column as any)._virtualId) {
    (cloned as any)._virtualId = true;
  }
  cloned.relationName = column.relationName;
  return cloned as TColumn;
}

export function alias<TColumns extends Record<string, PodColumnBase<any, any, any, any>>>(table: PodTableWithColumns<TColumns>, aliasName: string): PodTableWithColumns<TColumns> {
  if (typeof aliasName !== 'string' || aliasName.trim().length === 0) {
    throw new Error('alias() requires a non-empty alias name');
  }

  const clonedColumns: Record<string, PodColumnBase<any, any, any, any>> = {};
  for (const [key, column] of Object.entries(table.columns)) {
    clonedColumns[key] = clonePodColumn(column as PodColumnBase<any, any, any, any>);
  }

  const aliasedTable = new PodTable(aliasName.trim(), clonedColumns as any, {
    base: table.config.base,
    sparqlEndpoint: table.getSparqlEndpoint(),
    type: table.config.type,
    namespace: table.config.namespace,
    typeIndex: table.config.typeIndex,
    saiRegistryPath: table.config.saiRegistryPath,
    subClassOf: table.config.subClassOf,
    subjectTemplate: table.config.subjectTemplate,
    resourceMode: table.getResourceMode(),
    autoRegister: table.config.autoRegister,
    hooks: table.config.hooks,
  }) as PodTableWithColumns<TColumns>;

  aliasedTable.relations = table.relations;
  if (table.isInitialized()) {
    aliasedTable.markInitialized(true);
  }

  return aliasedTable;
}

export function podTable<
  TName extends string,
  TColumns extends Record<string, ColumnInput>
>(
  name: TName,
  columns: TColumns,
  options: PodTableOptions
): PodTableWithColumns<ResolvedColumns<TColumns>> {
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

    const predicateUri = (value as any).getPredicateUri?.();
    if (predicateUri) {
      column.predicate(predicateUri);
    }

    processedColumns[key as keyof TColumns] = column as ResolveColumn<TColumns[typeof key & keyof TColumns]>;
  }

  return new PodTable(name, processedColumns as ResolvedColumns<TColumns>, options) as PodTableWithColumns<ResolvedColumns<TColumns>>;
}
