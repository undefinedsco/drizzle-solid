#!/usr/bin/env node

/**
 * 手动清理 Solid Pod 数据的脚本
 */

const fetch = require('node-fetch');

async function cleanupPodData() {
  console.log('🧹 开始清理 Solid Pod 数据...\n');
  
  const podUrl = 'http://localhost:3000/alice/tasks/';
  
  // 方案1: 使用 SPARQL DELETE 清理特定数据
  console.log('1️⃣ 尝试使用 SPARQL DELETE 清理...');
  
  const deleteAllQuery = `
    DELETE WHERE {
      ?s ?p ?o .
      FILTER(STRSTARTS(STR(?s), "http://localhost:3000/alice/tasks/#"))
    }
  `;
  
  try {
    const response = await fetch(podUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/sparql-update'
      },
      body: deleteAllQuery
    });
    
    console.log(`   响应状态: ${response.status}`);
    if (response.ok) {
      console.log('   ✅ SPARQL DELETE 清理成功');
      return true;
    } else {
      const errorText = await response.text();
      console.log(`   ❌ SPARQL DELETE 失败: ${errorText}`);
    }
  } catch (error) {
    console.log(`   ❌ SPARQL DELETE 错误: ${error.message}`);
  }
  
  // 方案2: 使用 HTTP DELETE 删除整个容器
  console.log('\n2️⃣ 尝试使用 HTTP DELETE 删除容器...');
  
  try {
    const response = await fetch(podUrl, {
      method: 'DELETE'
    });
    
    console.log(`   响应状态: ${response.status}`);
    if (response.ok) {
      console.log('   ✅ HTTP DELETE 清理成功');
      
      // 重新创建容器
      console.log('   📁 重新创建容器...');
      const createResponse = await fetch(podUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/turtle'
        },
        body: `@prefix ldp: <http://www.w3.org/ns/ldp#> .
<> a ldp:Container .`
      });
      
      if (createResponse.ok) {
        console.log('   ✅ 容器重新创建成功');
        return true;
      }
    } else {
      const errorText = await response.text();
      console.log(`   ❌ HTTP DELETE 失败: ${errorText}`);
    }
  } catch (error) {
    console.log(`   ❌ HTTP DELETE 错误: ${error.message}`);
  }
  
  // 方案3: 使用 PUT 覆盖整个容器
  console.log('\n3️⃣ 尝试使用 PUT 覆盖容器内容...');
  
  try {
    const response = await fetch(podUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/turtle'
      },
      body: `@prefix ldp: <http://www.w3.org/ns/ldp#> .
@prefix dc: <http://purl.org/dc/terms/> .

<> a ldp:Container ;
   dc:title "Tasks Container" ;
   dc:description "Container for task management" .`
    });
    
    console.log(`   响应状态: ${response.status}`);
    if (response.ok) {
      console.log('   ✅ PUT 覆盖清理成功');
      return true;
    } else {
      const errorText = await response.text();
      console.log(`   ❌ PUT 覆盖失败: ${errorText}`);
    }
  } catch (error) {
    console.log(`   ❌ PUT 覆盖错误: ${error.message}`);
  }
  
  console.log('\n❌ 所有清理方案都失败了');
  console.log('💡 建议手动操作:');
  console.log('   1. 重启 Solid Pod 服务器');
  console.log('   2. 或者直接删除 solid-server-data/alice/tasks/ 目录');
  console.log('   3. 或者使用 Solid Pod 管理界面清理数据');
  
  return false;
}

// 验证清理结果
async function verifyCleanup() {
  console.log('\n🔍 验证清理结果...');
  
  try {
    const response = await fetch('http://localhost:3000/alice/tasks/', {
      method: 'GET',
      headers: {
        'Accept': 'text/turtle'
      }
    });
    
    if (response.ok) {
      const content = await response.text();
      console.log('当前容器内容:');
      console.log('---');
      console.log(content);
      console.log('---');
      
      // 检查是否还有测试数据
      if (content.includes('#task-') || content.includes('test-native-sparql')) {
        console.log('⚠️  仍然存在测试数据，可能需要进一步清理');
      } else {
        console.log('✅ 容器已清理干净');
      }
    }
  } catch (error) {
    console.log(`验证失败: ${error.message}`);
  }
}

// 主函数
async function main() {
  const success = await cleanupPodData();
  if (success) {
    await verifyCleanup();
  }
}

main().catch(console.error);