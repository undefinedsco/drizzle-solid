# Test Strategy - 测试策略

## 维度分析

### 核心维度

1. **Storage Mode（存储模式）**
   - Fragment Mode: `#{id}` - 多条记录在同一文件
   - Document Mode: `{id}.ttl` - 每条记录独立文件

2. **Template Complexity（模板复杂度）**
   - Single variable: `{id}` 或 `#{id}`
   - Multi-variable: `{chatId}/{id}` 或 `{chatId}/index.ttl#{id}`
   - Date-partitioned: `{chatId}/{yyyy}/{MM}/{dd}/...`

3. **Query Patterns（查询模式）**
   - By primary key only: `eq(table.id, value)`
   - By other fields: `eq(table.chatId, value)`
   - Combined: `and(eq(table.id, ...), eq(table.chatId, ...))`
   - Full URI: `eq(table.id, 'http://...')`
   - Partial variables: 只提供部分模板变量

4. **SPARQL Support（SPARQL 支持）**
   - LDP only (vanilla CSS)
   - SPARQL endpoint (xpod)

5. **Operations（操作）**
   - INSERT
   - SELECT
   - UPDATE
   - DELETE

## 测试矩阵

### 优先级 P0（必须覆盖）

| Storage | Template | Query | Expected |
|---------|----------|-------|----------|
| Fragment | `#{id}` | `eq(id, 'x')` | ✅ Works |
| Fragment | `{chatId}/index.ttl#{id}` | `and(eq(id, 'x'), eq(chatId, 'c'))` | ✅ Works |
| Fragment | `{chatId}/{yyyy}/{MM}/{dd}/messages.ttl#{id}` | `and(eq(id, 'x'), eq(chatId, 'c'))` | ✅ Works |
| Document | `{id}.ttl` | `eq(id, 'x')` | ✅ Works |
| Document | `{chatId}/{id}.ttl` | `and(eq(id, 'x'), eq(chatId, 'c'))` | ❌ NOT TESTED |
| Document | `{chatId}/{yyyy}/{MM}/{dd}/{id}.ttl` | `and(eq(id, 'x'), eq(chatId, 'c'))` | ❌ NOT TESTED |

### 优先级 P1（边界情况）

| Storage | Template | Query | Expected |
|---------|----------|-------|----------|
| Fragment | `{chatId}/index.ttl#{id}` | `eq(id, 'x')` only | ❌ Should error |
| Document | `{chatId}/{id}.ttl` | `eq(id, 'x')` only | ❌ Should error |
| Fragment | `{chatId}/index.ttl#{id}` | `eq(id, 'http://...')` full URI | ✅ Should work |
| Document | `{chatId}/{id}.ttl` | `eq(id, 'http://...')` full URI | ✅ Should work |

### 优先级 P2（高级场景）

- 3+ 变量的模板
- 跨 Pod 查询
- 联邦查询
- 批量操作

## 从 Drizzle ORM 映射测试用例

### Drizzle ORM 的测试模式

```typescript
// 典型的 Drizzle ORM 测试
describe('select', () => {
  test('select all', async () => {
    const users = await db.select().from(usersTable);
  });

  test('select with where', async () => {
    const users = await db.select().from(usersTable).where(eq(usersTable.id, 1));
  });

  test('select with multiple conditions', async () => {
    const users = await db.select().from(usersTable)
      .where(and(eq(usersTable.id, 1), eq(usersTable.name, 'Alice')));
  });
});
```

### 映射到 Solid 场景

每个 Drizzle ORM 测试用例 × 每种 template 模式 = 完整覆盖

```typescript
// 自动生成测试
const templates = [
  { mode: 'fragment', pattern: '#{id}' },
  { mode: 'fragment', pattern: '{chatId}/index.ttl#{id}' },
  { mode: 'document', pattern: '{id}.ttl' },
  { mode: 'document', pattern: '{chatId}/{id}.ttl' },
  { mode: 'document', pattern: '{chatId}/{yyyy}/{MM}/{dd}/{id}.ttl' },
];

const drizzleTestCases = [
  { name: 'select all', query: () => db.select().from(table) },
  { name: 'select by id', query: () => db.select().from(table).where(eq(table.id, 'x')) },
  { name: 'insert', query: () => db.insert(table).values({...}) },
  // ... 更多测试用例
];

// 生成 templates.length × drizzleTestCases.length 个测试
for (const template of templates) {
  for (const testCase of drizzleTestCases) {
    test(`${template.pattern} - ${testCase.name}`, async () => {
      const table = createTableWithTemplate(template);
      await testCase.query();
    });
  }
}
```

## 分支覆盖率目标

### 当前覆盖率（估算）

- `src/core/resource-resolver/` - ~60%
- `src/core/sparql/builder/` - ~70%
- `src/driver/` - ~50%

### 目标覆盖率

- **核心路径**: 90%+ (resource resolver, query builder)
- **边界情况**: 80%+ (error handling, validation)
- **工具函数**: 70%+ (utilities, helpers)

### 关键未覆盖分支

1. **Document resolver** - multi-variable template 的查询路径
2. **Expression builder** - 完整 URI 的处理
3. **LDP executor** - document mode 的 UPDATE/DELETE
4. **Error paths** - 各种错误场景的处理

## 实施计划

### Phase 1: 补充 P0 测试（1-2 天）

1. 创建 `tests/integration/css/template-matrix.test.ts`
2. 覆盖所有 P0 场景
3. 确保 document mode + multi-variable 能工作

### Phase 2: 自动化测试生成（2-3 天）

1. 分析 Drizzle ORM 的测试用例
2. 创建测试生成器
3. 自动生成 template × query 的组合测试

### Phase 3: 分支覆盖率（3-5 天）

1. 配置 coverage 工具
2. 识别未覆盖分支
3. 补充测试用例
4. 达到 80%+ 覆盖率

### Phase 4: CI/CD 集成（1 天）

1. 在 GitHub Actions 中运行覆盖率检查
2. 设置覆盖率阈值
3. PR 必须通过覆盖率检查

## 工具和配置

### Coverage 配置

```json
// vitest.config.ts
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/types.ts'],
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  }
});
```

### 测试生成器

```typescript
// scripts/generate-tests.ts
import { templates, drizzleTestCases } from './test-fixtures';

function generateTests() {
  for (const template of templates) {
    for (const testCase of drizzleTestCases) {
      const testCode = generateTestCode(template, testCase);
      writeTestFile(testCode);
    }
  }
}
```

## 参考资料

- [Drizzle ORM Tests](https://github.com/drizzle-team/drizzle-orm/tree/main/integration-tests)
- [Vitest Coverage](https://vitest.dev/guide/coverage.html)
- [Test Matrix Pattern](https://martinfowler.com/articles/practical-test-pyramid.html)
