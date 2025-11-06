#!/usr/bin/env node

/**
 * 快速演示：N3.js vs Comunica 对比
 * 
 * 运行: node examples/quick-demo.js
 */

const { Store, Parser, Writer, DataFactory } = require('n3');
const { namedNode, literal, quad } = DataFactory;

// 模拟 Solid Pod 数据
const sampleTurtleData = `
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
@prefix solid: <http://www.w3.org/ns/solid/terms#> .
@prefix ex: <http://example.org/> .

ex:alice foaf:name "Alice Smith" ;
         foaf:knows ex:bob, ex:charlie ;
         vcard:hasEmail "alice@example.com" ;
         solid:oidcIssuer <https://solidcommunity.net/> .

ex:bob foaf:name "Bob Jones" ;
       foaf:knows ex:alice ;
       vcard:hasEmail "bob@example.com" .

ex:charlie foaf:name "Charlie Brown" ;
           foaf:knows ex:alice ;
           solid:account ex:charlie-account .
`;

class QuickN3Demo {
  constructor() {
    this.store = new Store();
    this.loadSampleData();
  }

  loadSampleData() {
    const parser = new Parser();
    const quads = parser.parse(sampleTurtleData);
    this.store.addQuads(quads);
    console.log(`✅ 加载了 ${quads.length} 个三元组到 N3 Store`);
  }

  // 模拟简单的 SPARQL SELECT 查询
  selectAllNames() {
    console.log('\n🔍 查询所有人名 (等效于: SELECT ?name WHERE { ?person foaf:name ?name })');
    
    const foafName = namedNode('http://xmlns.com/foaf/0.1/name');
    const matches = this.store.getQuads(null, foafName, null, null);
    
    const results = matches.map(quad => ({
      person: quad.subject.value,
      name: quad.object.value
    }));
    
    console.log('结果:');
    results.forEach((result, index) => {
      console.log(`  ${index + 1}. ${result.name} (${result.person})`);
    });
    
    return results;
  }

  // 模拟 SPARQL 的 OPTIONAL 查询
  selectNamesWithEmail() {
    console.log('\n🔍 查询人名和邮箱 (等效于: SELECT ?name ?email WHERE { ?person foaf:name ?name . OPTIONAL { ?person vcard:hasEmail ?email } })');
    
    const foafName = namedNode('http://xmlns.com/foaf/0.1/name');
    const vcardEmail = namedNode('http://www.w3.org/2006/vcard/ns#hasEmail');
    
    const nameMatches = this.store.getQuads(null, foafName, null, null);
    
    const results = nameMatches.map(nameQuad => {
      const person = nameQuad.subject;
      const name = nameQuad.object.value;
      
      // 查找可选的邮箱
      const emailMatches = this.store.getQuads(person, vcardEmail, null, null);
      const email = emailMatches.length > 0 ? emailMatches[0].object.value : null;
      
      return { person: person.value, name, email };
    });
    
    console.log('结果:');
    results.forEach((result, index) => {
      const emailText = result.email ? result.email : '(无邮箱)';
      console.log(`  ${index + 1}. ${result.name} - ${emailText}`);
    });
    
    return results;
  }

  // 模拟 SPARQL 的关系查询
  findFriends(personUri) {
    console.log(`\n🔍 查找 ${personUri} 的朋友 (等效于: SELECT ?friend ?friendName WHERE { <${personUri}> foaf:knows ?friend . ?friend foaf:name ?friendName })`);
    
    const person = namedNode(personUri);
    const foafKnows = namedNode('http://xmlns.com/foaf/0.1/knows');
    const foafName = namedNode('http://xmlns.com/foaf/0.1/name');
    
    // 找到所有朋友
    const friendMatches = this.store.getQuads(person, foafKnows, null, null);
    
    const results = friendMatches.map(friendQuad => {
      const friend = friendQuad.object;
      
      // 获取朋友的名字
      const nameMatches = this.store.getQuads(friend, foafName, null, null);
      const friendName = nameMatches.length > 0 ? nameMatches[0].object.value : '(未知)';
      
      return {
        friendUri: friend.value,
        friendName: friendName
      };
    });
    
    console.log('结果:');
    if (results.length === 0) {
      console.log('  (没有找到朋友)');
    } else {
      results.forEach((result, index) => {
        console.log(`  ${index + 1}. ${result.friendName} (${result.friendUri})`);
      });
    }
    
    return results;
  }

  // 统计信息
  getStatistics() {
    console.log('\n📊 数据统计:');
    
    const allQuads = this.store.getQuads(null, null, null, null);
    const subjects = new Set(allQuads.map(q => q.subject.value));
    const predicates = new Set(allQuads.map(q => q.predicate.value));
    
    console.log(`  总三元组数: ${allQuads.length}`);
    console.log(`  唯一主体数: ${subjects.size}`);
    console.log(`  唯一谓词数: ${predicates.size}`);
    
    console.log('\n  谓词列表:');
    Array.from(predicates).forEach(predicate => {
      const shortName = predicate.split('/').pop() || predicate.split('#').pop() || predicate;
      console.log(`    - ${shortName} (${predicate})`);
    });
  }

