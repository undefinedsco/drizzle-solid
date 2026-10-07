import type { ConditionalPropertyPatch, ConditionalWriteResult, PodTable, SolidDatabase } from '../../src';

/** The caller configures a reviewed backend on db. This helper never qualifies or creates resources. */
export async function updateExactResource<TTable extends PodTable<any>>(db: SolidDatabase, table: TTable, iri: string, properties: ConditionalPropertyPatch<TTable>): Promise<ConditionalWriteResult> {
  const snapshot = await db.readResourceSnapshot(table, iri);
  return db.update(table).set(properties).whereByIri(iri).executeConditional({ snapshot });
}
