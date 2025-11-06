#!/usr/bin/env node

/**
 * 完整的 Solid Pod CRUD 演示
 * 展示：N3.js 查询 + SPARQL UPDATE 的完整 CRUD 操作
 * 包含原始数据格式展示和 N3.js 解析能力
 */

const http = require('http');
const { Store, Parser, Writer, DataFactory } = require('n3');
const { namedNode, literal, quad } = DataFactory;

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = http.request(requestOptions, (res) => {
      let data = '';
      res.setEncoding('utf8');
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

    req.on('error', (error) => {
      reject(new Error(`HTTP Request failed: ${error.message}`));
    });
    
    if (options.body) {
      req.write(options.body);
    }
    
    req.end();
  });
}

/**
 * Solid Pod CRUD 客户端
 */
class SolidCrudClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  }

  /**
   * READ - 查询数据（使用 N3.js）
   */
  async read(resourceUrl, options = {}) {
    console.log(`\n📖 READ 操作: ${resourceUrl}`);
    console.log('='.repeat(60));
    
    try {
      // 1. 获取原始 RDF 数据
      const response = await httpRequest(resourceUrl, {
        method: 'GET',
        headers: {
          'Accept': options.format || 'text/turtle'
        }
      });
      
      console.log(`📊 响应状态: ${response.status} ${response.statusText}`);
      console.log(`📋 Content-Type: ${response.headers['content-type']}`);
      
      if (!response.ok) {
        console.log('❌ 读取失败');
        return null;
      }
      
      const rawData = await response.text();
      console.log(`📄 原始数据 (${rawData.length} 字节):`);
      console.log('```turtle');
      console.log(rawData);
      console.log('```');
      
      // 2. 使用 N3.js 解析数据
      console.log('\n🔍 N3.js 解析结果:');
      const store = new Store();
      const parser = new Parser();
      
      try {
        const quads = parser.parse(rawData);
        store.addQuads(quads);
        
        console.log(`✅ 成功解析 ${quads.length} 个三元组`);
        
        // 3. 展示解析后的结构化数据
        console.log('\n📊 结构化数据:');
        quads.forEach((quad, index) => {
          console.log(`  ${index + 1}. 主语: ${quad.subject.value}`);
          console.log(`     谓语: ${quad.predicate.value}`);
          console.log(`     宾语: ${quad.object.value} (${quad.object.termType})`);
          console.log('');
        });
        
        // 4. 演示查询能力
        console.log('🔎 查询演示:');
        
        // 查询所有姓名
        const names = store.getQuads(null, namedNode('http://xmlns.com/foaf/0.1/name'), null);
        console.log(`  📝 姓名 (${names.length} 个):`);
        names.forEach((quad, index) => {
          console.log(`    ${index + 1}. ${quad.object.value}`);
        });
        
        // 查询所有邮箱
        const emails = store.getQuads(null, namedNode('http://xmlns.com/foaf/0.1/mbox'), null);
        console.log(`  📧 邮箱 (${emails.length} 个):`);
        emails.forEach((quad, index) => {
          console.log(`    ${index + 1}. ${quad.object.value}`);
        });
        
        // 查询所有属性
        const subjects = new Set();
        quads.forEach(quad => subjects.add(quad.subject.value));
        console.log(`  👤 主体 (${subjects.size} 个):`);
        subjects.forEach((subject, index) => {
          console.log(`    ${index + 1}. ${subject}`);
          const properties = store.getQuads(namedNode(subject), null, null);
          properties.forEach(prop => {
            const predicate = prop.predicate.value.split('/').pop().split('#').pop();
            console.log(`       ${predicate}: ${prop.object.value}`);
          });
        });
        
        return { rawData, store, quads };
        
      } catch (parseError) {
        console.log(`❌ N3.js 解析错误: ${parseError.message}`);
        return { rawData, error: parseError };
      }
      
    } catch (error) {
      console.log(`❌ 读取错误: ${error.message}`);
      return null;
    }
  }

  /**
   * CREATE - 创建数据（使用 SPARQL INSERT）
   */
  async create(resourceUrl, data) {
    console.log(`\n➕ CREATE 操作: ${resourceUrl}`);
    console.log('='.repeat(60));
    
    // 构建 SPARQL INSERT 查询
    let insertQuery = 'PREFIX foaf: <http://xmlns.com/foaf/0.1/>\n';
    insertQuery += 'PREFIX schema: <https://schema.org/>\n';
    insertQuery += 'INSERT DATA {\n';
    
    if (data.name) {
      insertQuery += `  <#me> foaf:name "${data.name}" .\n`;
    }
    if (data.email) {
      insertQuery += `  <#me> foaf:mbox <mailto:${data.email}> .\n`;
    }
    if (data.bio) {
      insertQuery += `  <#me> schema:bio "${data.bio}" .\n`;
    }
    if (data.website) {
      insertQuery += `  <#me> schema:website <${data.website}> .\n`;
    }
    if (data.nick) {
      insertQuery += `  <#me> foaf:nick "${data.nick}" .\n`;
    }
    
    insertQuery += '}';
    
    console.log('📝 SPARQL INSERT 查询:');
    console.log('```sparql');
    console.log(insertQuery);
    console.log('```');
    
    try {
      const response = await httpRequest(resourceUrl, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/sparql-update'
        },
        body: insertQuery
      });
      
      console.log(`📊 响应状态: ${response.status} ${response.statusText}`);
      
      if (response.ok) {
        console.log('✅ CREATE 成功！');
        return true;
      } else {
        const errorText = await response.text();
        console.log('❌ CREATE 失败');
        console.log(`错误信息: ${errorText.substring(0, 200)}...`);
        return false;
      }
      
    } catch (error) {
      console.log(`❌ CREATE 错误: ${error.message}`);
      return false;
    }
  }

  /**
   * UPDATE - 更新数据（使用 SPARQL DELETE/INSERT）
   */
  async update(resourceUrl, oldData, newData) {
    console.log(`\n✏️ UPDATE 操作: ${resourceUrl}`);
    console.log('='.repeat(60));
    
    // 构建 SPARQL DELETE/INSERT 查询
    let updateQuery = 'PREFIX foaf: <http://xmlns.com/foaf/0.1/>\n';
    updateQuery += 'PREFIX schema: <https://schema.org/>\n';
    
    // DELETE 部分
    if (oldData && Object.keys(oldData).length > 0) {
      updateQuery += 'DELETE DATA {\n';
      if (oldData.name) {
        updateQuery += `  <#me> foaf:name "${oldData.name}" .\n`;
      }
      if (oldData.email) {
        updateQuery += `  <#me> foaf:mbox <mailto:${oldData.email}> .\n`;
      }
      if (oldData.bio) {
        updateQuery += `  <#me> schema:bio "${oldData.bio}" .\n`;
      }
      if (oldData.nick) {
        updateQuery += `  <#me> foaf:nick "${oldData.nick}" .\n`;
      }
      updateQuery += '} ;\n';
    }
    
    // INSERT 部分
    updateQuery += 'INSERT DATA {\n';
    if (newData.name) {
      updateQuery += `  <#me> foaf:name "${newData.name}" .\n`;
    }
    if (newData.email) {
      updateQuery += `  <#me> foaf:mbox <mailto:${newData.email}> .\n`;
    }
    if (newData.bio) {
      updateQuery += `  <#me> schema:bio "${newData.bio}" .\n`;
    }
    if (newData.website) {
      updateQuery += `  <#me> schema:website <${newData.website}> .\n`;
    }
    if (newData.nick) {
      updateQuery += `  <#me> foaf:nick "${newData.nick}" .\n`;
    }
    updateQuery += '}';
    
    console.log('📝 SPARQL UPDATE 查询:');
    console.log('```sparql');
    console.log(updateQuery);
    console.log('```');
    
    try {
      const response = await httpRequest(resourceUrl, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/sparql-update'
        },
        body: updateQuery
      });
      
      console.log(`📊 响应状态: ${response.status} ${response.statusText}`);
      
      if (response.ok) {
        console.log('✅ UPDATE 成功！');
        return true;
      } else {
        const errorText = await response.text();
        console.log('❌ UPDATE 失败');
        console.log(`错误信息: ${errorText.substring(0, 200)}...`);
        return false;
      }
      
    } catch (error) {
      console.log(`❌ UPDATE 错误: ${error.message}`);
      return false;
    }
  }

  /**
   * DELETE - 删除数据（使用 SPARQL DELETE）
   */
  async delete(resourceUrl, data) {
    console.log(`\n🗑️ DELETE 操作: ${resourceUrl}`);
    console.log('='.repeat(60));
    
    // 构建 SPARQL DELETE 查询
    let deleteQuery = 'PREFIX foaf: <http://xmlns.com/foaf/0.1/>\n';
    deleteQuery += 'PREFIX schema: <https://schema.org/>\n';
    deleteQuery += 'DELETE DATA {\n';
    
    if (data.name) {
      deleteQuery += `  <#me> foaf:name "${data.name}" .\n`;
    }
    if (data.email) {
      deleteQuery += `  <#me> foaf:mbox <mailto:${data.email}> .\n`;
    }
    if (data.bio) {
      deleteQuery += `  <#me> schema:bio "${data.bio}" .\n`;
    }
    if (data.website) {
      deleteQuery += `  <#me> schema:website <${data.website}> .\n`;
    }
    if (data.nick) {
      deleteQuery += `  <#me> foaf:nick "${data.nick}" .\n`;
    }
    
    deleteQuery += '}';
    
    console.log('📝 SPARQL DELETE 查询:');
    console.log('```sparql');
    console.log(deleteQuery);
    console.log('```');
    
    try {
      const response = await httpRequest(resourceUrl, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/sparql-update'
        },
        body: deleteQuery
      });
      
      console.log(`📊 响应状态: ${response.status} ${response.statusText}`);
      
      if (response.ok) {
        console.log('✅ DELETE 成功！');
        return true;
      } else {
        const errorText = await response.text();
        console.log('❌ DELETE 失败');
        console.log(`错误信息: ${errorText.substring(0, 200)}...`);
        return false;
      }
      
    } catch (error) {
      console.log(`❌ DELETE 错误: ${error.message}`);
      return false;
    }
  }
}

