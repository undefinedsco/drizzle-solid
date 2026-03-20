import { type DrizzleConfig } from 'drizzle-orm/utils';
import { PodDatabase } from './core/pod-database';
import { PodAsyncSession } from './core/pod-session';
import { PodDialect, type SolidAuthSession, type PodDialectConfig } from './core/pod-dialect';
import type { ChannelType } from './core/notifications';
import type { SPARQLQueryEngineFactory } from './core/sparql-engine';

// Solid Pod 数据库类型
export type SolidDatabase<TSchema extends Record<string, unknown> = Record<string, never>> = PodDatabase<TSchema>;

// 扩展 DrizzleConfig 以支持 Solid 特定选项
export interface SolidDrizzleConfig<TSchema extends Record<string, unknown> = Record<string, never>> extends DrizzleConfig<TSchema> {
  /**
   * Schema registry used for URI/link resolution and typed query access.
   * Drizzle's upstream `DrizzleConfig` typing does not currently expose this field
   * on the imported utility type, so we declare it explicitly here.
   */
  schema?: TSchema;
  /**
   * Backward-compatible alias for legacy drizzle-solid callers.
   * Prefer `debug`, but keep `logger` accepted to avoid needless breakage.
   */
  logger?: boolean;
  /** Notifications 配置 */
  notifications?: {
    /** 通道偏好顺序，默认 ['streaming-http', 'websocket'] */
    preferredChannels?: ChannelType[];
  };
  /** SPARQL 执行器配置 */
  sparql?: {
    /**
     * 自定义 QueryEngine 工厂。
     * 可用于复用宿主应用或 xpod 自身安装的 Comunica。
     */
    createQueryEngine?: SPARQLQueryEngineFactory;
  };
  /** Disable Solid Interop discovery (optional) */
  disableInteropDiscovery?: boolean;
  /**
   * 是否自动连接到 Pod（默认 false，按需延迟连接）
   */
  autoConnect?: boolean;
  /**
   * Storage 缓存过期时间（毫秒），默认 5 分钟
   * 用于 IdP-SP 分离场景，控制从 profile 重新读取 pim:storage 的频率
   */
  storageTTL?: number;
  /**
   * 启用 debug 模式，输出查询信息
   */
  debug?: boolean;
}

// 主要的 drizzle 函数 - 接受 Inrupt Session
export function drizzle<TSchema extends Record<string, unknown> = Record<string, never>>(
  session: SolidAuthSession,
  config?: SolidDrizzleConfig<TSchema>
): SolidDatabase<TSchema> {
  if (!session || !session.info.isLoggedIn) {
    throw new Error('需要有效的已认证Session');
  }

  const dialectConfig: PodDialectConfig = {
    session,
    preferredChannels: config?.notifications?.preferredChannels,
    createQueryEngine: config?.sparql?.createQueryEngine,
    disableInteropDiscovery: config?.disableInteropDiscovery,
    storageTTL: config?.storageTTL,
    debug: config?.debug ?? config?.logger,
  };
  const dialect = new PodDialect(dialectConfig);

  if (config?.autoConnect) {
    dialect.connect().catch(console.error);
  }

  if (config?.schema) {
    dialect.setSchema(config.schema as Record<string, unknown>);
  }

  const podSession = new PodAsyncSession(dialect);
  return new PodDatabase<TSchema>(dialect, podSession, config?.schema);
}

export type { PodDatabase };
export { PodDatabase as Database };
export type { SolidAuthSession };
