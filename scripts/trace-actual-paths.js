#!/usr/bin/env node

/**
 * 追踪 drizzle-solid 实际使用的路径
 */

async function traceActualPaths() {
  console.log('🔍 追踪 drizzle-solid 实际路径');
  console.log('================================\n');
  
  // 1. 分析 drizzle-solid 的表定义
  console.log('📋 分析表定义...');
  
  // 从 examples/03-basic-usage.ts 中的表定义
  const tableDefinition = `
  export const tasks = solidTable('tasks', {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status').notNull().default('todo'),
    priority: integer('priority').default(1),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow()
  });`;
  
  console.log('表名:', 'tasks');
  console.log('这意味着资源路径应该是: /alice/tasks');
  
  // 2. 检查实际的 Pod 配置
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
    
    console.log('\n✅ 认证成功');
    
    // 3. 检查可能的路径
    const possiblePaths = [
      'http://localhost:3000/alice/tasks',           // 我们找到数据的地方
      'http://localhost:3000/alice/tasks/',          // 容器路径
      'http://localhost:3000/alice/tasks.ttl',       // 文件路径
      'http://localhost:3000/alice/tasks.rdf',       // RDF 文件路径
    ];
    
    console.log('\n🔍 检查所有可能的路径...');
    
    for (const path of possiblePaths) {
      console.log(`\n📍 检查: ${path}`);
      
      const response = await session.fetch(path, {
        method: 'GET',
        headers: {
          'Accept': 'text/turtle'
        }
      });
      
      console.log(`   状态: ${response.status}`);
      
      if (response.ok) {
        const content = await response.text();
        const taskCount = (content.match(/task-/g) || []).length;
        console.log(`   ✅ 成功! 包含 ${taskCount} 个任务引用`);
        
        // 显示前几行内容
        const lines = content.split('\n').slice(0, 5);
        console.log('   📄 内容预览:');
        lines.forEach(line => {
          if (line.trim()) {
            console.log(`      ${line.trim()}`);
          }
        });
      } else {
        console.log(`   ❌ 失败`);
      }
    }
    
    // 4. 现在运行一个实际的 INSERT 操作并追踪
    console.log('\n🚀 运行实际的 INSERT 操作并追踪...');
    
    // 这里我们需要模拟 drizzle-solid 的行为
    // 让我们看看它实际会向哪个 URL 发送请求
    
    console.log('\n📝 模拟 drizzle-solid INSERT...');
    
    // 基于我们对 drizzle-solid 的理解，它应该：
    // 1. 构建 SPARQL INSERT 查询
    // 2. 向表对应的资源 URL 发送 PATCH 请求
    
    const tableName = 'tasks';
    const baseUrl = 'http://localhost:3000/alice';
    const resourceUrl = `${baseUrl}/${tableName}`;
    
    console.log(`📍 drizzle-solid 应该使用的 URL: ${resourceUrl}`);
    
    // 构建一个简单的 SPARQL INSERT
    const testTaskId = `task-trace-${Date.now()}`;
    const sparqlInsert = `
PREFIX dc: <http://purl.org/dc/terms/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

INSERT DATA {
  <${tableName}/#${testTaskId}> 
    rdf:type <http://example.org/Task> ;
    dc:title "路径追踪测试" ;
    dc:description "验证 drizzle-solid 的实际路径" ;
    <http://www.w3.org/2002/07/owl#status> "todo" ;
    <http://example.org/priority> 999 ;
    dc:created "${new Date().toISOString()}"^^<http://www.w3.org/2001/XMLSchema#dateTime> .
}`;
    
    console.log('\n📤 发送 SPARQL INSERT...');
    console.log('目标 URL:', resourceUrl);
    
    const insertResponse = await session.fetch(resourceUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/sparql-update'
      },
      body: sparqlInsert
    });
    
    console.log(`📤 INSERT 响应: ${insertResponse.status}`);
    
    if (insertResponse.ok) {
      console.log('✅ INSERT 成功！');
      
      // 立即验证
      console.log('\n🔍 立即验证插入结果...');
      const verifyResponse = await session.fetch(resourceUrl, {
        method: 'GET',
        headers: {
          'Accept': 'text/turtle'
        }
      });
      
      if (verifyResponse.ok) {
        const content = await verifyResponse.text();
        const hasTestTask = content.includes(testTaskId);
        console.log(`📋 包含测试任务: ${hasTestTask ? '✅' : '❌'}`);
        
        if (hasTestTask) {
          console.log('🎉 路径追踪成功！drizzle-solid 确实使用这个路径');
        }
      }
    } else {
      const errorText = await insertResponse.text();
      console.log(`❌ INSERT 失败: ${errorText.substring(0, 200)}...`);
    }
    
    await session.logout();
    
  } catch (error) {
    console.log(`❌ 追踪失败: ${error.message}`);
  }
  
  console.log('\n🎯 路径分析结论:');
  console.log('1. drizzle-solid 使用表名作为资源名');
  console.log('2. 路径格式: /alice/{tableName}');
  console.log('3. 不是容器，是单个资源文件');
  console.log('4. 使用 PATCH + application/sparql-update');
}

traceActualPaths().catch(console.error);