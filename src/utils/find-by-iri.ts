import { PodAsyncSession } from '../core/pod-session';
import { PodDatabase } from '../core/pod-database';
import { PodTable, type InferTableData } from '../core/pod-table';

const isPodDatabase = (value: unknown): value is PodDatabase => {
  return !!value && typeof value === 'object' && 'session' in (value as Record<string, unknown>);
};

/**
 * 从绝对 IRI 或 fragment 查询单行记录。
 * 支持传入 PodDatabase 或 PodAsyncSession。
 */
export async function findByIRI<TTable extends PodTable<any>>(
  dbOrSession: PodDatabase | PodAsyncSession,
  table: TTable,
  iri: string
): Promise<InferTableData<TTable> | null> {
  const session = isPodDatabase(dbOrSession)
    ? (dbOrSession as PodDatabase).session
    : (dbOrSession as PodAsyncSession);

  const where = iri.includes('://')
    ? { '@id': iri }
    : { id: iri };

  const rows = await session
    .select()
    .from(table)
    .where(where)
    .limit(1);

  return rows[0] ?? null;
}
