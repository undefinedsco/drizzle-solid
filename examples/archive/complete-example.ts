import { 
  drizzle,
  solid,
  podTable, 
  string, 
  int, 
  boolean, 
  date,
  RDF_PREDICATES,
  RDF_CLASSES
} from '../src/index';

// 定义完整的数据模型

// 用户表
const users = podTable('users', {
  id: int('id').primaryKey(),
  name: string('name').notNull(),
  email: string('email').notNull(),
  isActive: boolean('isActive').default(true),
  createdAt: date('createdAt').predicate(RDF_PREDICATES.SCHEMA_DATE_CREATED),
  updatedAt: date('updatedAt').predicate(RDF_PREDICATES.SCHEMA_DATE_MODIFIED),
}, {
  containerPath: '/users/',
  rdfClass: RDF_CLASSES.SCHEMA_PERSON,
  autoRegister: true
});

// 项目表
const projects = podTable('projects', {
  id: int('id').primaryKey(),
  name: string('name').notNull(),
  description: string('description'),
  ownerId: int('ownerId').notNull(),
  status: string('status').default('active'),
  createdAt: date('createdAt').predicate(RDF_PREDICATES.SCHEMA_DATE_CREATED),
  updatedAt: date('updatedAt').predicate(RDF_PREDICATES.SCHEMA_DATE_MODIFIED),
}, {
  containerPath: '/projects/',
  rdfClass: 'https://myapp.com/vocab#Project',
  autoRegister: true
});

// 任务表
const tasks = podTable('tasks', {
  id: int('id').primaryKey(),
  title: string('title').notNull(),
  description: string('description'),
  projectId: int('projectId').notNull(),
  assigneeId: int('assigneeId'),
  status: string('status').default('todo'),
  priority: string('priority').default('medium'),
  dueDate: date('dueDate').predicate(RDF_PREDICATES.SCHEMA_DATE_MODIFIED),
  createdAt: date('createdAt').predicate(RDF_PREDICATES.SCHEMA_DATE_CREATED),
  updatedAt: date('updatedAt').predicate(RDF_PREDICATES.SCHEMA_DATE_MODIFIED),
}, {
  containerPath: '/tasks/',
  rdfClass: 'https://myapp.com/vocab#Task',
  autoRegister: true
});

// 项目成员表（多对多关系）
const projectMembers = podTable('projectMembers', {
  id: int('id').primaryKey(),
  projectId: int('projectId').notNull(),
  userId: int('userId').notNull(),
  role: string('role').default('member'),
  joinedAt: date('joinedAt').predicate(RDF_PREDICATES.SCHEMA_DATE_CREATED),
}, {
  containerPath: '/project-members/',
  rdfClass: 'https://myapp.com/vocab#ProjectMember',
  autoRegister: true
});

// 评论表
const comments = podTable('comments', {
  id: int('id').primaryKey(),
  content: string('content').notNull(),
  taskId: int('taskId').notNull(),
  authorId: int('authorId').notNull(),
  createdAt: date('createdAt').predicate(RDF_PREDICATES.SCHEMA_DATE_CREATED),
}, {
  containerPath: '/comments/',
  rdfClass: RDF_CLASSES.APP_COMMENT,
  autoRegister: true
});

/**
 * 完整的项目管理系统演示
 */
