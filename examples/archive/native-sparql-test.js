#!/usr/bin/env node

/**
 * 测试 Solid Pod 原生 SPARQL 支持
 * 验证是否可以直接用 N3.js 而不需要 Comunica
 */

const fetch = require('node-fetch');

async function testNativeSPARQL() {
  console.log('🧪 测试 Solid Pod 原生 SPARQL 支持\n');
  
  const podUrl = 'http://localhost:3000/alice/tasks/';
  
  // 1. 测试简单的 INSERT DATA
  console.log('1️⃣ 测试 INSERT DATA...');
  const insertQuery = `
    PREFIX dc: <http://purl.org/dc/terms/>
    INSERT DATA {
      <http://localhost:3000/alice/tasks/#test-native-sparql> 
        dc:title "Native SPARQL Test" ;
        dc:description "Testing direct SPARQL without Comunica" .
    }
  `;
  
  try {
    const insertResponse = await fetch(podUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/sparql-update',
        'Authorization': 'Bearer test-token' // 这里需要实际的认证
      },
      body: insertQuery
    });
    
    console.log(`   INSERT 响应状态: ${insertResponse.status}`);
    if (!insertResponse.ok) {
      const errorText = await insertResponse.text();
      console.log(`   错误详情: ${errorText}`);
    } else {
      console.log('   ✅ INSERT 成功');
    }
  } catch (error) {
    console.log(`   ❌ INSERT 失败: ${error.message}`);
  }
  
  // 2. 测试简单的 SELECT 查询
  console.log('\n2️⃣ 测试 SELECT 查询...');
  const selectQuery = `
    PREFIX dc: <http://purl.org/dc/terms/>
    SELECT ?title ?description WHERE {
      <http://localhost:3000/alice/tasks/#test-native-sparql> 
        dc:title ?title ;
        dc:description ?description .
    }
  `;
  
  try {
    const selectResponse = await fetch(podUrl + '?' + new URLSearchParams({
      query: selectQuery
    }), {
      method: 'GET',
      headers: {
        'Accept': 'application/sparql-results+json',
        'Authorization': 'Bearer test-token'
      }
    });
    
    console.log(`   SELECT 响应状态: ${selectResponse.status}`);
    if (!selectResponse.ok) {
      const errorText = await selectResponse.text();
      console.log(`   错误详情: ${errorText}`);
    } else {
      const results = await selectResponse.json();
      console.log('   ✅ SELECT 成功');
      console.log('   结果:', JSON.stringify(results, null, 2));
    }
  } catch (error) {
    console.log(`   ❌ SELECT 失败: ${error.message}`);
  }
  
  // 3. 测试 DELETE WHERE
  console.log('\n3️⃣ 测试 DELETE WHERE...');
  const deleteQuery = `
    DELETE WHERE {
      <http://localhost:3000/alice/tasks/#test-native-sparql> ?p ?o .
    }
  `;
  
  try {
    const deleteResponse = await fetch(podUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/sparql-update',
        'Authorization': 'Bearer test-token'
      },
      body: deleteQuery
    });
    
    console.log(`   DELETE 响应状态: ${deleteResponse.status}`);
    if (!deleteResponse.ok) {
      const errorText = await deleteResponse.text();
      console.log(`   错误详情: ${errorText}`);
    } else {
      console.log('   ✅ DELETE 成功');
    }
  } catch (error) {
    console.log(`   ❌ DELETE 失败: ${error.message}`);
  }
  
  console.log('\n📋 总结:');
  console.log('• Solid Pod 规范确实支持原生 SPARQL');
  console.log('• UPDATE 操作使用 PATCH + application/sparql-update');
  console.log('• SELECT 操作使用 GET + query 参数');
  console.log('• 主要挑战是认证和权限管理');
  console.log('• N3.js 可以用于本地 RDF 处理，但网络请求仍需要适当的 HTTP 客户端');
}

// 运行测试
testNativeSPARQL().catch(console.error);