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

// 博客文章表
const posts = podTable('posts', {
  id: int('id').primaryKey(),
  title: string('title').notNull(),
  content: string('content'),
  // 使用 reference 修饰符指定这是一个引用字段
  authorId: int('authorId').notNull().reference(RDF_CLASSES.SCHEMA_PERSON),
  createdAt: date('createdAt'),
}, {
  containerPath: '/posts/',
  rdfClass: RDF_CLASSES.SCHEMA_BLOG_POSTING,
  namespace: COMMON_NAMESPACES.schema
});

// 标签表
const tags = podTable('tags', {
  id: int('id').primaryKey(),
  name: string('name').notNull(),
  color: string('color'),
}, {
  containerPath: '/tags/',
  rdfClass: 'https://myapp.com/vocab#Tag',
  namespace: { prefix: 'myapp', uri: 'https://myapp.com/vocab#' }
});

// 文章标签关联表（多对多关系）
const postTags = podTable('postTags', {
  id: int('id').primaryKey(),
  postId: int('postId').notNull().reference(RDF_CLASSES.SCHEMA_BLOG_POSTING),
  tagId: int('tagId').notNull().reference('https://myapp.com/vocab#Tag'),
  createdAt: date('createdAt'),
}, {
  containerPath: '/post-tags/',
  rdfClass: 'https://myapp.com/vocab#PostTag',
  namespace: COMMON_NAMESPACES.schema
});

// 评论表（支持嵌套评论）
const comments = podTable('comments', {
  id: int('id').primaryKey(),
  content: string('content').notNull(),
  postId: int('postId').notNull().reference(RDF_CLASSES.SCHEMA_BLOG_POSTING),
  authorId: int('authorId').notNull().reference(RDF_CLASSES.SCHEMA_PERSON),
  // 父评论ID，用于支持嵌套评论
  parentId: int('parentId').reference('https://myapp.com/vocab#Comment'),
  createdAt: date('createdAt'),
}, {
  containerPath: '/comments/',
  rdfClass: 'https://myapp.com/vocab#Comment',
  namespace: COMMON_NAMESPACES.schema
});

async function relationshipsExample() {
  // 创建数据库连接
  const db = drizzle(solid({
    webId: 'https://your-pod.solidcommunity.net/profile/card#me'
  }));

  console.log('=== 关系型数据操作示例 ===');

  try {
    // 1. 创建用户
    console.log('创建用户...');
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

    // 2. 创建标签
    console.log('创建标签...');
    await db.insert(tags).values([
      { id: 1, name: 'Technology', color: '#007bff' },
      { id: 2, name: 'Web Development', color: '#28a745' },
      { id: 3, name: 'Solid Pod', color: '#6f42c1' }
    ]);

    // 3. 创建博客文章（带作者引用）
    console.log('创建博客文章...');
    await db.insert(posts).values([
      {
        id: 1,
        title: 'Getting Started with Solid Pods',
        content: 'Solid Pods are a revolutionary way to store and manage your data...',
        authorId: 1, // 引用用户 Alice
        createdAt: new Date()
      },
      {
        id: 2,
        title: 'Building Web Apps with Drizzle',
        content: 'Drizzle ORM makes database operations simple and type-safe...',
        authorId: 2, // 引用用户 Bob
        createdAt: new Date()
      }
    ]);

    // 4. 创建文章标签关联（多对多关系）
    console.log('创建文章标签关联...');
    await db.insert(postTags).values([
      { id: 1, postId: 1, tagId: 1, createdAt: new Date() }, // 文章1 -> Technology
      { id: 2, postId: 1, tagId: 3, createdAt: new Date() }, // 文章1 -> Solid Pod
      { id: 3, postId: 2, tagId: 1, createdAt: new Date() }, // 文章2 -> Technology
      { id: 4, postId: 2, tagId: 2, createdAt: new Date() }  // 文章2 -> Web Development
    ]);

    // 5. 创建评论（包括嵌套评论）
    console.log('创建评论...');
    await db.insert(comments).values([
      {
        id: 1,
        content: 'Great introduction to Solid Pods!',
        postId: 1,
        authorId: 2,
        parentId: null, // 顶级评论
        createdAt: new Date()
      },
      {
        id: 2,
        content: 'Thanks! I\'m glad you found it helpful.',
        postId: 1,
        authorId: 1,
        parentId: 1, // 回复评论1
        createdAt: new Date()
      },
      {
        id: 3,
        content: 'I have a question about data ownership...',
        postId: 1,
        authorId: 2,
        parentId: null, // 另一个顶级评论
        createdAt: new Date()
      }
    ]);

    // 6. 查询关系数据
    console.log('\n=== 查询关系数据 ===');

    // 查询所有文章及其作者信息
    console.log('查询文章列表...');
    const allPosts = await db.select().from(posts);
    console.log('文章:', allPosts);

    // 查询特定文章的标签
    console.log('查询文章1的标签...');
    const post1Tags = await db.select().from(postTags).where({ postId: 1 });
    console.log('文章1的标签关联:', post1Tags);

    // 查询特定文章的评论
    console.log('查询文章1的评论...');
    const post1Comments = await db.select().from(comments).where({ postId: 1 });
    console.log('文章1的评论:', post1Comments);

    // 查询顶级评论（没有父评论的评论）
    console.log('查询顶级评论...');
    const topLevelComments = await db.select().from(comments).where({ parentId: null });
    console.log('顶级评论:', topLevelComments);

    // 7. 更新关系数据
    console.log('\n=== 更新关系数据 ===');

    // 更新文章作者
    console.log('更改文章2的作者...');
    await db.update(posts)
      .set({ authorId: 1 }) // 改为 Alice
      .where({ id: 2 });

    // 添加新的标签关联
    console.log('为文章2添加新标签...');
    await db.insert(postTags).values({
      id: 5,
      postId: 2,
      tagId: 3, // Solid Pod 标签
      createdAt: new Date()
    });

    // 8. 删除关系数据
    console.log('\n=== 删除关系数据 ===');

    // 删除特定的标签关联
    console.log('删除文章标签关联...');
    await db.delete(postTags).where({ id: 4 });

    // 删除评论（注意：在实际应用中可能需要级联删除子评论）
    console.log('删除评论...');
    await db.delete(comments).where({ id: 3 });

    console.log('关系型数据操作完成！');

  } catch (error) {
    console.error('操作失败:', error);
  }
}

