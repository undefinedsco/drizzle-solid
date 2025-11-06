import fetch from 'node-fetch';
import { Store, Parser, Writer } from 'n3';

/**
 * 本地 Solid Pod 演示
 * 连接到 localhost:3000 的 Solid 服务器
 */

interface LocalSolidConfig {
  baseUrl: string;
  users: string[];
}

class LocalSolidDemo {
  private config: LocalSolidConfig;
  private authFetch: typeof fetch;

  constructor(config: LocalSolidConfig, authFetch: typeof fetch = fetch) {
    this.config = config;
    this.authFetch = authFetch;
  }

  /**
   * 测试服务器是否运行
   */
  async testServerConnection(): Promise<boolean> {
    try {
      console.log(`🔍 测试服务器连接: ${this.config.baseUrl}`);
      
      const response = await this.authFetch(this.config.baseUrl, {
        method: 'HEAD'
      });
      
      console.log(`   状态: ${response.status} ${response.statusText}`);
      
      if (response.ok) {
        console.log('✅ 服务器连接成功');
        return true;
      } else {
        console.log('❌ 服务器连接失败');
        return false;
      }
    } catch (error: any) {
      console.log(`❌ 服务器连接错误: ${error.message}`);
      return false;
    }
  }

  /**
   * 测试用户 Pod 访问
   */
  async testUserPods(): Promise<void> {
    console.log('\n📦 测试用户 Pod 访问:');
    
    for (const user of this.config.users) {
      const userPodUrl = `${this.config.baseUrl}${user}/`;
      const profileUrl = `${userPodUrl}profile/card`;
      
      console.log(`\n  用户: ${user}`);
      console.log(`  Pod URL: ${userPodUrl}`);
      console.log(`  Profile URL: ${profileUrl}`);
      
      try {
        // 测试 Pod 根目录
        const podResponse = await this.authFetch(userPodUrl, {
          method: 'HEAD'
        });
        console.log(`    Pod 访问: ${podResponse.status}`);
        
        // 测试 Profile 文档
        const profileResponse = await this.authFetch(profileUrl, {
          headers: {
            'Accept': 'text/turtle, application/ld+json'
          }
        });
        console.log(`    Profile 访问: ${profileResponse.status}`);
        
        if (profileResponse.ok) {
          const contentType = profileResponse.headers.get('content-type');
          const content = await profileResponse.text();
          
          console.log(`    Content-Type: ${contentType}`);
          console.log(`    内容大小: ${content.length} 字节`);
          
          // 解析 RDF 数据
          await this.parseAndDisplayRDF(content, profileUrl, user);
        }
        
      } catch (error: any) {
        console.log(`    ❌ 访问失败: ${error.message}`);
      }
    }
  }

  /**
   * 解析并显示 RDF 数据
   */
  async parseAndDisplayRDF(rdfContent: string, baseUri: string, user: string): Promise<void> {
    try {
      const parser = new Parser();
      const store = new Store();
      
      const quads = parser.parse(rdfContent);
      store.addQuads(quads);
      
      console.log(`    ✅ 解析了 ${quads.length} 个三元组`);
      
      // 查找用户信息
      const userInfo = this.extractUserInfo(store, user);
      if (Object.keys(userInfo).length > 0) {
        console.log(`    📋 用户信息:`);
        Object.entries(userInfo).forEach(([key, values]) => {
          console.log(`      ${key}: ${Array.isArray(values) ? values.join(', ') : values}`);
        });
      }
      
    } catch (error: any) {
      console.log(`    ❌ RDF 解析失败: ${error.message}`);
    }
  }

