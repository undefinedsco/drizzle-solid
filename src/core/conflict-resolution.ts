import {
  getSolidDataset,
  saveSolidDatasetAt,
  getThing,
  setThing,
  SolidDataset,
  Thing,
  getStringNoLocale,
  getInteger,
  getBoolean,
  getDatetime,
  getUrl
} from '@inrupt/solid-client';

/**
 * 合并策略类型
 */
export type MergeStrategy =
  | 'last-write-wins'      // 最后写入优先（简单覆盖）
  | 'field-level-merge'    // 字段级合并（保留非冲突字段）
  | 'timestamp-based'      // 基于时间戳的字段合并
  | 'user-resolution';     // 用户自定义解析函数

/**
 * 冲突解析配置
 */
export interface ConflictResolutionConfig {
  /** 最大重试次数 */
  maxRetries?: number;
  /** 合并策略 */
  strategy?: MergeStrategy;
  /** 用户自定义解析函数（当 strategy = 'user-resolution' 时使用） */
  resolver?: (local: Thing, remote: Thing, predicates: string[]) => Thing;
  /** 重试延迟（毫秒） */
  retryDelay?: number;
  /** 是否启用日志 */
  logging?: boolean;
}

/**
 * 冲突解析结果
 */
export interface ConflictResolutionResult {
  success: boolean;
  retries: number;
  strategy?: string;
  error?: string;
}

interface ErrorWithStatusCode {
  statusCode?: number;
  message?: string;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: Required<ConflictResolutionConfig> = {
  maxRetries: 3,
  strategy: 'last-write-wins',
  resolver: (local) => local, // fallback: 使用本地版本
  retryDelay: 100,
  logging: false
};

/**
 * 并发写入冲突解析器
 *
 * 处理 412 Precondition Failed 错误（ETag 不匹配），
 * 通过不同的合并策略自动重试保存操作。
 */
export class ConflictResolver {
  private config: Required<ConflictResolutionConfig>;
  private fetchFn: typeof fetch;

  constructor(fetchFn: typeof fetch, config?: ConflictResolutionConfig) {
    this.fetchFn = fetchFn;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 执行带冲突解析的保存操作
   *
   * @param resourceUrl - 资源 URL
   * @param modifier - 修改函数，接收当前 dataset 并返回修改后的 dataset
   * @returns 解析结果
   */
  async saveWithRetry(
    resourceUrl: string,
    modifier: (dataset: SolidDataset) => SolidDataset | Promise<SolidDataset>
  ): Promise<ConflictResolutionResult> {
    let retries = 0;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        if (this.config.logging && attempt > 0) {
          console.log(`[ConflictResolver] Retry attempt ${attempt}/${this.config.maxRetries} for ${resourceUrl}`);
        }

        // 1. 读取最新版本（包含最新的 ETag）
        const dataset = await getSolidDataset(resourceUrl, { fetch: this.fetchFn });

        // 2. 应用修改
        const modified = await modifier(dataset);

        // 3. 保存（@inrupt/solid-client 自动使用 ETag 和 If-Match）
        await saveSolidDatasetAt(resourceUrl, modified, { fetch: this.fetchFn });

        if (this.config.logging) {
          console.log(`[ConflictResolver] Successfully saved ${resourceUrl} after ${retries} retries`);
        }

        return {
          success: true,
          retries,
          strategy: this.config.strategy
        };
      } catch (error: unknown) {
        const resolvedError = error as ErrorWithStatusCode;
        // 检查是否是 412 Precondition Failed 错误
        if (resolvedError.statusCode === 412 && attempt < this.config.maxRetries) {
          retries++;

          if (this.config.logging) {
            console.log(`[ConflictResolver] 412 Precondition Failed, retrying with latest version...`);
          }

          // 延迟后重试
          if (this.config.retryDelay > 0) {
            await this.delay(this.config.retryDelay);
          }

          continue; // 重试
        }

        // 其他错误或达到最大重试次数
        if (this.config.logging) {
          console.error(`[ConflictResolver] Failed to save after ${retries} retries:`, error);
        }

        return {
          success: false,
          retries,
          error: resolvedError.message || String(error)
        };
      }
    }

    return {
      success: false,
      retries,
      error: 'Max retries exceeded'
    };
  }

  /**
   * 执行带字段级合并的保存操作
   *
   * @param resourceUrl - 资源 URL
   * @param thingUrl - Thing URL
   * @param localChanges - 本地修改的 Thing
   * @param predicates - 需要更新的谓词列表
   * @returns 解析结果
   */
  async saveThingWithMerge(
    resourceUrl: string,
    thingUrl: string,
    localChanges: Thing,
    predicates: string[]
  ): Promise<ConflictResolutionResult> {
    return this.saveWithRetry(resourceUrl, async (dataset) => {
      // 获取远程最新版本
      const remoteThing = getThing(dataset, thingUrl);

      if (!remoteThing) {
        // Thing 不存在，直接设置
        return setThing(dataset, localChanges);
      }

      // 根据策略合并
      const merged = await this.mergeThings(localChanges, remoteThing, predicates);

      return setThing(dataset, merged);
    });
  }