// 演示引用字段的工作原理
function demonstrateReferences() {
  console.log('\n=== 引用字段演示 ===');
  
  // 检查哪些字段是引用类型
  console.log('posts 表中的引用字段:');
  Object.entries(posts.columns).forEach(([name, column]) => {
    if (column.isReference()) {
      console.log(`  ${name}: 引用 -> ${column.options.referenceTarget}`);
    }
  });

  console.log('\ncomments 表中的引用字段:');
  Object.entries(comments.columns).forEach(([name, column]) => {
    if (column.isReference()) {
      console.log(`  ${name}: 引用 -> ${column.options.referenceTarget}`);
    }
  });

  console.log('\npostTags 表中的引用字段:');
  Object.entries(postTags.columns).forEach(([name, column]) => {
    if (column.isReference()) {
      console.log(`  ${name}: 引用 -> ${column.options.referenceTarget}`);
    }
  });
}

// 演示复杂查询场景
async function demonstrateComplexQueries() {
  const db = drizzle(solid({
    webId: 'https://your-pod.solidcommunity.net/profile/card#me'
  }));

  console.log('\n=== 复杂查询演示 ===');

  try {
    // 查询特定作者的所有文章
    console.log('查询 Alice 的所有文章...');
    const alicesPosts = await db.select().from(posts).where({ authorId: 1 });
    console.log('Alice 的文章:', alicesPosts);

    // 查询有特定标签的所有文章
    console.log('查询带有 Technology 标签的文章...');
    const techPosts = await db.select().from(postTags).where({ tagId: 1 });
    console.log('Technology 标签的文章关联:', techPosts);

    // 查询特定文章的所有评论（包括嵌套）
    console.log('查询文章1的所有评论...');
    const allCommentsForPost1 = await db.select().from(comments).where({ postId: 1 });
    console.log('文章1的所有评论:', allCommentsForPost1);

  } catch (error) {
    console.error('查询失败:', error);
  }
}

// 运行示例
if (require.main === module) {
  relationshipsExample()
    .then(() => demonstrateReferences())
    .then(() => demonstrateComplexQueries());
}

export { users, posts, tags, postTags, comments };