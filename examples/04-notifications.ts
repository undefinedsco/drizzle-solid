/**
 * 04-notifications.ts
 *
 * 展示 Drizzle Solid 的实时通知功能：
 * 1. 订阅资源变化
 * 2. 接收实时通知
 * 3. 响应数据变更
 */

import { drizzle } from '../src/driver';
import { podTable, string, datetime } from '../src/core/pod-table';
import { NotificationsClient } from '../src/core/notifications';
import { getAuthenticatedSession, getPodBaseUrl } from './utils/auth';
import { v4 as uuid } from 'uuid';
import { eq } from 'drizzle-orm';

import { Session } from '@inrupt/solid-client-authn-node';

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
  const resourceUrl = `${podBase}data/posts.ttl`;

  // 3. 创建 Notifications 客户端
  const notifications = new NotificationsClient(session.fetch);

  // 4. 订阅资源变化
  console.log(`Subscribing to: ${resourceUrl}`);
  
  const subscription = await notifications.subscribe(resourceUrl, {
    // 可选：指定通道类型 ('streaming-http' 或 'websocket')
    // channel: 'websocket',
    
    onNotification: (event) => {
      console.log(`\n[Notification] ${event.type}: ${event.object}`);
      console.log(`  Published: ${event.published}`);
      console.log(`  Event ID: ${event.id}`);
    },
    
    onError: (error) => {
      console.error('[Notification Error]', error.message);
    },
    
    onClose: () => {
      console.log('[Notification] Connection closed');
    }
  });

  console.log(`Subscribed via ${subscription.channel} channel`);
  console.log('Waiting for notifications... (will auto-close in 30 seconds)\n');

  // 5. 模拟数据变更以触发通知
  const testId = uuid();
  
  // INSERT - 应该触发 Update 或 Create 通知
  console.log('Inserting a new post...');
  await db.insert(posts).values({
    id: testId,
    title: 'Notification Test',
    content: 'This post was created to test notifications.',
    createdAt: new Date()
  });

  // 等待通知到达
  await sleep(2000);

  // UPDATE - 应该触发 Update 通知
  console.log('Updating the post...');
  await db.update(posts)
    .set({ title: 'Updated Title' })
    .where(eq(posts.id, testId));

  await sleep(2000);

  // DELETE - 应该触发 Update 通知
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
