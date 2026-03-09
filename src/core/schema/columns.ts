import { entityKind } from 'drizzle-orm';
import { 
  ColumnBuilderDataType, PodColumnOptions, NamespaceConfig, 
  RdfTermInput, resolveTermIri 
} from './defs';

export class ColumnBuilder<
  TType extends ColumnBuilderDataType,
  TElement extends ColumnBuilderDataType | null = null,
  TNotNull extends boolean = false,
  THasDefault extends boolean = false
> {
  public options: PodColumnOptions;
  private _predicateUri?: string;
  public readonly elementType: TElement;

  constructor(
    public readonly name: string,
    public readonly dataType: TType,
    options: PodColumnOptions = {},
    predicate?: string,
    elementType?: TElement
  ) {
    this.options = { ...options };
    this._predicateUri = predicate;
    this.elementType = elementType ?? (null as unknown as TElement);
  }

  formatValue(value: any): string | string[] {
    if (value === null || value === undefined) {
      throw new Error('Cannot format null or undefined value');
    }

    if (this.options.isArray) {
      if (!Array.isArray(value)) {
        throw new Error('Array column requires array value');
      }
      return value.map(item => this.formatSingleValue(item));
    }

    return this.formatSingleValue(value);
  }

  private formatSingleValue(value: any): string {
    const effectiveType = this.options.isArray && this.elementType ? this.elementType : this.dataType;
    if (this.options.linkTarget && typeof value === 'string') {
      return `<${value}>`;
    }

    switch (effectiveType) {
      case 'string':
        return `"${String(value).replace(/"/g, '\"')}"`;
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
        return `"${jsonString.replace(/"/g, '\"')}"^^<http://www.w3.org/2001/XMLSchema#json>`;
      }
      case 'uri':
        if (typeof value !== 'string' || !value.includes(':')) {
          throw new Error(`URI column requires valid IRI, got: ${value}`);
        }
        return `<${value}>`;
      default:
        return `"${String(value).replace(/"/g, '\"')}"`;
    }
  }

  parseValue(rdfValue: string, datatypeIri?: string): any {
    return this.parseSingleValue(rdfValue, datatypeIri);
  }

  private parseSingleValue(rdfValue: string, datatypeIri?: string): any {
    if (!datatypeIri) return rdfValue;

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

    if (rdfValue.startsWith('http://') || rdfValue.startsWith('https://')) {
      return rdfValue;
    }

    return rdfValue;
  }

  primaryKey(): ColumnBuilder<TType, TElement, true, THasDefault> {
    // primaryKey 等价于 predicate: '@id'，表示该列是 RDF subject IRI
    this._predicateUri = '@id';
    this.options = {
      ...this.options,
      primaryKey: true,
      required: true,
      predicate: '@id'
    };
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

  link(target: string | any): ColumnBuilder<TType, TElement, TNotNull, THasDefault> {
    if (typeof target === 'string') {
      if (target.startsWith('http://') || target.startsWith('https://')) {
        this.options = { ...this.options, linkTarget: target };
      } else {
        this.options = { ...this.options, linkTableName: target };
      }
    } else {
      this.options = { ...this.options, linkTable: target };
    }
    return this as unknown as ColumnBuilder<TType, TElement, TNotNull, THasDefault>;
  }

  array(): ColumnBuilder<'array', TType, TNotNull, THasDefault> {
    const arrayBuilder = new ColumnBuilder<'array', TType, TNotNull, THasDefault>(this.name, 'array', {
      ...this.options,
      baseType: this.dataType,
      isArray: true
    }, this._predicateUri, this.dataType);
    return arrayBuilder;
  }

  getPredicateUri(): string | undefined {
    return this._predicateUri;
  }
}

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

  table?: any;
  relationName?: string;

  getPredicate(tableNamespace?: NamespaceConfig): string {
    if (this.options.predicate) return this.options.predicate;
    if (tableNamespace) return `${tableNamespace.uri}${this.name}`;
    throw new Error(`Missing predicate for column "${this.name}"; please set namespace or predicate explicitly.`);
  }

  isLink(): boolean {
    return !!(this.options.linkTarget || this.options.linkTableName || this.options.linkTable);
  }

  getLinkTarget(): string | undefined {
    return this.options.linkTarget;
  }

  getLinkTableName(): string | undefined {
    return this.options.linkTableName;
  }

  getLinkTable(): any | undefined {
    return this.options.linkTable;
  }

  primaryKey(): this {
    // primaryKey 等价于 predicate: '@id'，表示该列是 RDF subject IRI
    this.options.primaryKey = true;
    this.options.required = true;
    this.options.predicate = '@id';
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

  link(target: string | any): this {
    if (typeof target === 'string') {
      if (target.startsWith('http://') || target.startsWith('https://')) {
        this.options.linkTarget = target;
      } else {
        this.options.linkTableName = target;
      }
    } else {
      this.options.linkTable = target;
    }
    return this;
  }

  inverse(value = true): this {
    this.options.inverse = value;
    return this;
  }

  isInverse(): boolean {
    return this.options.inverse === true;
  }

  formatValue(value: any): string | string[] {
    if (value === null || value === undefined) {
      throw new Error('Cannot format null or undefined value');
    }

    if (this.options.isArray) {
      if (!Array.isArray(value)) {
        throw new Error('Array column requires array value');
      }
      return value.map(item => this.formatSingleValue(item));
    }

    return this.formatSingleValue(value);
  }

  protected formatSingleValue(value: any): string {
    if (this.options.linkTarget && typeof value === 'string') {
      return `<${value}>`;
    }

    switch (this.dataType) {
      case 'string':
        return `"${String(value).replace(/"/g, '\"')}"`;
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
        return `"${jsonString.replace(/"/g, '\"')}"^^<http://www.w3.org/2001/XMLSchema#json>`;
      }
      case 'uri':
        if (typeof value !== 'string' || !value.includes(':')) {
          throw new Error(`URI column requires valid IRI, got: ${value}`);
        }
        return `<${value}>`;
      default:
        return `"${String(value).replace(/"/g, '\"')}"`;
    }
  }
}

