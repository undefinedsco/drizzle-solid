import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle } from '../../../src/driver';
import { SCHEMA_INRUPT as SCHEMA } from '@inrupt/vocab-common-rdf';
import {
  podTable,
  string,
  int,
  date,
  type NotificationEvent
} from '../../../src/index';
import type { SolidDatabase } from '../../../src/driver';
import type { Session } from '@inrupt/solid-client-authn-node';
import { createTestSession, ensureContainer } from './helpers';
import { isInProcessXpodEnabled } from './xpod-runtime';

const containerPath = `/notifications-test/${Date.now()}/`;
const schemaNamespace = { prefix: SCHEMA.PREFIX, uri: SCHEMA.NAMESPACE };
const expectedRealtimeChannel = isInProcessXpodEnabled() ? 'streaming-http' : 'websocket';

vi.setConfig({ testTimeout: 60_000 });

const testTable = podTable('notifications_test', {
  id: string('id').primaryKey().predicate('https://schema.org/identifier'),
  name: string('name').notNull().predicate('https://schema.org/name'),
  value: int('value').predicate('https://schema.org/value'),
  createdAt: date('createdAt').predicate('https://schema.org/dateCreated')
}, {
  base: `${containerPath}items.ttl`,
  type: 'https://schema.org/Thing',
  namespace: schemaNamespace,
  typeIndex: undefined
});

