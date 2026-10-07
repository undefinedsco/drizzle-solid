import type { PodDialect } from '../pod-dialect';
import type { PodTable } from '../schema';
import { compileProperties } from './compiler';
import { snapshotState } from './snapshot';
import type { ConditionalWriteOptions, ConditionalWriteResult } from './types';

export async function executeConditional(dialect: PodDialect, table: PodTable, subjectIri: string | undefined, options: ConditionalWriteOptions, properties?: Record<string, unknown>): Promise<ConditionalWriteResult> {
  if (!subjectIri) throw new Error('Conditional writes require whereByIri with one exact subject');
  snapshotState(options.snapshot, table, subjectIri, dialect.config.session.fetch);
  const backend = dialect.config.conditionalWriteBackend;
  if (!backend) return { status: 'unsupported', reason: 'No backend with strict conditional-write guarantees has been configured' };
  if (backend.fetch !== dialect.config.session.fetch) return { status: 'unsupported', reason: 'Conditional backend transport differs from the snapshot session' };
  const patch = compileProperties(options.snapshot, table, properties);
  const result = await backend.execute(patch, { authenticatedFetch: dialect.config.session.fetch });
  if (result.status === 'applied') {
    try { await dialect.getSPARQLExecutor().invalidateHttpCache(patch.documentIri); }
    catch (error) { return { ...result, maintenanceErrors: [error] }; }
  }
  return result;
}