  /**
   * 从 RDF Store 中提取用户信息
   */
  private extractUserInfo(store: Store, user: string): Record<string, any> {
    const info: Record<string, any> = {};
    
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
   * 测试 SPARQL 端点
   */
  async testSparqlEndpoints(): Promise<void> {
    console.log('\n🔍 测试 SPARQL 端点:');
    
    const endpoints = [
      'sparql',
      '.well-known/sparql',
      'query'
    ];
    
    for (const user of this.config.users) {
      console.log(`\n  用户: ${user}`);
      const userPodUrl = `${this.config.baseUrl}${user}/`;
      
      for (const endpoint of endpoints) {
        const endpointUrl = `${userPodUrl}${endpoint}`;
        
        try {
          console.log(`    测试: ${endpointUrl}`);
          
          const response = await this.authFetch(endpointUrl, {
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
          
        } catch (error: any) {
          console.log(`      ❌ 错误: ${error.message}`);
        }
      }
    }
  }

  /**
   * 使用 N3 进行本地查询演示
   */
  async demonstrateN3Queries(): Promise<void> {
    console.log('\n🔧 N3.js 本地查询演示:');
    
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
      
      // 查询所有人名
      console.log('\n  📋 查询所有人名:');
      const nameQuads = store.getQuads(null, 'http://xmlns.com/foaf/0.1/name', null, null);
      nameQuads.forEach((quad, index) => {
        console.log(`    ${index + 1}. ${quad.object.value} (${quad.subject.value})`);
      });
      
      // 查询朋友关系
      console.log('\n  👥 查询朋友关系:');
      const knowsQuads = store.getQuads(null, 'http://xmlns.com/foaf/0.1/knows', null, null);
      knowsQuads.forEach((quad, index) => {
        const subjectName = this.getNameForSubject(store, quad.subject.value);
        const objectName = this.getNameForSubject(store, quad.object.value);
        console.log(`    ${index + 1}. ${subjectName} 认识 ${objectName}`);
      });
      
    } catch (error: any) {
      console.log(`  ❌ N3 查询失败: ${error.message}`);
    }
  }

  /**
   * 获取主体的名称
   */
  private getNameForSubject(store: Store, subjectUri: string): string {
    const nameQuads = store.getQuads(subjectUri, 'http://xmlns.com/foaf/0.1/name', null, null);
    return nameQuads.length > 0 ? nameQuads[0].object.value : subjectUri.split('/').pop() || subjectUri;
  }
}

/**
 * 主演示函数
 */
async function runLocalSolidDemo() {
  console.log('🚀 本地 Solid Pod 演示\n');
  console.log('==================================================');
  
  const config: LocalSolidConfig = {
    baseUrl: 'http://localhost:3000/',
    users: ['alice', 'bob', 'charlie']
  };
  
  const demo = new LocalSolidDemo(config);
  
  try {
    // 1. 测试服务器连接
    const serverRunning = await demo.testServerConnection();
    
    if (!serverRunning) {
      console.log('\n❌ 本地 Solid 服务器未运行');
      console.log('💡 请先启动服务器: npm run server:start');
      return;
    }
    
    // 2. 测试用户 Pod 访问
    await demo.testUserPods();
    
    // 3. 测试 SPARQL 端点
    await demo.testSparqlEndpoints();
    
    // 4. N3 查询演示
    await demo.demonstrateN3Queries();
    
  } catch (error: any) {
    console.error('❌ 演示失败:', error);
  }
  
  console.log('\n==================================================');
  console.log('✅ 本地 Solid Pod 演示完成！');
  console.log('\n📝 总结:');
  console.log('  - 测试了本地 Solid 服务器的连接');
  console.log('  - 检查了用户 Pod 的 RDF 数据访问');
  console.log('  - 验证了 SPARQL 端点支持情况');
  console.log('  - 演示了 N3.js 的本地查询能力');
  console.log('\n💡 下一步:');
  console.log('  - 如果 SPARQL 不支持，使用 N3.js + HTTP');
  console.log('  - 复杂查询可以考虑 Comunica');
  console.log('  - 可以实现混合查询策略');
}

// 导出函数
export { LocalSolidDemo, runLocalSolidDemo };

// 如果直接运行此文件
if (require.main === module) {
  runLocalSolidDemo().catch(console.error);
}