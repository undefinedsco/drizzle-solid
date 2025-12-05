/**
 * 03-zero-config-discovery.ts
 * 
 * 展示 "零配置访问" (Zero-Config Access)。
 * 
 * 场景：Bob 想要读取 Alice 分享的消息。
 * 关键点：Bob 的代码中没有任何关于 Alice 数据 URL 的硬编码。
 * 一切都通过 SAI (Solid Application Interoperability) 自动发现。
 */

import { drizzle } from '../src/driver';
import { podTable, string, datetime, uri, id } from '../src/core/pod-table';
import { Session } from '@inrupt/solid-client-authn-node';

// 1. 定义 Schema
// 注意：没有 'base' 属性！只有 'typeIndex: private'。
// 这告诉 Drizzle："去网络上找这个类型的数据，别问我在哪。"
export const messageTable = podTable('message', {
  id: id(), // 必须有主键
  content: string('content').predicate('http://schema.org/text'),
  author: uri('author').predicate('http://schema.org/author'),
  createdAt: datetime('createdAt').predicate('http://schema.org/dateCreated')
}, {
  type: 'http://schema.org/Message',
  typeIndex: 'private', 
  autoRegister: false   // 我们是访客，不注册到自己的索引
});

// 2. Bob 的视角
export async function runBobViewer(bobSession: Session) {
  const db = drizzle(bobSession);

  console.log('🔍 Bob is discovering messages...');
  
  // SELECT: Drizzle 自动执行 Discovery -> 找到 Alice 的 Data Grant -> 找到数据 URL -> 查询
  const messages = await db.select().from(messageTable);

  console.log(`✅ Found ${messages.length} messages:`);
  messages.forEach(msg => {
    console.log(`   - [${msg.author}] ${msg.content}`);
  });

  // WRITE: 甚至可以写入（如果 Alice 给了权限）
  if (messages.length > 0) {
    console.log('✍️  Bob is replying...');
    await db.insert(messageTable).values({
      content: 'I found your chat room automatically!',
      author: bobSession.info.webId,
      createdAt: new Date()
    });
    console.log('✅ Reply sent.');
  }
  
  return messages;
}
