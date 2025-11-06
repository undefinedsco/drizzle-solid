#!/usr/bin/env node

/**
 * 超简化的本地 Solid Pod 演示
 * 使用内置 http 模块，无需额外依赖
 */

const http = require('http');
const { Store, Parser } = require('n3');

/**
 * 简单的 HTTP 请求函数
 */
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
 * 测试本地 Solid 服务器
 */
async function testLocalSolidServer() {
  console.log('🚀 本地 Solid Pod 演示 (简化版)\n');
  console.log('==================================================');
  
  const baseUrl = 'http://localhost:3000';
  const users = ['alice', 'bob', 'charlie'];
  
  // 1. 测试服务器连接
  console.log(`🔍 测试服务器连接: ${baseUrl}/`);
  
  try {
    const response = await httpRequest(`${baseUrl}/`, { method: 'HEAD' });
    console.log(`   状态: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      console.log('❌ 本地 Solid 服务器未运行');
      console.log('💡 请先启动服务器: npm run server:start');
      return;
    }
    
    console.log('✅ 服务器连接成功\n');
    
  } catch (error) {
    console.log(`❌ 服务器连接错误: ${error.message}`);
    console.log('💡 请先启动服务器: npm run server:start');
    return;
  }
  
  // 2. 测试用户 Pod 访问
  console.log('📦 测试用户 Pod 访问:');
  
  for (const user of users) {
    const userPodUrl = `${baseUrl}/${user}/`;
    const profileUrl = `${userPodUrl}profile/card`;
    
    console.log(`\n  用户: ${user}`);
    console.log(`  Pod URL: ${userPodUrl}`);
    console.log(`  Profile URL: ${profileUrl}`);
    
    try {
      // 测试 Pod 根目录
      const podResponse = await httpRequest(userPodUrl, { method: 'HEAD' });
      console.log(`    Pod 访问: ${podResponse.status}`);
      
      // 测试 Profile 文档
      const profileResponse = await httpRequest(profileUrl, {
        headers: {
          'Accept': 'text/turtle, application/ld+json'
        }
      });
      console.log(`    Profile 访问: ${profileResponse.status}`);
      
      if (profileResponse.ok) {
        const contentType = profileResponse.headers['content-type'];
        const content = await profileResponse.text();
        
        console.log(`    Content-Type: ${contentType}`);
        console.log(`    内容大小: ${content.length} 字节`);
        
        // 解析 RDF 数据
        if (content.length > 0) {
          await parseAndDisplayRDF(content, user);
        }
      }
      
    } catch (error) {
      console.log(`    ❌ 访问失败: ${error.message}`);
    }
  }
  
  // 3. 测试 SPARQL 端点
  console.log('\n🔍 测试 SPARQL 端点:');
  
  const endpoints = ['sparql', '.well-known/sparql', 'query'];
  
  for (const user of users) {
    console.log(`\n  用户: ${user}`);
    const userPodUrl = `${baseUrl}/${user}`;
    
    for (const endpoint of endpoints) {
      const endpointUrl = `${userPodUrl}/${endpoint}`;
      
      try {
        console.log(`    测试: ${endpointUrl}`);
        
        const response = await httpRequest(endpointUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/sparql-query',
            'Accept': 'application/sparql-results+json'
          },
          body: 'SELECT * WHERE { ?s ?p ?o } LIMIT 1'
        });
        
        console.log(`      状态: ${response.status}`);
        
        if (response.ok) {
          const result = await response.text();
          console.log(`      ✅ SPARQL 端点可用!`);
          console.log(`      响应: ${result.substring(0, 100)}...`);
        } else {
          console.log(`      ❌ 不支持 SPARQL`);
        }
        
      } catch (error) {
        console.log(`      ❌ 错误: ${error.message}`);
      }
    }
  }
  
  // 4. N3 查询演示
  console.log('\n🔧 N3.js 本地查询演示:');
  await demonstrateN3Queries();
  
  console.log('\n==================================================');
  console.log('✅ 本地 Solid Pod 演示完成！');
  console.log('\n📝 总结:');
  console.log('  - 测试了本地 Solid 服务器的连接');
  console.log('  - 检查了用户 Pod 的 RDF 数据访问');
  console.log('  - 验证了 SPARQL 端点支持情况');
  console.log('  - 演示了 N3.js 的本地查询能力');
  console.log('\n💡 结论:');
  console.log('  ✅ N3.js 可以直接处理 RDF 数据');
  console.log('  ❌ 大多数 Solid Pod 不支持原生 SPARQL');
  console.log('  🔧 推荐使用 N3.js + HTTP 进行简单查询');
  console.log('  🔧 复杂查询仍需要 Comunica');
}

/**
 * 解析并显示 RDF 数据
 */
async function parseAndDisplayRDF(rdfContent, user) {
  try {
    const parser = new Parser();
    const store = new Store();
    
    const quads = parser.parse(rdfContent);
    store.addQuads(quads);
    
    console.log(`    ✅ 解析了 ${quads.length} 个三元组`);
    
    if (quads.length > 0) {
      // 显示前几个三元组
      console.log(`    📋 RDF 数据示例:`);
      quads.slice(0, 3).forEach((quad, index) => {
        console.log(`      ${index + 1}. ${quad.subject.value} -> ${quad.predicate.value} -> ${quad.object.value}`);
      });
      
      // 查找用户信息
      const userInfo = extractUserInfo(store, user);
      if (Object.keys(userInfo).length > 0) {
        console.log(`    👤 用户信息:`);
        Object.entries(userInfo).forEach(([key, values]) => {
          console.log(`      ${key}: ${Array.isArray(values) ? values.join(', ') : values}`);
        });
      }
    }
    
  } catch (error) {
    console.log(`    ❌ RDF 解析失败: ${error.message}`);
  }
}

/**
 * 从 RDF Store 中提取用户信息
 */
function extractUserInfo(store, user) {
  const info = {};
  
  // 常见的 FOAF 和其他属性
  const properties = {
    'name': 'http://xmlns.com/foaf/0.1/name',
    'email': 'http://xmlns.com/foaf/0.1/mbox',
    'knows': 'http://xmlns.com/foaf/0.1/knows',
    'storage': 'http://www.w3.org/ns/pim/space#storage',
    'oidcIssuer': 'http://www.w3.org/ns/solid/terms#oidcIssuer'
  };
  
  // 查找所有主体
  const allQuads = store.getQuads(null, null, null, null);
  const subjects = new Set(allQuads.map(q => q.subject.value));
  
  // 对每个主体查找属性
  subjects.forEach(subject => {
    Object.entries(properties).forEach(([key, predicate]) => {
      const matches = store.getQuads(subject, predicate, null, null);
      if (matches.length > 0) {
        const values = matches.map(match => match.object.value);
        if (!info[key]) info[key] = [];
        info[key].push(...values);
      }
    });
  });
  
  // 去重
  Object.keys(info).forEach(key => {
    info[key] = [...new Set(info[key])];
    if (info[key].length === 1) {
      info[key] = info[key][0];
    }
  });
  
  return info;
}

/**
 * 使用 N3 进行本地查询演示
 */
async function demonstrateN3Queries() {
  // 创建示例数据
  const sampleData = `
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix solid: <http://www.w3.org/ns/solid/terms#> .
@prefix ex: <http://localhost:3000/> .

ex:alice/profile/card#me foaf:name "Alice" ;
                         foaf:mbox <mailto:alice@localhost> ;
                         solid:oidcIssuer <http://localhost:3000/> ;
                         foaf:knows ex:bob/profile/card#me .

ex:bob/profile/card#me foaf:name "Bob" ;
                       foaf:mbox <mailto:bob@localhost> ;
                       solid:oidcIssuer <http://localhost:3000/> .
  `;
  
  const parser = new Parser();
  const store = new Store();
  
  try {
    const quads = parser.parse(sampleData);
    store.addQuads(quads);
    
    console.log(`  ✅ 加载了 ${quads.length} 个三元组`);
    
    // 查询所有人名 (等效于 SPARQL: SELECT ?name WHERE { ?person foaf:name ?name })
    console.log('\n  📋 查询所有人名:');
    const nameQuads = store.getQuads(null, 'http://xmlns.com/foaf/0.1/name', null, null);
    nameQuads.forEach((quad, index) => {
      console.log(`    ${index + 1}. ${quad.object.value}`);
    });
    
    // 查询朋友关系 (等效于 SPARQL: SELECT ?person1 ?person2 WHERE { ?person1 foaf:knows ?person2 })
    console.log('\n  👥 查询朋友关系:');
    const knowsQuads = store.getQuads(null, 'http://xmlns.com/foaf/0.1/knows', null, null);
    knowsQuads.forEach((quad, index) => {
      const subjectName = getNameForSubject(store, quad.subject.value);
      const objectName = getNameForSubject(store, quad.object.value);
      console.log(`    ${index + 1}. ${subjectName} 认识 ${objectName}`);
    });
    
    // 查询邮箱 (等效于 SPARQL: SELECT ?name ?email WHERE { ?person foaf:name ?name ; foaf:mbox ?email })
    console.log('\n  📧 查询人名和邮箱:');
    nameQuads.forEach((nameQuad, index) => {
      const person = nameQuad.subject.value;
      const name = nameQuad.object.value;
      const emailQuads = store.getQuads(person, 'http://xmlns.com/foaf/0.1/mbox', null, null);
      const email = emailQuads.length > 0 ? emailQuads[0].object.value : '(无邮箱)';
      console.log(`    ${index + 1}. ${name} - ${email}`);
    });
    
  } catch (error) {
    console.log(`  ❌ N3 查询失败: ${error.message}`);
  }
}

/**
 * 获取主体的名称
 */
function getNameForSubject(store, subjectUri) {
  const nameQuads = store.getQuads(subjectUri, 'http://xmlns.com/foaf/0.1/name', null, null);
  return nameQuads.length > 0 ? nameQuads[0].object.value : subjectUri.split('/').pop() || subjectUri;
}

// 运行演示
if (require.main === module) {
  testLocalSolidServer().catch(console.error);
}

module.exports = { testLocalSolidServer };