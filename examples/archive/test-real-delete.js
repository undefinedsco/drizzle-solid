// 测试真实的 DELETE 场景
const { ASTToSPARQLConverter } = require('../dist/core/ast-to-sparql');

console.log('=== 测试真实的 DELETE 场景 ===\n');

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

// 测试场景1: 标准的 binary_expr 格式
console.log('场景1: 标准的 binary_expr 格式');
try {
  const whereConditions1 = {
    type: 'binary_expr',
    operator: '=',
    left: { column: 'id' },
    right: { value: 'task-123' }
  };
  
  const result1 = converter.convertDelete(whereConditions1, table);
  console.log('✅ 生成的 DELETE 查询:');
  console.log(result1.query);
  console.log('');
} catch (error) {
  console.error('❌ 错误:', error.message);
}

// 测试场景2: 简单对象格式
console.log('场景2: 简单对象格式 { id: "task-456" }');
try {
  const whereConditions2 = { id: 'task-456' };
  
  const result2 = converter.convertDelete(whereConditions2, table);
  console.log('✅ 生成的 DELETE 查询:');
  console.log(result2.query);
  console.log('');
} catch (error) {
  console.error('❌ 错误:', error.message);
}

// 测试场景3: Drizzle 风格的条件格式
console.log('场景3: Drizzle 风格的条件格式 { id: { eq: "task-789" } }');
try {
  const whereConditions3 = { id: { eq: 'task-789' } };
  
  const result3 = converter.convertDelete(whereConditions3, table);
  console.log('✅ 生成的 DELETE 查询:');
  console.log(result3.query);
  console.log('');
} catch (error) {
  console.error('❌ 错误:', error.message);
}

// 测试场景4: 直接字符串 ID
console.log('场景4: 直接字符串 ID');
try {
  const whereConditions4 = 'task-direct';
  
  const result4 = converter.convertDelete(whereConditions4, table);
  console.log('✅ 生成的 DELETE 查询:');
  console.log(result4.query);
  console.log('');
} catch (error) {
  console.error('❌ 错误:', error.message);
}

// 测试场景5: 无效的条件（应该使用通用删除模式）
console.log('场景5: 无效的条件（应该使用通用删除模式）');
try {
  const whereConditions5 = { title: 'some title' };
  
  const result5 = converter.convertDelete(whereConditions5, table);
  console.log('⚠️  生成的通用 DELETE 查询:');
  console.log(result5.query);
  console.log('');
} catch (error) {
  console.error('❌ 错误:', error.message);
}