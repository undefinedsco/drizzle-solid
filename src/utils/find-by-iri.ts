import { PodAsyncSession } from '../core/pod-session';
import { PodDatabase } from '../core/pod-database';
import { PodTable, type InferTableData } from '../core/schema';

const isPodDatabase = (value: unknown): value is PodDatabase => {
  return !!value && typeof value === 'object' && 'session' in (value as Record<string, unknown>);
};

type GenericPodTable = PodTable<any>;

/**
 * 从绝对 IRI 或 fragment 查询单行记录。
 * 支持传入 PodDatabase 或 PodAsyncSession。
 */
export async function findByIRI<TTable extends GenericPodTable>(
  dbOrSession: PodDatabase | PodAsyncSession,
  table: TTable,
  iri: string
): Promise<InferTableData<TTable> | null> {
  if (!iri || (typeof iri === 'string' && !iri.includes('://'))) {
    throw new Error('findByIRI requires an absolute IRI. Use findById() for base-relative resource ids.');
  }

  if (isPodDatabase(dbOrSession)) {
    return await dbOrSession.findByIri(table, iri);
  }

  const rows = await dbOrSession
    .select()
    .from(table)
    .whereByIri(iri)
    .limit(1);

  return rows[0] ?? null;
}
