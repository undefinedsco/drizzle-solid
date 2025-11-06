#!/usr/bin/env node

/**
 * 调试路径构建问题
 */

async function debugPathConstruction() {
  console.log('🐛 调试路径构建问题');
  console.log('================================\n');
  
  // 模拟 drizzle-solid 的路径构建逻辑
  const podUrl = 'http://localhost:3000';
  const webId = 'http://localhost:3000/alice/profile/card#me';
  const containerPath = '/tasks/';  // 来自表定义
  
  console.log('📋 输入参数:');
  console.log(`   podUrl: ${podUrl}`);
  console.log(`   webId: ${webId}`);
  console.log(`   containerPath: ${containerPath}`);
  
  // 模拟 extractUserPathFromWebId
  function extractUserPathFromWebId(webId) {
    try {
      const url = new URL(webId);
      const pathParts = url.pathname.split('/');
      if (pathParts.length >= 2) {
        const username = pathParts[1];
        return `/${username}/`;
      }
    } catch (error) {
      console.warn('Failed to parse webId:', webId, error);
    }
    return '';
  }
  
  const userPath = extractUserPathFromWebId(webId);
  console.log(`\n📍 用户路径: ${userPath}`);
  
  // 模拟当前的路径构建逻辑
  const fullContainerPath = containerPath.startsWith(userPath) ? 
    containerPath : 
    userPath + containerPath.replace(/^\//, '');
  
  let containerUrl = podUrl.endsWith('/') ? 
    podUrl + fullContainerPath.replace(/^\//, '') : 
    podUrl + fullContainerPath;
  
  // 确保容器URL以斜杠结尾
  if (!containerUrl.endsWith('/')) {
    containerUrl += '/';
  }
  
  console.log(`\n🔧 路径构建过程:`);
  console.log(`   fullContainerPath: ${fullContainerPath}`);
  console.log(`   containerUrl (with slash): ${containerUrl}`);
  
  // 对于INSERT，去掉结尾斜杠
  const queryUrl = containerUrl.endsWith('/') ? containerUrl.slice(0, -1) : containerUrl;
  console.log(`   queryUrl (for INSERT): ${queryUrl}`);
  
  // 现在测试这个 URL 是否正确
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
    
    // 测试不同的 URL
    const testUrls = [
      queryUrl,                                    // drizzle-solid 计算的 URL
      'http://localhost:3000/alice/tasks',         // 我们知道正确的 URL
      'http://localhost:3000/alice/tasks/',        // 带斜杠的版本
    ];
    
    console.log('\n🧪 测试不同的 URL...');
    
    for (const testUrl of testUrls) {
      console.log(`\n📍 测试: ${testUrl}`);
      
      const response = await session.fetch(testUrl, {
        method: 'GET',
        headers: {
          'Accept': 'text/turtle'
        }
      });
      
      console.log(`   状态: ${response.status}`);
      
      if (response.ok) {
        const content = await response.text();
        const taskCount = (content.match(/task-/g) || []).length;
        console.log(`   ✅ 成功! 包含 ${taskCount} 个任务`);
        
        if (testUrl === queryUrl) {
          console.log('   🎯 drizzle-solid 的 URL 是正确的！');
        }
      } else {
        console.log(`   ❌ 失败`);
        
        if (testUrl === queryUrl) {
          console.log('   🚨 drizzle-solid 的 URL 有问题！');
        }
      }
    }
    
    // 如果 drizzle-solid 的 URL 是正确的，那么问题可能在 SPARQL 执行
    if (queryUrl === 'http://localhost:3000/alice/tasks') {
      console.log('\n🎯 URL 正确，问题可能在 SPARQL 执行器');
      
      // 测试直接的 SPARQL INSERT
      const testTaskId = `task-direct-${Date.now()}`;
      const directSparql = `
PREFIX dc: <http://purl.org/dc/terms/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

INSERT DATA {
  <tasks/#${testTaskId}> 
    rdf:type <http://example.org/Task> ;
    dc:title "直接SPARQL测试" ;
    dc:description "绕过drizzle-solid直接测试" ;
    <http://www.w3.org/2002/07/owl#status> "todo" ;
    <http://example.org/priority> 1 ;
    dc:created "${new Date().toISOString()}"^^<http://www.w3.org/2001/XMLSchema#dateTime> .
}`;
      
      console.log('\n📝 直接 SPARQL INSERT:');
      console.log('-----------------------------------');
      console.log(directSparql);
      console.log('-----------------------------------');
      
      const directResponse = await session.fetch(queryUrl, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/sparql-update'
        },
        body: directSparql
      });
      
      console.log(`📤 直接 SPARQL 响应: ${directResponse.status}`);
      
      if (directResponse.ok) {
        console.log('✅ 直接 SPARQL INSERT 成功');
        
        // 验证
        const verifyResponse = await session.fetch(queryUrl, {
          method: 'GET',
          headers: {
            'Accept': 'text/turtle'
          }
        });
        
        if (verifyResponse.ok) {
          const content = await verifyResponse.text();
          const hasDirectTask = content.includes(testTaskId);
          const hasDirectTitle = content.includes('直接SPARQL测试');
          
          console.log(`📋 直接插入成功: ${hasDirectTask ? '✅' : '❌'}`);
          console.log(`📋 标题插入成功: ${hasDirectTitle ? '✅' : '❌'}`);
          
          if (hasDirectTask && hasDirectTitle) {
            console.log('\n🎉 直接 SPARQL 工作正常！');
            console.log('💡 问题在于 drizzle-solid 的 SPARQL 执行器');
          }
        }
      } else {
        const errorText = await directResponse.text();
        console.log(`❌ 直接 SPARQL 失败: ${errorText.substring(0, 200)}...`);
      }
    }
    
    await session.logout();
    
  } catch (error) {
    console.log(`❌ 调试失败: ${error.message}`);
  }
  
  console.log('\n🎯 调试结论:');
  console.log('1. 验证 drizzle-solid 的路径构建是否正确');
  console.log('2. 测试直接 SPARQL vs drizzle-solid SPARQL');
  console.log('3. 定位问题是在路径还是在执行器');
}

debugPathConstruction().catch(console.error);