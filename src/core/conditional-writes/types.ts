import type { Quad } from '@rdfjs/types';
import type { InferUpdateData, PodTable } from '../schema';

/** Exact GET representation and its version. Created only by readResourceSnapshot. */
export interface ResourceSnapshot<TTable extends PodTable<any> = PodTable<any>> {
  readonly table: TTable;
  readonly subjectIri: string;
  readonly documentIri: string;
  readonly etag: string;
  readonly quads: readonly Quad[];
}
export type ConditionalWriteResult =
  | { status: 'applied'; documentIri: string; etag?: string; maintenanceErrors?: readonly unknown[] }
  | { status: 'conflict'; documentIri: string; httpStatus: number }
  | { status: 'unknown'; documentIri: string; cause: unknown }
  | { status: 'unsupported'; reason: string };
export interface ConditionalPatch {
  readonly documentIri: string;
  readonly etag: string;
  readonly body: string;
}
export interface ConditionalWriteContext {
  readonly authenticatedFetch: typeof fetch;
}
/** Implementations must enforce exact strong If-Match even for equivalent/no-op writes,
 * atomic N3 evaluation and one transport attempt. No retries or representation replacement.
 * Scope and transport guarantees are the implementer's responsibility, not inferred from HTTP 2xx.
 */
export interface ConditionalWriteBackend {
  readonly fetch: typeof fetch;
  execute(patch: ConditionalPatch, context: ConditionalWriteContext): Promise<ConditionalWriteResult>;
}
export interface ConditionalWriteOptions<TTable extends PodTable<any> = PodTable<any>> {
  snapshot: ResourceSnapshot<TTable>;
}

type PartialProperty<T> = T extends Date | readonly unknown[] ? T : T extends object ? { [K in keyof T]?: PartialProperty<T[K]> | null } : T;
/** Selected fields and partial inline objects; null explicitly removes a property. */
export type ConditionalPropertyPatch<TTable extends PodTable<any>> = {
  [K in keyof InferUpdateData<TTable>]?: PartialProperty<InferUpdateData<TTable>[K]> | null;
};
