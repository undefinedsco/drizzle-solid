#!/usr/bin/env node

/**
 * 直接使用 Solid Pod SPARQL 端点演示
 * N3.js 辅助生成 SPARQL，直接调用 Pod 的 SPARQL 接口
 */

const http = require('http');
const { Store, Parser, Writer, DataFactory } = require('n3');
const { namedNode, literal, quad } = DataFactory;

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
class SparqlQueryBuilder {
  constructor() {
    this.prefixes = new Map();
    this.selectVars = [];
    this.wherePatterns = [];
    this.optionalPatterns = [];
    this.limitValue = null;
  }

  prefix(prefix, uri) {
    this.prefixes.set(prefix, uri);
    return this;
  }

  select(...vars) {
    this.selectVars.push(...vars);
    return this;
  }

  where(subject, predicate, object) {
    this.wherePatterns.push({ subject, predicate, object });
    return this;
  }

  optional(subject, predicate, object) {
    this.optionalPatterns.push({ subject, predicate, object });
    return this;
  }

  limit(count) {
    this.limitValue = count;
    return this;
  }

  build() {
    let query = '';
    
    // 添加前缀
    for (const [prefix, uri] of this.prefixes) {
      query += `PREFIX ${prefix}: <${uri}>\n`;
    }
    
    // SELECT 子句
    query += `SELECT ${this.selectVars.map(v => `?${v}`).join(' ')}\n`;
    
    // WHERE 子句
    query += 'WHERE {\n';
    
    // 必需模式
    for (const pattern of this.wherePatterns) {
      query += `  ${this.formatTriple(pattern)} .\n`;
    }
    
    // 可选模式
    for (const pattern of this.optionalPatterns) {
      query += `  OPTIONAL { ${this.formatTriple(pattern)} } .\n`;
    }
    
    query += '}\n';
    
    // LIMIT 子句
    if (this.limitValue) {
      query += `LIMIT ${this.limitValue}\n`;
    }
    
    return query;
  }

  formatTriple(pattern) {
    const formatTerm = (term) => {
      if (term.startsWith('?')) return term;
      if (term.includes(':')) return term;
      return `<${term}>`;
    };
    
    return `${formatTerm(pattern.subject)} ${formatTerm(pattern.predicate)} ${formatTerm(pattern.object)}`;
  }
}

/**
 * Solid Pod SPARQL 客户端
 */
class SolidSparqlClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  }

  async query(sparqlQuery, endpoint = 'sparql') {
    const url = `${this.baseUrl}${endpoint}`;
    
    console.log(`🔍 查询端点: ${url}`);
    console.log(`📝 SPARQL 查询:\n${sparqlQuery}`);
    
    try {
      const response = await httpRequest(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/sparql-query',
          'Accept': 'application/sparql-results+json, application/json'
        },
        body: sparqlQuery
      });
      
      console.log(`📊 响应状态: ${response.status}`);
      
      if (response.ok) {
        const result = await response.text();
        console.log(`✅ 查询成功!`);
        return JSON.parse(result);
      } else {
        console.log(`❌ 查询失败: ${response.status} ${response.statusText}`);
        const errorText = await response.text();
        console.log(`错误详情: ${errorText.substring(0, 200)}...`);
        return null;
      }
      
    } catch (error) {
      console.log(`❌ 请求错误: ${error.message}`);
      return null;
    }
  }

  async testEndpoints() {
    const endpoints = [
      'sparql',
      '.well-known/sparql', 
      'query',
      'sparql/',
      'query/'
    ];
    
    console.log(`🔍 测试 SPARQL 端点: ${this.baseUrl}`);
    
    for (const endpoint of endpoints) {
      console.log(`\n  测试端点: ${endpoint}`);
      
      const simpleQuery = `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        SELECT ?name WHERE {
          ?person foaf:name ?name .
        } LIMIT 1
      `;
      
      const result = await this.query(simpleQuery, endpoint);
      if (result) {
        console.log(`  ✅ 端点可用: ${endpoint}`);
        return endpoint;
      }
    }
    
    console.log(`  ❌ 没有找到可用的 SPARQL 端点`);
    return null;
  }
}

/**
 * 演示函数
 */
