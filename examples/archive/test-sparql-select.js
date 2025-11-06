#!/usr/bin/env node

/**
 * 测试 Solid Pod 的 SPARQL SELECT 支持
 * 重新验证是否真的不支持 SELECT 操作
 */

const http = require('http');

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
          text: () => Promise.resolve(data)
        });
      });
    });
    
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function testSparqlSelect() {
  console.log('🔍 测试 Solid Pod SPARQL SELECT 支持');
  console.log('==================================================');
  
  const baseUrl = 'http://localhost:3000';
  
  // 首先确保有数据可以查询
  console.log('\n📝 步骤 1: 准备测试数据');
  console.log('='.repeat(50));
  
  const insertQuery = `
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
INSERT DATA {
  <#me> foaf:name "Alice Test" .
  <#me> foaf:mbox <mailto:alice@test.com> .
}`;

  try {
    const response = await httpRequest(`${baseUrl}/alice/profile/card`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/sparql-update'
      },
      body: insertQuery.trim()
    });
    
    console.log(`📊 插入数据状态: ${response.status}`);
    if (response.ok) {
      console.log('✅ 测试数据准备完成');
    }
  } catch (error) {
    console.log(`❌ 准备数据失败: ${error.message}`);
  }
  
  // 测试不同的 SPARQL SELECT 端点和方法
  const selectQuery = `
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
SELECT ?name ?email WHERE {
  ?person foaf:name ?name .
  OPTIONAL { ?person foaf:mbox ?email }
}`;

  const testEndpoints = [
    // 不同的端点
    `${baseUrl}/sparql`,
    `${baseUrl}/query`,
    `${baseUrl}/.well-known/sparql`,
    `${baseUrl}/alice/sparql`,
    `${baseUrl}/alice/query`,
    `${baseUrl}/alice/profile/card?query`,
    
    // 尝试不同的路径
    `${baseUrl}/alice/profile/card`,
    `${baseUrl}/alice/`,
    `${baseUrl}/`,
  ];
  
  const testMethods = [
    { method: 'GET', contentType: null, queryParam: true },
    { method: 'POST', contentType: 'application/sparql-query', queryParam: false },
    { method: 'POST', contentType: 'application/x-www-form-urlencoded', queryParam: false },
    { method: 'POST', contentType: 'text/plain', queryParam: false },
  ];
  
  console.log('\n🔍 步骤 2: 测试 SPARQL SELECT');
  console.log('='.repeat(50));
  console.log('📝 查询语句:');
  console.log('```sparql');
  console.log(selectQuery.trim());
  console.log('```');
  
  for (const endpoint of testEndpoints) {
    console.log(`\n🎯 测试端点: ${endpoint}`);
    console.log('-'.repeat(40));
    
    for (const testMethod of testMethods) {
      let testUrl = endpoint;
      let requestOptions = {
        method: testMethod.method,
        headers: {}
      };
      
      if (testMethod.queryParam && testMethod.method === 'GET') {
        // GET 方法，查询作为 URL 参数
        const encodedQuery = encodeURIComponent(selectQuery.trim());
        testUrl += (endpoint.includes('?') ? '&' : '?') + `query=${encodedQuery}`;
        requestOptions.headers['Accept'] = 'application/sparql-results+json, application/json, text/csv';
      } else if (testMethod.method === 'POST') {
        // POST 方法，查询在 body 中
        if (testMethod.contentType) {
          requestOptions.headers['Content-Type'] = testMethod.contentType;
        }
        requestOptions.headers['Accept'] = 'application/sparql-results+json, application/json, text/csv';
        
        if (testMethod.contentType === 'application/x-www-form-urlencoded') {
          requestOptions.body = `query=${encodeURIComponent(selectQuery.trim())}`;
        } else {
          requestOptions.body = selectQuery.trim();
        }
      }
      
      console.log(`  📡 ${testMethod.method} ${testMethod.contentType || 'no-content-type'}`);
      
      try {
        const response = await httpRequest(testUrl, requestOptions);
        console.log(`    📊 状态: ${response.status} ${response.statusText}`);
        
        if (response.ok) {
          const responseText = await response.text();
          console.log(`    📄 响应 (${responseText.length} 字节):`);
          
          // 尝试解析 JSON 结果
          try {
            const jsonResult = JSON.parse(responseText);
            console.log('    ✅ JSON 解析成功:');
            console.log(`    📊 结果: ${JSON.stringify(jsonResult, null, 6)}`);
            
            if (jsonResult.results && jsonResult.results.bindings) {
              console.log('    🎉 找到 SPARQL SELECT 结果！');
              return { endpoint, method: testMethod, result: jsonResult };
            }
          } catch (jsonError) {
            console.log(`    📝 原始响应: ${responseText.substring(0, 200)}...`);
          }
        } else {
          console.log(`    ❌ 失败`);
        }
        
      } catch (error) {
        console.log(`    ❌ 错误: ${error.message}`);
      }
    }
  }
  
  // 测试特殊的 Community Solid Server 端点
  console.log('\n🔍 步骤 3: 测试 Community Solid Server 特殊端点');
  console.log('='.repeat(50));
  
  const specialEndpoints = [
    `${baseUrl}/.well-known/solid`,
    `${baseUrl}/.well-known/openid_configuration`,
    `${baseUrl}/alice/.well-known/sparql`,
    `${baseUrl}/alice/profile/.well-known/sparql`,
  ];
  
  for (const endpoint of specialEndpoints) {
    console.log(`\n🎯 检查: ${endpoint}`);
    try {
      const response = await httpRequest(endpoint, {
        method: 'GET',
        headers: {
          'Accept': 'application/json, text/plain'
        }
      });
      
      console.log(`📊 状态: ${response.status}`);
      if (response.ok) {
        const text = await response.text();
        console.log(`📄 内容: ${text.substring(0, 300)}...`);
        
        // 检查是否包含 SPARQL 相关信息
        if (text.toLowerCase().includes('sparql')) {
          console.log('🔍 发现 SPARQL 相关信息！');
        }
      }
    } catch (error) {
      console.log(`❌ 错误: ${error.message}`);
    }
  }
  
  console.log('\n==================================================');
  console.log('📋 测试总结:');
  console.log('  如果上面没有找到成功的 SPARQL SELECT 结果，');
  console.log('  那么可能确实不支持 SELECT 查询。');
  console.log('  但让我们再检查服务器配置和文档...');
  
  return null;
}

// 运行测试
testSparqlSelect().then(result => {
  if (result) {
    console.log('\n🎉 成功找到 SPARQL SELECT 支持！');
    console.log(`✅ 端点: ${result.endpoint}`);
    console.log(`✅ 方法: ${result.method.method} ${result.method.contentType}`);
    console.log(`✅ 结果: ${JSON.stringify(result.result, null, 2)}`);
  } else {
    console.log('\n💡 如果确实不支持 SPARQL SELECT，那么推荐方案是:');
    console.log('  📖 查询: N3.js + HTTP GET (获取 RDF 数据后本地查询)');
    console.log('  ✏️ 修改: SPARQL UPDATE (标准支持)');
    console.log('  🎯 这样既保持了 SPARQL 语法，又避免了 Comunica 的重量');
  }
}).catch(console.error);