#!/usr/bin/env node

/**
 * 完整集成演示：AST → SPARQL → SolidN3Client
 * 展示如何用 N3.js 替代 Comunica 的完整工作流
 */

const http = require('http');

// 模拟 SolidN3Client 的核心功能
class SimpleSolidN3Client {
  constructor() {
    this.cache = new Map();
  }

  async query(endpoint, sparqlQuery) {
    console.log(`🔍 执行查询到: ${endpoint}`);
    console.log(`📝 SPARQL: ${sparqlQuery.trim()}`);
    
    // 获取数据并本地查询
    const response = await this.httpRequest(endpoint, {
      method: 'GET',
      headers: { 'Accept': 'application/ld+json' }
    });
    
    if (response.ok) {
      const jsonLd = JSON.parse(await response.text());
      const store = this.jsonLdToStore(jsonLd);
      return this.executeLocalQuery(store, sparqlQuery);
    }
    
    throw new Error(`Query failed: ${response.status}`);
  }

  async update(endpoint, sparqlUpdate) {
    console.log(`✏️ 执行更新到: ${endpoint}`);
    console.log(`📝 SPARQL UPDATE: ${sparqlUpdate.trim()}`);
    
    const response = await this.httpRequest(endpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/sparql-update' },
      body: sparqlUpdate
    });
    
    if (!response.ok) {
      throw new Error(`Update failed: ${response.status}`);
    }
    
    console.log('✅ 更新成功');
  }

  // 简化的 JSON-LD 到 Store 转换
  jsonLdToStore(jsonLd) {
    const triples = [];
    
    if (Array.isArray(jsonLd)) {
      for (const item of jsonLd) {
        const subject = item['@id'];
        
        for (const [predicate, values] of Object.entries(item)) {
          if (predicate === '@id' || predicate === '@type') continue;
          
          const valueArray = Array.isArray(values) ? values : [values];
          for (const value of valueArray) {
            const object = value['@value'] || value['@id'] || value;
            triples.push({ subject, predicate, object });
          }
        }
      }
    }
    
    return { triples };
  }

  // 简化的本地查询执行
  executeLocalQuery(store, sparqlQuery) {
    const bindings = [];
    
    // 简单的模式匹配（实际项目中使用完整的 SPARQL 引擎）
    if (sparqlQuery.includes('foaf:name')) {
      for (const triple of store.triples) {
        if (triple.predicate === 'http://xmlns.com/foaf/0.1/name') {
          bindings.push({ '?name': triple.object });
        }
      }
    }
    
    if (sparqlQuery.includes('foaf:mbox')) {
      for (const triple of store.triples) {
        if (triple.predicate === 'http://xmlns.com/foaf/0.1/mbox') {
          bindings.push({ '?email': triple.object });
        }
      }
    }
    
    return { bindings };
  }

  // HTTP 请求辅助方法
  httpRequest(url, options = {}) {
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
}

// 模拟 AST 到 SPARQL 转换器
class AstToSparqlConverter {
  constructor(client) {
    this.client = client || new SimpleSolidN3Client();
  }

  // 将查询 AST 转换为 SPARQL SELECT
  convertQueryAst(ast) {
    console.log('🔄 转换查询 AST:', JSON.stringify(ast, null, 2));
    
    // 根据 AST 生成 SPARQL
    if (ast.type === 'profile_query') {
      return `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        SELECT ?name ?email WHERE {
          ?person foaf:name ?name .
          OPTIONAL { ?person foaf:mbox ?email }
        }
      `;
    }
    
    if (ast.type === 'user_info') {
      return `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        PREFIX schema: <https://schema.org/>
        SELECT ?name ?nick ?bio WHERE {
          ?person foaf:name ?name .
          OPTIONAL { ?person foaf:nick ?nick }
          OPTIONAL { ?person schema:bio ?bio }
        }
      `;
    }
    
    return `SELECT * WHERE { ?s ?p ?o }`;
  }

