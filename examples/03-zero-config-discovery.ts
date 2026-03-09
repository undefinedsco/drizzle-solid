/**
 * 03-zero-config-discovery.ts
 *
 * 展示“零配置访问” (Zero-Config Access)。
 *
 * 场景：Bob 想要读取 Alice 分享的消息。
 * 关键点：Bob 的代码中没有任何关于 Alice 数据 URL 的硬编码。
 * 一切都通过 SAI (Solid Application Interoperability) 自动发现。
 */

import { pod, podTable, string, datetime, uri, id } from 'drizzle-solid';
import { Session } from '@inrupt/solid-client-authn-node';

export const messageTable = podTable('message', {
  id: id(),
  content: string('content').predicate('http://schema.org/text'),
  author: uri('author').predicate('http://schema.org/author'),
  createdAt: datetime('createdAt').predicate('http://schema.org/dateCreated'),
}, {
  type: 'http://schema.org/Message',
  base: '/data/chat/',
  typeIndex: 'private',
  autoRegister: false,
});

export async function runBobViewer(bobSession: Session) {
  const client = pod(bobSession);
  const messagesCollection = client.collection(messageTable);

  console.log('🔍 Bob is discovering messages...');

  const messages = await messagesCollection.list();

  console.log(`✅ Found ${messages.length} messages:`);
  messages.forEach((msg) => {
    console.log(`   - [${msg.author}] ${msg.content}`);
  });

  if (messages.length > 0) {
    console.log('✍️  Bob is replying...');
    await messagesCollection.create({
      content: 'I found your chat room automatically!',
      author: bobSession.info.webId,
      createdAt: new Date(),
    });
    console.log('✅ Reply sent.');
  }

  return messages;
}
