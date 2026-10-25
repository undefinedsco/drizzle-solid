import type { PodTable } from '../schema';
import type { PodOperation } from '../pod-dialect';
import type { QueryCondition } from '../query-conditions';
import type { SelectQueryPlan } from '../select-plan';
import type { InsertQueryPlan, UpdateQueryPlan, DeleteQueryPlan } from '../pod-session';
import type { ASTToSPARQLConverter } from '../ast-to-sparql';
import type { ComunicaSPARQLExecutor } from '../sparql-executor';
import type { BoundSelectEndpointResolution, ExecutionStrategy } from './types';
import type { TableResourceDescriptor } from './pod-executor-types';

export interface PodExecutorDeps {
  ensureConnected: () => Promise<void>;
  ensureTableResourcePath: (
    table: PodTable,
    boundSelect: BoundSelectEndpointResolution
  ) => Promise<void>;
  resolveTableResource: (table: PodTable) => TableResourceDescriptor;
  /**
   * Per-database collection SELECT endpoint, if one is bound. May throw when
   * the binding is invalid so callers fail closed instead of using a broader
   * table/global endpoint.
   */
  resolveBoundSelectEndpoint?: (table: PodTable) => string | undefined;
  resolveTableUrls: (table: PodTable) => { containerUrl: string; resourceUrl: string };
  normalizeResourceUrl: (resourceUrl: string) => string;
  normalizeContainerKey: (containerUrl: string) => string;
  normalizeResourceKey: (resourceUrl: string) => string;
  ensureContainerExists: (containerUrl: string) => Promise<void>;
  ensureResourceExists: (resourceUrl: string, options?: { createIfMissing?: boolean }) => Promise<void>;
  shouldSkipResourcePreparation?: () => boolean;
  shouldUseWriteTimeResourcePreparation?: () => boolean;
  shouldContinueAfterResourcePreparationError?: () => boolean;
  getTableRegistries?: () => {
    tableRegistry: Map<string, PodTable[]>;
    tableNameRegistry: Map<string, PodTable>;
  };
  ensureIdentifierCondition: (
    condition: QueryCondition | undefined,
    table: PodTable,
    resourceUrl: string
  ) => Promise<QueryCondition | undefined>;
  resourceExists: (resourceUrl: string) => Promise<boolean>;
  getStrategy: (table: PodTable) => ExecutionStrategy;
  getLdpStrategy: () => ExecutionStrategy;
  getSparqlStrategy?: () => ExecutionStrategy;
  preparedContainers: Set<string>;
  preparedResources: Set<string>;
  sparqlConverter: ASTToSPARQLConverter;
  sparqlExecutor: ComunicaSPARQLExecutor;
  isSelectPlan: (plan: unknown) => plan is SelectQueryPlan;
  isInsertPlan: (plan: unknown) => plan is InsertQueryPlan;
  isUpdatePlan: (plan: unknown) => plan is UpdateQueryPlan;
  isDeletePlan: (plan: unknown) => plan is DeleteQueryPlan;
}

export class PodExecutor {
  private deps: PodExecutorDeps;

  constructor(deps: PodExecutorDeps) {
    this.deps = deps;
  }

