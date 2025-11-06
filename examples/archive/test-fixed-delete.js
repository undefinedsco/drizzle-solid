// 测试修复后的 DELETE 查询
const { ASTToSPARQLConverter } = require('../dist/core/ast-to-sparql');

console.log('=== 测试修复后的 DELETE 查询 ===\n');

const converter = new ASTToSPARQLConverter('http://localhost:3000/alice/');

// 模拟表结构
const table = {
  name: 'tasks',
  columns: {
    id: { type: 'string', predicate: null },
    title: { type: 'string', predicate: 'http://purl.org/dc/terms/title' },
    description: { type: 'string', predicate: 'http://purl.org/dc/terms/description' },
    status: { type: 'string', predicate: 'http://www.w3.org/2002/07/owl#status' }
  }
};

// 模拟 WHERE 条件：id = 'task-123'
const whereConditions = {
  type: 'binary_expr',
  operator: '=',
  left: { column: 'id' },
  right: { value: 'task-123' }
};

try {
  const result = converter.convertDelete(whereConditions, table);
  console.log('生成的 DELETE 查询:');
  console.log(result.query);
  console.log('\n查询类型:', result.type);
  console.log('前缀:', result.prefixes);
} catch (error) {
  console.error('生成 DELETE 查询时出错:', error.message);
}