/**
 * ExecutionStrategy Factory
 *
 * Creates the appropriate execution strategy based on table configuration.
 * - Tables with sparqlEndpoint -> SparqlStrategy
 * - Tables without sparqlEndpoint -> LdpStrategy
 */

import type { ASTToSPARQLConverter } from '../ast-to-sparql';
import type { QueryCondition } from '../query-conditions';
import type { ResourceResolver } from '../resource-resolver';
import type { PodTable } from '../schema';
import type { ComunicaSPARQLExecutor } from '../sparql-executor';
import type { SPARQLQueryEngineFactory } from '../sparql-engine';
import type { UriResolver } from '../uri';
import { LdpStrategy, type LdpStrategyDependencies } from './ldp-strategy';
import { SparqlStrategy, type SparqlStrategyDependencies } from './sparql-strategy';
import type { LdpExecutor } from './ldp-executor';
import type { ExecutionStrategy, ExecutionStrategyFactory } from './types';

export interface StrategyFactoryDependencies {
  sparqlExecutor: ComunicaSPARQLExecutor;
  sparqlConverter: ASTToSPARQLConverter;
  sessionFetch: typeof fetch;
  podUrl: string;
  createQueryEngine?: SPARQLQueryEngineFactory;
  ldpExecutor: LdpExecutor;
  uriResolver: UriResolver;
  getResolver: (table: PodTable) => ResourceResolver;
  listContainerResources: (containerUrl: string) => Promise<string[]>;
  findSubjectsForCondition: (
    condition: QueryCondition,
    table: PodTable,
    resourceUrl: string
  ) => Promise<string[]>;
}

export class ExecutionStrategyFactoryImpl implements ExecutionStrategyFactory {
  private deps: StrategyFactoryDependencies;

  private ldpStrategy: LdpStrategy | null = null;
  private sparqlStrategy: SparqlStrategy | null = null;

  constructor(deps: StrategyFactoryDependencies) {
    this.deps = deps;
  }

  getStrategy(table: PodTable): ExecutionStrategy {
    const endpoint = table.getSparqlEndpoint?.();

    if (endpoint) {
      return this.getSparqlStrategy();
    }

    return this.getLdpStrategy();
  }

  getLdpStrategy(): LdpStrategy {
    return this.getLdpStrategyInternal();
  }

  private getLdpStrategyInternal(): LdpStrategy {
    if (!this.ldpStrategy) {
      const ldpDeps: LdpStrategyDependencies = {
        sparqlExecutor: this.deps.sparqlExecutor,
        sparqlConverter: this.deps.sparqlConverter,
        fetchFn: this.deps.sessionFetch,
        ldpExecutor: this.deps.ldpExecutor,
        getResolver: this.deps.getResolver,
        listContainerResources: this.deps.listContainerResources,
        findSubjectsForCondition: this.deps.findSubjectsForCondition
      };
      this.ldpStrategy = new LdpStrategy(ldpDeps);
    }
    return this.ldpStrategy;
  }

  private getSparqlStrategy(): SparqlStrategy {
    if (!this.sparqlStrategy) {
      const sparqlDeps: SparqlStrategyDependencies = {
        sparqlExecutor: this.deps.sparqlExecutor,
        sparqlConverter: this.deps.sparqlConverter,
        sessionFetch: this.deps.sessionFetch,
        podUrl: this.deps.podUrl,
        uriResolver: this.deps.uriResolver,
        createQueryEngine: this.deps.createQueryEngine,
      };
      this.sparqlStrategy = new SparqlStrategy(sparqlDeps);
    }
    return this.sparqlStrategy;
  }

  static getMode(table: PodTable): 'ldp' | 'sparql' {
    return table.getSparqlEndpoint?.() ? 'sparql' : 'ldp';
  }
}