  async query(operation: PodOperation): Promise<unknown[]> {
    await this.deps.ensureConnected();

    // Per-database collection SELECT endpoint binding. Evaluated exactly once
    // per SELECT operation, before any table preparation, so an invalid binding
    // fails closed without probing broader containers first. The resolution is
    // carried as a sentinel so "resolved to nothing" is not re-evaluated as
    // "never resolved".
    // INSERT/UPDATE/DELETE are `applicable: false`: they never evaluate the
    // collection-SELECT resolver, so write-time discovery keeps baseline
    // behavior even when the resolver would throw.
    const boundSelect: BoundSelectEndpointResolution = operation.type === 'select'
      ? { applicable: true, endpoint: this.resolveBoundSelectEndpoint(operation.table) }
      : { applicable: false };
    const boundSelectEndpoint = boundSelect.applicable ? boundSelect.endpoint : undefined;

    // 如果表没有指定 resourcePath，尝试从 TypeIndex 自动发现
    await this.deps.ensureTableResourcePath(operation.table, boundSelect);

    const descriptor = this.deps.resolveTableResource(operation.table);

    // 策略选择：
    // - SELECT: 使用表配置的策略（可能是 SPARQL 或 LDP）
    // - INSERT/UPDATE/DELETE: 强制使用 LDP 策略（SPARQL mode 仅用于查询增强）
    const strategy = operation.type === 'select'
      ? this.getSelectStrategy(operation, descriptor, boundSelectEndpoint)
      : this.deps.getLdpStrategy();

    // LDP container/resource URLs（物理存储位置）
    const { containerUrl, resourceUrl } = this.deps.resolveTableUrls(operation.table);
    const normalizedResourceUrl = this.deps.normalizeResourceUrl(resourceUrl);

    // Exact resource reads already know the concrete Pod document; collection
    // reads may use the configured scoped SPARQL endpoint.
    const exactSelectResourceUrl = operation.type === 'select'
      ? this.getExactSelectResourceUrl(operation)
      : undefined;
    const selectResourceUrl = exactSelectResourceUrl
      ?? (operation.type === 'select' && boundSelectEndpoint
      ? boundSelectEndpoint
      : operation.type === 'select' && descriptor.mode === 'sparql'
      ? descriptor.endpoint
      : normalizedResourceUrl);

    try {
      switch (operation.type) {
        case 'select':
          return await this.executeSelect(
            operation,
            strategy,
            containerUrl,
            selectResourceUrl,
            boundSelectEndpoint,
            exactSelectResourceUrl
          );

        case 'insert':
          return await this.executeInsert(operation, strategy, containerUrl, normalizedResourceUrl, descriptor);

        case 'update':
          return await this.executeUpdate(operation, strategy, containerUrl, normalizedResourceUrl, descriptor);

        case 'delete':
          return await this.executeDelete(operation, strategy, containerUrl, normalizedResourceUrl, descriptor);

        default:
          throw new Error(`Unsupported operation type: ${operation.type}`);
      }
    } catch (error) {
      if (typeof process !== 'undefined' && process.env?.LINX_DEBUG === '1') {
        console.error(`${operation.type.toUpperCase()} operation failed:`, error);
      }
      throw error;
    }
  }

  private shouldSkipResourcePreparation(): boolean {
    return this.deps.shouldSkipResourcePreparation?.() ?? false;
  }

  private shouldUseWriteTimeResourcePreparation(): boolean {
    return this.deps.shouldUseWriteTimeResourcePreparation?.() ?? this.shouldSkipResourcePreparation();
  }

  private shouldContinueAfterResourcePreparationError(): boolean {
    return this.deps.shouldContinueAfterResourcePreparationError?.() ?? false;
  }

  private async prepareResource(operationName: string, prepare: () => Promise<void>): Promise<void> {
    if (this.shouldSkipResourcePreparation()) {
      return;
    }

    try {
      await prepare();
    } catch (error) {
      if (!this.shouldContinueAfterResourcePreparationError()) {
        throw error;
      }
      if (typeof process !== 'undefined' && process.env?.LINX_DEBUG === '1') {
        console.warn(`[${operationName}] Resource preparation failed; continuing in best-effort mode:`, error);
      }
    }
  }

  /**
   * Execute SELECT operation via ExecutionStrategy
   */
  private async executeSelect(
    operation: PodOperation,
    strategy: ExecutionStrategy,
    containerUrl: string,
    resourceUrl: string,
    boundSelectEndpoint?: string,
    exactSelectResourceUrl?: string
  ): Promise<unknown[]> {
    // Build SelectQueryPlan
    let plan: SelectQueryPlan;

    if (operation.plan && this.deps.isSelectPlan(operation.plan)) {
      plan = operation.plan;
    } else if (operation.plan && !this.deps.isSelectPlan(operation.plan)) {
      throw new Error('Invalid plan supplied for select operation');
    } else {
      // Create plan from simple options or SQL
      const alias = operation.table.config.name ?? 'table';
      const basePlan: SelectQueryPlan = {
        baseTable: operation.table,
        baseAlias: alias,
        selectAll: true,
        conditionTree: operation.where as QueryCondition | undefined,
        limit: operation.limit,
        offset: operation.offset,
        distinct: operation.distinct,
        aliasToTable: new Map([[alias, operation.table]]),
        tableToAlias: new Map([[operation.table, alias]])
      };

      // Store the original operation for Strategy to use appropriate conversion
      // Use type assertion to add internal properties
      (basePlan as any)._simpleSelectOptions = !operation.sql ? {
        table: operation.table,
        where: operation.where as Record<string, unknown>,
        limit: operation.limit,
        offset: operation.offset,
        orderBy: operation.orderBy,
        distinct: operation.distinct
      } : undefined;
      (basePlan as any)._sql = operation.sql;

      plan = basePlan;
    }

    // Exact-by-IRI selects target one concrete document and are never bound to
    // the collection endpoint.
    if (exactSelectResourceUrl) {
      return await strategy.executeSelect(
        plan,
        containerUrl,
        resourceUrl,
        { exactResource: exactSelectResourceUrl }
      );
    }

    if (!boundSelectEndpoint) {
      return await strategy.executeSelect(plan, containerUrl, resourceUrl);
    }

    return await strategy.executeSelect(
      plan,
      containerUrl,
      resourceUrl,
      { boundEndpoint: boundSelectEndpoint }
    );
  }

