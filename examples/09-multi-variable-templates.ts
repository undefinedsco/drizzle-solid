/**
 * 09-multi-variable-templates.ts
 *
 * 展示多变量 subjectTemplate 的使用：
 * 1. 按 chatId 分区存储消息
 * 2. 区分集合读取与精确定位
 * 3. 多变量 join 需要完整 locator
 * 4. 设计理念和最佳实践
 */

import { pod, podTable, string, datetime, eq, and, drizzle, asc } from 'drizzle-solid';
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
  const exampleBase = `${podBase}data/examples/${uuid()}/`;
  console.log(`Connected to Pod: ${podBase}`);

  const MessagesTable = podTable('ExampleMessages', {
    id: string('id').primaryKey(),
    chatId: string('chatId').predicate('http://example.org/chatId'),
    content: string('content').predicate('http://schema.org/text'),
    timestamp: datetime('timestamp').predicate('http://schema.org/dateCreated'),
  }, {
    base: `${exampleBase}chats/`,
    sparqlEndpoint: `${exampleBase}chats/-/sparql`,
    subjectTemplate: '{chatId}/messages.ttl#{id}',
    type: 'http://schema.org/Message',
  });

  const PostsTable = podTable('ExamplePosts', {
    id: string('id').primaryKey(),
    chatId: string('chatId').predicate('http://schema.org/isPartOf'),
    title: string('title').predicate('http://schema.org/headline').notNull(),
    messageId: string('messageId').predicate('http://schema.org/identifier'),
  }, {
    base: `${exampleBase}posts/`,
    sparqlEndpoint: `${exampleBase}posts/-/sparql`,
    subjectTemplate: '{id}.ttl',
    type: 'http://schema.org/Article',
  });

  const client = pod(session);
  await client.init(MessagesTable);
  await client.init(PostsTable);

  const messages = client.collection(MessagesTable);
  const db = drizzle(session);

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

  console.log('\n=== 2. 显式集合读取：按 chat 分区读取消息 ===');
  const chat1Messages = await messages.list({
    where: eq(MessagesTable.chatId, 'chat-1'),
  });

  console.log(`Found ${chat1Messages.length} messages in chat-1:`);
  chat1Messages.forEach((msg) => {
    console.log(`  - [${msg.timestamp}] ${msg.content}`);
  });

  console.log('\n=== 3. 精确读取：提供完整 locator ===');
  const exactMessage = await db.findByLocator(MessagesTable, {
    id: msg1Id,
    chatId: 'chat-1',
  });

  console.log('Found exact message:');
  console.log(`  - ID: ${exactMessage?.id}`);
  console.log(`  - Content: ${exactMessage?.content}`);

  console.log('\n=== 4. 精确读取：使用完整 IRI ===');
  const fullUri = `${exampleBase}chats/chat-1/messages.ttl#${msg1Id}`;
  console.log(`Querying with full URI: ${fullUri}`);

  const messageByUri = await client.entity(MessagesTable, fullUri).get();

  console.log('Found message by URI:');
  console.log(`  - Content: ${messageByUri?.content}`);

  console.log('\n=== 5. 错误示例：只给局部 id，不足以精确定位 ===');
  try {
    await db.findByLocator(MessagesTable, {
      id: msg1Id,
    });
    console.log('❌ Should have thrown an error');
  } catch (error: any) {
    console.log('✅ Expected error:');
    console.log(`   ${error.message}`);
  }

  console.log('\n=== 6. 准备 join 数据 ===');
  const JoinMessagesTable = podTable('ExampleJoinMessages', {
    id: string('id').primaryKey(),
    chatId: string('chatId').predicate('http://example.org/chatId'),
    content: string('content').predicate('http://schema.org/text'),
    timestamp: datetime('timestamp').predicate('http://schema.org/dateCreated'),
  }, {
    base: `${exampleBase}chats/`,
    subjectTemplate: '{chatId}/messages.ttl#{id}',
    type: 'http://schema.org/Message',
  });

  const JoinPostsTable = podTable('ExampleJoinPosts', {
    id: string('id').primaryKey(),
    chatId: string('chatId').predicate('http://schema.org/isPartOf'),
    title: string('title').predicate('http://schema.org/headline').notNull(),
    messageId: string('messageId').predicate('http://schema.org/identifier'),
  }, {
    base: `${exampleBase}join-posts.ttl`,
    subjectTemplate: '#{id}',
    type: 'http://schema.org/Article',
  });

  await client.init(JoinPostsTable);

  await db.insert(JoinPostsTable).values([
    { id: uuid(), chatId: 'chat-1', title: 'Post for chat 1', messageId: msg1Id },
    { id: uuid(), chatId: 'chat-2', title: 'Post for chat 2', messageId: msg3Id },
    { id: uuid(), chatId: 'chat-3', title: 'Post without message', messageId: 'missing-message' },
  ]);
  console.log('✅ Inserted post rows for join demo');

  console.log('\n=== 7. 错误 join：只给 messageId，不给 chatId ===');
  try {
    await db.select({
      postTitle: JoinPostsTable.title,
      messageBody: JoinMessagesTable.content,
    })
      .from(JoinPostsTable)
      .leftJoin(JoinMessagesTable, eq(JoinPostsTable.messageId, JoinMessagesTable.id))
      .orderBy(asc(JoinPostsTable.title));
    console.log('❌ Should have thrown an error');
  } catch (error: any) {
    console.log('✅ Expected join error:');
    console.log(`   ${error.message}`);
  }

  console.log('\n=== 8. 正确 join：补齐完整 locator ===');
  const joinedRows = await db.select({
    postTitle: JoinPostsTable.title,
    messageBody: JoinMessagesTable.content,
  })
    .from(JoinPostsTable)
    .leftJoin(JoinMessagesTable, and(
      eq(JoinPostsTable.messageId, JoinMessagesTable.id),
      eq(JoinPostsTable.chatId, JoinMessagesTable.chatId),
    ))
    .orderBy(asc(JoinPostsTable.title));

  joinedRows.forEach((row) => {
    console.log(`  - ${row.postTitle} -> ${row.messageBody ?? '(no match)'}`);
  });

  console.log('\n=== 设计理念总结 ===');
  console.log('1. 多变量模板首先是在表达物理定位，而不只是字段拼接');
  console.log('2. 集合读取可以按分区进行，但这是显式 collection read');
  console.log('3. exact-target 路径要么提供完整 locator，要么直接用完整 IRI');
  console.log('4. 信息不足时直接报错，不要偷偷退化成扫描式执行');
  console.log('\n详细文档：docs/guides/multi-variable-templates.md');
}

if (require.main === module) {
  run().catch(console.error);
}

export { run };
