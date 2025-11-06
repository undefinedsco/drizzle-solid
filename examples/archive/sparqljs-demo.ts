import { SparqlJSConverter } from '../src/core/ast-to-sparql-v2';
import { PodTable } from '../src/core/pod-table';
import { text, integer } from '../src/core/pod-column';

/**
 * 演示使用 sparqljs 生成 SPARQL 查询的优势
 */

// 创建测试表
const usersTable = new PodTable('users', {
  rdfClass: 'https://schema.org/Person',
  containerPath: '/data/users/',
  namespace: 'https://example.com/vocab#'
}, {
  name: text('name').predicate('https://schema.org/name'),
  age: integer('age').predicate('https://schema.org/age'),
  email: text('email').predicate('https://schema.org/email').optional()
});

const podUrl = 'http://localhost:3000';
const webId = 'http://localhost:3000/alice/profile/card#me';

// 初始化转换器
const converter = new SparqlJSConverter(podUrl, webId);

console.log('=== 使用 sparqljs 生成 SPARQL 查询 ===\n');

// 1. SELECT 查询
console.log('1. SELECT 查询:');
const selectQuery = converter.convertSelect(
  { columns: ['name', 'age'], where: { id: 'alice' } },
  usersTable
);
console.log(selectQuery.query);
console.log('\n' + '-'.repeat(50) + '\n');

// 2. INSERT 查询
console.log('2. INSERT 查询:');
const insertQuery = converter.convertInsert([
  { id: 'bob', name: 'Bob Smith', age: 30, email: 'bob@example.com' }
], usersTable);
console.log(insertQuery.query);
console.log('\n' + '-'.repeat(50) + '\n');

// 3. UPDATE 查询
console.log('3. UPDATE 查询:');
const updateQuery = converter.convertUpdate(
  { age: 31 },
  { id: 'bob' },
  usersTable
);
console.log(updateQuery.query);
console.log('\n' + '-'.repeat(50) + '\n');

// 4. DELETE 查询
console.log('4. DELETE 查询:');
const deleteQuery = converter.convertDelete(
  { id: 'bob' },
  usersTable
);
console.log(deleteQuery.query);

console.log('\n=== sparqljs 的优势 ===');
console.log('✅ 1. 类型安全 - TypeScript 编译时检查');
console.log('✅ 2. 结构化 - 使用对象而不是字符串拼接');
console.log('✅ 3. 可维护性 - 更容易修改和扩展');
console.log('✅ 4. 标准化 - 符合 W3C SPARQL 规范');
console.log('✅ 5. 错误处理 - 更好的错误信息和调试');