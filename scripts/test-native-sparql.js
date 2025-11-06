#!/usr/bin/env node

/**
 * 测试 Solid Pod 原生 SPARQL 支持
 * 
 * 运行方式: node scripts/test-native-sparql.js
 */

const https = require('https');
const http = require('http');

// 简单的 HTTP 请求函数
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    
    const req = client.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      ...options
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: data,
          ok: res.statusCode >= 200 && res.statusCode < 300
        });
      });
    });
    
    req.on('error', reject);
    
    if (options.body) {
      req.write(options.body);
    }
    
    req.end();
  });
}

// 测试不同的 Solid Pod 提供商（包括本地服务器）
const testPods = [
  {
    name: '本地 Solid 服务器',
    baseUrl: 'http://localhost:3000/',
    profileUrl: 'http://localhost:3000/alice/profile/card'
  },
  {
    name: 'SolidCommunity.net',
    baseUrl: 'https://solidcommunity.net/',
    profileUrl: 'https://solidcommunity.net/profile/card'
  },
  {
    name: 'Inrupt PodSpaces',
    baseUrl: 'https://pod.inrupt.com/',
    profileUrl: 'https://pod.inrupt.com/example/profile/card'
  }
];

// 测试 SPARQL 端点
async function testSparqlEndpoint(baseUrl, endpointPath) {
  const fullUrl = baseUrl + endpointPath;
  
  console.log(`  🔍 测试端点: ${fullUrl}`);
  
  // 简单的 SPARQL 查询
  const sparqlQuery = `
    PREFIX foaf: <http://xmlns.com/foaf/0.1/>
    SELECT ?name WHERE {
      ?person foaf:name ?name .
    } LIMIT 1
  `;

  try {
    // 先测试 HEAD 请求看端点是否存在
    const headResponse = await makeRequest(fullUrl, {
      method: 'HEAD'
    });
    
    console.log(`    HEAD 请求: ${headResponse.status}`);
    
    if (!headResponse.ok) {
      return { success: false, error: `端点不存在 (${headResponse.status})` };
    }

    // 尝试 SPARQL 查询
    const queryResponse = await makeRequest(fullUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sparql-query',
        'Accept': 'application/sparql-results+json'
      },
      body: sparqlQuery
    });

    console.log(`    SPARQL 查询: ${queryResponse.status}`);
    
    if (queryResponse.ok) {
      try {
        const results = JSON.parse(queryResponse.data);
        return { 
          success: true, 
          results: results,
          endpoint: fullUrl
        };
      } catch (parseError) {
        return { 
          success: false, 
          error: `响应解析失败: ${parseError.message}`,
          rawResponse: queryResponse.data.substring(0, 200)
        };
      }
    } else {
      return { 
        success: false, 
        error: `查询失败 (${queryResponse.status})`,
        response: queryResponse.data.substring(0, 200)
      };
    }
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 测试 RDF 数据获取
async function testRdfAccess(profileUrl) {
  console.log(`  📄 测试 RDF 数据获取: ${profileUrl}`);
  
  try {
    const response = await makeRequest(profileUrl, {
      headers: {
        'Accept': 'text/turtle, application/ld+json, application/rdf+xml'
      }
    });
    
    console.log(`    状态: ${response.status}`);
    console.log(`    Content-Type: ${response.headers['content-type']}`);
    
    if (response.ok) {
      const dataSize = response.data.length;
      const preview = response.data.substring(0, 200).replace(/\n/g, '\\n');
      
      return {
        success: true,
        contentType: response.headers['content-type'],
        size: dataSize,
        preview: preview
      };
    } else {
      return {
        success: false,
        error: `获取失败 (${response.status})`
      };
    }
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 主测试函数
async function runTests() {
  console.log('🚀 开始测试 Solid Pod 原生 SPARQL 支持\n');
  
  const results = {
    sparqlSupport: [],
    rdfAccess: [],
    summary: {
      totalPods: testPods.length,
      sparqlEnabled: 0,
      rdfAccessible: 0
    }
  };

  for (const pod of testPods) {
    console.log(`\n📦 测试 ${pod.name}`);
    console.log(`   基础URL: ${pod.baseUrl}`);
    
    // 测试可能的 SPARQL 端点
    const sparqlEndpoints = [
      'sparql',
      '.well-known/sparql',
      'query',
      '' // 根路径
    ];
    
    let sparqlFound = false;
    
    for (const endpoint of sparqlEndpoints) {
      const result = await testSparqlEndpoint(pod.baseUrl, endpoint);
      
      if (result.success) {
        console.log(`    ✅ SPARQL 端点可用: ${endpoint}`);
        results.sparqlSupport.push({
          pod: pod.name,
          endpoint: result.endpoint,
          working: true
        });
        sparqlFound = true;
        break;
      } else {
        console.log(`    ❌ ${endpoint}: ${result.error}`);
      }
    }
    
    if (sparqlFound) {
      results.summary.sparqlEnabled++;
    }
    
    // 测试 RDF 数据访问
    const rdfResult = await testRdfAccess(pod.profileUrl);
    
    if (rdfResult.success) {
      console.log(`    ✅ RDF 数据可访问`);
      console.log(`       类型: ${rdfResult.contentType}`);
      console.log(`       大小: ${rdfResult.size} 字节`);
      console.log(`       预览: ${rdfResult.preview}...`);
      
      results.rdfAccess.push({
        pod: pod.name,
        url: pod.profileUrl,
        contentType: rdfResult.contentType,
        size: rdfResult.size
      });
      
      results.summary.rdfAccessible++;
    } else {
      console.log(`    ❌ RDF 数据访问失败: ${rdfResult.error}`);
    }
  }

  // 输出总结
  console.log('\n' + '='.repeat(50));
  console.log('📊 测试总结');
  console.log('='.repeat(50));
  
  console.log(`\n🎯 SPARQL 支持情况:`);
  console.log(`   支持 SPARQL 的 Pod: ${results.summary.sparqlEnabled}/${results.summary.totalPods}`);
  
  if (results.sparqlSupport.length > 0) {
    console.log(`   可用的 SPARQL 端点:`);
    results.sparqlSupport.forEach(item => {
      console.log(`     - ${item.pod}: ${item.endpoint}`);
    });
  }
  
  console.log(`\n📄 RDF 数据访问:`);
  console.log(`   可访问 RDF 的 Pod: ${results.summary.rdfAccessible}/${results.summary.totalPods}`);
  
  if (results.rdfAccess.length > 0) {
    console.log(`   RDF 数据源:`);
    results.rdfAccess.forEach(item => {
      console.log(`     - ${item.pod}: ${item.contentType} (${item.size} bytes)`);
    });
  }

  // 结论和建议
  console.log(`\n💡 结论:`);
  
  if (results.summary.sparqlEnabled > 0) {
    console.log(`   ✅ 发现 ${results.summary.sparqlEnabled} 个 Pod 支持原生 SPARQL`);
    console.log(`   💡 可以直接使用 HTTP + SPARQL，无需 Comunica`);
    console.log(`   🚀 建议优先尝试原生 SPARQL 方式`);
  } else {
    console.log(`   ❌ 未发现支持原生 SPARQL 的 Pod`);
    console.log(`   💡 需要使用 Comunica 或类似的 SPARQL 引擎`);
    console.log(`   📚 可以通过 RDF 数据 + 本地 SPARQL 引擎实现查询`);
  }
  
  if (results.summary.rdfAccessible > 0) {
    console.log(`   ✅ ${results.summary.rdfAccessible} 个 Pod 支持 RDF 数据访问`);
    console.log(`   💡 可以使用 N3.js 解析和查询 RDF 数据`);
  }

  console.log(`\n🛠️  推荐方案:`);
  
  if (results.summary.sparqlEnabled > 0 && results.summary.rdfAccessible > 0) {
    console.log(`   1. 优先使用原生 SPARQL (性能最佳)`);
    console.log(`   2. 备选方案: N3.js + RDF 数据 (兼容性好)`);
    console.log(`   3. 复杂查询: Comunica (功能最全)`);
  } else if (results.summary.rdfAccessible > 0) {
    console.log(`   1. 使用 N3.js + RDF 数据进行本地查询`);
    console.log(`   2. 复杂 SPARQL 需求使用 Comunica`);
  } else {
    console.log(`   1. 使用 Comunica 作为主要 SPARQL 引擎`);
    console.log(`   2. 考虑其他 Solid Pod 提供商`);
  }
}

// 运行测试
if (require.main === module) {
  runTests().catch(error => {
    console.error('❌ 测试失败:', error);
    process.exit(1);
  });
}

module.exports = { runTests, testSparqlEndpoint, testRdfAccess };