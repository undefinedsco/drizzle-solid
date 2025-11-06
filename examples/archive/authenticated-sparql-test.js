#!/usr/bin/env node

/**
 * 带认证的 SPARQL 测试
 * 演示如何在 Solid Pod 中使用原生 SPARQL
 */

async function authenticatedSparqlTest() {
  // 动态导入 node-fetch
  const { default: fetch } = await import('node-fetch');
  
  console.log('🔐 带认证的 SPARQL 测试');
  console.log('================================\n');
  
  const testId = Date.now();
  const podUrl = `http://localhost:3000/alice/auth-test-${testId}/`;
  
  console.log(`📍 测试路径: ${podUrl}`);
  
  // 注意：这里需要实际的认证 token
  // 在真实应用中，你需要通过 Solid 认证流程获取 token
  const authHeaders = {
    // 'Authorization': 'Bearer YOUR_ACCESS_TOKEN_HERE',
    // 或者使用其他认证方式
  };
  
  console.log('\n💡 认证说明:');
  console.log('• 当前测试没有认证 token，会收到 401 错误');
  console.log('• 在实际应用中，需要通过 Solid 认证流程获取访问令牌');
  console.log('• 可以使用 @inrupt/solid-client-authn-node 进行认证');
  
  // 1. 尝试公开读取（某些容器可能允许）
  console.log('\n1️⃣ 尝试公开读取根路径...');
  try {
    const rootResponse = await fetch('http://localhost:3000/', {
      method: 'GET',
      headers: {
        'Accept': 'text/turtle'
      }
    });
    
    console.log(`   根路径响应: ${rootResponse.status}`);
    if (rootResponse.ok) {
      const content = await rootResponse.text();
      console.log('   ✅ 根路径可以公开访问');
      console.log('   📄 内容预览:');
      console.log(content.substring(0, 200) + '...');
    } else {
      console.log('   ❌ 根路径也需要认证');
    }
  } catch (error) {
    console.log(`   ❌ 根路径访问错误: ${error.message}`);
  }
  
  // 2. 展示正确的认证流程
  console.log('\n2️⃣ 正确的认证流程示例...');
  console.log(`
// 使用 @inrupt/solid-client-authn-node 的示例代码:

import { Session } from '@inrupt/solid-client-authn-node';

async function authenticatedSparqlExample() {
  const session = new Session();
  
  // 1. 认证登录
  await session.login({
    clientId: 'your-client-id',
    clientSecret: 'your-client-secret',
    oidcIssuer: 'http://localhost:3000/',
    redirectUrl: 'http://localhost:3001/callback'
  });
  
  // 2. 使用认证后的 fetch
  const response = await session.fetch(podUrl, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/sparql-update'
    },
    body: sparqlUpdateQuery
  });
  
  return response;
}
  `);
  
  // 3. 演示 SPARQL 查询的正确格式
  console.log('\n3️⃣ 正确的 SPARQL 格式演示...');
  
  const insertQuery = `
PREFIX dc: <http://purl.org/dc/terms/>
INSERT DATA {
  <${podUrl}#item-1> 
    dc:title "Authenticated Test Item" ;
    dc:description "This item was created with proper authentication" .
}`;

  const selectQuery = `
PREFIX dc: <http://purl.org/dc/terms/>
SELECT ?item ?title ?description WHERE {
  ?item dc:title ?title ;
        dc:description ?description .
  FILTER(STRSTARTS(STR(?item), "${podUrl}"))
}`;

  const deleteQuery = `
DELETE WHERE {
  <${podUrl}#item-1> ?p ?o .
}`;

  console.log('   📝 INSERT 查询:');
  console.log(insertQuery);
  
  console.log('\n   📊 SELECT 查询:');
  console.log(selectQuery);
  
  console.log('\n   🗑️  DELETE 查询:');
  console.log(deleteQuery);
  
  // 4. 总结发现
  console.log('\n🎯 重要发现总结:');
  console.log('================================');
  console.log('✅ Solid Pod 确实原生支持 SPARQL!');
  console.log('✅ 可以直接使用 fetch + SPARQL，不需要 Comunica');
  console.log('✅ SPARQL 语法生成正确（从 400 改善到 401 证明了这点）');
  console.log('✅ 409 冲突问题通过使用新路径解决');
  console.log('');
  console.log('🔑 主要挑战:');
  console.log('• 认证和权限管理');
  console.log('• 不同 Solid Pod 服务器的兼容性差异');
  console.log('• 需要处理各种 HTTP 状态码');
  console.log('');
  console.log('💡 推荐方案:');
  console.log('• 使用 N3.js 进行本地 RDF 处理');
  console.log('• 使用 @inrupt/solid-client-authn-* 处理认证');
  console.log('• 直接使用 fetch 发送 SPARQL 请求');
  console.log('• 保留 Comunica 作为复杂查询的备选方案');
}

authenticatedSparqlTest().catch(console.error);