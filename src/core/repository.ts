import type {
  InferInsertData,
  InferTableData,
  InferUpdateData,
  PodColumnBase,
  PodTable,
} from './schema';
import { and, like, or, type QueryCondition } from './query-conditions';
import type { SolidDatabase } from '../driver';

type RepositoryTable = PodTable<any>;
export type AnyPodTable = RepositoryTable;

export interface PodExecutableQuery<TRow = unknown> {
  where(condition: unknown): PodExecutableQuery<TRow>;
  whereByIri?(iri: string | string[]): PodExecutableQuery<TRow>;
  orderBy(...args: unknown[]): PodExecutableQuery<TRow>;
  execute(): Promise<TRow[]>;
}

export interface PodInsertQuery {
  values(values: unknown): { execute(): Promise<unknown[]> };
}

export interface PodUpdateQuery {
  set(values: unknown): PodMutationQuery;
}

export interface PodMutationQuery {
  where(condition: unknown): PodMutationQuery;
  whereByIri?(iri: string): PodMutationQuery;
  execute(): Promise<unknown[]>;
}

export async function initSolidTables(
  db: Pick<SolidDatabase, 'init'>,
  tables: AnyPodTable[],
): Promise<void> {
  await db.init?.(tables as RepositoryTable[]);
}

export interface RepositoryCacheOptions {
  staleTime?: number;
  gcTime?: number;
}

export type RepositoryScope = 'list' | 'detail' | string;

export interface RepositoryInvalidations {
  create?: RepositoryScope[];
  update?: RepositoryScope[];
  remove?: RepositoryScope[];
}

export interface RepositoryFilterContext<TTable extends RepositoryTable, Filters> {
  table: TTable;
  filters?: Filters;
}

export interface PodRepositoryDescriptor<
  TTable extends RepositoryTable,
  Row extends Record<string, unknown> = InferTableData<TTable>,
  Insert = InferInsertData<TTable>,
  Update = InferUpdateData<TTable>,
  Filters extends Record<string, unknown> = Record<string, unknown>
> {
  namespace: string;
  resourcePath: string;
  searchableFields?: (keyof Row & string)[];
  defaultSort?: { field: keyof Row & string; direction: 'asc' | 'desc' };
  cache?: RepositoryCacheOptions;
  invalidations: RepositoryInvalidations;
  list: (db: SolidDatabase, filters?: Filters) => Promise<Row[]>;
  detail: (db: SolidDatabase, id: string) => Promise<Row | null>;
  create?: (db: SolidDatabase, input: Insert) => Promise<Row>;
  update?: (db: SolidDatabase, id: string, input: Update) => Promise<Row>;
  remove?: (db: SolidDatabase, id: string) => Promise<{ id: string }>;
}

export interface PodRepositoryOptions<
  TTable extends RepositoryTable,
  Row extends Record<string, unknown> = InferTableData<TTable>,
  Filters extends Record<string, unknown> = Record<string, unknown>
> {
  namespace: string;
  table: TTable;
  searchableFields?: (keyof Row & string)[];
  searchAccessor?: (filters?: Filters) => string | undefined;
  defaultSort?: { field: keyof Row & string; direction: 'asc' | 'desc' };
  cache?: RepositoryCacheOptions;
  invalidations?: Partial<RepositoryInvalidations>;
  transform?: (row: Row) => Row;
  filter?: (context: RepositoryFilterContext<TTable, Filters>) => QueryCondition | undefined;
  disableMutations?: Partial<Record<'create' | 'update' | 'remove', boolean>>;
}

export function createRepositoryDescriptor<
  TTable extends RepositoryTable,
  Row extends Record<string, unknown> = InferTableData<TTable>,
  Insert = InferInsertData<TTable>,
  Update = InferUpdateData<TTable>,
  Filters extends Record<string, unknown> = Record<string, unknown>
