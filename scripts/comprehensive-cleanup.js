#!/usr/bin/env node

/**
 * 综合清理方案 - 处理认证和数据清理
 */

const fs = require('fs');
const path = require('path');

// 使用动态导入解决 node-fetch ESM 问题
async function getFetch() {
  const { default: fetch } = await import('node-fetch');
  return fetch;
}

async function comprehensiveCleanup() {
  const fetch = await getFetch();
=======
  console.log('🧹 综合清理 Solid Pod 数据');
  console.log('================================\n');
  
  // 1. 检查服务器状态
  console.log('1️⃣ 检查 Solid Pod 服务器状态...');
  try {
    const response = await fetch('http://localhost:3000/', {
      method: 'GET'
    });
    console.log(`   服务器响应状态: ${response.status}`);
    if (response.ok) {
      console.log('   ✅ 服务器正在运行');
    }
  } catch (error) {
    console.log('   ❌ 服务器未运行或无法访问');
    console.log('   💡 请先启动服务器: npm run solid-server');
    return;
  }
  
  // 2. 尝试无认证访问（某些 Pod 服务器允许）
  console.log('\n2️⃣ 尝试无认证清理...');
  await attemptCleanupWithoutAuth();
  
  // 3. 检查本地数据目录
  console.log('\n3️⃣ 检查本地数据存储...');
  await checkLocalDataStorage();
  
  // 4. 提供手动清理指南
  console.log('\n4️⃣ 手动清理指南...');
  provideManualCleanupGuide();
}

async function attemptCleanupWithoutAuth() {
  const fetch = await getFetch();
  const podUrl = 'http://localhost:3000/alice/tasks/';
  
  // 尝试简单的 PUT 请求重置容器
  try {
=======
    const response = await fetch(podUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/turtle'
      },
      body: `@prefix ldp: <http://www.w3.org/ns/ldp#> .
@prefix dc: <http://purl.org/dc/terms/> .

<> a ldp:Container ;
   dc:title "Tasks Container" ;
   dc:description "Clean container for task management" .`
    });
    
    console.log(`   PUT 重置响应: ${response.status}`);
    if (response.ok) {
      console.log('   ✅ 无认证清理成功');
      return true;
    } else {
      const errorText = await response.text();
      console.log(`   ❌ 无认证清理失败: ${errorText.substring(0, 100)}...`);
    }
  } catch (error) {
    console.log(`   ❌ 无认证清理错误: ${error.message}`);
  }
  
  return false;
}

async function checkLocalDataStorage() {
  const possiblePaths = [
    './solid-server-data',
    './data',
    './.solid',
    './db',
    './storage',
    process.env.HOME + '/.solid',
    '/tmp/solid-server-data'
  ];
  
  for (const dataPath of possiblePaths) {
    if (fs.existsSync(dataPath)) {
      console.log(`   📁 发现数据目录: ${dataPath}`);
      
      // 查找 alice 相关数据
      try {
        const alicePath = path.join(dataPath, 'alice');
        if (fs.existsSync(alicePath)) {
          console.log(`   👤 发现 alice 数据: ${alicePath}`);
          
          // 列出 alice 目录内容
          const aliceContents = fs.readdirSync(alicePath);
          console.log(`   📋 alice 目录内容: ${aliceContents.join(', ')}`);
          
          // 检查 tasks 目录
          const tasksPath = path.join(alicePath, 'tasks');
          if (fs.existsSync(tasksPath)) {
            console.log(`   📝 发现 tasks 目录: ${tasksPath}`);
            
            // 备份并清理
            const backupPath = `${tasksPath}.backup.${Date.now()}`;
            fs.renameSync(tasksPath, backupPath);
            fs.mkdirSync(tasksPath);
            
            console.log(`   ✅ tasks 目录已清理，备份至: ${backupPath}`);
            return true;
          }
        }
      } catch (error) {
        console.log(`   ❌ 处理 ${dataPath} 时出错: ${error.message}`);
      }
    }
  }
  
  console.log('   ❌ 未找到本地数据存储目录');
  return false;
}

