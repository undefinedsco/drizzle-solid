# 完整测试维度分析

## 总维度数

基于以下维度的组合：

### 1. Storage Mode（2 种）
- Fragment Mode
- Document Mode

### 2. Template Variables（3 种）
- Single: `{id}`
- Multi: `{chatId}/{id}`
- Date: `{chatId}/{yyyy}/{MM}/{dd}/{id}`

### 3. Query Patterns（5 种）
- By ID only (short)
- By ID (full URI)
- By other field
- By all variables
- By partial variables

### 4. Operations（4 种）
- INSERT
- SELECT
- UPDATE
- DELETE

### 5. API Interface（5 种）
- Query Builder: `db.select().from(table).where(...)`
- Relational Query: `db.query.table.findFirst({ where: ... })`
- Explicit IRI helper: `db.findByIri(table, iri)`
- Batch: `db.batch([...])`
- Raw SPARQL: `db.executeSPARQL(sparql)`

### 6. Query Operators（10+ 种）
- `eq`, `ne`, `gt`, `gte`, `lt`, `lte`
- `and`, `or`, `not`
- `like`, `ilike`
- `inArray`, `notInArray`
- `isNull`, `isNotNull`

### 7. Column Types（6 种）
- `string`, `int`, `boolean`
- `datetime`, `json`
- `uri()` with `.link()` as link target metadata

### 8. Column Modifiers（6 种）
- `.primaryKey()`
- `.notNull()`
- `.default(value)`
- `.predicate(uri)`
- `.link(table)` (declares link target)
- `.inverse()`

### 9. SPARQL Engine（2 种）
- LDP only (CSS)
- SPARQL endpoint (xpod)

### 10. Concurrency（3 种）
- Single operation
- Concurrent reads
- Concurrent writes

## 理论总数

2 × 3 × 5 × 4 × 5 × 10 × 6 × 6 × 2 × 3 = **1,296,000 种组合**

显然不可能全部测试。

## 实际测试策略

### 优先级分层

#### P0 - 核心功能（必须 100% 通过）
**数量**: ~50 个测试

**覆盖**:
- 所有 storage mode × template 组合的基本 CRUD
- Query Builder API 的基本操作
- 关键错误场景（缺少变量、无效 URI）

**当前状态**: ✅ 已创建 `template-matrix.test.ts` (36 tests)

#### P1 - 常用场景（目标 90% 通过）
**数量**: ~100 个测试

**覆盖**:
- 所有 query operators
- Relational Query API
- explicit IRI helper
- Column modifiers (`.notNull()`, `.link()`)
- 基本并发场景

**当前状态**: ⚠️ 部分覆盖

#### P2 - 高级场景（目标 80% 通过）
**数量**: ~50 个测试

**覆盖**:
- Batch operations
- Raw SPARQL
- 复杂并发场景
- 跨 Pod 查询
- 联邦查询

**当前状态**: ❌ 基本未覆盖

### 从 Drizzle ORM 映射

#### Drizzle ORM 测试用例统计

```bash
# 分析 Drizzle ORM 的测试
cd /tmp/drizzle-orm
find integration-tests/tests/sqlite -name "*.test.ts" -exec wc -l {} + | tail -1
# 约 15,000+ 行测试代码
```

#### 可复用的测试模式

1. **Basic CRUD** (Drizzle: ~500 tests)
   - 映射到 Solid: 每种 template × CRUD = 6 × 4 = 24 tests ✅

2. **Query Operators** (Drizzle: ~200 tests)
   - 映射到 Solid: 每种 operator × 2 templates = 10 × 2 = 20 tests ⚠️

3. **Relations** (Drizzle: ~300 tests)
   - 映射到 Solid: `.link()` + joins = ~30 tests ❌

4. **Batch Operations** (Drizzle: ~100 tests)
   - 映射到 Solid: batch insert/update/delete = ~10 tests ❌

5. **Transactions** (Drizzle: ~150 tests)
   - 映射到 Solid: conflict resolution = ~20 tests ⚠️

## 分支覆盖率分析

### 关键文件覆盖率目标

| 文件 | 当前 | 目标 | 优先级 |
|------|------|------|--------|
| `src/core/resource-resolver/document-resolver.ts` | ~60% | 90% | P0 |
| `src/core/resource-resolver/fragment-resolver.ts` | ~70% | 90% | P0 |
| `src/core/sparql/builder/select-builder.ts` | ~65% | 85% | P0 |
| `src/core/sparql/builder/expression-builder.ts` | ~70% | 85% | P0 |
| `src/driver/solid/index.ts` | ~50% | 80% | P1 |
| `src/core/ldp/executor.ts` | ~55% | 80% | P1 |
| `src/core/uri/resolver.ts` | ~75% | 90% | P0 |

