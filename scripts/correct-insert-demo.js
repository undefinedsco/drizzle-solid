#!/usr/bin/env node

/**
 * 正确的 INSERT 操作演示
 * 创建具体的资源文件而不是对容器执行 PATCH
 */

async function correctInsertDemo() {
  console.log('✅ 正确的 INSERT 操作演示');
  console.log('================================\n');
  
  const { Session } = await import('@inrupt/solid-client-authn-node');
  
  // 设置认证
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
    console.log(`🌐 WebID: ${session.info.webId}`);
    
    // 正确的方法：创建具体的资源文件
    const taskId = `task-${Date.now()}`;
    const resourceUrl = `http://localhost:3000/alice/tasks/${taskId}.ttl`;
    
    console.log(`\n📝 创建资源: ${resourceUrl}`);
    
    // 1. 创建 Turtle 资源文件
    const turtleContent = `@prefix dc: <http://purl.org/dc/terms/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix schema: <https://schema.org/> .

<#${taskId}> 
    rdf:type <http://example.org/Task> ;
    dc:title "正确的任务创建" ;
    dc:description "使用正确的方法创建 Solid Pod 资源" ;
    <http://www.w3.org/2002/07/owl#status> "todo" ;
    <http://example.org/priority> 1 ;
    dc:created "${new Date().toISOString()}"^^<http://www.w3.org/2001/XMLSchema#dateTime> ;
    dc:modified "${new Date().toISOString()}"^^<http://www.w3.org/2001/XMLSchema#dateTime> .`;
    
    console.log('\n📄 Turtle 内容:');
    console.log('-----------------------------------');
    console.log(turtleContent);
    console.log('-----------------------------------');
    
    // 2. 使用 PUT 创建资源文件
    const createResponse = await session.fetch(resourceUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/turtle'
      },
      body: turtleContent
    });
    
    console.log(`\n📤 创建响应: ${createResponse.status}`);
    
    if (createResponse.ok) {
      console.log('✅ 资源创建成功！');
      
      // 3. 验证创建结果
      console.log('\n🔍 验证创建结果...');
      const verifyResponse = await session.fetch(resourceUrl, {
        method: 'GET',
        headers: {
          'Accept': 'text/turtle'
        }
      });
      
      if (verifyResponse.ok) {
        const content = await verifyResponse.text();
        console.log('✅ 资源读取成功');
        
        console.log('\n📄 验证内容:');
        console.log('-----------------------------------');
        console.log(content);
        console.log('-----------------------------------');
        
        const hasTask = content.includes(taskId);
        const hasTitle = content.includes('正确的任务创建');
        
        console.log(`\n📋 验证结果:`);
        console.log(`   包含任务ID: ${hasTask ? '✅' : '❌'}`);
        console.log(`   包含标题: ${hasTitle ? '✅' : '❌'}`);
        
        if (hasTask && hasTitle) {
          console.log('\n🎉 INSERT 操作真正成功！');
        }
        
      } else {
        console.log(`❌ 验证失败: ${verifyResponse.status}`);
      }
      
      // 4. 演示 SPARQL UPDATE（对资源文件）
      console.log('\n🔄 演示 SPARQL UPDATE...');
      const updateQuery = `
PREFIX dc: <http://purl.org/dc/terms/>
DELETE { <#${taskId}> <http://www.w3.org/2002/07/owl#status> "todo" . }
INSERT { <#${taskId}> <http://www.w3.org/2002/07/owl#status> "completed" . }
WHERE { <#${taskId}> <http://www.w3.org/2002/07/owl#status> "todo" . }`;
      
      const updateResponse = await session.fetch(resourceUrl, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/sparql-update'
        },
        body: updateQuery
      });
      
      console.log(`📤 更新响应: ${updateResponse.status}`);
      
      if (updateResponse.ok) {
        console.log('✅ SPARQL UPDATE 成功！');
        
        // 验证更新结果
        const verifyUpdateResponse = await session.fetch(resourceUrl, {
          method: 'GET',
          headers: {
            'Accept': 'text/turtle'
          }
        });
        
        if (verifyUpdateResponse.ok) {
          const updatedContent = await verifyUpdateResponse.text();
          const hasCompleted = updatedContent.includes('"completed"');
          const hasTodo = updatedContent.includes('"todo"');
          
          console.log(`📋 更新验证:`);
          console.log(`   状态已更新为completed: ${hasCompleted ? '✅' : '❌'}`);
          console.log(`   不再包含todo状态: ${!hasTodo ? '✅' : '❌'}`);
        }
      } else {
        const errorText = await updateResponse.text();
        console.log(`❌ SPARQL UPDATE 失败: ${errorText.substring(0, 200)}...`);
      }
      
    } else {
      const errorText = await createResponse.text();
      console.log(`❌ 资源创建失败: ${errorText.substring(0, 200)}...`);
    }
    
    await session.logout();
    
  } catch (error) {
    console.log(`❌ 演示失败: ${error.message}`);
  }
  
  console.log('\n🎯 总结:');
  console.log('✅ 正确的方法是创建具体的资源文件，而不是对容器执行 PATCH');
  console.log('✅ 使用 PUT + text/turtle 创建资源');
  console.log('✅ 使用 PATCH + application/sparql-update 更新资源');
  console.log('❌ drizzle-solid 当前的实现有问题，需要修复');
}

correctInsertDemo().catch(console.error);