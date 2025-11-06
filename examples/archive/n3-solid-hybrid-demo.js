#!/usr/bin/env node

/**
 * N3.js + Solid Pod 混合方案演示
 * 
 * 架构说明:
 * - 查询(SELECT): HTTP GET + N3.js 本地查询
 * - 修改(UPDATE): SPARQL UPDATE + HTTP PATCH
 * - 这样既保持了 SPARQL 语法，又避免了 Comunica 的重量
 */

const http = require('http');

// 模拟 N3.js 的基本功能 (实际项目中应该 import N3)
class SimpleStore {
  constructor() {
    this.triples = [];
  }
  
  addQuad(subject, predicate, object) {
    this.triples.push({ subject, predicate, object });
  }
  
  // 简单的 SPARQL SELECT 模拟
  select(pattern) {
    const results = [];
    for (const triple of this.triples) {
      const match = {};
      let isMatch = true;
      
      for (const [key, value] of Object.entries(pattern)) {
        if (value.startsWith('?')) {
          // 变量，记录绑定
          match[value] = triple[key];
        } else if (triple[key] !== value) {
          // 常量，必须匹配
          isMatch = false;
          break;
        }
      }
      
      if (isMatch) {
        results.push(match);
      }
    }
    return results;
  }
}

function httpRequest(url, options = {}) {
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
          text: () => Promise.resolve(data),
          json: () => Promise.resolve(JSON.parse(data))
        });
      });
    });
    
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// 将 JSON-LD 转换为简单的三元组存储
function jsonLdToStore(jsonLd) {
  const store = new SimpleStore();
  
  if (Array.isArray(jsonLd)) {
    for (const item of jsonLd) {
      const subject = item['@id'];
      
      for (const [predicate, values] of Object.entries(item)) {
        if (predicate === '@id' || predicate === '@type') continue;
        
        if (Array.isArray(values)) {
          for (const value of values) {
            const object = value['@value'] || value['@id'] || value;
            store.addQuad(subject, predicate, object);
          }
        }
      }
    }
  }
  
  return store;
}