/**
 * 完整 CRUD 演示
 */
async function demonstrateCompleteCrud() {
  console.log('🚀 完整 Solid Pod CRUD 演示');
  console.log('展示原始数据格式和 N3.js 解析能力');
  console.log('==================================================');
  
  const client = new SolidCrudClient('http://localhost:3000');
  const resourceUrl = 'http://localhost:3000/alice/profile/card';
  
  // 1. 初始状态 - READ
  console.log('\n🔍 步骤 1: 读取初始状态');
  let readResult = await client.read(resourceUrl);
  
  // 2. CREATE - 创建新数据
  console.log('\n➕ 步骤 2: 创建新数据');
  const createData = {
    name: 'Alice Smith',
    email: 'alice@example.com',
    bio: '一个热爱编程的开发者',
    website: 'https://alice.example.com',
    nick: 'AliceCode'
  };
  
  await client.create(resourceUrl, createData);
  
  // 验证创建结果
  console.log('\n🔍 验证创建结果:');
  readResult = await client.read(resourceUrl);
  
  // 3. UPDATE - 更新数据
  console.log('\n✏️ 步骤 3: 更新数据');
  const oldData = {
    name: 'Alice Smith',
    bio: '一个热爱编程的开发者'
  };
  const newData = {
    name: 'Alice Johnson',
    bio: '全栈开发工程师，专注于 Solid 和语义网技术',
    nick: 'AliceFullStack'
  };
  
  await client.update(resourceUrl, oldData, newData);
  
  // 验证更新结果
  console.log('\n🔍 验证更新结果:');
  readResult = await client.read(resourceUrl);
  
  // 4. DELETE - 删除部分数据
  console.log('\n🗑️ 步骤 4: 删除部分数据');
  const deleteData = {
    website: 'https://alice.example.com',
    nick: 'AliceFullStack'
  };
  
  await client.delete(resourceUrl, deleteData);
  
  // 验证删除结果
  console.log('\n🔍 验证删除结果:');
  readResult = await client.read(resourceUrl);
  
  // 5. 完全清理
  console.log('\n🧹 步骤 5: 完全清理');
  if (readResult && readResult.store) {
    const allQuads = readResult.store.getQuads();
    const cleanupData = {};
    
    allQuads.forEach(quad => {
      const predicate = quad.predicate.value;
      if (predicate.includes('foaf/0.1/name')) {
        cleanupData.name = quad.object.value;
      } else if (predicate.includes('foaf/0.1/mbox')) {
        cleanupData.email = quad.object.value.replace('mailto:', '');
      } else if (predicate.includes('schema.org/bio')) {
        cleanupData.bio = quad.object.value;
      }
    });
    
    if (Object.keys(cleanupData).length > 0) {
      await client.delete(resourceUrl, cleanupData);
    }
  }
  
  // 最终验证
  console.log('\n🔍 最终状态验证:');
  await client.read(resourceUrl);
  
  console.log('\n==================================================');
  console.log('🎉 完整 CRUD 演示完成！');
  console.log('\n📋 总结:');
  console.log('  ✅ READ: N3.js + HTTP GET - 完美解析各种 RDF 格式');
  console.log('  ✅ CREATE: SPARQL INSERT - 标准语法，强大功能');
  console.log('  ✅ UPDATE: SPARQL DELETE/INSERT - 精确控制');
  console.log('  ✅ DELETE: SPARQL DELETE - 安全删除');
  console.log('\n🔧 推荐架构:');
  console.log('  📖 查询: N3.js (轻量、快速、灵活)');
  console.log('  ✏️ 修改: SPARQL UPDATE (标准、强大)');
  console.log('  🚫 无需: Comunica (重量级、复杂)');
  console.log('  🎯 结果: 最佳性能 + 完整功能');
}

// 运行演示
demonstrateCompleteCrud().catch(console.error);