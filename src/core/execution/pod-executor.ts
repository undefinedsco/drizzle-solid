import type { PodTable } from '../schema';
import type { PodOperation } from '../pod-dialect';
import type { QueryCondition } from '../query-conditions';
import type { SelectQueryPlan } from '../select-plan';
import type { InsertQueryPlan, UpdateQueryPlan, DeleteQueryPlan } from '../pod-session';
import type { ASTToSPARQLConverter } from '../ast-to-sparql';
import type { ComunicaSPARQLExecutor } from '../sparql-executor';
import type { ExecutionStrategy } from './types';
import type { TableResourceDescriptor } from './pod-executor-types';

export interface PodExecutorDeps {
  ensureConnected: () => Promise<void>;
  ensureTableResourcePath: (table: PodTable) => Promise<void>;
  resolveTableResource: (table: PodTable) => TableResourceDescriptor;
  resolveTableUrls: (table: PodTable) => { containerUrl: string; resourceUrl: string };
  normalizeResourceUrl: (resourceUrl: string) => string;
  normalizeContainerKey: (containerUrl: string) => string;
  normalizeResourceKey: (resourceUrl: string) => string;
  ensureContainerExists: (containerUrl: string) => Promise<void>;
  ensureResourceExists: (resourceUrl: string, options?: { createIfMissing?: boolean }) => Promise<void>;
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

    // 如果表没有指定 resourcePath，尝试从 TypeIndex 自动发现
    await this.deps.ensureTableResourcePath(operation.table);

    const descriptor = this.deps.resolveTableResource(operation.table);

    // 策略选择：
    // - SELECT: 使用表配置的策略（可能是 SPARQL 或 LDP）
    // - INSERT/UPDATE/DELETE: 强制使用 LDP 策略（SPARQL mode 仅用于查询增强）
    const strategy = operation.type === 'select'
      ? this.getSelectStrategy(operation, descriptor)
      : this.deps.getLdpStrategy();

    // LDP container/resource URLs（物理存储位置）
    const { containerUrl, resourceUrl } = this.deps.resolveTableUrls(operation.table);
    const normalizedResourceUrl = this.deps.normalizeResourceUrl(resourceUrl);

    // SELECT 操作时，SPARQL 策略需要使用表配置的 scoped endpoint。
    // xpod sidecar endpoint 负责定义这个路径下的资源集合；SDK 不用 GRAPH 模拟路径范围。
    const exactSelectResourceUrl = operation.type === 'select'
      ? this.getExactSelectResourceUrl(operation)
      : undefined;
    const selectResourceUrl = operation.type === 'select' && descriptor.mode === 'sparql'
      ? descriptor.endpoint
      : exactSelectResourceUrl ?? normalizedResourceUrl;

    try {
      switch (operation.type) {
        case 'select':
          return await this.executeSelect(operation, strategy, containerUrl, selectResourceUrl);

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

  /**
   * Execute SELECT operation via ExecutionStrategy
   */
  private async executeSelect(
    operation: PodOperation,
    strategy: ExecutionStrategy,
    containerUrl: string,
    resourceUrl: string
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

    const results = await strategy.executeSelect(plan, containerUrl, resourceUrl);
    return results;
  }

  private getSelectStrategy(operation: PodOperation, descriptor: TableResourceDescriptor): ExecutionStrategy {
    return this.deps.getStrategy(operation.table);
  }

  private isExactIriSelect(operation: PodOperation): boolean {
    const condition = operation.where;
    if (!condition || typeof condition !== 'object' || 'type' in condition) {
      return false;
    }
    const value = (condition as Record<string, unknown>)['@id'];
    return typeof value === 'string' && value.startsWith('http');
  }

  private getExactSelectResourceUrl(operation: PodOperation): string | undefined {
    if (!this.isExactIriSelect(operation)) {
      return undefined;
    }
    const iri = (operation.where as Record<string, string>)['@id'];
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

    // Writes always go through LDP, even when SELECT uses a SPARQL endpoint.
    if (!this.deps.preparedContainers.has(this.deps.normalizeContainerKey(containerUrl))) {
      await this.deps.ensureContainerExists(containerUrl);
    }
    if (descriptor.mode === 'ldp' && !this.deps.preparedResources.has(this.deps.normalizeResourceKey(resourceUrl))) {
      await this.deps.ensureResourceExists(resourceUrl, { createIfMissing: true });
    }

    if (descriptor.mode === 'ldp') {
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
      ensureContainerExists: this.deps.ensureContainerExists,
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
    if (descriptor.mode === 'ldp') {
      if (!this.deps.preparedContainers.has(this.deps.normalizeContainerKey(containerUrl))) {
        try {
          await this.deps.ensureContainerExists(containerUrl);
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
        await this.deps.ensureResourceExists(resourceUrl, { createIfMissing: false });
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
    if (descriptor.mode === 'ldp') {
      if (!this.deps.preparedContainers.has(this.deps.normalizeContainerKey(containerUrl))) {
        await this.deps.ensureContainerExists(containerUrl);
      }

      const hasResource = this.deps.preparedResources.has(this.deps.normalizeResourceKey(resourceUrl))
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
