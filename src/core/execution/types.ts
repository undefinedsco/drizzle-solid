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
export interface ExecutionStrategy {
  /** Mode identifier */
  readonly mode: 'ldp' | 'sparql';

  /**
   * Execute a SELECT query
   */
  executeSelect(
    plan: SelectQueryPlan,
    containerUrl: string,
    resourceUrl: string
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
