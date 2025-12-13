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
  };
  const dialect = new PodDialect(dialectConfig);
  
  // 自动连接到Pod
  dialect.connect().catch(console.error);
  
  // 创建PodAsyncSession和PodDatabase
  const podSession = new PodAsyncSession(dialect);
  return new PodDatabase<TSchema>(dialect, podSession, config?.schema);
}

// 导出类型
export type { PodDatabase };
export { PodDatabase as Database };
export type { SolidAuthSession };
