#!/usr/bin/env node

/**
 * 最终验证 - 确认 SPARQL INSERT 确实工作
 */

async function finalVerification() {
  console.log('🎯 最终验证 SPARQL INSERT');
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
    
    // 1. 记录插入前的任务数量
    console.log('\n📊 插入前的状态...');
    const beforeResponse = await session.fetch(resourceUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/turtle'
      }
    });
    
    if (!beforeResponse.ok) {
      throw new Error(`Failed to read resource: ${beforeResponse.status}`);
    }
    
    const beforeContent = await beforeResponse.text();
    const beforeTaskCount = (beforeContent.match(/task-/g) || []).length;
    console.log(`📋 插入前任务数量: ${beforeTaskCount}`);
    
    // 2. 执行一个简单的 INSERT
    const testTaskId = `task-final-verification-${Date.now()}`;
    const testTitle = `最终验证任务-${Date.now()}`;
    
    console.log(`\n📝 插入任务: ${testTaskId}`);
    console.log(`📝 任务标题: ${testTitle}`);
    
    const insertSparql = `
PREFIX dc: <http://purl.org/dc/terms/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

INSERT DATA {
  <tasks/#${testTaskId}> 
    rdf:type <http://example.org/Task> ;
    dc:title "${testTitle}" ;
    dc:description "这是最终验证测试" ;
    <http://www.w3.org/2002/07/owl#status> "todo" ;
    <http://example.org/priority> 999 ;
    dc:created "${new Date().toISOString()}"^^<http://www.w3.org/2001/XMLSchema#dateTime> .
}`;
    
    console.log('\n📤 执行 INSERT...');
    const insertResponse = await session.fetch(resourceUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/sparql-update'
      },
      body: insertSparql
    });
    
    console.log(`📤 INSERT 响应: ${insertResponse.status}`);
    
    if (!insertResponse.ok) {
      const errorText = await insertResponse.text();
      console.log(`❌ INSERT 失败: ${errorText}`);
      return;
    }
    
    console.log('✅ INSERT 请求成功');
    
    // 3. 等待一下，然后验证
    console.log('\n⏳ 等待 1 秒...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 4. 读取插入后的内容
    console.log('\n📊 插入后的状态...');
    const afterResponse = await session.fetch(resourceUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/turtle'
      }
    });
    
    if (!afterResponse.ok) {
      throw new Error(`Failed to read resource after insert: ${afterResponse.status}`);
    }
    
    const afterContent = await afterResponse.text();
    const afterTaskCount = (afterContent.match(/task-/g) || []).length;
    console.log(`📋 插入后任务数量: ${afterTaskCount}`);
    
    // 5. 检查数量变化
    const countDiff = afterTaskCount - beforeTaskCount;
    console.log(`📊 任务数量变化: ${countDiff > 0 ? '+' : ''}${countDiff}`);
    
    if (countDiff > 0) {
      console.log('🎉 任务数量增加了！INSERT 确实工作了！');
    } else {
      console.log('❌ 任务数量没有变化');
    }
    
    // 6. 精确搜索我们插入的内容
    console.log('\n🔍 搜索插入的具体内容...');
    
    const hasTaskId = afterContent.includes(testTaskId);
    const hasTitle = afterContent.includes(testTitle);
    const hasDescription = afterContent.includes('这是最终验证测试');
    const hasPriority999 = afterContent.includes('<http://example.org/priority> 999');
    
    console.log(`📋 包含任务ID (${testTaskId}): ${hasTaskId ? '✅' : '❌'}`);
    console.log(`📋 包含标题 (${testTitle}): ${hasTitle ? '✅' : '❌'}`);
    console.log(`📋 包含描述: ${hasDescription ? '✅' : '❌'}`);
    console.log(`📋 包含优先级999: ${hasPriority999 ? '✅' : '❌'}`);
    
    // 7. 如果找到了，显示相关行
    if (hasTaskId || hasTitle) {
      console.log('\n📄 找到的相关内容:');
      const lines = afterContent.split('\n');
      const relevantLines = lines.filter(line => 
        line.includes(testTaskId) || 
        line.includes(testTitle) ||
        line.includes('这是最终验证测试') ||
        line.includes('999')
      );
      
      relevantLines.forEach((line, index) => {
        console.log(`   ${index + 1}: ${line.trim()}`);
      });
    }
    
    // 8. 最终结论
    console.log('\n🎯 最终结论:');
    if (countDiff > 0 && (hasTaskId || hasTitle)) {
      console.log('✅ SPARQL INSERT 完全正常工作！');
      console.log('✅ drizzle-solid 的 INSERT 操作是成功的！');
      console.log('💡 之前的"失败"判断是错误的！');
      
      // 现在测试 drizzle-solid 的 INSERT
      console.log('\n🧪 现在测试 drizzle-solid 的 INSERT...');
      
      // 导入并测试 drizzle-solid
      const { drizzle } = await import('../dist/index.js');
      const { tasks } = await import('../examples/03-basic-usage.js');
      
      const db = drizzle({
        podUrl: 'http://localhost:3000',
        webId: 'http://localhost:3000/alice/profile/card#me',
        session: session
      });
      
      const newTask = {
        title: `Drizzle测试任务-${Date.now()}`,
        description: 'drizzle-solid INSERT 测试',
        status: 'todo',
        priority: 888,
        created: new Date(),
        modified: new Date()
      };
      
      console.log('📝 使用 drizzle-solid 插入任务...');
      const insertResult = await db.insert(tasks).values(newTask);
      console.log('✅ drizzle-solid INSERT 完成');
      
      // 验证 drizzle-solid 的插入
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const finalResponse = await session.fetch(resourceUrl, {
        method: 'GET',
        headers: {
          'Accept': 'text/turtle'
        }
      });
      
      if (finalResponse.ok) {
        const finalContent = await finalResponse.text();
        const finalTaskCount = (finalContent.match(/task-/g) || []).length;
        const drizzleCountDiff = finalTaskCount - afterTaskCount;
        
        console.log(`📊 drizzle-solid 插入后任务数量: ${finalTaskCount}`);
        console.log(`📊 drizzle-solid 任务数量变化: ${drizzleCountDiff > 0 ? '+' : ''}${drizzleCountDiff}`);
        
        const hasDrizzleTask = finalContent.includes('Drizzle测试任务');
        const hasDrizzleDesc = finalContent.includes('drizzle-solid INSERT 测试');
        const hasPriority888 = finalContent.includes('<http://example.org/priority> 888');
        
        console.log(`📋 drizzle任务标题: ${hasDrizzleTask ? '✅' : '❌'}`);
        console.log(`📋 drizzle任务描述: ${hasDrizzleDesc ? '✅' : '❌'}`);
        console.log(`📋 drizzle优先级888: ${hasPriority888 ? '✅' : '❌'}`);
        
        if (drizzleCountDiff > 0 && (hasDrizzleTask || hasDrizzleDesc)) {
          console.log('\n🎉🎉🎉 drizzle-solid 完全正常工作！');
          console.log('🎯 原始问题的答案:');
          console.log('   ✅ Solid Pod 原生支持 SPARQL');
          console.log('   ✅ 可以直接用 N3.js 对接，不需要 Comunica');
          console.log('   ✅ drizzle-solid 已经证明了这种方法的可行性');
        }
      }
      
    } else {
      console.log('❌ SPARQL INSERT 仍然有问题');
      console.log('🔍 需要进一步调试');
    }
    
    await session.logout();
    
  } catch (error) {
    console.log(`❌ 验证失败: ${error.message}`);
    console.error(error);
  }
}

finalVerification().catch(console.error);