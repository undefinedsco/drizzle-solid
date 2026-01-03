/**
 * LDP Execution Strategy
 *
 * Implements ExecutionStrategy for LDP mode.
 * - SELECT: Uses Comunica to query RDF resources
 * - INSERT/UPDATE/DELETE: Uses N3 Patch or PUT
 */

import type { PodTable } from '../schema';
import type { ComunicaSPARQLExecutor } from '../sparql-executor';
import type { ASTToSPARQLConverter, SPARQLQuery } from '../ast-to-sparql';
import type { ResourceResolver } from '../resource-resolver';
import type { QueryCondition } from '../query-conditions';
import type { SelectQueryPlan } from '../select-plan';
import type {
  ExecutionStrategy,
  ExecutionResult,
  InsertQueryPlan,
  UpdateQueryPlan,
  DeleteQueryPlan
} from './types';
import { LdpExecutor } from './ldp-executor';

export interface LdpStrategyDependencies {
  sparqlExecutor: ComunicaSPARQLExecutor;
  sparqlConverter: ASTToSPARQLConverter;
  fetchFn: typeof fetch;
  ldpExecutor: LdpExecutor;
  getResolver: (table: PodTable) => ResourceResolver;
  listContainerResources: (containerUrl: string) => Promise<string[]>;
  findSubjectsForCondition: (
    condition: QueryCondition,
    table: PodTable,
    resourceUrl: string
  ) => Promise<string[]>;
}

export class LdpStrategy implements ExecutionStrategy {
  readonly mode = 'ldp' as const;

  private sparqlExecutor: ComunicaSPARQLExecutor;
  private sparqlConverter: ASTToSPARQLConverter;
  private fetchFn: typeof fetch;
  private ldpExecutor: LdpExecutor;
  private getResolver: (table: PodTable) => ResourceResolver;
  private listContainerResources: (containerUrl: string) => Promise<string[]>;
  private findSubjectsForCondition: (
    condition: QueryCondition,
    table: PodTable,
    resourceUrl: string
  ) => Promise<string[]>;

  constructor(deps: LdpStrategyDependencies) {
    this.sparqlExecutor = deps.sparqlExecutor;
    this.sparqlConverter = deps.sparqlConverter;
    this.fetchFn = deps.fetchFn;
    this.ldpExecutor = deps.ldpExecutor;
    this.getResolver = deps.getResolver;
    this.listContainerResources = deps.listContainerResources;
    this.findSubjectsForCondition = deps.findSubjectsForCondition;
  }

  /**
   * Execute SELECT query in LDP mode
   * Uses ResourceResolver to determine which sources to query
   */
  async executeSelect(
    plan: SelectQueryPlan,
    containerUrl: string,
    _resourceUrl: string
  ): Promise<any[]> {
    const table = plan.baseTable;
    if (!table) {
      throw new Error('SELECT plan must have a baseTable');
    }

    const resolver = this.getResolver(table);
    const conditionTree = plan.conditionTree;

    // Resolve which sources to query based on mode (fragment/document)
    const sources = await resolver.resolveSelectSources(
      table,
      containerUrl,
      conditionTree as QueryCondition | undefined,
      () => this.listContainerResources(containerUrl)
    );

    // Convert plan to SPARQL - check for simple select options or SQL
    let sparqlQuery;
    const extendedPlan = plan as SelectQueryPlan & {
      _simpleSelectOptions?: {
        table: any;
        where?: Record<string, unknown>;
        limit?: number;
        offset?: number;
        orderBy?: Array<{ column: string; direction: 'asc' | 'desc' }>;
        distinct?: boolean;
      };
      _sql?: any;
    };

    if (extendedPlan._simpleSelectOptions) {
      // Use convertSimpleSelect for simple operations
      sparqlQuery = this.sparqlConverter.convertSimpleSelect(extendedPlan._simpleSelectOptions, undefined, undefined, false);
    } else if (extendedPlan._sql) {
      // Use convertSelect for SQL-based operations
      const ast = this.sparqlConverter.parseDrizzleAST(extendedPlan._sql, table);
      sparqlQuery = this.sparqlConverter.convertSelect(ast, table, undefined, undefined, false);
    } else {
      // Use convertSelectPlan for full plans
      sparqlQuery = this.sparqlConverter.convertSelectPlan(plan, undefined, undefined, false);
    }

    // Execute on each source and collect results
    const allResults: any[] = [];
    for (const source of sources) {
      try {
        const results = await this.sparqlExecutor.queryContainer(source, sparqlQuery);
        allResults.push(...results);
      } catch (e) {
        // Skip sources that can't be queried (e.g., 404)
        console.warn(`[LdpStrategy] Failed to query source ${source}:`, e);
      }
    }

    return allResults;
  }

  /**
   * Execute INSERT operation in LDP mode
   */
  async executeInsert(
    plan: InsertQueryPlan,
    _containerUrl: string,
    resourceUrl: string
  ): Promise<ExecutionResult[]> {
    const results = await this.ldpExecutor.executeInsert(
      plan.rows,
      plan.table,
      resourceUrl
    );
    return results as ExecutionResult[];
  }

  /**
   * Execute UPDATE operation in LDP mode
   */
  async executeUpdate(
    plan: UpdateQueryPlan,
    containerUrl: string,
    resourceUrl: string
  ): Promise<ExecutionResult[]> {
    const resolver = this.getResolver(plan.table);

    // Resolve which subjects to update
    const subjects = await resolver.resolveSubjectsForMutation(
      plan.table,
      plan.where,
      (url) => this.findSubjectsForCondition(plan.where, plan.table, url),
      () => this.listContainerResources(containerUrl)
    );

    if (subjects.length === 0) {
      return [];
    }

    const results = await this.ldpExecutor.executeUpdate(
      plan.table,
      plan.data,
      subjects,
      resourceUrl
    );
    return results as ExecutionResult[];
  }

  /**
   * Execute DELETE operation in LDP mode
   */
  async executeDelete(
    plan: DeleteQueryPlan,
    containerUrl: string,
    resourceUrl: string
  ): Promise<ExecutionResult[]> {
    if (!plan.where) {
      // Cannot delete without condition in LDP mode (safety)
      return [];
    }

    const resolver = this.getResolver(plan.table);

    // Resolve which subjects to delete
    const subjects = await resolver.resolveSubjectsForMutation(
      plan.table,
      plan.where,
      (url) => this.findSubjectsForCondition(plan.where!, plan.table, url),
      () => this.listContainerResources(containerUrl)
    );

    if (subjects.length === 0) {
      return [];
    }

    const results = await this.ldpExecutor.executeDelete(
      subjects,
      plan.table,
      resourceUrl
    );
    return results as ExecutionResult[];
  }
}
