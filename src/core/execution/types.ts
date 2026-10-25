/**
 * ExecutionStrategy Types
 *
 * Defines the interface for different execution modes (LDP, SPARQL)
 */

import type { PodTable } from '../schema';
import type { QueryCondition } from '../query-conditions';
import type { SelectQueryPlan } from '../select-plan';

// Re-export plan types for convenience
export interface InsertQueryPlan {
  table: PodTable;
  rows: any[];
  ensureContainerExists?: (containerUrl: string) => Promise<void>;
  repairContainerOnWriteFailure?: (containerUrl: string) => Promise<void>;
  skipResourceExistenceCheck?: boolean;
  tableRegistry?: Map<string, PodTable[]>;
  tableNameRegistry?: Map<string, PodTable>;
}

export interface UpdateQueryPlan {
  table: PodTable;
  data: Record<string, any>;
  where: QueryCondition;
}

export interface DeleteQueryPlan {
  table: PodTable;
  where?: QueryCondition;
}

/**
 * Result of an execution operation
 */
export interface ExecutionResult {
  success: boolean;
  source: string;
  status: number;
  via?: string;
  error?: string;
  retried?: boolean;
}

/**
 * Context passed to execution strategies
 */
export interface ExecutionContext {
  /** Pod base URL */
  podUrl: string;
  /** Authenticated fetch function */
  fetch: typeof fetch;
  /** WebID of the current user */
  webId: string;
}

/**
 * ExecutionStrategy interface
 *
 * Abstracts the difference between LDP and SPARQL execution modes.
 * SELECT is required; write operations are optional since SPARQL mode
 * only supports SELECT (writes are routed to LDP for Solid Notifications compatibility).
 */
/**
 * Optional per-call SELECT controls supplied by the executor.
 *
 * `boundEndpoint` is an explicit, per-database scoped SPARQL endpoint. It is
 * authoritative for collection SELECT: when present, strategies must not fall
 * back to the table-level/global endpoint.
 */
/**
 * Per-operation result of evaluating a database's collection-SELECT binding.
 *
 * - `applicable: true` carries the outcome of the single evaluation for this
 *   SELECT (`endpoint` absent means the binding declined this table).
 * - `applicable: false` means the binding does not apply to this operation at
 *   all (INSERT/UPDATE/DELETE). The resolver must never be evaluated for those,
 *   so write-time discovery keeps its baseline behavior.
 */
export type BoundSelectEndpointResolution =
  | { applicable: true; endpoint?: string }
  | { applicable: false };

export interface SelectExecutionOptions {
  /** Per-database scoped endpoint for a collection SELECT. */
  boundEndpoint?: string;
  /**
   * Concrete Pod document for an exact-by-IRI SELECT. When present it wins over
   * any collection endpoint: exact targets must never be widened.
   */
  exactResource?: string;
}

export interface ExecutionStrategy {
  /** Mode identifier */
  readonly mode: 'ldp' | 'sparql';

  /**
   * Execute a SELECT query
   */
  executeSelect(
    plan: SelectQueryPlan,
    containerUrl: string,
    resourceUrl: string,
    options?: SelectExecutionOptions
  ): Promise<any[]>;

  /**
   * Execute an INSERT operation (optional - SPARQL mode does not support writes)
   */
  executeInsert?(
    plan: InsertQueryPlan,
    containerUrl: string,
    resourceUrl: string
  ): Promise<ExecutionResult[]>;

  /**
   * Execute an UPDATE operation (optional - SPARQL mode does not support writes)
   */
  executeUpdate?(
    plan: UpdateQueryPlan,
    containerUrl: string,
    resourceUrl: string
  ): Promise<ExecutionResult[]>;

  /**
   * Execute a DELETE operation (optional - SPARQL mode does not support writes)
   */
  executeDelete?(
    plan: DeleteQueryPlan,
    containerUrl: string,
    resourceUrl: string
  ): Promise<ExecutionResult[]>;
}

/**
 * Factory interface for creating execution strategies
 */
export interface ExecutionStrategyFactory {
  /**
   * Get the appropriate execution strategy for a table
   */
  getStrategy(table: PodTable): ExecutionStrategy;
}
