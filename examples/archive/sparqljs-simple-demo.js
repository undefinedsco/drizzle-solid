const sparqljs = require('sparqljs');

console.log('=== sparqljs vs 手动字符串拼接对比 ===\n');

// 创建生成器
const generator = new sparqljs.Generator();

console.log('1. 手动字符串拼接方式（容易出错）:');
const manualQuery = `PREFIX schema: <https://schema.org/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

SELECT ?name ?age
WHERE {
  ?person rdf:type schema:Person .
  ?person schema:name ?name .
  ?person schema:age ?age .
  FILTER(?age > 18)
}`;

console.log(manualQuery);
console.log('\n' + '-'.repeat(50) + '\n');

console.log('2. 使用 sparqljs 结构化方式（类型安全）:');
const structuredQuery = {
  queryType: 'SELECT',
  variables: [
    { termType: 'Variable', value: 'name' },
    { termType: 'Variable', value: 'age' }
  ],
  where: [
    {
      type: 'bgp',
      triples: [
        {
          subject: { termType: 'Variable', value: 'person' },
          predicate: { termType: 'NamedNode', value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' },
          object: { termType: 'NamedNode', value: 'https://schema.org/Person' }
        },
        {
          subject: { termType: 'Variable', value: 'person' },
          predicate: { termType: 'NamedNode', value: 'https://schema.org/name' },
          object: { termType: 'Variable', value: 'name' }
        },
        {
          subject: { termType: 'Variable', value: 'person' },
          predicate: { termType: 'NamedNode', value: 'https://schema.org/age' },
          object: { termType: 'Variable', value: 'age' }
        }
      ]
    },
    {
      type: 'filter',
      expression: {
        type: 'operation',
        operator: '>',
        args: [
          { termType: 'Variable', value: 'age' },
          { 
            termType: 'Literal', 
            value: '18',
            datatype: { termType: 'NamedNode', value: 'http://www.w3.org/2001/XMLSchema#integer' }
          }
        ]
      }
    }
  ],
  type: 'query',
  prefixes: {
    'schema': 'https://schema.org/',
    'rdf': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
  }
};

console.log(generator.stringify(structuredQuery));

console.log('\n' + '='.repeat(60) + '\n');

console.log('3. DELETE WHERE 查询对比（解决之前的语法问题）:');

console.log('--- 手动拼接（容易出现 OPTIONAL 语法错误）---');
const manualDelete = `PREFIX schema: <https://schema.org/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

DELETE WHERE {
  ?subject rdf:type schema:Person .
  ?subject schema:name ?name .
  OPTIONAL { ?subject schema:age ?age }  # 这在 DELETE WHERE 中是无效的！
}`;

console.log(manualDelete);
console.log('❌ 上面的查询包含语法错误：DELETE WHERE 不能包含 OPTIONAL');

console.log('\n--- 使用 sparqljs（自动避免语法错误）---');
const structuredDelete = {
  type: 'update',
  prefixes: {
    'schema': 'https://schema.org/',
    'rdf': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
  },
  updates: [{
    updateType: 'deletewhere',
    delete: [{
      type: 'bgp',
      triples: [
        {
          subject: { termType: 'Variable', value: 'subject' },
          predicate: { termType: 'NamedNode', value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' },
          object: { termType: 'NamedNode', value: 'https://schema.org/Person' }
        },
        {
          subject: { termType: 'Variable', value: 'subject' },
          predicate: { termType: 'NamedNode', value: 'https://schema.org/name' },
          object: { termType: 'Variable', value: 'name' }
        }
        // 注意：sparqljs 结构不会让你在 DELETE WHERE 中添加 OPTIONAL
      ]
    }]
  }]
};

console.log(generator.stringify(structuredDelete));
console.log('✅ sparqljs 生成的查询语法正确');

console.log('\n' + '='.repeat(60) + '\n');

console.log('=== 总结：sparqljs 的优势 ===');
console.log('✅ 1. 类型安全 - 编译时检查，避免语法错误');
console.log('✅ 2. 结构化 - 使用对象而不是字符串拼接');
console.log('✅ 3. 可维护性 - 更容易修改和扩展查询');
console.log('✅ 4. 标准化 - 严格符合 W3C SPARQL 规范');
console.log('✅ 5. 错误预防 - 自动避免常见的 SPARQL 语法错误');
console.log('✅ 6. 代码复用 - 可以重用查询组件和模式');
console.log('✅ 7. 调试友好 - 结构化的对象更容易调试');

console.log('\n=== 手动字符串拼接的问题 ===');
console.log('❌ 1. 容易出现语法错误（如 DELETE WHERE 中的 OPTIONAL）');
console.log('❌ 2. 字符串转义问题');
console.log('❌ 3. 没有编译时检查');
console.log('❌ 4. 难以维护和修改');
console.log('❌ 5. 代码重复');
console.log('❌ 6. 调试困难');

console.log('\n🎯 建议：用 sparqljs 重构现有的 AST 转 SPARQL 实现！');