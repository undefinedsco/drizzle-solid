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

async function fixedTypeIndexExample() {
  console.log('=== 修复的 TypeIndex 示例 ===\n');

  // 1. 创建数据库连接
  const db = drizzle(solid({
    webId: 'https://example.com/profile/card#me',
    // fetch: authenticatedFetch // 认证后的 fetch 函数
  }));

  await db.connect();

  // 2. 演示基本的数据操作
  console.log('1. 基本数据操作演示...');
  
  // 插入用户数据
  await db.insert(users).values([
    {
      id: 1,
      name: 'Alice Johnson',
      email: 'alice@example.com',
      createdAt: new Date()
    },
    {
      id: 2,
      name: 'Bob Smith',
      email: 'bob@example.com',
      createdAt: new Date()
    }
  ]);
  console.log('✓ 用户数据插入成功');

  // 插入文章数据
  await db.insert(posts).values([
    {
      id: 1,
      title: 'Getting Started with Solid Pods',
      content: 'This is a comprehensive guide...',
      authorId: 1,
      createdAt: new Date()
    },
    {
      id: 2,
      title: 'Building Web Apps with Drizzle',
      content: 'Drizzle ORM makes database operations simple...',
      authorId: 2,
      createdAt: new Date()
    }
  ]);
  console.log('✓ 文章数据插入成功\n');

  // 3. 查询数据
  console.log('2. 查询数据演示...');
  const allUsers = await db.select().from(users);
  console.log('所有用户:', allUsers);

  const allPosts = await db.select().from(posts);
  console.log('所有文章:', allPosts);
  console.log('');

  // 4. 更新数据
  console.log('3. 更新数据演示...');
  await db.update(users)
    .set({ name: 'Alice Johnson Updated' })
    .where({ id: 1 });
  console.log('✓ 用户数据更新成功\n');

  // 5. 删除数据
  console.log('4. 删除数据演示...');
  await db.delete(posts).where({ id: 2 });
  console.log('✓ 文章数据删除成功\n');

  // 6. 演示表的配置信息
  console.log('5. 表配置信息演示...');
  console.log('用户表配置:');
  console.log(`  - 容器路径: ${users.getContainerPath()}`);
  console.log(`  - RDF 类: ${users.getRdfClass()}`);
  console.log(`  - 命名空间: ${JSON.stringify(users.getNamespace())}`);
  
  console.log('\n文章表配置:');
  console.log(`  - 容器路径: ${posts.getContainerPath()}`);
  console.log(`  - RDF 类: ${posts.getRdfClass()}`);
  console.log(`  - 命名空间: ${JSON.stringify(posts.getNamespace())}`);
  console.log('');

  // 7. 演示列信息
  console.log('6. 列信息演示...');
  console.log('用户表列信息:');
  Object.entries(users.getColumns()).forEach(([name, column]) => {
    console.log(`  - ${name}: ${column.dataType} (${column.isReference() ? '引用' : '普通'})`);
  });
  
  console.log('\n文章表列信息:');
  Object.entries(posts.getColumns()).forEach(([name, column]) => {
    console.log(`  - ${name}: ${column.dataType} (${column.isReference() ? '引用' : '普通'})`);
  });
  console.log('');

  // 8. 演示类型推断
  console.log('7. 类型推断演示...');
  console.log('用户表类型推断:');
  console.log('  - id: number (主键)');
  console.log('  - name: string (必需)');
  console.log('  - email: string (必需)');
  console.log('  - createdAt: Date (可选)');
  
  console.log('\n文章表类型推断:');
  console.log('  - id: number (主键)');
  console.log('  - title: string (必需)');
  console.log('  - content: string (可选)');
  console.log('  - authorId: number (必需，引用)');
  console.log('  - createdAt: Date (可选)');
  console.log('');

  // 9. 演示事务
  console.log('8. 事务演示...');
  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id: 3,
      name: 'Charlie Brown',
      email: 'charlie@example.com',
      createdAt: new Date()
    });
    
    await tx.insert(posts).values({
      id: 3,
      title: 'Transaction Test',
      content: 'This is a test post in a transaction',
      authorId: 3,
      createdAt: new Date()
    });
  });
  console.log('✓ 事务操作完成\n');

  // 10. 演示连接信息
  console.log('9. 连接信息演示...');
  const config = db.getConfig();
  console.log('数据库配置:', config);
  console.log('');

  console.log('=== 示例完成 ===');
}

// 运行示例
if (require.main === module) {
  fixedTypeIndexExample().catch(console.error);
}

export { users, posts };
