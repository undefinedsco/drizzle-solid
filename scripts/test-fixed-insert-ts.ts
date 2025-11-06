#!/usr/bin/env ts-node

/**
 * 测试修复后的 INSERT 操作 (TypeScript 版本)
 */

import { Session } from '@inrupt/solid-client-authn-node';
import { drizzle } from '../src/index';
import { podTable, string, int, date } from '../src/index';

async function testFixedInsert() {
  console.log('🧪 测试修复后的 INSERT 操作');
  console.log('================================\n');
  
  const clientId = 'test_3c0a130f-564e-4e5c-9e9e-166bae262471';
  const clientSecret = '782f6e5917037674c44e2a18027fc18b01dc8ab746410532eb0a982ea506f67b7814beedd604fad8851ff77c3b9ac278903580a8261fb5c5ff635916c0306ca2';
  const oidcIssuer = 'http://localhost:3000';
  
  const session = new Session();
  
  try {
    await session.login({
      clientId,
      clientSecret,
      oidcIssuer,
      tokenType: 'Bearer'
    });
    
    console.log('✅ 认证成功');
    
    // 1. 读取修复前的任务数量
    const resourceUrl = 'http://localhost:3000/alice/tasks';
    const beforeResponse = await session.fetch(resourceUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/turtle'
      }
    });
    
    let beforeCount = 0;
    if (beforeResponse.ok) {
      const beforeContent = await beforeResponse.text();
      beforeCount = (beforeContent.match(/task-/g) || []).length;
      console.log(`📊 修复前任务数量: ${beforeCount}`);
    }
    
    // 2. 定义表结构（与 03-basic-usage.ts 相同）
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
      containerPath: '/tasks/'  // 注意：这里有尾部斜杠，但修复后的代码会正确处理
    });
    
    // 创建数据库连接
    console.log('\n🔗 创建数据库连接...');
    const db = drizzle(session);
    
    // 3. 测试 INSERT 操作
    const testTaskId = `task-fixed-${Date.now()}`;
    const testTask = {
      id: testTaskId,
      title: '修复测试任务',
      description: '测试修复后的URI生成是否正常工作',
      status: 'todo',
      priority: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    console.log(`📝 插入测试任务: ${testTaskId}`);
    
    try {
      await db.insert(taskTable).values(testTask);
      console.log('✅ INSERT 操作完成');
    } catch (error: any) {
      console.log(`❌ INSERT 操作失败: ${error.message}`);
      console.log('错误详情:', error);
      return;
    }
    
    // 4. 验证插入结果
    console.log('\n🔍 验证插入结果...');
    const afterResponse = await session.fetch(resourceUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/turtle'
      }
    });
    
    if (afterResponse.ok) {
      const afterContent = await afterResponse.text();
      const afterCount = (afterContent.match(/task-/g) || []).length;
      const hasTestTask = afterContent.includes(testTaskId);
      const hasTestTitle = afterContent.includes('修复测试任务');
      
      console.log(`📊 修复后任务数量: ${afterCount}`);
      console.log(`📋 包含测试任务ID: ${hasTestTask ? '✅' : '❌'}`);
      console.log(`📋 包含测试标题: ${hasTestTitle ? '✅' : '❌'}`);
      console.log(`📈 任务数量增加: ${afterCount > beforeCount ? '✅' : '❌'} (${afterCount - beforeCount})`);
      
      if (hasTestTask && hasTestTitle && afterCount > beforeCount) {
        console.log('\n🎉 修复成功！INSERT 操作现在正常工作了！');
        
        // 显示插入的内容
        const lines = afterContent.split('\n');
        const relevantLines = lines.filter(line => 
          line.includes(testTaskId) || line.includes('修复测试任务')
        );
        
        if (relevantLines.length > 0) {
          console.log('\n📄 插入的内容:');
          relevantLines.forEach(line => {
            console.log(`   ${line.trim()}`);
          });
        }
        
        // 5. 测试 SELECT 操作
        console.log('\n📖 测试 SELECT 操作...');
        try {
          const allTasks = await db.select().from(taskTable);
          console.log(`📊 SELECT 查询返回 ${allTasks.length} 个任务`);
          
          const testTaskFromDb = allTasks.find((task: any) => task.id === testTaskId);
          if (testTaskFromDb) {
            console.log('✅ 能够通过 SELECT 查询到刚插入的任务');
            console.log(`   标题: ${testTaskFromDb.title}`);
            console.log(`   状态: ${testTaskFromDb.status}`);
          } else {
            console.log('❌ 无法通过 SELECT 查询到刚插入的任务');
          }
        } catch (error: any) {
          console.log(`❌ SELECT 操作失败: ${error.message}`);
        }
        
      } else {
        console.log('\n❌ 修复可能不完整，需要进一步调试');
        
        // 显示一些调试信息
        console.log('\n🐛 调试信息:');
        console.log(`   beforeCount: ${beforeCount}`);
        console.log(`   afterCount: ${afterCount}`);
        console.log(`   hasTestTask: ${hasTestTask}`);
        console.log(`   hasTestTitle: ${hasTestTitle}`);
        
        if (!hasTestTask) {
          console.log('\n📄 当前内容中的任务ID:');
          const taskIds = afterContent.match(/task-[^>\s]+/g) || [];
          taskIds.slice(0, 5).forEach(id => console.log(`   ${id}`));
          if (taskIds.length > 5) {
            console.log(`   ... 还有 ${taskIds.length - 5} 个`);
          }
        }
      }
    }
    
    await session.logout();
    
  } catch (error: any) {
    console.log(`❌ 测试失败: ${error.message}`);
    console.log('错误详情:', error);
  }
  
  console.log('\n🎯 总结:');
  console.log('1. 修复了 generateSubjectUri 方法中的路径处理');
  console.log('2. 确保生成正确的绝对URI格式');
  console.log('3. 验证 INSERT 和 SELECT 操作都正常工作');
}

testFixedInsert().catch(console.error);