  private getSelectStrategy(
    operation: PodOperation,
    descriptor: TableResourceDescriptor,
    boundSelectEndpoint?: string
  ): ExecutionStrategy {
    if (boundSelectEndpoint) {
      if (!this.deps.getSparqlStrategy) {
        throw new Error(
          'A per-database sparqlEndpoint binding was provided, but SPARQL execution is not available for this database.'
        );
      }
      return this.deps.getSparqlStrategy();
    }
    return this.deps.getStrategy(operation.table);
  }

  private resolveBoundSelectEndpoint(table: PodTable): string | undefined {
    if (!this.deps.resolveBoundSelectEndpoint) {
      return undefined;
    }
    return this.deps.resolveBoundSelectEndpoint(table);
  }

  /**
   * Extract the exact subject IRI when the operation targets one concrete Pod
   * document.
   *
   * Accepts both shapes the public API really produces:
   * - a plain `{ '@id': iri }` where payload, and
   * - the `BinaryExpression` (`type: 'binary_expr'`, left `@id`, operator `=`)
   *   built by `db.select().from(t).whereByIri(iri)` and by the update/delete
   *   exact preflight selects.
   *
   * Only a single equality on `@id` counts; `IN`, ranges, or any condition
   * combined with another predicate is a collection query.
   */
  private getExactSelectIri(operation: PodOperation): string | undefined {
    const candidates: unknown[] = [operation.where];

    const planCondition = (operation.plan as { conditionTree?: unknown } | undefined)
      ?.conditionTree;
    if (planCondition !== undefined) {
      candidates.push(planCondition);
    }

    for (const condition of candidates) {
      const iri = this.extractSingleIdIri(condition, operation);
      if (iri) {
        return iri;
      }
    }

    return undefined;
  }

  private extractSingleIdIri(
    condition: unknown,
    operation: PodOperation
  ): string | undefined {
    if (!condition || typeof condition !== 'object') {
      return undefined;
    }

    const record = condition as Record<string, unknown>;

    if (!('type' in record)) {
      // A bare where object is exact only when '@id' is its ONLY key. An extra
      // predicate makes it a collection query.
      const keys = Object.keys(record);
      if (keys.length !== 1 || keys[0] !== '@id') {
        return undefined;
      }
      const value = record['@id'];
      return this.isExactDocumentIri(value) ? value : undefined;
    }

    if (record.type !== 'binary_expr') {
      return undefined;
    }
    if (record.operator !== '=') {
      return undefined;
    }

    const left = record.left as { name?: unknown } | string | undefined;
    const columnName = typeof left === 'string' ? left : left?.name;
    if (typeof columnName !== 'string' || !this.isSubjectOperand(columnName, operation)) {
      return undefined;
    }

    const right = record.right;
    return this.isExactDocumentIri(right) ? right : undefined;
  }

  /**
   * Only the RDF subject operand is exact:
   * - canonical `@id`, or
   * - the base table's own qualification, `<baseAlias>.@id`.
   *
   * Ordinary columns may legitimately be named like `external@id` or
   * `note@id`; those are filters, never the subject. A foreign join's `<x>.@id`
   * is not the base subject either.
   */
  private isSubjectOperand(columnName: string, operation: PodOperation): boolean {
    if (columnName === '@id') {
      return true;
    }
    const plan = operation.plan as { baseAlias?: unknown } | undefined;
    const baseAlias = typeof plan?.baseAlias === 'string'
      ? plan.baseAlias
      : operation.table.config.name;
    return baseAlias !== undefined && columnName === `${baseAlias}.@id`;
  }

