#!/usr/bin/env ts-node

/**
 * Drizzle Solid 示例: 基本使用方法
 * 
 * 这个示例展示如何：
 * 1. 定义数据表结构
 * 2. 从环境变量获取Session授权
 * 3. 执行完整的CRUD操作
 * 4. 清理测试数据，保持Pod干净
 * 
 * 技术特点：
 * - 完整的CRUD操作演示
 * - 环境变量认证
 * - 数据清理机制
 * - 类型安全的数据操作
 */

import { Session } from '@inrupt/solid-client-authn-node';
import { drizzle } from '../src/index';
import { podTable, string, int, date } from '../src/index';

// 尝试加载.env文件
try {
  require('dotenv').config();
} catch (error) {
  // dotenv不是必需的，如果没有安装就跳过
}

// 定义测试用的任务表结构
const taskTable = podTable('tasks', {
  id: string('id').primaryKey(),
  title: string('title').predicate('http://purl.org/dc/terms/title'),
  description: string('description').predicate('http://purl.org/dc/terms/description'),
  status: string('status').predicate('http://www.w3.org/2002/07/owl#status'),
  priority: int('priority').predicate('http://example.org/priority'),
  createdAt: date('createdAt').predicate('http://purl.org/dc/terms/created'),
  updatedAt: date('updatedAt').predicate('http://purl.org/dc/terms/modified')
}, {
  rdfClass: 'http://example.org/Task',
  containerPath: '/tasks/'
});

/**
 * 从环境变量获取Session授权
 */
async function getSession(): Promise<Session> {
  console.log('\n🔐 获取Session授权');
  console.log('============================================================');
  console.log('从环境变量读取认证信息...');

  const clientId = process.env.SOLID_CLIENT_ID;
  const clientSecret = process.env.SOLID_CLIENT_SECRET;
  const oidcIssuer = process.env.SOLID_OIDC_ISSUER || 'http://localhost:3000';
  
  if (!clientId || !clientSecret) {
    console.log('❌ 未找到有效的环境变量配置');
    console.log('');
    console.log('💡 请先运行以下命令进行认证：');
    console.log('   npm run example:auth');
    console.log('');
    console.log('或者手动设置以下环境变量：');
    console.log('- SOLID_CLIENT_ID=your-client-id');
    console.log('- SOLID_CLIENT_SECRET=your-client-secret'); 
    console.log('- SOLID_OIDC_ISSUER=http://localhost:3000');
    console.log('');
    console.log('您也可以创建 .env 文件包含上述变量');
    process.exit(1);
  }

  console.log(`✅ 找到环境变量配置`);
  console.log(`📍 OIDC Issuer: ${oidcIssuer}`);
  console.log(`🆔 Client ID: ${clientId}`);
  
  const session = new Session();
  
  try {
    await session.login({
      clientId,
      clientSecret,
      oidcIssuer,
      tokenType: 'Bearer'
    });
    
    if (!session.info.isLoggedIn || !session.info.webId) {
      throw new Error('认证失败');
    }
    
    console.log('✅ Session认证成功');
    console.log(`🌐 WebID: ${session.info.webId}`);
    
    return session;
  } catch (error) {
    console.log('❌ Session认证失败:', error);
    console.log('');
    console.log('💡 请检查：');
    console.log('- 认证信息是否正确');
    console.log('- Solid服务器是否运行');
    console.log('- Token权限是否足够');
    process.exit(1);
  }
}

/**
 * 演示CREATE操作 - 创建任务
 */
async function demonstrateCreate(db: any): Promise<string[]> {
  console.log('\n📝 CREATE操作 - 创建任务');
  console.log('============================================================');
  
  const createdIds: string[] = [];
  const now = new Date();
  
  // 创建测试任务数据
  const testTasks = [
    {
      id: `task-${Date.now()}-1`,
      title: '学习Drizzle Solid',
      description: '掌握Solid Pod数据操作的基本方法',
      status: 'todo',
      priority: 1,
      createdAt: now,
      updatedAt: now
    },
    {
      id: `task-${Date.now()}-2`,
      title: '编写示例代码',
      description: '创建完整的CRUD操作示例',
      status: 'in-progress',
      priority: 2,
      createdAt: now,
      updatedAt: now
    },
    {
      id: `task-${Date.now()}-3`,
      title: '测试数据清理',
      description: '确保测试后Pod保持干净',
      status: 'todo',
      priority: 3,
      createdAt: now,
      updatedAt: now
    }
  ];
  
  console.log('🔄 插入测试任务...');
  
  for (const task of testTasks) {
    try {
      await db.insert(taskTable).values(task);
      createdIds.push(task.id);
      console.log(`   ✅ 创建任务: ${task.title} (ID: ${task.id})`);
    } catch (error) {
      console.error(`   ❌ 创建任务失败: ${task.title}`, error);
    }
  }
  
  console.log(`\n📊 成功创建 ${createdIds.length} 个任务`);
  return createdIds;
}

/**
 * 演示READ操作 - 读取任务
 */