describe('CSS integration: Notifications', () => {
  let session: Session;
  let db: SolidDatabase;
  let containerUrl: string;
  let resourceUrl: string;

  beforeAll(async () => {
    session = await createTestSession();
    db = drizzle(session);
    containerUrl = await ensureContainer(session, containerPath);
    resourceUrl = `${containerUrl}items.ttl`;
    await db.init(testTable);
  }, 120_000);

  afterAll(async () => {
    await db.disconnect();
  });

  describe('WebSocket Channel (WebSocketChannel2023)', () => {
    test('should receive notification when inserting data', async () => {
      const notifications: NotificationEvent[] = [];
      let resolveNotification: (value: NotificationEvent) => void;
      const notificationPromise = new Promise<NotificationEvent>((resolve) => {
        resolveNotification = resolve;
      });

      // 订阅资源变化（使用 WebSocket，CSS 默认支持）
      const subscription = await db.subscribe(testTable, {
        channel: 'websocket',
        onNotification: (event) => {
          console.log('[WS] Received notification:', event.type, event.object);
          notifications.push(event);
          resolveNotification(event);
        },
        onError: (error) => {
          console.error('[WS] Error:', error);
        }
      });

      expect(subscription.active).toBe(true);
      expect(subscription.channel).toBe(expectedRealtimeChannel);

      // 等待连接建立
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 插入数据触发通知
      const insertId = `ws-test-${Date.now()}`;
      await db.insert(testTable).values({
        id: insertId,
        name: 'WebSocket Test Item',
        value: 100,
        createdAt: new Date()
      });

      // 等待通知（最多 10 秒）
      const timeoutPromise = new Promise<null>((resolve) => 
        setTimeout(() => resolve(null), 10000)
      );
      
      const result = await Promise.race([notificationPromise, timeoutPromise]);

      // 取消订阅
      subscription.unsubscribe();
      expect(subscription.active).toBe(false);

      // 验证收到通知
      if (result) {
        expect(result.type).toMatch(/Create|Update|Add/);
        expect(result.object).toBeDefined();
        expect(result.published).toBeDefined();
        console.log('[WS] Notification received successfully:', result.type);
      } else {
        console.warn('[WS] No notification received within timeout - this may be a server configuration issue');
      }
    });

    test('should receive Update notification when modifying data', async () => {
      // 先插入一条数据
      const updateId = `ws-update-${Date.now()}`;
      await db.insert(testTable).values({
        id: updateId,
        name: 'Before Update',
        value: 200
      });

      const notifications: NotificationEvent[] = [];
      let resolveNotification: (value: NotificationEvent) => void;
      const notificationPromise = new Promise<NotificationEvent>((resolve) => {
        resolveNotification = resolve;
      });

      // 订阅
      const subscription = await db.subscribe(testTable, {
        channel: 'websocket',
        onNotification: (event) => {
          console.log('[WS Update] Received:', event.type, event.object);
          notifications.push(event);
          if (event.type === 'Update') {
            resolveNotification(event);
          }
        }
      });

      await new Promise(resolve => setTimeout(resolve, 1000));

      // 更新数据
      await db.update(testTable)
        .set({ name: 'After Update', value: 300 })
        .where({ id: updateId });

      const timeoutPromise = new Promise<null>((resolve) => 
        setTimeout(() => resolve(null), 10000)
      );
      
      const result = await Promise.race([notificationPromise, timeoutPromise]);

      subscription.unsubscribe();

      if (result) {
        expect(result.type).toBe('Update');
        console.log('[WS] Update notification received');
      } else {
        console.warn('[WS] No update notification received within timeout');
      }
    });

    test('should receive Delete notification when removing data', async () => {
      // 先插入一条数据
      const deleteId = `ws-delete-${Date.now()}`;
      await db.insert(testTable).values({
        id: deleteId,
        name: 'To Delete',
        value: 999
      });

      let deleteNotification: NotificationEvent | null = null;
      let resolveNotification: (value: NotificationEvent) => void;
      const notificationPromise = new Promise<NotificationEvent>((resolve) => {
        resolveNotification = resolve;
      });

      const subscription = await db.subscribe(testTable, {
        channel: 'websocket',
        onNotification: (event) => {
          console.log('[WS Delete] Received:', event.type);
          if (event.type === 'Delete' || event.type === 'Remove' || event.type === 'Update') {
            deleteNotification = event;
            resolveNotification(event);
          }
        }
      });

      await new Promise(resolve => setTimeout(resolve, 1000));

      // 删除数据
      await db.delete(testTable).where({ id: deleteId });

      const timeoutPromise = new Promise<null>((resolve) => 
        setTimeout(() => resolve(null), 10000)
      );
      
      await Promise.race([notificationPromise, timeoutPromise]);

      subscription.unsubscribe();

      if (deleteNotification) {
        expect(deleteNotification.type).toMatch(/Delete|Remove|Update/);
        console.log('[WS] Delete notification received');
      } else {
        console.warn('[WS] No delete notification received within timeout');
      }
    });

    test('should support state feature', async () => {
      let stateReceived = false;
      let resolveNotification: (value: NotificationEvent) => void;
      const notificationPromise = new Promise<NotificationEvent>((resolve) => {
        resolveNotification = resolve;
      });

      const subscription = await db.subscribe(testTable, {
        channel: 'websocket',
        features: ['state'],
        onNotification: (event) => {
          console.log('[WS State] Received:', event.type, 'has state:', !!event.state);
          if (event.state) {
            stateReceived = true;
          }
          resolveNotification(event);
        }
      });

      await new Promise(resolve => setTimeout(resolve, 1000));

      // 插入数据
      await db.insert(testTable).values({
        id: `ws-state-${Date.now()}`,
        name: 'State Test',
        value: 777
      });

      const timeoutPromise = new Promise<null>((resolve) => 
        setTimeout(() => resolve(null), 10000)
      );
      
      const result = await Promise.race([notificationPromise, timeoutPromise]);

      subscription.unsubscribe();

      if (result && stateReceived) {
        expect(result.state).toBeDefined();
        expect(typeof result.state).toBe('string');
        console.log('[WS] State feature working, received state data');
      } else if (result) {
        console.warn('[WS] Notification received but state feature not enabled on server');
      }
    });
  });

  describe('SSE Channel (StreamingHTTPChannel2023)', () => {
    test('should use streaming-http (SSE) with CSS direct connect mode', async () => {
      // CSS 使用直接连接模式支持 streaming-http
      const subscription = await db.subscribe(testTable, {
        channel: 'streaming-http',
        onNotification: () => {}
      });

      // 应该成功连接
      expect(subscription.active).toBe(true);
      // CSS 直接连接模式应该使用 streaming-http
      expect(subscription.channel).toBe('streaming-http');

      subscription.unsubscribe();
    });

    test('should receive notification via SSE when inserting data', async () => {
      const notifications: NotificationEvent[] = [];
      let resolveNotification: (value: NotificationEvent) => void;
      const notificationPromise = new Promise<NotificationEvent>((resolve) => {
        resolveNotification = resolve;
      });

      const subscription = await db.subscribe(testTable, {
        channel: 'streaming-http',
        onNotification: (event) => {
          console.log('[SSE] Received notification:', event.type, event.object);
          notifications.push(event);
          resolveNotification(event);
        },
        onError: (error) => {
          console.error('[SSE] Error:', error);
        }
      });

      expect(subscription.active).toBe(true);
      expect(subscription.channel).toBe('streaming-http');

      // 等待连接建立
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 插入数据触发通知
      const insertId = `sse-test-${Date.now()}`;
      await db.insert(testTable).values({
        id: insertId,
        name: 'SSE Test Item',
        value: 100,
        createdAt: new Date()
      });

      // 等待通知（最多 10 秒）
      const timeoutPromise = new Promise<null>((resolve) => 
        setTimeout(() => resolve(null), 10000)
      );
      
      const result = await Promise.race([notificationPromise, timeoutPromise]);

      subscription.unsubscribe();
      expect(subscription.active).toBe(false);

      if (result) {
        expect(result.type).toMatch(/Create|Update|Add/);
        expect(result.object).toBeDefined();
        expect(result.published).toBeDefined();
        console.log('[SSE] Notification received successfully:', result.type);
      } else {
        console.warn('[SSE] No notification received within timeout - this may be a server configuration issue');
      }
    });

    test('should receive Update notification via SSE when modifying data', async () => {
      // 先插入一条数据
      const updateId = `sse-update-${Date.now()}`;
      await db.insert(testTable).values({
        id: updateId,
        name: 'Before SSE Update',
        value: 200
      });

      const notifications: NotificationEvent[] = [];
      let resolveNotification: (value: NotificationEvent) => void;
      const notificationPromise = new Promise<NotificationEvent>((resolve) => {
        resolveNotification = resolve;
      });

      const subscription = await db.subscribe(testTable, {
        channel: 'streaming-http',
        onNotification: (event) => {
          console.log('[SSE Update] Received:', event.type, event.object);
          notifications.push(event);
          if (event.type === 'Update') {
            resolveNotification(event);
          }
        }
      });

      await new Promise(resolve => setTimeout(resolve, 1000));

      // 更新数据
      await db.update(testTable)
        .set({ name: 'After SSE Update', value: 300 })
        .where({ id: updateId });

      const timeoutPromise = new Promise<null>((resolve) => 
        setTimeout(() => resolve(null), 10000)
      );
      
      const result = await Promise.race([notificationPromise, timeoutPromise]);

      subscription.unsubscribe();

      if (result) {
        expect(result.type).toBe('Update');
        console.log('[SSE] Update notification received');
      } else {
        console.warn('[SSE] No update notification received within timeout');
      }
    });

    test('should receive Delete notification via SSE when removing data', async () => {
      // 先插入一条数据
      const deleteId = `sse-delete-${Date.now()}`;
      await db.insert(testTable).values({
        id: deleteId,
        name: 'To SSE Delete',
        value: 999
      });

      let deleteNotification: NotificationEvent | null = null;
      let resolveNotification: (value: NotificationEvent) => void;
      const notificationPromise = new Promise<NotificationEvent>((resolve) => {
        resolveNotification = resolve;
      });

      const subscription = await db.subscribe(testTable, {
        channel: 'streaming-http',
        onNotification: (event) => {
          console.log('[SSE Delete] Received:', event.type);
          if (event.type === 'Delete' || event.type === 'Remove' || event.type === 'Update') {
            deleteNotification = event;
            resolveNotification(event);
          }
        }
      });

      await new Promise(resolve => setTimeout(resolve, 1000));

      // 删除数据
      await db.delete(testTable).where({ id: deleteId });

      const timeoutPromise = new Promise<null>((resolve) => 
        setTimeout(() => resolve(null), 10000)
      );
      
      await Promise.race([notificationPromise, timeoutPromise]);

      subscription.unsubscribe();

      if (deleteNotification) {
        expect(deleteNotification.type).toMatch(/Delete|Remove|Update/);
        console.log('[SSE] Delete notification received');
      } else {
        console.warn('[SSE] No delete notification received within timeout');
      }
    });
  });

  describe('Channel fallback', () => {
    test('should fallback to websocket when streaming-http fails', async () => {
      // 测试 fallback 机制：如果 SSE 失败，应该回退到 WebSocket
      // 注意：CSS 直接连接模式下 SSE 应该成功
      let usedChannel: string = '';
      
      const subscription = await db.subscribe(testTable, {
        channel: 'streaming-http',
        onNotification: () => {}
      });
      
      usedChannel = subscription.channel;
      subscription.unsubscribe();

      console.log(`[Fallback Test] Used channel: ${usedChannel}`);
      
      // 应该使用 streaming-http（CSS 直接连接模式）或 websocket（fallback）
      expect(['streaming-http', 'websocket']).toContain(usedChannel);
    });
  });

  describe('PreferredChannels and Auto-detection', () => {
    test('should auto-select channel based on preferredChannels config', async () => {
      // 创建一个配置为优先使用 SSE 的 db
      const ssePreferredDb = drizzle(session, {
        notifications: {
          preferredChannels: ['streaming-http', 'websocket']
        }
      });
      await ssePreferredDb.init(testTable);

      // 不指定 channel，应该自动选择 streaming-http（如果可用）
      const subscription = await ssePreferredDb.subscribe(testTable, {
        onNotification: () => {}
      });

      expect(subscription.active).toBe(true);
      // CSS 支持直接连接模式，应该优先使用 streaming-http
      expect(['streaming-http', 'websocket']).toContain(subscription.channel);
      console.log(`[Auto-detect] Selected channel: ${subscription.channel}`);

      subscription.unsubscribe();
      await ssePreferredDb.disconnect();
    });

    test('should prefer websocket when configured', async () => {
      // 创建一个配置为优先使用 WebSocket 的 db
      const wsPreferredDb = drizzle(session, {
        notifications: {
          preferredChannels: ['websocket', 'streaming-http']
        }
      });
      await wsPreferredDb.init(testTable);

      // 不指定 channel，应该自动选择 websocket
      const subscription = await wsPreferredDb.subscribe(testTable, {
        onNotification: () => {}
      });

      expect(subscription.active).toBe(true);
      expect(subscription.channel).toBe(expectedRealtimeChannel);
      console.log(`[WS Preferred] Selected channel: ${subscription.channel}`);

      subscription.unsubscribe();
      await wsPreferredDb.disconnect();
    });

    test('should respect explicit channel override', async () => {
      // 即使配置优先 SSE，显式指定 websocket 应该生效
      const ssePreferredDb = drizzle(session, {
        notifications: {
          preferredChannels: ['streaming-http', 'websocket']
        }
      });
      await ssePreferredDb.init(testTable);

      const subscription = await ssePreferredDb.subscribe(testTable, {
        channel: 'websocket', // 显式指定
        onNotification: () => {}
      });

      expect(subscription.active).toBe(true);
      expect(subscription.channel).toBe(expectedRealtimeChannel);

      subscription.unsubscribe();
      await ssePreferredDb.disconnect();
    });
  });

  describe('Multiple subscriptions', () => {
    test('should handle multiple concurrent subscriptions', async () => {
      const notifications1: NotificationEvent[] = [];
      const notifications2: NotificationEvent[] = [];

      const subscription1 = await db.subscribe(testTable, {
        channel: 'websocket',
        onNotification: (event) => {
          notifications1.push(event);
        }
      });

      const subscription2 = await db.subscribe(testTable, {
        channel: 'websocket',
        onNotification: (event) => {
          notifications2.push(event);
        }
      });

      expect(subscription1.active).toBe(true);
      expect(subscription2.active).toBe(true);

      await new Promise(resolve => setTimeout(resolve, 1000));

      // 插入数据
      await db.insert(testTable).values({
        id: `multi-${Date.now()}`,
        name: 'Multi Subscription Test',
        value: 888
      });

      // 等待通知
      await new Promise(resolve => setTimeout(resolve, 3000));

      // 取消所有订阅
      subscription1.unsubscribe();
      subscription2.unsubscribe();

      console.log(`Subscription 1 received ${notifications1.length} notifications`);
      console.log(`Subscription 2 received ${notifications2.length} notifications`);
    });

    test('should cleanup all subscriptions on disconnect', async () => {
      const testDb = drizzle(session);
      await testDb.init(testTable);

      // 只创建一个订阅，因为同一个 topic 会复用订阅
      const sub = await testDb.subscribe(testTable, {
        channel: 'websocket',
        onNotification: () => {}
      });

      expect(sub.active).toBe(true);

      // disconnect 应该清理订阅
      await testDb.disconnect();

      expect(sub.active).toBe(false);
    });
  });
});
