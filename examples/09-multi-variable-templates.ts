/**
 * 09-multi-variable-templates.ts
 *
 * 展示多变量 subjectTemplate 的使用：
 * 1. 按 chatId 分区存储消息
 * 2. 三种查询方式：完整 URI、所有变量、部分变量
 * 3. 设计理念和最佳实践
 */

import { pod, podTable, string, datetime, eq, and } from 'drizzle-solid';
import { Session } from '@inrupt/solid-client-authn-node';
import { config as loadEnv } from 'dotenv';
import { v4 as uuid } from 'uuid';

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
    tokenType: 'DPoP',
  });

  if (!session.info.isLoggedIn) {
    throw new Error('Login failed');
  }

  return session;
}

function getPodBaseUrl(session: Session): string {
  if (!session.info.webId) {
    throw new Error('No WebID');
  }
  return session.info.webId.split('profile')[0];
}

async function run(providedSession?: Session) {
  const session = providedSession || await getAuthenticatedSession();
  const podBase = getPodBaseUrl(session);
  console.log(`Connected to Pod: ${podBase}`);

  const Message = podTable('Message', {
    id: string('id').primaryKey(),
    chatId: string('chatId').predicate('http://example.org/chatId'),
    content: string('content').predicate('http://schema.org/text'),
    timestamp: datetime('timestamp').predicate('http://schema.org/dateCreated'),
  }, {
    base: `${podBase}data/chats/`,
    subjectTemplate: '{chatId}/messages.ttl#{id}',
    type: 'http://schema.org/Message',
  });

  const client = pod(session);
  await client.init(Message);

  const messages = client.collection(Message);

  console.log('\n=== 1. 插入数据到不同的 chat ===');

  const msg1Id = uuid();
  await messages.create({
    id: msg1Id,
    chatId: 'chat-1',
    content: 'Hello from chat 1',
    timestamp: new Date('2024-03-04T10:00:00Z'),
  });
  console.log(`✅ Inserted message to chat-1: ${msg1Id}`);

  const msg2Id = uuid();
  await messages.create({
    id: msg2Id,
    chatId: 'chat-1',
    content: 'Second message in chat 1',
    timestamp: new Date('2024-03-04T10:05:00Z'),
  });
  console.log(`✅ Inserted message to chat-1: ${msg2Id}`);

  const msg3Id = uuid();
  await messages.create({
    id: msg3Id,
    chatId: 'chat-2',
    content: 'Hello from chat 2',
    timestamp: new Date('2024-03-04T10:10:00Z'),
  });
  console.log(`✅ Inserted message to chat-2: ${msg3Id}`);

  console.log('\n=== 2. 查询方式 1: 提供部分变量（查询某个 chat 的所有消息）===');
  const chat1Messages = await messages.list({
    where: eq(Message.chatId, 'chat-1'),
  });

  console.log(`Found ${chat1Messages.length} messages in chat-1:`);
  chat1Messages.forEach((msg) => {
    console.log(`  - [${msg.timestamp}] ${msg.content}`);
  });

  console.log('\n=== 3. 查询方式 2: 提供所有变量（精确查询）===');
  const exactMessage = await messages.list({
    where: and(
      eq(Message.id, msg1Id),
      eq(Message.chatId, 'chat-1'),
    ),
    limit: 1,
  });

  console.log('Found exact message:');
  console.log(`  - ID: ${exactMessage[0].id}`);
  console.log(`  - Content: ${exactMessage[0].content}`);

  console.log('\n=== 4. 查询方式 3: 使用完整 URI（最高效）===');
  const fullUri = `${podBase}data/chats/chat-1/messages.ttl#${msg1Id}`;
  console.log(`Querying with full URI: ${fullUri}`);

  const messageByUri = await client.entity(Message, fullUri).get();

  console.log('Found message by URI:');
  console.log(`  - Content: ${messageByUri?.content}`);

  console.log('\n=== 5. 错误示例：只提供短 id（会报错）===');
  try {
    await messages.list({
      where: eq(Message.id, msg1Id),
    });
    console.log('❌ Should have thrown an error');
  } catch (error: any) {
    console.log('✅ Expected error:');
    console.log(`   ${error.message}`);
  }

  console.log('\n=== 设计理念总结 ===');
  console.log('1. 完整 URI 查询：O(1) - 直接定位资源');
  console.log('2. 所有变量查询：O(1) - 解析路径后直接定位');
  console.log('3. 部分变量查询：O(n) - 扫描子容器');
  console.log('4. 缺少变量时报错：避免意外的全容器扫描');
  console.log('\n详细文档：docs/guides/multi-variable-templates.md');
}

if (require.main === module) {
  run().catch(console.error);
}

export { run };