async function demonstrateHybridApproach() {
  console.log('🚀 N3.js + Solid Pod 混合方案演示');
  console.log('==================================================');
  
  const baseUrl = 'http://localhost:3000';
  const profileUrl = `${baseUrl}/alice/profile/card`;
  
  // 1. 查询操作 - 使用 HTTP GET + N3.js 本地查询
  console.log('\n📖 步骤 1: 查询操作 (GET + N3.js)');
  console.log('='.repeat(50));
  
  try {
    // 获取原始数据
    const response = await httpRequest(profileUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/ld+json'
      }
    });
    
    if (response.ok) {
      const jsonLd = await response.json();
      console.log('✅ 获取到 JSON-LD 数据');
      
      // 转换为 N3 存储
      const store = jsonLdToStore(jsonLd);
      console.log(`📊 转换为三元组: ${store.triples.length} 个`);
      
      // 执行类似 SPARQL SELECT 的查询
      console.log('\n🔍 执行查询: 查找所有姓名');
      const nameResults = store.select({
        subject: 'http://localhost:3000/alice/profile/card#me',
        predicate: 'http://xmlns.com/foaf/0.1/name',
        object: '?name'
      });
      
      console.log('📋 查询结果:');
      nameResults.forEach((result, index) => {
        console.log(`  ${index + 1}. ${result['?name']}`);
      });
      
      console.log('\n🔍 执行查询: 查找所有邮箱');
      const emailResults = store.select({
        subject: 'http://localhost:3000/alice/profile/card#me',
        predicate: 'http://xmlns.com/foaf/0.1/mbox',
        object: '?email'
      });
      
      console.log('📋 查询结果:');
      emailResults.forEach((result, index) => {
        console.log(`  ${index + 1}. ${result['?email']}`);
      });
      
    } else {
      console.log(`❌ 获取数据失败: ${response.status}`);
    }
  } catch (error) {
    console.log(`❌ 查询操作失败: ${error.message}`);
  }
  
  // 2. 修改操作 - 使用 SPARQL UPDATE
  console.log('\n✏️ 步骤 2: 修改操作 (SPARQL UPDATE)');
  console.log('='.repeat(50));
  
  // 添加新数据
  const insertQuery = `
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
PREFIX schema: <https://schema.org/>
INSERT DATA {
  <#me> foaf:nick "N3Demo" .
  <#me> schema:jobTitle "Semantic Web Developer" .
}`;

  try {
    const insertResponse = await httpRequest(profileUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/sparql-update'
      },
      body: insertQuery.trim()
    });
    
    console.log(`📊 插入操作状态: ${insertResponse.status}`);
    if (insertResponse.ok) {
      console.log('✅ 数据插入成功');
    }
  } catch (error) {
    console.log(`❌ 插入操作失败: ${error.message}`);
  }
  
  // 3. 验证修改结果 - 再次查询
  console.log('\n🔍 步骤 3: 验证修改结果');
  console.log('='.repeat(50));
  
  try {
    const verifyResponse = await httpRequest(profileUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/ld+json'
      }
    });
    
    if (verifyResponse.ok) {
      const jsonLd = await verifyResponse.json();
      const store = jsonLdToStore(jsonLd);
      
      // 查询新添加的昵称
      const nickResults = store.select({
        subject: 'http://localhost:3000/alice/profile/card#me',
        predicate: 'http://xmlns.com/foaf/0.1/nick',
        object: '?nick'
      });
      
      console.log('🏷️ 所有昵称:');
      nickResults.forEach((result, index) => {
        console.log(`  ${index + 1}. ${result['?nick']}`);
      });
      
      // 查询职位信息
      const jobResults = store.select({
        subject: 'http://localhost:3000/alice/profile/card#me',
        predicate: 'https://schema.org/jobTitle',
        object: '?job'
      });
      
      console.log('💼 职位信息:');
      jobResults.forEach((result, index) => {
        console.log(`  ${index + 1}. ${result['?job']}`);
      });
    }
  } catch (error) {
    console.log(`❌ 验证失败: ${error.message}`);
  }
  
  // 4. 删除操作
  console.log('\n🗑️ 步骤 4: 删除操作 (SPARQL DELETE)');
  console.log('='.repeat(50));
  
  const deleteQuery = `
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
DELETE DATA {
  <#me> foaf:nick "N3Demo" .
}`;

  try {
    const deleteResponse = await httpRequest(profileUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/sparql-update'
      },
      body: deleteQuery.trim()
    });
    
    console.log(`📊 删除操作状态: ${deleteResponse.status}`);
    if (deleteResponse.ok) {
      console.log('✅ 数据删除成功');
    }
  } catch (error) {
    console.log(`❌ 删除操作失败: ${error.message}`);
  }
  
  // 5. 总结和建议
  console.log('\n📋 总结和建议');
  console.log('='.repeat(50));
  console.log('🎯 混合方案的优势:');
  console.log('  ✅ 保持 SPARQL 语法 (UPDATE 部分)');
  console.log('  ✅ 避免 Comunica 的重量');
  console.log('  ✅ N3.js 提供强大的本地查询能力');
  console.log('  ✅ 直接使用 Solid Pod 的原生接口');
  
  console.log('\n🏗️ 推荐架构:');
  console.log('  📖 读取: HTTP GET → JSON-LD → N3.js Store → 本地 SPARQL 查询');
  console.log('  ✏️ 写入: SPARQL UPDATE → HTTP PATCH → Solid Pod');
  console.log('  🔄 缓存: N3.js Store 可以作为本地缓存层');
  
  console.log('\n💡 实现建议:');
  console.log('  1. 创建一个 SolidN3Client 类封装这些操作');
  console.log('  2. 实现智能缓存机制，减少网络请求');
  console.log('  3. 提供类似 Comunica 的查询接口，但更轻量');
  console.log('  4. 支持批量操作和事务性更新');
}

// 运行演示
demonstrateHybridApproach().catch(console.error);