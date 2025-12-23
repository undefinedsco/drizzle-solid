/**
 * 01-quick-start.ts
 *
 * 展示 Drizzle Solid 的核心功能：
 * 1. 连接 Solid Pod
 * 2. 定义 RDF Schema 映射 (使用 Schema.org)
 * 3. 执行 SQL 风格的 CRUD
 */

import { drizzle, podTable, string, datetime } from 'drizzle-solid';
import { v4 as uuid } from 'uuid';

import { Session } from '@inrupt/solid-client-authn-node';
import { config as loadEnv } from 'dotenv';

loadEnv();
loadEnv({ path: '.env.local', override: true });

async function getAuthenticatedSession(): Promise<Session> {
  const session = new Session();
  const clientId = process.env.SOLID_CLIENT_ID;
  const clientSecret = process.env.SOLID_CLIENT_SECRET;
  const oidcIssuer = process.env.SOLID_OIDC_ISSUER || 'http://localhost:3000/';

  if (!clientId || !clientSecret) {
    throw new Error('Missing SOLID_CLIENT_ID or SOLID_CLIENT_SECRET');
  }

  await session.login({
    clientId,
    clientSecret,
    oidcIssuer,
    tokenType: 'DPoP'
  });

  if (!session.info.isLoggedIn) {
    throw new Error('Login failed');
  }

  return session;
}

function getPodBaseUrl(session: Session): string {
  if (!session.info.webId) throw new Error('No WebID');
  return session.info.webId.split('profile')[0];
}

async function run(providedSession?: Session) {
  // 1. 认证
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
    // 数据将存储在 /data/posts/ 目录下（Document 模式：每条记录一个文件）
    // - 默认不带 fragment：{id}.ttl -> .../posts/<id>.ttl
    // - 也可以显式带 fragment：{id}.ttl#it -> .../posts/<id>.ttl#it
    base: `${podBase}data/posts/`,
    subjectTemplate: '{id}.ttl',
    type: 'http://schema.org/CreativeWork'
  });

  const db = drizzle(session);
  await db.init([posts]);

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
