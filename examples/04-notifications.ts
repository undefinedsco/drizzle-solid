/**
 * 04-notifications.ts
 *
 * 展示 Drizzle Solid 的实时通知功能：
 * 1. 使用 db.subscribe() 订阅表变化
 * 2. 按类型接收通知 (onCreate/onUpdate/onDelete)
 * 3. 在回调中使用 drizzle API 查询最新数据
 */

import { drizzle, podTable, string, datetime, eq } from 'drizzle-solid';
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
  const session = providedSession || await getAuthenticatedSession();
  const podBase = getPodBaseUrl(session);
  console.log(`Connected to Pod: ${podBase}`);

  // 2. 定义表
  const posts = podTable('posts', {
    id: string('id').primaryKey(),
    title: string('title').predicate('http://schema.org/headline'),
    content: string('content').predicate('http://schema.org/text'),
    createdAt: datetime('createdAt').predicate('http://schema.org/dateCreated')
  }, {
    base: `${podBase}data/posts.ttl`,
    type: 'http://schema.org/CreativeWork'
  });

  const db = drizzle(session);

  // 3. 初始化表
  await db.init(posts);

  // 4. 订阅表变化
  console.log(`\nSubscribing to posts table...`);
  
  const subscription = await db.subscribe(posts, {
    // 可选：指定通道类型 ('streaming-http' 或 'websocket')
    // channel: 'websocket',
    
    onCreate: async (activity) => {
      console.log(`\n[CREATE] ${activity.object}`);
      console.log(`  Published: ${activity.published}`);
      // 在回调中可以使用 drizzle API 查询最新数据
      const latest = await db.select().from(posts);
      console.log(`  Current posts count: ${latest.length}`);
    },
    
    onUpdate: async (activity) => {
      console.log(`\n[UPDATE] ${activity.object}`);
      console.log(`  Published: ${activity.published}`);
      const latest = await db.select().from(posts);
      console.log(`  Current posts count: ${latest.length}`);
    },
    
    onDelete: async (activity) => {
      console.log(`\n[DELETE] ${activity.object}`);
      console.log(`  Published: ${activity.published}`);
      const latest = await db.select().from(posts);
      console.log(`  Current posts count: ${latest.length}`);
    },
    
    onAdd: (activity) => {
      console.log(`\n[ADD] ${activity.object} -> ${activity.target}`);
    },
    
    onRemove: (activity) => {
      console.log(`\n[REMOVE] ${activity.object} <- ${activity.target}`);
    },
    
    onError: (error) => {
      console.error('[ERROR]', error.message);
    },
    
    onClose: () => {
      console.log('[CLOSE] Subscription closed');
    }
  });

  console.log(`Subscribed via ${subscription.channel} channel`);
  console.log('Waiting for notifications...\n');

  // 5. 模拟数据变更以触发通知
  const testId = uuid();
  
  // INSERT - 应该触发 onCreate 或 onUpdate
  console.log('Inserting a new post...');
  await db.insert(posts).values({
    id: testId,
    title: 'Notification Test',
    content: 'This post was created to test notifications.',
    createdAt: new Date()
  });

  // 等待通知到达
  await sleep(2000);

  // UPDATE - 应该触发 onUpdate
  console.log('Updating the post...');
  await db.update(posts)
    .set({ title: 'Updated Title' })
    .where(eq(posts.id, testId));

  await sleep(2000);

  // DELETE - 应该触发 onUpdate 或 onDelete
  console.log('Deleting the post...');
  await db.delete(posts).where(eq(posts.id, testId));

  await sleep(2000);

  // 6. 清理
  console.log('\nUnsubscribing...');
  subscription.unsubscribe();
  
  console.log('Done!');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 仅在直接运行时执行
if (require.main === module) {
  run().catch(console.error);
}

export { run };