  // 性能测试
  performanceTest() {
    console.log('\n⚡ 性能测试:');
    
    const iterations = 1000;
    
    // 测试简单查询
    const start1 = Date.now();
    for (let i = 0; i < iterations; i++) {
      this.store.getQuads(null, namedNode('http://xmlns.com/foaf/0.1/name'), null, null);
    }
    const time1 = Date.now() - start1;
    
    // 测试复杂查询
    const start2 = Date.now();
    for (let i = 0; i < iterations; i++) {
      this.selectNamesWithEmail();
    }
    const time2 = Date.now() - start2;
    
    console.log(`  简单查询 (${iterations} 次): ${time1}ms (平均 ${(time1/iterations).toFixed(2)}ms)`);
    console.log(`  复杂查询 (${iterations} 次): ${time2}ms (平均 ${(time2/iterations).toFixed(2)}ms)`);
  }
}

// 模拟 Comunica 的复杂度对比
function simulateComunicaComplexity() {
  console.log('\n🔄 Comunica vs N3.js 对比分析:');
  
  const comparison = {
    '初始化时间': {
      'N3.js': '~5ms (轻量级)',
      'Comunica': '~200ms (需要加载引擎)'
    },
    '简单查询': {
      'N3.js': '~1ms (直接内存访问)',
      'Comunica': '~10ms (SPARQL 解析+执行)'
    },
    '复杂查询': {
      'N3.js': '需要手动实现逻辑',
      'Comunica': '~50ms (完整 SPARQL 支持)'
    },
    '联邦查询': {
      'N3.js': '不支持',
      'Comunica': '原生支持'
    },
    '内存占用': {
      'N3.js': '~10MB (仅数据)',
      'Comunica': '~50MB (引擎+数据)'
    },
    '包大小': {
      'N3.js': '~500KB',
      'Comunica': '~5MB'
    }
  };

  Object.entries(comparison).forEach(([aspect, values]) => {
    console.log(`\n  ${aspect}:`);
    Object.entries(values).forEach(([tool, value]) => {
      console.log(`    ${tool}: ${value}`);
    });
  });
}

// 使用建议
function showRecommendations() {
  console.log('\n💡 使用建议:');
  
  const scenarios = [
    {
      scenario: '简单档案查询',
      recommendation: 'N3.js',
      reason: '性能好，代码简单'
    },
    {
      scenario: '复杂 SPARQL 查询',
      recommendation: 'Comunica',
      reason: '完整语法支持'
    },
    {
      scenario: '多 Pod 联邦查询',
      recommendation: 'Comunica',
      reason: '原生联邦查询支持'
    },
    {
      scenario: '实时性要求高',
      recommendation: 'N3.js',
      reason: '低延迟，轻量级'
    },
    {
      scenario: '企业级应用',
      recommendation: 'Comunica',
      reason: '功能完整，生态成熟'
    }
  ];

  scenarios.forEach(item => {
    console.log(`\n  场景: ${item.scenario}`);
    console.log(`    推荐: ${item.recommendation}`);
    console.log(`    原因: ${item.reason}`);
  });

  console.log('\n🎯 最佳实践:');
  console.log('  1. 先尝试 N3.js 实现简单查询');
  console.log('  2. 复杂需求再引入 Comunica');
  console.log('  3. 可以在同一项目中混合使用');
  console.log('  4. 根据性能需求选择合适工具');
}

// 主演示函数
async function runQuickDemo() {
  console.log('🚀 N3.js Solid Pod 查询演示\n');
  console.log('==================================================');
  
  const demo = new QuickN3Demo();
  
  // 基础查询演示
  demo.selectAllNames();
  demo.selectNamesWithEmail();
  demo.findFriends('http://example.org/alice');
  
  // 统计和性能
  demo.getStatistics();
  demo.performanceTest();
  
  // 对比分析
  simulateComunicaComplexity();
  showRecommendations();
  
  console.log('\n==================================================');
  console.log('✅ 演示完成！');
  console.log('\n📝 总结:');
  console.log('  - N3.js 适合简单、快速的 RDF 查询');
  console.log('  - 可以直接替代 Comunica 处理基础场景');
  console.log('  - Solid Pod 通过 HTTP + RDF 提供数据访问');
  console.log('  - 混合使用策略可以获得最佳效果');
}

// 运行演示
if (require.main === module) {
  runQuickDemo().catch(console.error);
}

module.exports = { QuickN3Demo, runQuickDemo };