  /** Exact documents are http(s) resource URLs (Solid Pod storage). */
  private isExactDocumentIri(value: unknown): value is string {
    return typeof value === 'string' && /^https?:\/\//i.test(value);
  }

  private getExactSelectResourceUrl(operation: PodOperation): string | undefined {
    const iri = this.getExactSelectIri(operation);
    if (!iri) {
      return undefined;
    }
    const hashIndex = iri.indexOf('#');
    return hashIndex >= 0 ? iri.slice(0, hashIndex) : iri;
  }

  /**
   * Execute INSERT operation via ExecutionStrategy
   */
  private async executeInsert(
    operation: PodOperation,
    strategy: ExecutionStrategy,
    containerUrl: string,
    resourceUrl: string,
    descriptor: TableResourceDescriptor
  ): Promise<unknown[]> {
    const values = Array.isArray(operation.values) ? operation.values : [operation.values];
    if (!values || values.length === 0) {
      throw new Error('INSERT operation requires at least one value');
    }

    const useWriteTimePreparation = this.shouldUseWriteTimeResourcePreparation();
    const repairOnWriteFailure = useWriteTimePreparation && !this.shouldSkipResourcePreparation();

    // Writes always go through LDP, even when SELECT uses a SPARQL endpoint.
    if (!useWriteTimePreparation && !this.deps.preparedContainers.has(this.deps.normalizeContainerKey(containerUrl))) {
      await this.prepareResource('INSERT', () => this.deps.ensureContainerExists(containerUrl));
    }
    if (descriptor.mode === 'ldp' && !useWriteTimePreparation && !this.deps.preparedResources.has(this.deps.normalizeResourceKey(resourceUrl))) {
      await this.prepareResource('INSERT', () => this.deps.ensureResourceExists(resourceUrl, { createIfMissing: true }));
    }

    if (descriptor.mode === 'ldp' && !useWriteTimePreparation) {
      // Pre-flight check for duplicates (Strategy: INSERT means NEW)
      // 如果资源不存在（404），清除缓存以避免后续查询被缓存的 404 影响
      for (const row of values) {
        try {
          const subject = this.deps.sparqlConverter.generateSubjectUri(row, operation.table);
          const askQuery = { type: 'ASK' as const, query: `ASK { <${subject}> ?p ?o }`, prefixes: {} };
          const results = await this.deps.sparqlExecutor.executeQueryWithSource(askQuery, resourceUrl);
          const firstResult = results[0] as { result?: unknown } | undefined;
          if (firstResult?.result) {
            throw new Error(`Duplicate primary key: ${subject} already exists.`);
          }
        } catch (e: any) {
          if (e.message && e.message.includes('Duplicate primary key')) throw e;
          // 资源可能不存在，清除缓存以避免影响后续 INSERT 和 SELECT
          await this.deps.sparqlExecutor.invalidateHttpCache(resourceUrl);
        }
      }
    }

    const insertPlan = {
      ...(this.deps.isInsertPlan(operation.plan)
        ? operation.plan
        : { table: operation.table, rows: values }),
      ensureContainerExists: useWriteTimePreparation
        ? undefined
        : async (targetContainerUrl: string) => {
            await this.prepareResource('INSERT', () => this.deps.ensureContainerExists(targetContainerUrl));
          },
      repairContainerOnWriteFailure: repairOnWriteFailure
        ? async (targetContainerUrl: string) => {
            await this.prepareResource('INSERT', () => this.deps.ensureContainerExists(targetContainerUrl));
          }
        : undefined,
      skipResourceExistenceCheck: useWriteTimePreparation
        || (this.deps.isInsertPlan(operation.plan) && operation.plan.skipResourceExistenceCheck === true),
      tableRegistry: this.deps.getTableRegistries?.().tableRegistry,
      tableNameRegistry: this.deps.getTableRegistries?.().tableNameRegistry,
    };

    if (!strategy.executeInsert) {
      throw new Error('Strategy does not support INSERT operations');
    }

    const results = await strategy.executeInsert(insertPlan, containerUrl, resourceUrl);
    return results;
  }