export class PodStringColumn<TNotNull extends boolean = false, THasDefault extends boolean = false> extends PodColumnBase<'string', TNotNull, THasDefault> {
  constructor(name: string, options: PodColumnOptions = {}) { super(name, 'string', options); }
}

export class PodIntegerColumn<TNotNull extends boolean = false, THasDefault extends boolean = false> extends PodColumnBase<'integer', TNotNull, THasDefault> {
  constructor(name: string, options: PodColumnOptions = {}) { super(name, 'integer', options); }
}

export class PodBooleanColumn<TNotNull extends boolean = false, THasDefault extends boolean = false> extends PodColumnBase<'boolean', TNotNull, THasDefault> {
  constructor(name: string, options: PodColumnOptions = {}) { super(name, 'boolean', options); }
}

export class PodDateTimeColumn<TNotNull extends boolean = false, THasDefault extends boolean = false> extends PodColumnBase<'datetime', TNotNull, THasDefault> {
  constructor(name: string, options: PodColumnOptions = {}) { super(name, 'datetime', options); }
}

export class PodJsonColumn<TNotNull extends boolean = false, THasDefault extends boolean = false> extends PodColumnBase<'json', TNotNull, THasDefault> {
  constructor(name: string, options: PodColumnOptions = {}) { super(name, 'json', options); }
}

export class PodObjectColumn<TNotNull extends boolean = false, THasDefault extends boolean = false> extends PodColumnBase<'object', TNotNull, THasDefault> {
  constructor(name: string, options: PodColumnOptions = {}) { super(name, 'object', options); }
}

export class PodUriColumn<TNotNull extends boolean = false, THasDefault extends boolean = false> extends PodColumnBase<'uri', TNotNull, THasDefault> {
  constructor(name: string, options: PodColumnOptions = {}) { super(name, 'uri', options); }
}

export class PodArrayColumn<TElement extends ColumnBuilderDataType = ColumnBuilderDataType, TNotNull extends boolean = false, THasDefault extends boolean = false> extends PodColumnBase<'array', TNotNull, THasDefault, TElement> {
  constructor(name: string, public readonly elementType: TElement, options: PodColumnOptions = {}) { super(name, 'array', options); }
}