>(options: PodRepositoryOptions<TTable, Row, Filters>): PodRepositoryDescriptor<TTable, Row, Insert, Update, Filters> {
  const {
    namespace,
    table,
    searchableFields,
    defaultSort,
    cache,
  } = options;

  const searchAccessor = options.searchAccessor ?? ((filters?: Filters) => {
    const value = filters ? (filters as Record<string, unknown>).search : undefined;
    return typeof value === 'string' ? value : undefined;
  });
  const transformRow = options.transform ?? ((row: Row) => row);

  const invalidations: RepositoryInvalidations = {
    create: options.invalidations?.create ?? ['list'],
    update: options.invalidations?.update ?? ['list', 'detail'],
    remove: options.invalidations?.remove ?? ['list', 'detail'],
  };

  const resolveColumn = (field: keyof Row & string): PodColumnBase | string => {
    const column = (table as unknown as Record<string, PodColumnBase | undefined>)[field];
    if (column) return column;
    const tableName = (table as { config?: { name?: string } }).config?.name;
    return tableName ? `${tableName}.${field}` : field;
  };

  const buildWhereClause = (filters?: Filters): QueryCondition | undefined => {
    const clauses: QueryCondition[] = [];
    const term = searchAccessor(filters)?.trim();
    if (term && searchableFields?.length) {
      const pattern = `%${term}%`;
      const searchClauses = searchableFields
        .map((field) => like(resolveColumn(field), pattern));
      if (searchClauses.length === 1) {
        clauses.push(searchClauses[0]);
      } else if (searchClauses.length > 1) {
        clauses.push(or(...searchClauses));
      }
    }
    const customFilter = options.filter?.({ table, filters });
    if (customFilter) {
      clauses.push(customFilter);
    }
    if (clauses.length === 0) return undefined;
    return clauses.length === 1 ? clauses[0] : and(...clauses);
  };

  const list = async (db: SolidDatabase, filters?: Filters): Promise<Row[]> => {
    let query = db.select().from(table);
    const whereClause = buildWhereClause(filters);
    if (whereClause) {
      query = query.where(whereClause);
    }
    if (defaultSort) {
      query = query.orderBy(resolveColumn(defaultSort.field), defaultSort.direction);
    }
    const rows = await query.execute();
    return rows.map((row) => transformRow(row as Row));
  };

  const detail = async (db: SolidDatabase, id: string): Promise<Row | null> => {
    const record = await db.findByIri<Row>(table, id);
    return record ? transformRow(record as Row) : null;
  };

  const create = options.disableMutations?.create
    ? undefined
    : async (db: SolidDatabase, input: Insert): Promise<Row> => {
        const inputId = (input as Record<string, unknown>).id;
        const generatedId = typeof inputId === 'string' && inputId.length > 0
          ? inputId
          : crypto.randomUUID();

        const inputWithId = { ...input, id: generatedId } as InferInsertData<TTable>;
        const result = await db.insert(table).values(inputWithId).execute();
        const firstResult = Array.isArray(result) ? result?.[0] : result;

        if (firstResult && typeof firstResult === 'object' && !('success' in firstResult)) {
          return transformRow(firstResult as Row);
        }

        const sourceUrl = firstResult && typeof firstResult === 'object' && 'source' in firstResult
          ? (firstResult as { source: string }).source
          : null;
        const rowIri = sourceUrl
          ? db.resolveRowIri(table, { ...inputWithId, source: sourceUrl })
          : db.resolveRowIri(table, inputWithId as Record<string, unknown>);

        return {
          ...inputWithId,
          id: db.resolveRowId(table, { ...inputWithId, '@id': rowIri }),
          '@id': rowIri,
          subject: rowIri,
          uri: rowIri,
          source: sourceUrl ?? rowIri,
        } as unknown as Row;
      };

  const update = options.disableMutations?.update
    ? undefined
    : async (db: SolidDatabase, id: string, input: Update): Promise<Row> => {
        const updated = await db.updateByIri<Row>(table, id, input as Record<string, unknown>);
        if (updated) {
          return transformRow(updated as Row);
        }
        const next = await detail(db, id);
        if (!next) {
          throw new Error(`Failed to load ${namespace} record after update`);
        }
        return next;
      };

  const remove = options.disableMutations?.remove
    ? undefined
    : async (db: SolidDatabase, id: string): Promise<{ id: string }> => {
        await db.deleteByIri(table, id);
        return { id };
      };

  const resourcePath =
    typeof (table as { getResourcePath?: () => string }).getResourcePath === 'function'
      ? (table as { getResourcePath: () => string }).getResourcePath()
      : ((table as { config?: { base?: string } }).config?.base ?? '');

  return {
    namespace,
    resourcePath,
    searchableFields,
    defaultSort,
    cache,
    invalidations,
    list,
    detail,
    create,
    update,
    remove,
  };
}

export const definePodRepository = createRepositoryDescriptor;