  /**
   * Execute UPDATE operation via ExecutionStrategy
   */
  private async executeUpdate(
    operation: PodOperation,
    strategy: ExecutionStrategy,
    containerUrl: string,
    resourceUrl: string,
    descriptor: TableResourceDescriptor
  ): Promise<unknown[]> {
    if (!operation.data) {
      throw new Error('UPDATE operation requires data');
    }
    if (!operation.where || Object.keys(operation.where).length === 0) {
      throw new Error('UPDATE operation requires where conditions to locate target resources');
    }

    // LDP mode: ensure container and resource exist first
    if (descriptor.mode === 'ldp' && !this.shouldUseWriteTimeResourcePreparation()) {
      if (!this.deps.preparedContainers.has(this.deps.normalizeContainerKey(containerUrl))) {
        try {
          await this.prepareResource('UPDATE', () => this.deps.ensureContainerExists(containerUrl));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes('Failed to check container: 401') || message.includes('Failed to check container: 403')) {
            console.warn(`[UPDATE] Skipping container existence check for ${containerUrl}: ${message}`);
          } else {
            throw error;
          }
        }
      }
      if (!this.deps.preparedResources.has(this.deps.normalizeResourceKey(resourceUrl))) {
        await this.prepareResource('UPDATE', () => this.deps.ensureResourceExists(resourceUrl, { createIfMissing: false }));
      }
    }

    const updatePlan = this.deps.isUpdatePlan(operation.plan)
      ? operation.plan
      : {
          table: operation.table,
          data: operation.data as Record<string, any>,
          where: operation.where as QueryCondition
        };

    // For SPARQL mode, ensure we have identifier condition
    if (descriptor.mode === 'sparql') {
      const ensuredCondition = await this.deps.ensureIdentifierCondition(
        updatePlan.where,
        updatePlan.table,
        resourceUrl
      );

      if (!ensuredCondition) {
        console.warn('[UPDATE] No matching subjects found for provided condition, skipping update.');
        return [];
      }

      updatePlan.where = ensuredCondition;
    }

    if (!strategy.executeUpdate) {
      throw new Error('Strategy does not support UPDATE operations');
    }

    const results = await strategy.executeUpdate(updatePlan, containerUrl, resourceUrl);
    return results;
  }

  /**
   * Execute DELETE operation via ExecutionStrategy
   */
  private async executeDelete(
    operation: PodOperation,
    strategy: ExecutionStrategy,
    containerUrl: string,
    resourceUrl: string,
    descriptor: TableResourceDescriptor
  ): Promise<unknown[]> {
    // LDP mode: ensure container and resource exist first
    if (descriptor.mode === 'ldp' && !this.shouldUseWriteTimeResourcePreparation()) {
      if (!this.deps.preparedContainers.has(this.deps.normalizeContainerKey(containerUrl))) {
        await this.prepareResource('DELETE', () => this.deps.ensureContainerExists(containerUrl));
      }

      const hasResource = this.deps.preparedResources.has(this.deps.normalizeResourceKey(resourceUrl))
        ? true
        : this.shouldSkipResourcePreparation()
          ? true
          : await this.deps.resourceExists(resourceUrl);
      if (!hasResource) {
        console.log('[DELETE] Target resource does not exist, skipping execution');
        return [{
          success: true,
          source: resourceUrl,
          status: 404
        }];
      }
    }

    const deletePlan = this.deps.isDeletePlan(operation.plan)
      ? operation.plan
      : {
          table: operation.table,
          where: operation.where as QueryCondition | undefined
        };

    // For SPARQL mode with condition, ensure identifier condition
    if (descriptor.mode === 'sparql' && deletePlan.where) {
      const ensuredCondition = await this.deps.ensureIdentifierCondition(
        deletePlan.where,
        deletePlan.table,
        resourceUrl
      );

      if (!ensuredCondition) {
        console.warn('[DELETE] No matching subjects found for provided condition, skipping delete.');
        return [];
      }

      deletePlan.where = ensuredCondition;
    }

    if (!strategy.executeDelete) {
      throw new Error('Strategy does not support DELETE operations');
    }

    const results = await strategy.executeDelete(deletePlan, containerUrl, resourceUrl);
    return results;
  }
}
