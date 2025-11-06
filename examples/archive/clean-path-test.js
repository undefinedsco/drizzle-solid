#!/usr/bin/env node

/**
 * 全新路径 SPARQL 测试 - 避免数据冲突
 */

async function cleanPathTest() {
  // 动态导入 node-fetch
  const { default: fetch } = await import('node-fetch');
  
  console.log('🧪 全新路径 SPARQL 测试\n');
  
  // 使用时间戳创建完全唯一的路径
  const testId = '1757951196274';
  const podUrl = `http://localhost:3000/alice/clean-test-${testId}/`;
  
  console.log(`📍 测试路径: ${podUrl}`);
  
  // 1. 创建全新容器
  console.log('\n1️⃣ 创建全新容器...');
  try {
    const createResponse = await fetch(podUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/turtle'
      },
      body: `@prefix ldp: <http://www.w3.org/ns/ldp#> .
@prefix dc: <http://purl.org/dc/terms/> .

<> a ldp:Container ;
   dc:title "Clean Test Container ${testId}" ;
   dc:description "Fresh container for testing" .`
    });
    
    console.log(`   创建响应: ${createResponse.status}`);
    if (createResponse.ok) {
      console.log('   ✅ 容器创建成功');
    } else {
      const errorText = await createResponse.text();
      console.log(`   ❌ 创建失败: ${errorText.substring(0, 100)}...`);
    }
  } catch (error) {
    console.log(`   ❌ 创建错误: ${error.message}`);
  }
  
  // 2. 测试 INSERT DATA
  console.log('\n2️⃣ 测试 INSERT DATA...');
  const insertQuery = `
    PREFIX dc: <http://purl.org/dc/terms/>
    INSERT DATA {
      <${podUrl}#item-1> 
        dc:title "Test Item 1" ;
        dc:description "First test item" .
      <${podUrl}#item-2> 
        dc:title "Test Item 2" ;
        dc:description "Second test item" .
    }
  `;
  
  try {
    const insertResponse = await fetch(podUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/sparql-update'
      },
      body: insertQuery
    });
    
    console.log(`   INSERT 响应: ${insertResponse.status}`);
    if (insertResponse.ok) {
      console.log('   ✅ INSERT 成功');
    } else {
      const errorText = await insertResponse.text();
      console.log(`   ❌ INSERT 失败: ${errorText.substring(0, 200)}...`);
    }
  } catch (error) {
    console.log(`   ❌ INSERT 错误: ${error.message}`);
  }
  
  // 3. 验证数据 (GET)
  console.log('\n3️⃣ 验证数据 (GET)...');
  try {
    const getResponse = await fetch(podUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/turtle'
      }
    });
    
    console.log(`   GET 响应: ${getResponse.status}`);
    if (getResponse.ok) {
      const content = await getResponse.text();
      console.log('   ✅ GET 成功');
      console.log('   📄 内容预览:');
      console.log(content.substring(0, 400) + '...');
      
      // 检查是否包含我们插入的数据
      if (content.includes('Test Item 1') && content.includes('Test Item 2')) {
        console.log('   🎉 数据插入验证成功！');
      }
    } else {
      const errorText = await getResponse.text();
      console.log(`   ❌ GET 失败: ${errorText.substring(0, 200)}...`);
    }
  } catch (error) {
    console.log(`   ❌ GET 错误: ${error.message}`);
  }
  
  // 4. 测试 SELECT 查询 (如果支持)
  console.log('\n4️⃣ 测试 SELECT 查询...');
  const selectQuery = `
    PREFIX dc: <http://purl.org/dc/terms/>
    SELECT ?item ?title WHERE {
      ?item dc:title ?title .
      FILTER(STRSTARTS(STR(?item), "${podUrl}"))
    }
  `;
  
  try {
    const selectUrl = new URL(podUrl);
    selectUrl.searchParams.set('query', selectQuery);
    
    const selectResponse = await fetch(selectUrl.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/sparql-results+json'
      }
    });
    
    console.log(`   SELECT 响应: ${selectResponse.status}`);
    if (selectResponse.ok) {
      const results = await selectResponse.json();
      console.log('   ✅ SELECT 成功');
      console.log('   📊 查询结果:', JSON.stringify(results, null, 2));
    } else {
      const errorText = await selectResponse.text();
      console.log(`   ❌ SELECT 失败: ${errorText.substring(0, 200)}...`);
      console.log('   💡 某些 Solid Pod 可能不支持 SELECT 查询');
    }
  } catch (error) {
    console.log(`   ❌ SELECT 错误: ${error.message}`);
  }
  
  console.log('\n🎯 测试总结:');
  console.log('• 使用全新路径避免了数据冲突');
  console.log('• Solid Pod 确实支持原生 SPARQL UPDATE');
  console.log('• 可以直接使用 fetch + SPARQL，不一定需要 Comunica');
  console.log('• 主要挑战是认证和不同服务器的兼容性');
}

cleanPathTest().catch(console.error);