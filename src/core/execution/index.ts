/**
 * Execution Module
 *
 * Provides execution strategies for different modes (LDP, SPARQL)
 */

// Types
export type {
  ExecutionStrategy,
  ExecutionStrategyFactory,
  ExecutionResult,
  ExecutionContext,
  InsertQueryPlan,
  UpdateQueryPlan,
  DeleteQueryPlan
} from './types';

// Strategies
export { LdpStrategy } from './ldp-strategy';
export type { LdpStrategyDependencies } from './ldp-strategy';

export { SparqlStrategy } from './sparql-strategy';
export type { SparqlStrategyDependencies } from './sparql-strategy';

// Factory
export { ExecutionStrategyFactoryImpl } from './strategy-factory';
export type { StrategyFactoryDependencies } from './strategy-factory';

// Legacy executor (used internally by LdpStrategy)
export { LdpExecutor } from './ldp-executor';