  // 将更新 AST 转换为 SPARQL UPDATE
  convertUpdateAst(ast) {
    console.log('🔄 转换更新 AST:', JSON.stringify(ast, null, 2));
    
    if (ast.type === 'add_profile') {
      return `
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        INSERT DATA {
          <#me> foaf:name "${ast.data.name}" .
          <#me> foaf:mbox <mailto:${ast.data.email}> .
        }
      `;
    }
    
    if (ast.type === 'update_bio') {
      return `
        PREFIX schema: <https://schema.org/>
        DELETE { <#me> schema:bio ?oldBio }
        INSERT { <#me> schema:bio "${ast.data.bio}" }
        WHERE { OPTIONAL { <#me> schema:bio ?oldBio } }
      `;
    }
    
    return '';
  }

  // 执行查询
  async executeQuery(ast, endpoint) {
    const sparqlQuery = this.convertQueryAst(ast);
    return await this.client.query(endpoint, sparqlQuery);
  }

  // 执行更新
  async executeUpdate(ast, endpoint) {
    const sparqlUpdate = this.convertUpdateAst(ast);
    return await this.client.update(endpoint, sparqlUpdate);
  }
}

// 完整演示
async function demonstrateIntegration() {
  console.log('🚀 完整集成演示：AST → SPARQL → SolidN3Client');
  console.log('==================================================');
  
  const client = new SimpleSolidN3Client();
  const converter = new AstToSparqlConverter(client);
  const endpoint = 'http://localhost:3000/alice/profile/card';
  
  // 1. 查询演示
  console.log('\n📖 步骤 1: 查询演示');
  console.log('='.repeat(50));
  
  const queryAst = {
    type: 'profile_query',
    fields: ['name', 'email']
  };
  
  try {
    const results = await converter.executeQuery(queryAst, endpoint);
    console.log('📋 查询结果:');
    results.bindings.forEach((binding, index) => {
      console.log(`  ${index + 1}. ${JSON.stringify(binding)}`);
    });
  } catch (error) {
    console.log(`❌ 查询失败: ${error.message}`);
  }
  
  // 2. 更新演示
  console.log('\n✏️ 步骤 2: 更新演示');
  console.log('='.repeat(50));
  
  const updateAst = {
    type: 'add_profile',
    data: {
      name: 'AST Generated User',
      email: 'ast@example.com'
    }
  };
  
  try {
    await converter.executeUpdate(updateAst, endpoint);
  } catch (error) {
    console.log(`❌ 更新失败: ${error.message}`);
  }
  
  // 3. 复杂查询演示
  console.log('\n🔍 步骤 3: 复杂查询演示');
  console.log('='.repeat(50));
  
  const complexQueryAst = {
    type: 'user_info',
    fields: ['name', 'nick', 'bio']
  };
  
  try {
    const results = await converter.executeQuery(complexQueryAst, endpoint);
    console.log('📋 复杂查询结果:');
    results.bindings.forEach((binding, index) => {
      console.log(`  ${index + 1}. ${JSON.stringify(binding)}`);
    });
  } catch (error) {
    console.log(`❌ 复杂查询失败: ${error.message}`);
  }
  
  // 4. 架构总结
  console.log('\n🏗️ 架构总结');
  console.log('='.repeat(50));
  console.log('📊 数据流:');
  console.log('  1. 用户输入 → AST');
  console.log('  2. AST → SPARQL (通过 AstToSparqlConverter)');
  console.log('  3. SPARQL → SolidN3Client');
  console.log('  4. SolidN3Client → Solid Pod (HTTP + N3.js)');
  console.log('  5. 结果 ← 用户');
  
  console.log('\n🎯 优势:');
  console.log('  ✅ 轻量级：无需 Comunica 的重量');
  console.log('  ✅ 标准化：使用标准 SPARQL 语法');
  console.log('  ✅ 灵活性：AST 可以生成任意 SPARQL');
  console.log('  ✅ 性能：N3.js 本地查询 + 缓存');
  console.log('  ✅ 兼容性：直接使用 Solid Pod 原生接口');
  
  console.log('\n💡 实现建议:');
  console.log('  1. 使用 sparqljs 进行完整的 SPARQL 解析');
  console.log('  2. 实现智能缓存和批量操作');
  console.log('  3. 添加错误处理和重试机制');
  console.log('  4. 支持更复杂的 SPARQL 1.1 功能');
  console.log('  5. 提供 TypeScript 类型定义');
}

// 运行演示
demonstrateIntegration().catch(console.error);