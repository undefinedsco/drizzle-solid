#!/usr/bin/env node

/**
 * 验证 03-basic-usage.ts 的 INSERT 是否真的成功了
 */

async function verify03Success() {
  console.log('🔍 验证 03-basic-usage.ts 的 INSERT 成功');
  console.log('================================\n');
  
  const { Session } = await import('@inrupt/solid-client-authn-node');
  
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
    
    const resourceUrl = 'http://localhost:3000/alice/tasks';
    
    // 读取当前内容
    const response = await session.fetch(resourceUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/turtle'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to read resource: ${response.status}`);
    }
    
    const content = await response.text();
    
    // 查找 03-basic-usage.ts 插入的任务
    console.log('🔍 查找 03-basic-usage.ts 插入的任务...');
    
    const taskIds = [
      'task-1757994450155-1',
      'task-1757994450155-2', 
      'task-1757994450155-3'
    ];
    
    const taskTitles = [
      '学习Drizzle Solid',
      '编写示例代码',
      '测试数据清理'
    ];
    
    console.log('\n📋 搜索结果:');
    
    let foundTasks = 0;
    
    for (let i = 0; i < taskIds.length; i++) {
      const taskId = taskIds[i];
      const taskTitle = taskTitles[i];
      
      const hasTaskId = content.includes(taskId);
      const hasTaskTitle = content.includes(taskTitle);
      
      console.log(`\n任务 ${i + 1}:`);
      console.log(`   ID: ${taskId}`);
      console.log(`   标题: ${taskTitle}`);
      console.log(`   找到ID: ${hasTaskId ? '✅' : '❌'}`);
      console.log(`   找到标题: ${hasTaskTitle ? '✅' : '❌'}`);
      
      if (hasTaskId && hasTaskTitle) {
        foundTasks++;
        console.log(`   状态: ✅ 完全成功`);
      } else if (hasTaskId || hasTaskTitle) {
        console.log(`   状态: ⚠️  部分成功`);
      } else {
        console.log(`   状态: ❌ 未找到`);
      }
    }
    
    console.log(`\n📊 总结:`);
    console.log(`   成功插入的任务: ${foundTasks}/${taskIds.length}`);
    console.log(`   成功率: ${(foundTasks / taskIds.length * 100).toFixed(1)}%`);
    
    if (foundTasks === taskIds.length) {
      console.log('\n🎉 所有任务都成功插入了！');
      console.log('✅ drizzle-solid 的 INSERT 操作完全正常工作！');
      console.log('✅ 我修复的 generateSubjectUri 方法起作用了！');
    } else if (foundTasks > 0) {
      console.log('\n⚠️  部分任务插入成功');
      console.log('🔍 需要进一步调查部分失败的原因');
    } else {
      console.log('\n❌ 没有找到任何插入的任务');
      console.log('🚨 INSERT 操作可能仍然有问题');
    }
    
    // 显示包含任务ID的行
    if (foundTasks > 0) {
      console.log('\n📄 找到的任务数据:');
      const lines = content.split('\n');
      
      for (const taskId of taskIds) {
        if (content.includes(taskId)) {
          console.log(`\n--- ${taskId} ---`);
          const relevantLines = lines.filter(line => 
            line.includes(taskId) || 
            (lines.indexOf(line) > 0 && lines[lines.indexOf(line) - 1].includes(taskId)) ||
            (lines.indexOf(line) < lines.length - 1 && lines[lines.indexOf(line) + 1].includes(taskId))
          );
          
          relevantLines.slice(0, 10).forEach(line => {
            console.log(`   ${line.trim()}`);
          });
        }
      }
    }
    
    // 统计总任务数
    const totalTasks = (content.match(/task-/g) || []).length;
    console.log(`\n📊 Pod 中总任务数: ${totalTasks}`);
    
    await session.logout();
    
  } catch (error) {
    console.log(`❌ 验证失败: ${error.message}`);
    console.error(error);
  }
}

verify03Success().catch(console.error);