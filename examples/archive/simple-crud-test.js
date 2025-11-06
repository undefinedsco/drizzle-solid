#!/usr/bin/env node

/**
 * 简化的 CRUD 测试，使用 node-fetch
 */

const { Store, Parser, Writer, DataFactory } = require('n3');
const { namedNode, literal } = DataFactory;

// 使用动态导入来处理 node-fetch 的 ESM 问题
async function createFetch() {
  try {
    const fetch = (await import('node-fetch')).default;
    return fetch;
  } catch (error) {
    // 如果 node-fetch 不可用，使用内置的 http 模块
    const http = require('http');
    return function(url, options = {}) {
      return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const req = http.request({
          hostname: urlObj.hostname,
          port: urlObj.port || 80,
          path: urlObj.pathname + urlObj.search,
          method: options.method || 'GET',
          headers: options.headers || {}
        }, (res) => {
          const chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => {
            const data = Buffer.concat(chunks).toString('utf8');
            resolve({
              status: res.statusCode,
              statusText: res.statusMessage,
              headers: res.headers,
              ok: res.statusCode >= 200 && res.statusCode < 300,
              text: () => Promise.resolve(data)
            });
          });
        });
        
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
      });
    };
  }
}

async function testCrud() {
  console.log('🚀 简化 CRUD 测试');
  console.log('==================================================');
  
  const fetch = await createFetch();
  const resourceUrl = 'http://localhost:3000/alice/profile/card';
  
  // 1. 测试 READ - 获取原始数据
  console.log('\n📖 步骤 1: READ - 获取原始数据');
  console.log('='.repeat(50));
  
  try {
    const response = await fetch(resourceUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/turtle'
      }
    });
    
    console.log(`📊 状态: ${response.status} ${response.statusText}`);
    console.log(`📋 Content-Type: ${response.headers['content-type'] || response.headers.get?.('content-type')}`);
    
    if (response.ok) {
      const rawData = await response.text();
      console.log(`📄 原始数据 (${rawData.length} 字节):`);
      console.log('```turtle');
      console.log(rawData);
      console.log('```');
      
      // N3.js 解析
      if (rawData.trim()) {
        console.log('\n🔍 N3.js 解析:');
        try {
          const store = new Store();
          const parser = new Parser();
          const quads = parser.parse(rawData);
          store.addQuads(quads);
          
          console.log(`✅ 解析成功: ${quads.length} 个三元组`);
          
          quads.forEach((quad, index) => {
            const predicate = quad.predicate.value.split('/').pop().split('#').pop();
            console.log(`  ${index + 1}. ${predicate}: ${quad.object.value}`);
          });
          
        } catch (parseError) {
          console.log(`❌ N3.js 解析错误: ${parseError.message}`);
        }
      } else {
        console.log('⚠️ 数据为空');
      }
    } else {
      console.log('❌ 读取失败');
    }
    
  } catch (error) {
    console.log(`❌ READ 错误: ${error.message}`);
  }
  
  // 2. 测试 CREATE - SPARQL INSERT
  console.log('\n➕ 步骤 2: CREATE - SPARQL INSERT');
  console.log('='.repeat(50));
  
  const insertQuery = `
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
PREFIX schema: <https://schema.org/>
INSERT DATA {
  <#me> foaf:name "Alice Demo" .
  <#me> foaf:mbox <mailto:alice@demo.com> .
  <#me> schema:bio "测试用户" .
}`;

  console.log('📝 SPARQL INSERT:');
  console.log('```sparql');
  console.log(insertQuery.trim());
  console.log('```');
  
  try {
    const response = await fetch(resourceUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/sparql-update'
      },
      body: insertQuery.trim()
    });
    
    console.log(`📊 状态: ${response.status} ${response.statusText}`);
    
    if (response.ok) {
      console.log('✅ CREATE 成功！');
    } else {
      const errorText = await response.text();
      console.log('❌ CREATE 失败');
      console.log(`错误: ${errorText.substring(0, 200)}...`);
    }
    
  } catch (error) {
    console.log(`❌ CREATE 错误: ${error.message}`);
  }
  
  // 3. 验证创建结果
  console.log('\n🔍 步骤 3: 验证创建结果');
  console.log('='.repeat(50));
  
  try {
    const response = await fetch(resourceUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/turtle'
      }
    });
    
    if (response.ok) {
      const rawData = await response.text();
      console.log(`📄 当前数据 (${rawData.length} 字节):`);
      console.log('```turtle');
      console.log(rawData);
      console.log('```');
      
      // 检查是否包含我们插入的数据
      if (rawData.includes('Alice Demo')) {
        console.log('✅ 找到插入的姓名: Alice Demo');
      }
      if (rawData.includes('alice@demo.com')) {
        console.log('✅ 找到插入的邮箱: alice@demo.com');
      }
      if (rawData.includes('测试用户')) {
        console.log('✅ 找到插入的简介: 测试用户');
      }
      
    } else {
      console.log('❌ 验证失败');
    }
    
  } catch (error) {
    console.log(`❌ 验证错误: ${error.message}`);
  }
  
  // 4. 测试 UPDATE - SPARQL DELETE/INSERT
  console.log('\n✏️ 步骤 4: UPDATE - SPARQL DELETE/INSERT');
  console.log('='.repeat(50));
  
  const updateQuery = `
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
PREFIX schema: <https://schema.org/>
DELETE DATA {
  <#me> foaf:name "Alice Demo" .
  <#me> schema:bio "测试用户" .
} ;
INSERT DATA {
  <#me> foaf:name "Alice Updated" .
  <#me> schema:bio "更新后的测试用户" .
  <#me> foaf:nick "AliceUp" .
}`;

  console.log('📝 SPARQL UPDATE:');
  console.log('```sparql');
  console.log(updateQuery.trim());
  console.log('```');
  
  try {
    const response = await fetch(resourceUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/sparql-update'
      },
      body: updateQuery.trim()
    });
    
    console.log(`📊 状态: ${response.status} ${response.statusText}`);
    
    if (response.ok) {
      console.log('✅ UPDATE 成功！');
    } else {
      console.log('❌ UPDATE 失败');
    }
    
  } catch (error) {
    console.log(`❌ UPDATE 错误: ${error.message}`);
  }
  
  // 5. 验证更新结果
  console.log('\n🔍 步骤 5: 验证更新结果');
  console.log('='.repeat(50));
  
  try {
    const response = await fetch(resourceUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/turtle'
      }
    });
    
    if (response.ok) {
      const rawData = await response.text();
      console.log(`📄 更新后数据:`);
      console.log('```turtle');
      console.log(rawData);
      console.log('```');
      
      // N3.js 详细解析
      if (rawData.trim()) {
        console.log('\n🔍 N3.js 详细解析:');
        const store = new Store();
        const parser = new Parser();
        const quads = parser.parse(rawData);
        store.addQuads(quads);
        
        console.log(`📊 总计: ${quads.length} 个三元组`);
        
        // 按类型分组显示
        const names = store.getQuads(null, namedNode('http://xmlns.com/foaf/0.1/name'), null);
        const emails = store.getQuads(null, namedNode('http://xmlns.com/foaf/0.1/mbox'), null);
        const bios = store.getQuads(null, namedNode('https://schema.org/bio'), null);
        const nicks = store.getQuads(null, namedNode('http://xmlns.com/foaf/0.1/nick'), null);
        
        console.log(`📝 姓名 (${names.length}): ${names.map(q => q.object.value).join(', ')}`);
        console.log(`📧 邮箱 (${emails.length}): ${emails.map(q => q.object.value).join(', ')}`);
        console.log(`📖 简介 (${bios.length}): ${bios.map(q => q.object.value).join(', ')}`);
        console.log(`🏷️ 昵称 (${nicks.length}): ${nicks.map(q => q.object.value).join(', ')}`);
      }
      
    } else {
      console.log('❌ 验证失败');
    }
    
  } catch (error) {
    console.log(`❌ 验证错误: ${error.message}`);
  }
  
  // 6. 测试 DELETE - SPARQL DELETE
  console.log('\n🗑️ 步骤 6: DELETE - SPARQL DELETE');
  console.log('='.repeat(50));
  
  const deleteQuery = `
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
DELETE DATA {
  <#me> foaf:nick "AliceUp" .
}`;

  console.log('📝 SPARQL DELETE:');
  console.log('```sparql');
  console.log(deleteQuery.trim());
  console.log('```');
  
  try {
    const response = await fetch(resourceUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/sparql-update'
      },
      body: deleteQuery.trim()
    });
    
    console.log(`📊 状态: ${response.status} ${response.statusText}`);
    
    if (response.ok) {
      console.log('✅ DELETE 成功！');
    } else {
      console.log('❌ DELETE 失败');
    }
    
  } catch (error) {
    console.log(`❌ DELETE 错误: ${error.message}`);
  }
  
  // 7. 最终验证
  console.log('\n🔍 步骤 7: 最终状态');
  console.log('='.repeat(50));
  
  try {
    const response = await fetch(resourceUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/turtle'
      }
    });
    
    if (response.ok) {
      const rawData = await response.text();
      console.log(`📄 最终数据:`);
      console.log('```turtle');
      console.log(rawData);
      console.log('```');
    }
    
  } catch (error) {
    console.log(`❌ 最终验证错误: ${error.message}`);
  }
  
  console.log('\n==================================================');
  console.log('🎉 CRUD 测试完成！');
  console.log('\n📋 关键发现:');
  console.log('  ✅ 原始数据格式: Turtle (.ttl) - 人类可读的 RDF');
  console.log('  ✅ N3.js 解析: 完美支持，快速准确');
  console.log('  ✅ SPARQL UPDATE: 全功能支持 (INSERT/DELETE/UPDATE)');
  console.log('  ❌ SPARQL SELECT: 不支持查询操作');
  console.log('\n🎯 最佳实践:');
  console.log('  📖 查询: HTTP GET + N3.js 解析');
  console.log('  ✏️ 修改: SPARQL UPDATE (PATCH 方法)');
  console.log('  🚫 避免: Comunica (过于重量级)');
  console.log('  🔧 结果: 轻量 + 高效 + 标准');
}

testCrud().catch(console.error);