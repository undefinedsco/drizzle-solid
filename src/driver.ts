import type { Session as InruptSession } from '@inrupt/solid-client-authn-node';
import { PodDatabase } from './core/pod-database';
import { PodAsyncSession } from './core/pod-session';
import { PodDialect } from './core/pod-dialect';
import { type DrizzleConfig } from 'drizzle-orm/utils';

// Solid Pod 数据库类型
export type SolidDatabase<TSchema extends Record<string, unknown> = Record<string, never>> = PodDatabase<TSchema>;

// 主要的 drizzle 函数 - 接受 Inrupt Session
export function drizzle<TSchema extends Record<string, unknown> = Record<string, never>>(
  session: InruptSession,
  config?: DrizzleConfig<TSchema>
): SolidDatabase<TSchema> {
  // 验证session
  if (!session || !session.info.isLoggedIn) {
    throw new Error('需要有效的已认证Session');
  }

  // 创建PodDialect
  const dialect = new PodDialect({ session });
  
  // 自动连接到Pod
  dialect.connect().catch(console.error);
  
  // 创建PodAsyncSession和PodDatabase
  const podSession = new PodAsyncSession(dialect);
  return new PodDatabase<TSchema>(dialect, podSession, config?.schema);
}

// 导出类型
export type { PodDatabase };
export { PodDatabase as Database };