### 未覆盖的关键分支

#### 1. Document Resolver (document-resolver.ts)

```typescript
// Line 107-125: Multi-variable template query
if (idValues.length > 0 && !allVarsPresent) {
  const isFullUri = idValue.includes('://') || idValue.startsWith('http');
  if (isFullUri) {
    return [this.getResourceUrlForSubject(idValue)]; // ⚠️ 未充分测试
  }
  throw new Error(...); // ✅ 已测试
}
```

**缺失测试**:
- Document mode + multi-variable + full URI query
- Document mode + date variables + full URI query

#### 2. Expression Builder (expression-builder.ts)

```typescript
// formatSubjectValue - 处理不同类型的 ID 值
if (typeof value === 'string' && value.startsWith('http')) {
  // Full URI path - 未充分测试
} else {
  // Short ID path - 已测试
}
```

**缺失测试**:
- 各种 URI 格式的处理
- 边界情况（空字符串、特殊字符）

#### 3. LDP Executor (ldp-executor.ts)

```typescript
// Document mode UPDATE/DELETE
if (mode === 'document') {
  // 每个文件单独更新 - ⚠️ 未充分测试
} else {
  // Fragment mode 批量更新 - ✅ 已测试
}
```

**缺失测试**:
- Document mode 的 UPDATE
- Document mode 的 DELETE
- 并发更新冲突

## 实施计划

### Phase 1: 补充 P0 测试（已完成 70%）

✅ 创建 `template-matrix.test.ts` (36 tests)
⚠️ 需要补充:
- Document mode + full URI 查询
- 所有 template 的 UPDATE/DELETE

### Phase 2: 提高分支覆盖率（预计 2-3 天）

1. 运行覆盖率分析
```bash
yarn test:coverage --reporter=html
open coverage/index.html
```

2. 识别未覆盖分支
3. 为每个未覆盖分支创建测试
4. 目标: 核心文件达到 85%+ 覆盖率

### Phase 3: 从 Drizzle ORM 移植测试（预计 3-5 天）

1. 分析 Drizzle ORM 的 SQLite 测试
2. 创建自动化映射工具
3. 生成 Solid 版本的测试
4. 目标: 覆盖所有 query operators

### Phase 4: CI/CD 集成（预计 1 天）

1. 配置 GitHub Actions
2. 设置覆盖率阈值
3. PR 必须通过覆盖率检查

## 快速提升质量的方法

### 方法 1: 测试矩阵生成器（最快）

**优势**:
- 自动生成大量测试
- 覆盖所有组合
- 易于维护

**实施**:
```typescript
// 已完成: tests/fixtures/test-matrix.ts
// 已完成: tests/integration/css/template-matrix.test.ts
// 待完成: 扩展到更多维度
```

### 方法 2: 分支覆盖率驱动（最有效）

**优势**:
- 精确定位未测试代码
- 避免重复测试
- 量化质量指标

**实施**:
```bash
# 1. 运行覆盖率
yarn test:coverage

# 2. 查看报告
open coverage/index.html

# 3. 为每个未覆盖分支创建测试
```

### 方法 3: 从 Drizzle ORM 移植（最全面）

**优势**:
- 复用成熟的测试用例
- 确保 API 兼容性
- 覆盖边界情况

**实施**:
```typescript
// 创建映射工具
function mapDrizzleTest(drizzleTest) {
  // SQL -> SPARQL
  // SQLite table -> Solid Pod table
  // 生成对应的 Solid 测试
}
```

### 方法 4: Debug 模式（最实用）

**优势**:
- 快速定位问题
- 减少沟通成本
- 用户自助排查

**实施**:
```typescript
const client = pod(session, { debug: true });
const db = client.asDrizzle();
// 输出:
// [DEBUG] Template: {chatId}/{yyyy}/{MM}/{dd}/{id}.ttl
// [DEBUG] Provided: { id: 'msg-123' }
// [DEBUG] Missing: [chatId, yyyy, MM, dd]
// [DEBUG] Error: Cannot resolve...
```

## 建议优先级

1. **立即**: 添加 debug 模式（1-2 小时）
2. **本周**: 补充 document mode 测试（1 天）
3. **下周**: 提高分支覆盖率到 85%（2-3 天）
4. **下下周**: 从 Drizzle ORM 移植测试（3-5 天）

## 总结

- **理论组合数**: 1,296,000
- **实际需要**: ~200 个精心设计的测试
- **当前完成**: ~50 个测试（25%）
- **覆盖率**: ~60% → 目标 85%
- **最快见效**: Debug 模式 + 分支覆盖率驱动
