import { drizzle, solid } from '../src/index';
import { podTable, string, int, date, COMMON_NAMESPACES, RDF_CLASSES } from '../src/index';

// 用户表 - 演示类型推断
const users = podTable('users', {
  id: int('id').primaryKey(),
  name: string('name').notNull(),
  email: string('email').notNull(),
  createdAt: date('createdAt'), // 可空字段
}, {
  containerPath: '/users/',
  rdfClass: RDF_CLASSES.SCHEMA_PERSON,
  namespace: COMMON_NAMESPACES.schema
});

// 博客文章表 - 演示引用类型
const posts = podTable('posts', {
  id: int('id').primaryKey(),
  title: string('title').notNull(),
  content: string('content'), // 可空字段
  authorId: int('authorId').notNull().reference(RDF_CLASSES.SCHEMA_PERSON),
  createdAt: date('createdAt'),
}, {
  containerPath: '/posts/',
  rdfClass: RDF_CLASSES.SCHEMA_BLOG_POSTING,
  namespace: COMMON_NAMESPACES.schema
});

async function typeInferenceExample() {
  const db = drizzle(solid({
    webId: 'https://your-pod.solidcommunity.net/profile/card#me'
  }));

  console.log('=== 类型推断示例 ===');

  try {
    // 1. 查询操作 - 类型推断
    console.log('查询用户...');
    const userResults = await db.select().from(users);
    
    if (userResults.length > 0) {
      const firstUser = userResults[0];
      
      // TypeScript 现在知道这些类型：
      // - id: number (主键，非空)
      // - name: string (非空)
      // - email: string (非空)
      // - createdAt: Date | null (可空)
      
      console.log('用户数据:', {
        id: firstUser.id,           // number
        name: firstUser.name,       // string
        email: firstUser.email,     // string
        createdAt: firstUser.createdAt // Date | null
      });
    }

    // 2. 插入操作 - 类型推断
    console.log('插入用户...');
    await db.insert(users).values({
      id: 1,                        // 主键
      name: 'Alice Johnson',        // 必需字段
      email: 'alice@example.com',   // 必需字段
      // createdAt 是可选的，因为它是可空字段
    });

    // 3. 更新操作 - 类型推断
    console.log('更新用户...');
    await db.update(users)
      .set({
        name: 'Alice Updated',      // 所有字段都是可选的
        // email 和 createdAt 都是可选的
      })
      .where({ id: 1 });

    // 4. 引用类型演示
    console.log('插入博客文章...');
    await db.insert(posts).values({
      id: 1,                        // 主键
      title: 'Getting Started with Solid Pods',
      content: 'This is a great introduction...',
      authorId: 1,                  // 引用用户ID
      // createdAt 是可选的
    });

    // 5. 查询博客文章
    console.log('查询博客文章...');
    const postResults = await db.select().from(posts);
    
    if (postResults.length > 0) {
      const firstPost = postResults[0];
      
      // TypeScript 知道这些类型：
      // - id: number (主键)
      // - title: string (非空)
      // - content: string | null (可空)
      // - authorId: number (非空，引用类型)
      // - createdAt: Date | null (可空)
      
      console.log('博客文章数据:', {
        id: firstPost.id,
        title: firstPost.title,
        content: firstPost.content,
        authorId: firstPost.authorId,
        createdAt: firstPost.createdAt
      });
    }

    console.log('类型推断示例完成！');

  } catch (error) {
    console.error('操作失败:', error);
  }
}

// 演示类型推断的优势
function demonstrateTypeSafety() {
  console.log('\n=== 类型安全演示 ===');
  
  // 这些操作现在都有类型检查：
  
  // ✅ 正确的类型
  const correctUser = {
    name: 'Bob Smith',
    email: 'bob@example.com'
  };
  
  // ❌ 错误的类型会被 TypeScript 捕获
  // const wrongUser = {
  //   name: 123,        // 错误：应该是 string
  //   email: 'bob@example.com'
  // };
  
  // ❌ 缺少必需字段会被 TypeScript 捕获
  // const incompleteUser = {
  //   name: 'Bob Smith'
  //   // 缺少 email 字段
  // };
  
  console.log('类型安全演示完成！');
}

// 运行示例
if (require.main === module) {
  typeInferenceExample()
    .then(() => demonstrateTypeSafety());
}

export { users, posts, typeInferenceExample, demonstrateTypeSafety };
