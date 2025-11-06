#!/usr/bin/env node

/**
 * 调试 SPARQL 查询的具体内容
 */

async function debugSPARQLQuery() {
  console.log('🐛 调试 SPARQL 查询内容');
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
    
    // 1. 先读取现有内容
    console.log('\n📄 读取现有内容...');
    const readResponse = await session.fetch(resourceUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/turtle'
      }
    });
    
    if (readResponse.ok) {
      const existingContent = await readResponse.text();
      const existingTaskCount = (existingContent.match(/task-/g) || []).length;
      console.log(`📊 现有任务数量: ${existingTaskCount}`);
    }
    
    // 2. 构造一个简单的 SPARQL INSERT
    const testTaskId = `task-debug-${Date.now()}`;
    
    // 尝试不同的 SPARQL INSERT 格式
    const sparqlVariants = [
      {
        name: '格式1: 使用相对URI',
        query: `
PREFIX dc: <http://purl.org/dc/terms/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

INSERT DATA {
  <tasks/#${testTaskId}> 
    rdf:type <http://example.org/Task> ;
    dc:title "调试测试任务" ;
    dc:description "测试 SPARQL INSERT 格式" ;
    <http://www.w3.org/2002/07/owl#status> "todo" ;
    <http://example.org/priority> 999 ;
    dc:created "${new Date().toISOString()}"^^<http://www.w3.org/2001/XMLSchema#dateTime> .
}`
      },
      {
        name: '格式2: 使用绝对URI',
        query: `
PREFIX dc: <http://purl.org/dc/terms/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

INSERT DATA {
  <http://localhost:3000/alice/tasks#${testTaskId}> 
    rdf:type <http://example.org/Task> ;
    dc:title "调试测试任务2" ;
    dc:description "测试绝对URI格式" ;
    <http://www.w3.org/2002/07/owl#status> "todo" ;
    <http://example.org/priority> 998 ;
    dc:created "${new Date().toISOString()}"^^<http://www.w3.org/2001/XMLSchema#dateTime> .
}`
      },
      {
        name: '格式3: 使用空白节点',
        query: `
PREFIX dc: <http://purl.org/dc/terms/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

INSERT DATA {
  _:${testTaskId} 
    rdf:type <http://example.org/Task> ;
    dc:title "调试测试任务3" ;
    dc:description "测试空白节点格式" ;
    <http://www.w3.org/2002/07/owl#status> "todo" ;
    <http://example.org/priority> 997 ;
    dc:created "${new Date().toISOString()}"^^<http://www.w3.org/2001/XMLSchema#dateTime> .
}`
      }
    ];
    
    // 3. 测试每种格式
    for (let i = 0; i < sparqlVariants.length; i++) {
      const variant = sparqlVariants[i];
      console.log(`\n🧪 测试 ${variant.name}...`);
      console.log('📝 SPARQL 查询:');
      console.log('-----------------------------------');
      console.log(variant.query);
      console.log('-----------------------------------');
      
      const insertResponse = await session.fetch(resourceUrl, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/sparql-update'
        },
        body: variant.query
      });
      
      console.log(`📤 响应状态: ${insertResponse.status}`);
      
      if (insertResponse.ok) {
        console.log('✅ INSERT 请求成功');
        
        // 立即验证
        const verifyResponse = await session.fetch(resourceUrl, {
          method: 'GET',
          headers: {
            'Accept': 'text/turtle'
          }
        });
        
        if (verifyResponse.ok) {
          const content = await verifyResponse.text();
          const hasNewTask = content.includes(`${testTaskId}`) || content.includes('调试测试任务');
          console.log(`📋 验证结果: ${hasNewTask ? '✅ 数据已插入' : '❌ 数据未插入'}`);
          
          if (hasNewTask) {
            console.log('🎉 找到有效的 SPARQL 格式！');
            
            // 显示插入的内容
            const lines = content.split('\n');
            const relevantLines = lines.filter(line => 
              line.includes(testTaskId) || line.includes('调试测试任务')
            );
            
            if (relevantLines.length > 0) {
              console.log('📄 插入的内容:');
              relevantLines.forEach(line => {
                console.log(`   ${line.trim()}`);
              });
            }
            
            break; // 找到有效格式，停止测试
          }
        }
      } else {
        const errorText = await insertResponse.text();
        console.log(`❌ INSERT 失败: ${errorText.substring(0, 200)}...`);
      }
      
      // 等待一下再测试下一个格式
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // 4. 最终检查
    console.log('\n🔍 最终内容检查...');
    const finalResponse = await session.fetch(resourceUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/turtle'
      }
    });
    
    if (finalResponse.ok) {
      const finalContent = await finalResponse.text();
      const finalTaskCount = (finalContent.match(/task-/g) || []).length;
      console.log(`📊 最终任务数量: ${finalTaskCount}`);
      
      const debugTasks = (finalContent.match(/task-debug-/g) || []).length;
      console.log(`🐛 调试任务数量: ${debugTasks}`);
    }
    
    await session.logout();
    
  } catch (error) {
    console.log(`❌ 调试失败: ${error.message}`);
  }
  
  console.log('\n🎯 调试结论:');
  console.log('1. 检查哪种 SPARQL 格式有效');
  console.log('2. 确认数据是否真的插入');
  console.log('3. 找出 drizzle-solid 可能的问题');
}

debugSPARQLQuery().catch(console.error);