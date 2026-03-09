import type {
  EntitySubscribeOptions,
  TableSubscribeOptions,
  Subscription,
} from './core/notifications';
import type { OrderByExpression } from './core/order-by';
import type { SelectFieldMap } from './core/pod-session';
import type { QueryCondition } from './core/query-conditions';
import { generateSubjectUri } from './core/sparql/helpers';
import {
  PodTable,
  SolidSchema,
  type InferInsertData,
  type InferTableData,
  type InstantiateTableOptions,
  type PodColumnBase,
} from './core/schema';
import type { DataLocation, DiscoverOptions, LocationToTableOptions } from './core/discovery';
import type { FederatedError } from './core/federated';
import {
  drizzle,
  type SolidAuthSession,
  type SolidDatabase,
  type SolidDrizzleConfig,
} from './driver';

type CollectionWhere = Record<string, unknown> | QueryCondition;
type CollectionOrderBy = PodColumnBase | string | OrderByExpression | 'asc' | 'desc';

export interface PodCollectionQueryOptions<TTable extends PodTable<any> = PodTable<any>> {
  fields?: SelectFieldMap;
  where?: CollectionWhere;
  limit?: number;
  offset?: number;
  orderBy?: CollectionOrderBy[];
}

const parseIri = (iri: string): { documentUrl: string; fragment: string | null } => {
  const hashIndex = iri.indexOf('#');
  if (hashIndex >= 0) {
    return {
      documentUrl: iri.substring(0, hashIndex),
      fragment: iri.substring(hashIndex + 1),
    };
  }

  return {
    documentUrl: iri,
    fragment: null,
  };
};

export class PodEntity<TTable extends PodTable<any>, TSchema extends Record<string, unknown> = Record<string, never>> {
  constructor(
    private readonly db: SolidDatabase<TSchema>,
    readonly table: TTable,
    readonly iri: string,
  ) {}

  get documentUrl(): string {
    return parseIri(this.iri).documentUrl;
  }

  get fragment(): string | null {
    return parseIri(this.iri).fragment;
  }

  async get(): Promise<InferTableData<TTable> | null> {
    return await this.db.findByIri(this.table, this.iri);
  }

  async read(): Promise<InferTableData<TTable> | null> {
    return await this.get();
  }

  async update(
    data: Partial<Omit<InferTableData<TTable>, '@id' | 'id'>>,
  ): Promise<InferTableData<TTable> | null> {
    return await this.db.updateByIri(this.table, this.iri, data);
  }

  async delete(): Promise<boolean> {
    return await this.db.deleteByIri(this.table, this.iri);
  }

  async subscribe(
    options: EntitySubscribeOptions<InferTableData<TTable>>,
  ): Promise<() => void> {
    return await this.db.subscribeByIri(this.table, this.iri, options);
  }
}

export class PodCollection<TTable extends PodTable<any>, TSchema extends Record<string, unknown> = Record<string, never>> {
  constructor(
    private readonly db: SolidDatabase<TSchema>,
    readonly table: TTable,
  ) {}

  byIri(iri: string): PodEntity<TTable, TSchema> {
    return new PodEntity(this.db, this.table, iri);
  }

  entity(iri: string): PodEntity<TTable, TSchema> {
    return this.byIri(iri);
  }

  iriFor(record: InferInsertData<TTable>): string {
    const resolver = this.db.getDialect().getUriResolver();
    return generateSubjectUri(record, this.table, resolver);
  }

  select(fields?: SelectFieldMap) {
    return this.db.select<TTable>(fields).from(this.table);
  }

  async list(options: PodCollectionQueryOptions<TTable> = {}): Promise<InferTableData<TTable>[]> {
    let builder = this.select(options.fields);

    if (options.where) {
      builder = builder.where(options.where as any);
    }

    if (options.limit !== undefined) {
      builder = builder.limit(options.limit);
    }

    if (options.offset !== undefined) {
      builder = builder.offset(options.offset);
    }

    if (options.orderBy && options.orderBy.length > 0) {
      builder = builder.orderBy(...options.orderBy as any);
    }

    return await builder as InferTableData<TTable>[];
  }

  async first(options: PodCollectionQueryOptions<TTable> = {}): Promise<InferTableData<TTable> | null> {
    const rows = await this.list({ ...options, limit: 1 });
    return rows[0] ?? null;
  }

  async create(record: InferInsertData<TTable>): Promise<InferTableData<TTable> | null>;
  async create(records: InferInsertData<TTable>[]): Promise<Array<InferTableData<TTable>>>;
  async create(
    input: InferInsertData<TTable> | InferInsertData<TTable>[],
  ): Promise<InferTableData<TTable> | Array<InferTableData<TTable>> | null> {
    const rows = await this.db.insert(this.table).values(input as any).returning();

    if (Array.isArray(input)) {
      return rows as Array<InferTableData<TTable>>;
    }

    return (rows[0] ?? null) as InferTableData<TTable> | null;
  }

  async createMany(records: InferInsertData<TTable>[]): Promise<Array<InferTableData<TTable>>> {
    return await this.create(records) as Array<InferTableData<TTable>>;
  }

  async subscribe(options: TableSubscribeOptions): Promise<Subscription> {
    return await this.db.subscribe(this.table, options);
  }
}

export class PodClient<TSchema extends Record<string, unknown> = Record<string, never>> {
  constructor(private readonly db: SolidDatabase<TSchema>) {}

  asDrizzle(): SolidDatabase<TSchema> {
    return this.db;
  }

  get query() {
    return this.db.query;
  }

  bind<TColumns extends Record<string, PodColumnBase<any, any, any, any>>>(
    schema: SolidSchema<TColumns>,
    options: InstantiateTableOptions,
  ): PodTable<TColumns> {
    return this.db.createTable(schema, options);
  }

  async locationToTable(
    location: DataLocation,
    options?: LocationToTableOptions,
  ): Promise<PodTable<any>> {
    return await this.db.locationToTable(location, options);
  }

  async discoverTablesFor(
    rdfClass: string,
    options?: DiscoverOptions,
    tableOptions?: LocationToTableOptions,
  ): Promise<PodTable<any>[]> {
    return await this.db.discoverTablesFor(rdfClass, options, tableOptions);
  }

  collection<TTable extends PodTable<any>>(table: TTable): PodCollection<TTable, TSchema> {
    return new PodCollection<TTable, TSchema>(this.db, table);
  }

  entity<TTable extends PodTable<any>>(table: TTable, iri: string): PodEntity<TTable, TSchema> {
    return new PodEntity<TTable, TSchema>(this.db, table, iri);
  }

  async init<TTable extends PodTable<any>>(...tables: Array<TTable | TTable[]>): Promise<void> {
    await (this.db as any).init(...tables);
  }

  async connect(): Promise<void> {
    await this.db.connect();
  }

  async disconnect(): Promise<void> {
    await this.db.disconnect();
  }

  async sparql(query: string): Promise<unknown[]> {
    return await this.db.executeSPARQL(query);
  }

  async batch<TOperations extends readonly unknown[]>(operations: TOperations): Promise<{ [K in keyof TOperations]: Awaited<TOperations[K]> }> {
    return await this.db.batch(operations);
  }

  getLastFederatedErrors(): FederatedError[] {
    return this.db.getLastFederatedErrors();
  }

  get discovery() {
    return this.db.discovery;
  }
}

export function pod<TSchema extends Record<string, unknown> = Record<string, never>>(
  session: SolidAuthSession,
  config?: SolidDrizzleConfig<TSchema>,
): PodClient<TSchema> {
  return new PodClient<TSchema>(drizzle(session, config));
}
