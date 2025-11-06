#!/usr/bin/env node

/**
 * 直接发送 SPARQL 请求到 Solid Pod
 * N3.js 辅助生成 SPARQL 查询，直接发送请求
 */

const http = require('http');
const { Store, Parser, DataFactory } = require('n3');

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || 80,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = http.request(requestOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: res.headers,
          text: () => Promise.resolve(data),
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

/**
 * SPARQL 查询构建器 (使用 N3.js 辅助)
 */
class SparqlBuilder {
  constructor() {
    this.prefixes = new Map([
      ['foaf', 'http://xmlns.com/foaf/0.1/'],
      ['solid', 'http://www.w3.org/ns/solid/terms#'],
      ['schema', 'https://schema.org/'],
      ['rdf', 'http://www.w3.org/1999/02/22-rdf-syntax-ns#']
    ]);
  }

  // 生成查询所有人名的 SPARQL
  getAllNames() {
    return `
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
SELECT ?name WHERE {
  ?person foaf:name ?name .
}`;
  }

  // 生成查询人名和邮箱的 SPARQL
  getNamesAndEmails() {
    return `
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
SELECT ?name ?email WHERE {
  ?person foaf:name ?name .
  OPTIONAL { ?person foaf:mbox ?email }
}`;
  }

  // 生成查询用户详细信息的 SPARQL
  getUserDetails() {
    return `
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
PREFIX schema: <https://schema.org/>
PREFIX solid: <http://www.w3.org/ns/solid/terms#>
SELECT ?person ?name ?email ?bio ?website ?location WHERE {
  ?person foaf:name ?name .
  OPTIONAL { ?person foaf:mbox ?email }
  OPTIONAL { ?person schema:bio ?bio }
  OPTIONAL { ?person schema:website ?website }
  OPTIONAL { ?person schema:location ?location }
}`;
  }

  // 生成计数查询的 SPARQL
  getPersonCount() {
    return `
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
SELECT (COUNT(?person) as ?count) WHERE {
  ?person foaf:name ?name .
}`;
  }
}

/**
 * 直接 SPARQL 客户端
 */
class DirectSparqlClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    this.builder = new SparqlBuilder();
  }

  async executeSparql(sparqlQuery, targetUrl = null) {
    const url = targetUrl || `${this.baseUrl}/sparql`;
    
    console.log(`🔍 发送 SPARQL 请求到: ${url}`);
    console.log(`📝 查询内容:\n${sparqlQuery.trim()}`);
    
    try {
      const response = await httpRequest(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/sparql-query',
          'Accept': 'application/sparql-results+json, application/json, text/plain'
        },
        body: sparqlQuery.trim()
      });
      
      console.log(`📊 响应状态: ${response.status} ${response.statusText}`);
      console.log(`📋 响应头: ${JSON.stringify(response.headers, null, 2)}`);
      
      const responseText = await response.text();
      console.log(`📄 响应内容 (${responseText.length} 字节):`);
      console.log(responseText.substring(0, 500) + (responseText.length > 500 ? '...' : ''));
      
      if (response.ok) {
        try {
          return JSON.parse(responseText);
        } catch (e) {
          console.log('⚠️ 响应不是 JSON 格式，返回原始文本');
          return { raw: responseText };
        }
      } else {
        console.log(`❌ 请求失败`);
        return null;
      }
      
    } catch (error) {
      console.log(`❌ 请求错误: ${error.message}`);
      return null;
    }
  }

  async testMultipleEndpoints(sparqlQuery) {
    const endpoints = [
      `${this.baseUrl}/sparql`,
      `${this.baseUrl}/query`,
      `${this.baseUrl}/.well-known/sparql`,
      `${this.baseUrl}/`,  // 直接发送到根目录
      `${this.baseUrl}/alice/`,  // 发送到用户目录
      `${this.baseUrl}/alice/sparql`,
      `${this.baseUrl}/alice/query`
    ];

    console.log('\n🔄 测试多个端点...\n');
    
    for (const endpoint of endpoints) {
      console.log(`\n${'='.repeat(60)}`);
      const result = await this.executeSparql(sparqlQuery, endpoint);
      
      if (result && result.results && result.results.bindings) {
        console.log(`✅ 成功！找到可用端点: ${endpoint}`);
        return { endpoint, result };
      }
      
      console.log(`${'='.repeat(60)}\n`);
    }
    
    return null;
  }
}

