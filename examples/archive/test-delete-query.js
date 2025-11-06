const sparqljs = require('sparqljs');

// 测试当前的 DELETE 查询生成
console.log('=== 测试 DELETE 查询生成 ===\n');

// 模拟一个简单的 DELETE WHERE 查询
const deleteQuery = {
  queryType: 'DELETE',
  delete: [
    {
      type: 'bgp',
      triples: [
        {
          subject: { termType: 'NamedNode', value: 'http://localhost:3000/alice/tasks/#task-123' },
          predicate: { termType: 'NamedNode', value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' },
          object: { termType: 'NamedNode', value: 'http://example.org/Task' }
        },
        {
          subject: { termType: 'NamedNode', value: 'http://localhost:3000/alice/tasks/#task-123' },
          predicate: { termType: 'NamedNode', value: 'http://purl.org/dc/terms/title' },
          object: { termType: 'Variable', value: 'title' }
        }
      ]
    }
  ],
  where: [
    {
      type: 'bgp',
      triples: [
        {
          subject: { termType: 'NamedNode', value: 'http://localhost:3000/alice/tasks/#task-123' },
          predicate: { termType: 'NamedNode', value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' },
          object: { termType: 'NamedNode', value: 'http://example.org/Task' }
        },
        {
          subject: { termType: 'NamedNode', value: 'http://localhost:3000/alice/tasks/#task-123' },
          predicate: { termType: 'NamedNode', value: 'http://purl.org/dc/terms/title' },
          object: { termType: 'Variable', value: 'title' }
        }
      ]
    }
  ],
  type: 'update',
  prefixes: {
    rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    dc: 'http://purl.org/dc/terms/'
  }
};

const generator = new sparqljs.Generator();

try {
  const sparqlString = generator.stringify(deleteQuery);
  console.log('生成的 DELETE 查询:');
  console.log(sparqlString);
  console.log('\n');
} catch (error) {
  console.error('生成 DELETE 查询时出错:', error.message);
}

// 测试更简单的 DELETE WHERE 语法
console.log('=== 测试简化的 DELETE WHERE ===\n');

const simpleDeleteQuery = {
  queryType: 'DELETE',
  delete: [
    {
      type: 'bgp',
      triples: [
        {
          subject: { termType: 'NamedNode', value: 'http://localhost:3000/alice/tasks/#task-123' },
          predicate: { termType: 'Variable', value: 'p' },
          object: { termType: 'Variable', value: 'o' }
        }
      ]
    }
  ],
  where: [
    {
      type: 'bgp',
      triples: [
        {
          subject: { termType: 'NamedNode', value: 'http://localhost:3000/alice/tasks/#task-123' },
          predicate: { termType: 'Variable', value: 'p' },
          object: { termType: 'Variable', value: 'o' }
        }
      ]
    }
  ],
  type: 'update',
  prefixes: {
    rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
  }
};

try {
  const simpleSparql = generator.stringify(simpleDeleteQuery);
  console.log('简化的 DELETE 查询:');
  console.log(simpleSparql);
  console.log('\n');
} catch (error) {
  console.error('生成简化 DELETE 查询时出错:', error.message);
}

// 测试最简单的 DELETE WHERE 语法（推荐用于 Solid Pod）
console.log('=== 推荐的 Solid Pod DELETE 语法 ===\n');

const solidDeleteQuery = {
  queryType: 'DELETE',
  delete: [
    {
      type: 'bgp',
      triples: [
        {
          subject: { termType: 'NamedNode', value: 'http://localhost:3000/alice/tasks/#task-123' },
          predicate: { termType: 'Variable', value: 'p' },
          object: { termType: 'Variable', value: 'o' }
        }
      ]
    }
  ],
  // 对于 Solid Pod，可能需要使用相同的模式作为 WHERE 条件
  where: [
    {
      type: 'bgp',
      triples: [
        {
          subject: { termType: 'NamedNode', value: 'http://localhost:3000/alice/tasks/#task-123' },
          predicate: { termType: 'Variable', value: 'p' },
          object: { termType: 'Variable', value: 'o' }
        }
      ]
    }
  ],
  type: 'update',
  prefixes: {}
};

try {
  const solidSparql = generator.stringify(solidDeleteQuery);
  console.log('Solid Pod 兼容的 DELETE 查询:');
  console.log(solidSparql);
} catch (error) {
  console.error('生成 Solid DELETE 查询时出错:', error.message);
}