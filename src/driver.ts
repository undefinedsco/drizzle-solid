import { PodDatabase } from './core/pod-database';
import { PodAsyncSession } from './core/pod-session';
import { PodDialect, type SolidAuthSession, type PodDialectConfig } from './core/pod-dialect';
import { type DrizzleConfig } from 'drizzle-orm/utils';
import type { ChannelType } from './core/notifications';

// Solid Pod 数据库类型
export type SolidDatabase<TSchema extends Record<string, unknown> = Record<string, never>> = PodDatabase<TSchema>;

// 扩展 DrizzleConfig 以支持 Solid 特定选项
export interface SolidDrizzleConfig<TSchema extends Record<string, unknown> = Record<string, never>> extends DrizzleConfig<TSchema> {
  /** Notifications 配置 */
  notifications?: {
    /** 通道偏好顺序，默认 ['streaming-http', 'websocket'] */
    preferredChannels?: ChannelType[];
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
  // 验证session
  if (!session || !session.info.isLoggedIn) {
    throw new Error('需要有效的已认证Session');
  }

  // 创建PodDialect，传递 notifications 配置
  const dialectConfig: PodDialectConfig = {
    session,
    preferredChannels: config?.notifications?.preferredChannels,
    disableInteropDiscovery: config?.disableInteropDiscovery,
    storageTTL: config?.storageTTL,
    debug: config?.debug,
  };
  const dialect = new PodDialect(dialectConfig);
  
  // 可选：自动连接到 Pod
  if (config?.autoConnect) {
    dialect.connect().catch(console.error);
  }
  
  // 如果有 schema，设置表注册表（用于 URI 引用自动补全）
  if (config?.schema) {
    dialect.setSchema(config.schema as Record<string, unknown>);
  }
  
  // 创建PodAsyncSession和PodDatabase
  const podSession = new PodAsyncSession(dialect);
  return new PodDatabase<TSchema>(dialect, podSession, config?.schema);
}

// 导出类型
export type { PodDatabase };
export { PodDatabase as Database };
export type { SolidAuthSession };