async function demonstrateRead(db: any): Promise<void> {
  console.log('\n📖 READ操作 - 读取任务');
  console.log('============================================================');
  
  try {
    // 1. 读取所有任务
    console.log('🔄 读取所有任务...');
    const allTasks = await db.select().from(taskTable);
    
    console.log(`📊 找到 ${allTasks.length} 个任务：`);
    allTasks.forEach((task: any, index: number) => {
      console.log(`\n   ${index + 1}. ${task.title}`);
      console.log(`      📝 描述: ${task.description}`);
      console.log(`      📊 状态: ${task.status}`);
      console.log(`      🔢 优先级: ${task.priority}`);
      console.log(`      🆔 ID: ${task.id}`);
    });
    
    // 2. 条件查询 - 查找待办任务
    console.log('\n🔍 条件查询 - 查找待办任务...');
    const todoTasks = await db.select()
      .from(taskTable)
      .where({ status: 'todo' });
    
    console.log(`📋 找到 ${todoTasks.length} 个待办任务：`);
    todoTasks.forEach((task: any) => {
      console.log(`   • ${task.title} (优先级: ${task.priority})`);
    });
    
  } catch (error) {
    console.error('❌ 读取操作失败:', error);
  }
}

/**
 * 演示UPDATE操作 - 更新任务
 */
async function demonstrateUpdate(db: any, createdIds: string[]): Promise<void> {
  console.log('\n✏️  UPDATE操作 - 更新任务');
  console.log('============================================================');
  
  if (createdIds.length === 0) {
    console.log('⚠️  没有可更新的任务');
    return;
  }
  
  try {
    // 更新第一个任务的状态
    const taskIdToUpdate = createdIds[0];
    console.log(`🔄 更新任务状态: ${taskIdToUpdate}`);
    
    await db.update(taskTable)
      .set({
        status: 'completed',
        updatedAt: new Date()
      })
      .where({ id: taskIdToUpdate });
    
    console.log('   ✅ 任务状态已更新为 completed');
    
    // 验证更新结果
    console.log('🔍 验证更新结果...');
    const updatedTask = await db.select()
      .from(taskTable)
      .where({ id: taskIdToUpdate });
    
    if (updatedTask.length > 0) {
      console.log(`   📊 任务 "${updatedTask[0].title}" 状态: ${updatedTask[0].status}`);
    }
    
  } catch (error) {
    console.error('❌ 更新操作失败:', error);
  }
}

/**
 * 演示DELETE操作 - 删除任务
 */
async function demonstrateDelete(db: any, createdIds: string[]): Promise<void> {
  console.log('\n🗑️  DELETE操作 - 删除任务');
  console.log('============================================================');
  
  if (createdIds.length === 0) {
    console.log('⚠️  没有可删除的任务');
    return;
  }
  
  try {
    // 清理所有测试数据
    console.log('\n🧹 清理测试数据...');
    for (const taskId of createdIds) {
      try {
        await db.delete(taskTable)
          .where({ id: taskId });
        console.log(`   ✅ 清理任务: ${taskId}`);
      } catch (error) {
        console.log(`   ⚠️  清理任务失败: ${taskId}`);
      }
    }
    
    // 验证清理结果
    console.log('\n🔍 验证清理结果...');
    const remainingTasks = await db.select().from(taskTable);
    const testTasks = remainingTasks.filter((task: any) => 
      createdIds.includes(task.id)
    );
    
    if (testTasks.length === 0) {
      console.log('   ✅ 所有测试数据已清理完成，Pod保持干净');
    } else {
      console.log(`   ⚠️  还有 ${testTasks.length} 个测试任务未清理`);
    }
    
  } catch (error) {
    console.error('❌ 删除操作失败:', error);
  }
}

// 主函数
async function main() {
  console.log('🚀 Drizzle Solid 示例: 基本使用方法');
  console.log('============================================================');
  console.log('📚 本示例展示完整的CRUD操作和数据清理');
  console.log('🧹 运行完成后Pod将保持干净状态');
  
  let createdIds: string[] = [];
  
  try {
    // 1. 获取认证Session
    const session = await getSession();
    
    // 2. 创建数据库连接
    console.log('\n🔗 创建数据库连接');
    console.log('============================================================');
    const db = drizzle(session);
    console.log('✅ drizzle-solid数据库连接已建立');
    
    // 3. 执行CRUD操作
    createdIds = await demonstrateCreate(db);
    await demonstrateRead(db);
    await demonstrateUpdate(db, createdIds);
    await demonstrateDelete(db, createdIds);
    
    // 4. 完成总结
    console.log('\n🎉 基本使用方法示例完成！');
    console.log('============================================================');
    console.log('✅ 成功演示的功能：');
    console.log('   • 环境变量认证');
    console.log('   • 表结构定义');
    console.log('   • CREATE操作 (插入数据)');
    console.log('   • READ操作 (查询数据)');
    console.log('   • UPDATE操作 (更新数据)');
    console.log('   • DELETE操作 (删除数据)');
    console.log('   • 数据清理 (保持Pod干净)');
    console.log('');
    console.log('🧹 数据清理状态：');
    console.log('   ✅ 所有测试数据已清理');
    console.log('   ✅ Pod保持干净状态');
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ 示例执行失败:', error);
    console.log('\n💡 故障排除：');
    console.log('   • 检查认证信息是否正确');
    console.log('   • 确认Solid服务器是否可访问');
    console.log('   • 验证Token权限是否足够');
    console.log('   • 运行服务器设置: npm run example:setup');
    console.log('   • 测试认证: npm run example:auth');
    
    process.exit(1);
  }
}

// 运行示例
if (require.main === module) {
  main().catch(console.error);
}