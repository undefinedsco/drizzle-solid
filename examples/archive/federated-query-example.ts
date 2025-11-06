import { drizzle, solid } from '../src/index';
import { podTable, string, int, date, COMMON_NAMESPACES, RDF_CLASSES } from '../src/index';

// 用户表
const users = podTable('users', {
  id: int('id').primaryKey(),
  name: string('name').notNull(),
  email: string('email').notNull(),
  createdAt: date('createdAt'),
}, {
  containerPath: '/users/',
  rdfClass: RDF_CLASSES.SCHEMA_PERSON,
  namespace: COMMON_NAMESPACES.schema
});

// 文章表
const posts = podTable('posts', {
  id: int('id').primaryKey(),
  title: string('title').notNull(),
  content: string('content'),
  authorId: int('authorId').notNull().reference(RDF_CLASSES.SCHEMA_PERSON),
  createdAt: date('createdAt'),
}, {
  containerPath: '/posts/',
  rdfClass: RDF_CLASSES.SCHEMA_BLOG_POSTING,
  namespace: COMMON_NAMESPACES.schema
});

async function federatedQueryExample() {
  console.log('=== 联邦查询示例 ===\n');

  // 1. 创建数据库连接
  const db = drizzle(solid({
    webId: 'https://alice.solidcommunity.net/profile/card#me'
  }));

  await db.connect();

  // 2. 数据写入 - 写入到当前用户的 Pod
  console.log('1. 数据写入演示...');
  
  // 写入用户数据到 Alice 的 Pod
  await db.insert(users).values({
    id: 1,
    name: 'Alice Johnson',
    email: 'alice@example.com',
    createdAt: new Date()
  });
  console.log('✅ 用户数据写入到 Alice 的 Pod');

  // 写入文章数据到 Alice 的 Pod
  await db.insert(posts).values({
    id: 1,
    title: 'Alice 的第一篇文章',
    content: '这是 Alice 写的文章内容...',
    authorId: 1,
    createdAt: new Date()
  });
  console.log('✅ 文章数据写入到 Alice 的 Pod\n');

  // 3. 联邦查询 - 添加其他用户的数据源
  console.log('2. 联邦查询演示...');
  
  // 添加其他用户的数据源（需要相应的访问权限）
  await db.addSource('https://bob.solidcommunity.net/users/');
  await db.addSource('https://bob.solidcommunity.net/posts/');
  await db.addSource('https://charlie.solidcommunity.net/users/');
  await db.addSource('https://charlie.solidcommunity.net/posts/');
  
  console.log('✅ 添加了 Bob 和 Charlie 的数据源');
  console.log('当前数据源:', db.getSources());

  // 4. 查询所有用户（跨多个 Pod）
  console.log('\n3. 跨 Pod 查询用户...');
  const allUsers = await db.select().from(users);
  console.log('所有用户:', allUsers);
  // 结果包含：Alice 的用户 + Bob 的用户 + Charlie 的用户

  // 5. JOIN 查询 - 文章和作者
  console.log('\n4. JOIN 查询演示...');
  
  // 查询文章及其作者信息
  const postsWithAuthors = await db
    .select()
    .from(posts)
    .leftJoin(users, { 'posts.authorId': 'users.id' });
  
  console.log('文章和作者信息:', postsWithAuthors);
  // 结果包含：Alice 的文章+作者 + Bob 的文章+作者 + Charlie 的文章+作者

  // 6. 复杂 JOIN 查询
  console.log('\n5. 复杂 JOIN 查询...');
  
  // 查询特定作者的所有文章
  const alicePosts = await db
    .select()
    .from(posts)
    .innerJoin(users, { 'posts.authorId': 'users.id' })
    .where({ 'users.name': 'Alice Johnson' });
  
  console.log('Alice 的所有文章:', alicePosts);

  // 7. 数据写入的权限说明
  console.log('\n6. 数据写入权限说明...');
  console.log('✅ 可以写入到自己的 Pod (Alice)');
  console.log('❌ 不能写入到其他人的 Pod (Bob, Charlie) - 没有权限');
  console.log('📝 写入操作始终写入到当前用户的 Pod，不受 addSource 影响');

  // 8. 联邦查询的注意事项
  console.log('\n7. 联邦查询注意事项...');
  console.log('⚠️  需要相应的访问权限才能查询其他用户的数据');
  console.log('⚠️  联邦查询可能较慢，因为需要访问多个数据源');
  console.log('⚠️  不同数据源的数据格式可能不同，需要处理差异');

  console.log('\n=== 示例完成 ===');
}

// 运行示例
if (require.main === module) {
  federatedQueryExample().catch(console.error);
}

export { users, posts };
