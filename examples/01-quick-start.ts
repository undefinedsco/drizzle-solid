/**
 * 01-quick-start.ts
 *
 * 展示 Drizzle Solid 的核心功能：
 * 1. 连接 Solid Pod
 * 2. 定义 RDF Schema 映射 (使用 Schema.org)
 * 3. 执行 SQL 风格的 CRUD
 */

import { drizzle } from '../src/driver';
import { podTable, string, datetime } from '../src/core/pod-table';
import { getAuthenticatedSession, getPodBaseUrl } from './utils/auth';
import { v4 as uuid } from 'uuid';

import { Session } from '@inrupt/solid-client-authn-node';

async function run(providedSession?: Session) {
  // 1. 认证 (见 utils/auth.ts)
  // 如果测试运行器提供了 session，则直接使用，否则执行登录
  const session = providedSession || await getAuthenticatedSession();
  const podBase = getPodBaseUrl(session);
  console.log(`Connected to Pod: ${podBase}`);

  // 2. 定义表 (Schema)
  // 我们定义一个简单的 'Post' 表，映射到 schema:CreativeWork
  const posts = podTable('posts', {
    id: string('id').primaryKey(),
    title: string('title').predicate('http://schema.org/headline'),
    content: string('content').predicate('http://schema.org/text'),
    createdAt: datetime('createdAt').predicate('http://schema.org/dateCreated')
  }, {
    // 数据将存储在 /data/posts.ttl 文件中 (Fragment 模式)
    base: `${podBase}data/posts.ttl`, 
    type: 'http://schema.org/CreativeWork'
  });

  const db = drizzle(session);

  // 3. 写入数据 (INSERT)
  const newId = uuid();
  console.log(`Creating post... ${newId}`);
  
  await db.insert(posts).values({
    id: newId,
    title: 'Hello Drizzle Solid',
    content: 'This is my first post using Drizzle ORM on Solid.',
    createdAt: new Date()
  });

  // 4. 读取数据 (SELECT)
  console.log('Reading posts...');
  const result = await db.select().from(posts);
  
  console.log('Found posts:', result);

  // 5. 清理
  // await db.delete(posts).where(eq(posts.id, newId));
}

// 仅在直接运行时执行
if (require.main === module) {
  run().catch(console.error);
}

export { run }; // 导出供测试调用