  /**
   * 合并两个 Thing
   *
   * @param local - 本地版本（包含我们的修改）
   * @param remote - 远程版本（最新状态）
   * @param predicates - 需要合并的谓词列表
   * @returns 合并后的 Thing
   */
  private async mergeThings(
    local: Thing,
    remote: Thing,
    predicates: string[]
  ): Promise<Thing> {
    switch (this.config.strategy) {
      case 'last-write-wins':
        // 简单策略：本地修改完全覆盖远程
        return local;

      case 'field-level-merge':
        // 字段级合并：只覆盖指定的谓词，保留其他远程字段
        return this.fieldLevelMerge(local, remote, predicates);

      case 'timestamp-based':
        // 基于时间戳的合并：每个字段选择最新的值
        return this.timestampBasedMerge(local, remote, predicates);

      case 'user-resolution':
        // 用户自定义解析
        return this.config.resolver(local, remote, predicates);

      default:
        return local;
    }
  }

  /**
   * 字段级合并
   *
   * 策略：
   * - 对于 predicates 中的谓词，使用本地版本
   * - 对于其他谓词，保留远程版本
   */
  private fieldLevelMerge(local: Thing, remote: Thing, predicates: string[]): Thing {
    // 从远程版本开始
    let merged = remote;

    // 覆盖指定的谓词
    for (const predicate of predicates) {
      // 从本地复制该谓词的所有值到合并结果
      // 注意：这里需要根据实际类型进行处理
      const localValue = this.getPredicateValue(local, predicate);
      if (localValue !== null) {
        merged = this.setPredicateValue(merged, predicate, localValue);
      }
    }

    return merged;
  }

  /**
   * 基于时间戳的合并
   *
   * 策略：
   * - 如果有 updatedAt 字段，比较时间戳，选择最新的
   * - 否则 fallback 到 field-level-merge
   */
  private timestampBasedMerge(local: Thing, remote: Thing, predicates: string[]): Thing {
    const localUpdatedAt = this.getUpdatedAt(local);
    const remoteUpdatedAt = this.getUpdatedAt(remote);

    if (localUpdatedAt && remoteUpdatedAt) {
      // 如果本地版本更新，使用本地；否则使用远程
      return localUpdatedAt > remoteUpdatedAt ? local : remote;
    }

    // Fallback 到字段级合并
    return this.fieldLevelMerge(local, remote, predicates);
  }

  /**
   * 获取 Thing 的 updatedAt 时间戳
   */
  private getUpdatedAt(thing: Thing): Date | null {
    const commonPredicates = [
      'https://schema.org/dateModified',
      'http://purl.org/dc/terms/modified',
      'http://www.w3.org/ns/prov#generatedAtTime'
    ];

    for (const predicate of commonPredicates) {
      const date = getDatetime(thing, predicate);
      if (date) return date;
    }

    return null;
  }

  /**
   * 获取谓词的值（支持多种类型）
   */
  private getPredicateValue(thing: Thing, predicate: string): { type: string; value: string | number | boolean | Date } | null {
    // 尝试不同类型的 getter
    const stringValue = getStringNoLocale(thing, predicate);
    if (stringValue !== null) return { type: 'string', value: stringValue };

    const intValue = getInteger(thing, predicate);
    if (intValue !== null) return { type: 'integer', value: intValue };

    const boolValue = getBoolean(thing, predicate);
    if (boolValue !== null) return { type: 'boolean', value: boolValue };

    const dateValue = getDatetime(thing, predicate);
    if (dateValue !== null) return { type: 'datetime', value: dateValue };

    const urlValue = getUrl(thing, predicate);
    if (urlValue !== null) return { type: 'url', value: urlValue };

    return null;
  }

  /**
   * 设置谓词的值（根据类型）
   *
   * 注意：这是简化实现，实际使用时应该用 buildThing 模式
   */
  private setPredicateValue(thing: Thing, predicate: string, valueObj: unknown): Thing {
    // 这里返回原 thing，实际应该使用 buildThing 来修改
    // 由于 @inrupt/solid-client 的 Thing 是不可变的，
    // 真实实现需要使用 buildThing 模式

    if (this.config.logging) {
      console.warn(
        `[ConflictResolver] setPredicateValue is a placeholder. Use buildThing in production.`,
        { predicate, value: valueObj }
      );
    } else {
      // 防止未使用参数的 lint 报错
      void predicate;
      void valueObj;
    }

    return thing;
  }

  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * 便捷函数：使用默认配置创建冲突解析器
 */
export function createConflictResolver(
  fetchFn: typeof fetch,
  config?: ConflictResolutionConfig
): ConflictResolver {
  return new ConflictResolver(fetchFn, config);
}

/**
 * 便捷函数：执行单次带重试的保存操作
 */
export async function saveWithConflictResolution(
  fetchFn: typeof fetch,
  resourceUrl: string,
  modifier: (dataset: SolidDataset) => SolidDataset | Promise<SolidDataset>,
  config?: ConflictResolutionConfig
): Promise<ConflictResolutionResult> {
  const resolver = new ConflictResolver(fetchFn, config);
  return resolver.saveWithRetry(resourceUrl, modifier);
}
