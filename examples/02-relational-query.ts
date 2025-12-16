import { drizzle, podTable, string, uri } from 'drizzle-solid';
import { relations } from 'drizzle-orm';
import { getAuthenticatedSession, getPodBaseUrl } from './utils/auth';
import type { Session } from '@inrupt/solid-client-authn-node';

async function run(providedSession?: Session) {
  const session = providedSession || await getAuthenticatedSession();
  const podBase = getPodBaseUrl(session);

  // 定义 Schema
  const users = podTable('users', {
    id: string('id').primaryKey(),
    name: string('name').predicate('http://xmlns.com/foaf/0.1/name')
  }, {
    base: `${podBase}data/users.ttl`,
    type: 'http://xmlns.com/foaf/0.1/Person'
  });

  const posts = podTable('posts', {
    id: string('id').primaryKey(),
    title: string('title').predicate('http://schema.org/headline'),
    // 定义外键关联：authorId 存储用户的 URI
    authorId: uri('author')
      .predicate('http://schema.org/author')
      .reference(users) // 支持传相对 ID 自动补全为用户 IRI
  }, {
    base: `${podBase}data/posts.ttl`,
    type: 'http://schema.org/CreativeWork'
  });

  // 使用 Drizzle 的 relations API 定义关联
  const postsRelations = relations(posts, ({ one }) => ({
    author: one(users, {
      fields: [posts.authorId],
      references: [users.id],
    }),
  }));

  // 初始化 Schema 对象，传给 drizzle
  const schema = { users, posts, postsRelations };
  const db = drizzle(session, { schema });

  // 准备数据
  console.log('Seeding data...');
  
  // 清理旧数据 (防止重复运行报错)
  try {
    await session.fetch(`${podBase}data/users.ttl`, { method: 'DELETE' });
    await session.fetch(`${podBase}data/posts.ttl`, { method: 'DELETE' });
  } catch {}

  await db.insert(users).values({ id: 'alice', name: 'Alice' });
  // 可以直接传相对 ID：会根据 users 表的 base/subjectTemplate 自动补全为完整 IRI
  await db.insert(posts).values({ id: 'post-1', title: 'Alice\'s Post', authorId: 'alice' });

  // --- 核心展示：Query API ---
  
  console.log('Executing Relational Query...');
  
  // 查找所有帖子，并自动带出作者信息 (Graph Traversal)
  const results = await db.query.posts.findMany({
    with: {
      author: true // 加载关联的 'author' (注意这里用的是 relation 的名字 'author')
    }
  });

  console.log('Posts with Authors:', JSON.stringify(results, null, 2));
  // Output:
  // [
  //   {
  //     id: 'post-1',
  //     title: "Alice's Post",
  //     author: { id: 'alice', name: 'Alice' }  <-- 自动解析关联
  //   }
  // ]
}

if (require.main === module) {
  run().catch(console.error);
}

export { run };