async function demonstrateDirectSparql() {
  console.log('🚀 直接使用 Solid Pod SPARQL 端点演示\n');
  console.log('==================================================');
  
  const baseUrl = 'http://localhost:3000';
  
  // 1. 测试服务器根级别的 SPARQL 端点
  console.log('📋 测试服务器根级别 SPARQL 端点:');
  const rootClient = new SolidSparqlClient(baseUrl);
  const rootEndpoint = await rootClient.testEndpoints();
  
  if (rootEndpoint) {
    console.log(`\n🎯 找到根级别端点: ${rootEndpoint}`);
    await demonstrateQueries(rootClient, rootEndpoint);
  }
  
  // 2. 测试用户级别的 SPARQL 端点
  const users = ['alice', 'bob', 'charlie'];
  
  for (const user of users) {
    console.log(`\n📋 测试用户 ${user} 的 SPARQL 端点:`);
    const userClient = new SolidSparqlClient(`${baseUrl}/${user}`);
    const userEndpoint = await userClient.testEndpoints();
    
    if (userEndpoint) {
      console.log(`\n🎯 找到用户端点: ${user}/${userEndpoint}`);
      await demonstrateQueries(userClient, userEndpoint);
      break; // 找到一个可用的就够了
    }
  }
  
  console.log('\n==================================================');
  console.log('✅ 直接 SPARQL 端点测试完成！');
}

/**
 * 演示各种 SPARQL 查询
 */
async function demonstrateQueries(client, endpoint) {
  console.log('\n🔧 演示 SPARQL 查询 (N3.js 辅助生成):');
  
  // 1. 简单查询：获取所有人名
  console.log('\n  📋 查询 1: 获取所有人名');
  const query1 = new SparqlQueryBuilder()
    .prefix('foaf', 'http://xmlns.com/foaf/0.1/')
    .select('name')
    .where('?person', 'foaf:name', '?name')
    .limit(10)
    .build();
  
  const result1 = await client.query(query1, endpoint);
  if (result1 && result1.results) {
    console.log('  结果:');
    result1.results.bindings.forEach((binding, index) => {
      console.log(`    ${index + 1}. ${binding.name.value}`);
    });
  }
  
  // 2. 可选查询：人名和邮箱
  console.log('\n  📧 查询 2: 人名和邮箱 (可选)');
  const query2 = new SparqlQueryBuilder()
    .prefix('foaf', 'http://xmlns.com/foaf/0.1/')
    .select('name', 'email')
    .where('?person', 'foaf:name', '?name')
    .optional('?person', 'foaf:mbox', '?email')
    .limit(10)
    .build();
  
  const result2 = await client.query(query2, endpoint);
  if (result2 && result2.results) {
    console.log('  结果:');
    result2.results.bindings.forEach((binding, index) => {
      const name = binding.name.value;
      const email = binding.email ? binding.email.value : '(无邮箱)';
      console.log(`    ${index + 1}. ${name} - ${email}`);
    });
  }
  
  // 3. 类型查询：所有人员
  console.log('\n  👤 查询 3: 所有人员类型');
  const query3 = new SparqlQueryBuilder()
    .prefix('foaf', 'http://xmlns.com/foaf/0.1/')
    .prefix('rdf', 'http://www.w3.org/1999/02/22-rdf-syntax-ns#')
    .select('person', 'name')
    .where('?person', 'rdf:type', 'foaf:Person')
    .where('?person', 'foaf:name', '?name')
    .limit(10)
    .build();
  
  const result3 = await client.query(query3, endpoint);
  if (result3 && result3.results) {
    console.log('  结果:');
    result3.results.bindings.forEach((binding, index) => {
      console.log(`    ${index + 1}. ${binding.person.value} (${binding.name.value})`);
    });
  }
  
  // 4. Solid 特定查询：OIDC 发行者
  console.log('\n  🔐 查询 4: OIDC 发行者');
  const query4 = new SparqlQueryBuilder()
    .prefix('solid', 'http://www.w3.org/ns/solid/terms#')
    .prefix('foaf', 'http://xmlns.com/foaf/0.1/')
    .select('person', 'name', 'issuer')
    .where('?person', 'foaf:name', '?name')
    .where('?person', 'solid:oidcIssuer', '?issuer')
    .limit(10)
    .build();
  
  const result4 = await client.query(query4, endpoint);
  if (result4 && result4.results) {
    console.log('  结果:');
    result4.results.bindings.forEach((binding, index) => {
      console.log(`    ${index + 1}. ${binding.name.value} -> ${binding.issuer.value}`);
    });
  }
}

// 运行演示
demonstrateDirectSparql().catch(console.error);