async function completeExample() {
  try {
    // 创建数据库连接
    const db = drizzle(solid({
      webId: 'https://alice.solidcommunity.net/profile/card#me'
    }));

    console.log('开始完整项目管理系统演示...');

    // 1. 创建用户
    console.log('\n1. 创建用户');
    const userData = [
      {
        id: 1,
        name: 'Alice Johnson',
        email: 'alice@company.com',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 2,
        name: 'Bob Smith',
        email: 'bob@company.com',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 3,
        name: 'Carol Davis',
        email: 'carol@company.com',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];

    await db.insert(users).values(userData);
    console.log('用户创建成功:', userData.length, '个用户');

    // 2. 创建项目
    console.log('\n2. 创建项目');
    const projectData = [
      {
        id: 1,
        name: 'Web 应用重构',
        description: '重构现有的 Web 应用，提升性能和用户体验',
        ownerId: 1,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 2,
        name: '移动端开发',
        description: '开发配套的移动端应用',
        ownerId: 1,
        status: 'planning',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];

    await db.insert(projects).values(projectData);
    console.log('项目创建成功:', projectData.length, '个项目');

    // 3. 添加项目成员
    console.log('\n3. 添加项目成员');
    const memberData = [
      {
        id: 1,
        projectId: 1,
        userId: 1,
        role: 'owner',
        joinedAt: new Date().toISOString()
      },
      {
        id: 2,
        projectId: 1,
        userId: 2,
        role: 'developer',
        joinedAt: new Date().toISOString()
      },
      {
        id: 3,
        projectId: 1,
        userId: 3,
        role: 'designer',
        joinedAt: new Date().toISOString()
      },
      {
        id: 4,
        projectId: 2,
        userId: 1,
        role: 'owner',
        joinedAt: new Date().toISOString()
      },
      {
        id: 5,
        projectId: 2,
        userId: 2,
        role: 'developer',
        joinedAt: new Date().toISOString()
      }
    ];

    await db.insert(projectMembers).values(memberData);
    console.log('项目成员添加成功:', memberData.length, '个成员关系');

    // 4. 创建任务
    console.log('\n4. 创建任务');
    const taskData = [
      {
        id: 1,
        title: '设计新的用户界面',
        description: '重新设计用户界面，提升用户体验',
        projectId: 1,
        assigneeId: 3,
        status: 'in_progress',
        priority: 'high',
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 2,
        title: '重构后端 API',
        description: '优化后端 API 性能和结构',
        projectId: 1,
        assigneeId: 2,
        status: 'todo',
        priority: 'high',
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 3,
        title: '编写单元测试',
        description: '为新功能编写完整的单元测试',
        projectId: 1,
        assigneeId: 2,
        status: 'todo',
        priority: 'medium',
        dueDate: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 4,
        title: '移动端原型设计',
        description: '设计移动端应用的原型',
        projectId: 2,
        assigneeId: 3,
        status: 'todo',
        priority: 'medium',
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];

    await db.insert(tasks).values(taskData);
    console.log('任务创建成功:', taskData.length, '个任务');

    // 5. 添加评论
    console.log('\n5. 添加任务评论');
    const commentData = [
      {
        id: 1,
        content: '界面设计草图已完成，请查看',
        taskId: 1,
        authorId: 3,
        createdAt: new Date().toISOString()
      },
      {
        id: 2,
        content: '看起来不错！建议调整一下颜色搭配',
        taskId: 1,
        authorId: 1,
        createdAt: new Date().toISOString()
      },
      {
        id: 3,
        content: '开始进行 API 重构，预计需要两周时间',
        taskId: 2,
        authorId: 2,
        createdAt: new Date().toISOString()
      }
    ];

    await db.insert(comments).values(commentData);
    console.log('评论添加成功:', commentData.length, '条评论');

    // 6. 查询操作演示
    console.log('\n6. 执行各种查询操作');

    // 查询所有活跃用户
    const activeUsers = await db.select().from(users).where({ isActive: true });
    console.log('活跃用户数量:', activeUsers.length);

    // 查询特定项目的所有任务
    const project1Tasks = await db.select().from(tasks).where({ projectId: 1 });
    console.log('项目1的任务数量:', project1Tasks.length);

    // 查询高优先级任务
    const highPriorityTasks = await db.select().from(tasks).where({ priority: 'high' });
    console.log('高优先级任务:', highPriorityTasks.map(t => t.title));

    // 查询特定用户分配的任务
    const bobTasks = await db.select().from(tasks).where({ assigneeId: 2 });
    console.log('Bob 的任务:', bobTasks.map(t => t.title));

    // 查询项目成员
    const project1Members = await db.select().from(projectMembers).where({ projectId: 1 });
    console.log('项目1的成员数量:', project1Members.length);

    // 查询任务评论
    const task1Comments = await db.select().from(comments).where({ taskId: 1 });
    console.log('任务1的评论数量:', task1Comments.length);

    // 7. 更新操作演示
    console.log('\n7. 执行更新操作');

    // 更新任务状态
    await db.update(tasks)
      .set({ 
        status: 'completed',
        updatedAt: new Date().toISOString()
      })
      .where({ id: 1 });
    console.log('任务1状态更新为已完成');

    // 更新用户信息
    await db.update(users)
      .set({ 
        name: 'Alice Johnson-Smith',
        updatedAt: new Date().toISOString()
      })
      .where({ id: 1 });
    console.log('用户1信息已更新');

    // 8. 验证更新结果
    console.log('\n8. 验证更新结果');
    const updatedTask = await db.select().from(tasks).where({ id: 1 });
    console.log('更新后的任务1状态:', updatedTask[0]?.status);

    const updatedUser = await db.select().from(users).where({ id: 1 });
    console.log('更新后的用户1姓名:', updatedUser[0]?.name);

    console.log('\n✅ 完整项目管理系统演示完成！');
    console.log('演示包含了：');
    console.log('- 用户管理');
    console.log('- 项目管理');
    console.log('- 任务分配');
    console.log('- 成员关系');
    console.log('- 评论系统');
    console.log('- 复杂查询');
    console.log('- 数据更新');

  } catch (error) {
    console.error('操作失败:', error);
    throw error;
  }
}

// 运行演示
if (require.main === module) {
  completeExample()
    .then(() => {
      console.log('完整演示执行完成');
      process.exit(0);
    })
    .catch((error) => {
      console.error('完整演示执行失败:', error);
      process.exit(1);
    });
}

export { completeExample };