function provideManualCleanupGuide() {
  console.log('   📖 手动清理步骤:');
  console.log('');
  console.log('   方案 A: 重启服务器');
  console.log('   1. 停止当前 Solid Pod 服务器 (Ctrl+C)');
  console.log('   2. 重新启动: npm run solid-server');
  console.log('   3. 重新运行测试');
  console.log('');
  console.log('   方案 B: 使用不同的测试路径');
  console.log('   1. 修改测试代码使用新的容器路径');
  console.log('   2. 例如: http://localhost:3000/alice/test-clean/');
  console.log('');
  console.log('   方案 C: 认证后清理');
  console.log('   1. 使用 Solid Pod 管理界面登录');
  console.log('   2. 手动删除 tasks 容器中的数据');
  console.log('');
  console.log('   方案 D: 忽略 409 错误');
  console.log('   1. 409 可能只是警告，不影响实际功能');
  console.log('   2. 专注于测试 INSERT 和 SELECT 操作');
}

// 创建一个简化的测试，使用新的干净路径
async function createCleanTest() {
  console.log('\n5️⃣ 创建使用干净路径的测试...');
  
  const cleanTestCode = `#!/usr/bin/env node

/**
 * 使用干净路径的 SPARQL 测试
 */

const fetch = require('node-fetch');

async function cleanSparqlTest() {
  console.log('🧪 使用干净路径测试 SPARQL\\n');
  
  // 使用时间戳创建唯一路径
  const timestamp = Date.now();
  const podUrl = \`http://localhost:3000/alice/test-\${timestamp}/\`;
  
  console.log(\`📍 测试路径: \${podUrl}\`);
  
  // 1. 创建容器
  console.log('\\n1️⃣ 创建测试容器...');
  try {
    const createResponse = await fetch(podUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/turtle'
      },
      body: \`@prefix ldp: <http://www.w3.org/ns/ldp#> .
<> a ldp:Container .\`
    });
    
    console.log(\`   创建容器响应: \${createResponse.status}\`);
  } catch (error) {
    console.log(\`   创建容器失败: \${error.message}\`);
  }
  
  // 2. 测试 INSERT
  console.log('\\n2️⃣ 测试 INSERT...');
  const insertQuery = \`
    PREFIX dc: <http://purl.org/dc/terms/>
    INSERT DATA {
      <\${podUrl}#clean-test> 
        dc:title "Clean Test" ;
        dc:description "Testing with clean path" .
    }
  \`;
  
  try {
    const insertResponse = await fetch(podUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/sparql-update'
      },
      body: insertQuery
    });
    
    console.log(\`   INSERT 响应: \${insertResponse.status}\`);
    if (!insertResponse.ok) {
      const errorText = await insertResponse.text();
      console.log(\`   错误: \${errorText.substring(0, 200)}...\`);
    }
  } catch (error) {
    console.log(\`   INSERT 失败: \${error.message}\`);
  }
  
  // 3. 验证数据
  console.log('\\n3️⃣ 验证数据...');
  try {
    const getResponse = await fetch(podUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/turtle'
      }
    });
    
    console.log(\`   GET 响应: \${getResponse.status}\`);
    if (getResponse.ok) {
      const content = await getResponse.text();
      console.log('   内容预览:');
      console.log(content.substring(0, 300) + '...');
    }
  } catch (error) {
    console.log(\`   验证失败: \${error.message}\`);
  }
}

cleanSparqlTest().catch(console.error);`;

  fs.writeFileSync('examples/clean-sparql-test.js', cleanTestCode);
  console.log('   ✅ 已创建 examples/clean-sparql-test.js');
  console.log('   🚀 运行: node examples/clean-sparql-test.js');
}

// 主函数
async function main() {
  await comprehensiveCleanup();
  await createCleanTest();
  
  console.log('\n🎯 总结:');
  console.log('• 409 冲突可能是认证或数据冲突问题');
  console.log('• 建议使用新的干净路径进行测试');
  console.log('• Solid Pod 确实支持原生 SPARQL');
  console.log('• 可以考虑不使用 Comunica，直接用 N3.js + fetch');
}

main().catch(console.error);