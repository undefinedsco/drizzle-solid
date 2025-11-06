import { Store, Parser, Writer, DataFactory } from 'n3';
import fetch from 'node-fetch';

const { namedNode, literal, quad } = DataFactory;

/**
 * 简化的 Solid Pod SPARQL 客户端
 * 直接使用 N3 和 HTTP 请求，无需 Comunica
 */
class SimpleN3SolidClient {
  private podUrl: string;
  private store: Store;

  constructor(podUrl: string) {
    this.podUrl = podUrl.endsWith('/') ? podUrl : podUrl + '/';
    this.store = new Store();
  }

  /**
   * 从 Pod 获取 RDF 数据并加载到 N3 Store
   */
  async loadFromPod(resourceUrl: string): Promise<void> {
    try {
      const response = await fetch(resourceUrl, {
        headers: {
          'Accept': 'text/turtle, application/ld+json, application/rdf+xml'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch ${resourceUrl}: ${response.statusText}`);
      }

      const rdfData = await response.text();
      const contentType = response.headers.get('content-type') || '';
      
      // 根据 Content-Type 选择解析器格式
      let format = 'text/turtle'; // 默认
      if (contentType.includes('application/ld+json')) {
        format = 'application/ld+json';
      } else if (contentType.includes('application/rdf+xml')) {
        format = 'application/rdf+xml';
      }

      const parser = new Parser({ format });
      const quads = parser.parse(rdfData);
      
      this.store.addQuads(quads);
      console.log(`✅ 已加载 ${quads.length} 个三元组从 ${resourceUrl}`);
      
    } catch (error) {
      console.error(`❌ 加载失败 ${resourceUrl}:`, error.message);
      throw error;
    }
  }

  /**
   * 尝试直接向 Pod 发送 SPARQL 查询
   */
  async directSparqlQuery(sparqlQuery: string): Promise<any> {
    // 尝试不同的 SPARQL 端点
    const endpoints = [
      `${this.podUrl}sparql`,
      `${this.podUrl}.well-known/sparql`,
      this.podUrl // 有些 Pod 在根路径支持 SPARQL
    ];

    for (const endpoint of endpoints) {
      try {
        console.log(`🔍 尝试 SPARQL 端点: ${endpoint}`);
        
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/sparql-query',
            'Accept': 'application/sparql-results+json'
          },
          body: sparqlQuery
        });

        if (response.ok) {
          const results = await response.json();
          console.log(`✅ SPARQL 查询成功！端点: ${endpoint}`);
          return results;
        } else {
          console.log(`❌ 端点 ${endpoint} 返回: ${response.status}`);
        }
      } catch (error) {
        console.log(`❌ 端点 ${endpoint} 错误:`, error.message);
      }
    }

    throw new Error('所有 SPARQL 端点都不可用');
  }

  /**
   * 使用 N3 Store 进行本地查询（简单模式匹配）
   */
  queryLocal(subject?: string, predicate?: string, object?: string): any[] {
    const subjectNode = subject ? namedNode(subject) : undefined;
    const predicateNode = predicate ? namedNode(predicate) : undefined;
    const objectNode = object ? (object.startsWith('http') ? namedNode(object) : literal(object)) : undefined;

    const matches = this.store.getQuads(subjectNode || null, predicateNode || null, objectNode || null, null);
    
    return matches.map(quad => ({
      subject: quad.subject.value,
      predicate: quad.predicate.value,
      object: quad.object.value,
      objectType: quad.object.termType
    }));
  }

  /**
   * 获取某个主体的所有属性
   */
  getProfile(personUri: string): Record<string, any> {
    const matches = this.queryLocal(personUri);
    const profile: Record<string, any> = {};

    matches.forEach(match => {
      const predicate = match.predicate;
      const value = match.object;
      
      // 简化谓词名称
      const shortPredicate = predicate.split('/').pop() || predicate.split('#').pop() || predicate;
      
      if (!profile[shortPredicate]) {
        profile[shortPredicate] = [];
      }
      profile[shortPredicate].push(value);
    });

    return profile;
  }

  /**
   * 添加新的三元组到 Pod（如果支持）
   */
  async addTriple(subject: string, predicate: string, object: string): Promise<void> {
    const sparqlUpdate = `
      INSERT DATA {
        <${subject}> <${predicate}> ${object.startsWith('http') ? `<${object}>` : `"${object}"`} .
      }
    `;

    try {
      const response = await fetch(this.podUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/sparql-update'
        },
        body: sparqlUpdate
      });

      if (response.ok) {
        console.log('✅ 三元组添加成功');
        // 同时更新本地 store
        const quad_obj = object.startsWith('http') ? namedNode(object) : literal(object);
        this.store.addQuad(quad(namedNode(subject), namedNode(predicate), quad_obj));
      } else {
        throw new Error(`更新失败: ${response.status}`);
      }
    } catch (error) {
      console.error('❌ 添加三元组失败:', error.message);
      throw error;
    }
  }

  /**
   * 导出当前 store 为 Turtle 格式
   */
  exportAsTurtle(): string {
    const writer = new Writer({ format: 'text/turtle' });
    const quads = this.store.getQuads(null, null, null, null);
    
    quads.forEach(quad => writer.addQuad(quad));
    
    return new Promise((resolve, reject) => {
      writer.end((error, result) => {
        if (error) reject(error);
        else resolve(result);
      });
    }) as any;
  }

  /**
   * 获取 store 统计信息
   */
  getStats(): any {
    const quads = this.store.getQuads(null, null, null, null);
    const subjects = new Set(quads.map(q => q.subject.value));
    const predicates = new Set(quads.map(q => q.predicate.value));
    const objects = new Set(quads.map(q => q.object.value));

    return {
      totalQuads: quads.length,
      uniqueSubjects: subjects.size,
      uniquePredicates: predicates.size,
      uniqueObjects: objects.size,
      subjects: Array.from(subjects).slice(0, 5), // 前5个示例
      predicates: Array.from(predicates).slice(0, 5)
    };
  }
}

/**
 * 演示函数
 */
async function demonstrateSimpleN3Solid() {
  console.log('=== 简单 N3 + Solid Pod 演示 ===\n');

  // 使用公开的测试 Pod 或本地 Pod
  const podUrl = 'https://solidcommunity.net/profile/card#me';
  const client = new SimpleN3SolidClient('https://solidcommunity.net/');

  try {
    // 1. 加载 Pod 数据到本地 N3 Store
    console.log('1. 从 Pod 加载数据...');
    await client.loadFromPod('https://solidcommunity.net/profile/card');
    
    // 2. 显示统计信息
    console.log('\n2. 数据统计:');
    const stats = client.getStats();
    console.log(JSON.stringify(stats, null, 2));

    // 3. 查询特定信息
    console.log('\n3. 查询 FOAF 名称:');
    const names = client.queryLocal(null, 'http://xmlns.com/foaf/0.1/name');
    names.forEach(result => {
      console.log(`  名称: ${result.object}`);
    });

    // 4. 尝试直接 SPARQL 查询
    console.log('\n4. 尝试直接 SPARQL 查询...');
    const sparqlQuery = `
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>
      SELECT ?name WHERE {
        ?person foaf:name ?name .
      } LIMIT 5
    `;

    try {
      const sparqlResults = await client.directSparqlQuery(sparqlQuery);
      console.log('SPARQL 查询结果:', JSON.stringify(sparqlResults, null, 2));
    } catch (error) {
      console.log('❌ 直接 SPARQL 查询不支持，使用本地 N3 Store 查询');
    }

    // 5. 获取完整档案
    console.log('\n5. 获取档案信息:');
    const profile = client.getProfile(podUrl);
    console.log(JSON.stringify(profile, null, 2));

  } catch (error) {
    console.error('演示失败:', error.message);
  }
}

/**
 * 对比不同方法的优缺点
 */
function compareApproaches() {
  console.log('\n=== 方法对比 ===\n');
  
  const approaches = {
    '直接 N3 + HTTP': {
      优点: [
        '轻量级，依赖少',
        '性能好，无中间层',
        '完全控制查询逻辑',
        '适合简单场景'
      ],
      缺点: [
        '需要手动处理 HTTP 请求',
        '不支持复杂 SPARQL 查询',
        '缺少联邦查询能力',
        '错误处理需要自己实现'
      ],
      适用场景: [
        '简单的 RDF 数据读取',
        '基础的三元组查询',
        '性能敏感的应用',
        '轻量级集成'
      ]
    },
    'Comunica': {
      优点: [
        '完整的 SPARQL 1.1 支持',
        '联邦查询能力',
        '多数据源支持',
        '成熟的错误处理'
      ],
      缺点: [
        '较重的依赖',
        '配置相对复杂',
        '性能开销',
        '学习曲线'
      ],
      适用场景: [
        '复杂 SPARQL 查询',
        '多数据源联邦查询',
        '企业级应用',
        '需要完整 SPARQL 功能'
      ]
    }
  };

  Object.entries(approaches).forEach(([name, details]) => {
    console.log(`${name}:`);
    console.log('  优点:');
    details.优点.forEach(pro => console.log(`    ✅ ${pro}`));
    console.log('  缺点:');
    details.缺点.forEach(con => console.log(`    ❌ ${con}`));
    console.log('  适用场景:');
    details.适用场景.forEach(scenario => console.log(`    💡 ${scenario}`));
    console.log('');
  });
}

// 主函数
export async function runSimpleDemo() {
  await demonstrateSimpleN3Solid();
  compareApproaches();
  
  console.log('=== 建议 ===');
  console.log('💡 对于简单的 Solid Pod 查询，直接使用 N3 + HTTP 是可行的');
  console.log('💡 如果需要复杂 SPARQL 功能，建议继续使用 Comunica');
  console.log('💡 可以采用混合方式：简单查询用 N3，复杂查询用 Comunica');
}

// 如果直接运行
if (require.main === module) {
  runSimpleDemo().catch(console.error);
}