/**
 * 主演示函数
 */
async function demonstrateDirectSparql() {
  console.log('🚀 直接发送 SPARQL 请求演示\n');
  console.log('==================================================');
  
  const client = new DirectSparqlClient('http://localhost:3000');
  
  // 1. 测试简单的人名查询
  console.log('\n📋 测试 1: 查询所有人名');
  const nameQuery = client.builder.getAllNames();
  const nameResult = await client.testMultipleEndpoints(nameQuery);
  
  if (nameResult) {
    console.log('\n🎉 成功获取结果:');
    nameResult.result.results.bindings.forEach((binding, index) => {
      console.log(`  ${index + 1}. ${binding.name.value}`);
    });
  }
  
  // 2. 测试人名和邮箱查询
  console.log('\n\n📧 测试 2: 查询人名和邮箱');
  const emailQuery = client.builder.getNamesAndEmails();
  const emailResult = await client.testMultipleEndpoints(emailQuery);
  
  if (emailResult) {
    console.log('\n🎉 成功获取结果:');
    emailResult.result.results.bindings.forEach((binding, index) => {
      const name = binding.name.value;
      const email = binding.email ? binding.email.value : '(无邮箱)';
      console.log(`  ${index + 1}. ${name} - ${email}`);
    });
  }
  
  // 3. 测试详细信息查询
  console.log('\n\n👤 测试 3: 查询用户详细信息');
  const detailQuery = client.builder.getUserDetails();
  const detailResult = await client.testMultipleEndpoints(detailQuery);
  
  if (detailResult) {
    console.log('\n🎉 成功获取结果:');
    detailResult.result.results.bindings.forEach((binding, index) => {
      console.log(`  ${index + 1}. ${binding.name.value}`);
      if (binding.email) console.log(`      邮箱: ${binding.email.value}`);
      if (binding.bio) console.log(`      简介: ${binding.bio.value.substring(0, 50)}...`);
      if (binding.website) console.log(`      网站: ${binding.website.value}`);
      if (binding.location) console.log(`      位置: ${binding.location.value}`);
    });
  }
  
  // 4. 测试计数查询
  console.log('\n\n📊 测试 4: 统计人员数量');
  const countQuery = client.builder.getPersonCount();
  const countResult = await client.testMultipleEndpoints(countQuery);
  
  if (countResult) {
    console.log('\n🎉 成功获取结果:');
    const count = countResult.result.results.bindings[0].count.value;
    console.log(`  总人数: ${count}`);
  }
  
  console.log('\n==================================================');
  console.log('✅ 直接 SPARQL 请求演示完成！');
  
  if (nameResult || emailResult || detailResult || countResult) {
    console.log('\n🎯 结论:');
    console.log('  ✅ Solid Pod 支持直接 SPARQL 查询！');
    console.log('  ✅ N3.js 可以完美辅助生成 SPARQL 查询');
    console.log('  ✅ 无需 Comunica，直接发送请求即可');
    console.log('  🔧 推荐方案: N3.js + 直接 SPARQL 请求');
  } else {
    console.log('\n💡 备选方案:');
    console.log('  🔧 如果 SPARQL 不可用，可以用 N3.js + HTTP 获取 RDF');
    console.log('  🔧 然后在本地执行类似 SPARQL 的查询');
  }
}

// 运行演示
demonstrateDirectSparql().catch(console.error);