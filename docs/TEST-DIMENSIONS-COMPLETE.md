# 完整测试维度分析（扩展版）

## 所有可能的测试维度

### 1. Storage Mode（存储模式）- 2 种
- Fragment Mode: `#{id}` - 多条记录在同一文件
- Document Mode: `{id}.ttl` - 每条记录独立文件

### 2. Template Variables（模板变量）- 5 种
- Single: `{id}` 或 `#{id}`
- Multi (2 vars): `{chatId}/{id}` 或 `{chatId}/index.ttl#{id}`
- Multi (3 vars): `{workspace}/{chatId}/{id}`
- Date-partitioned: `{chatId}/{yyyy}/{MM}/{dd}/...`
- Complex: `{userId}/{category}/{yyyy}/{MM}/{id}`

### 3. Query Patterns（查询模式）- 8 种
- By ID only (short): `eq(table.id, 'msg-123')`
- By ID (full URI): `eq(table.id, 'http://...')`
- By other field: `eq(table.chatId, 'chat-1')`
- By all variables: `and(eq(id, ...), eq(chatId, ...))`
- By partial variables: `eq(chatId, ...)` without id
- Multiple conditions: `and(eq(...), gt(...), like(...))`
- OR conditions: `or(eq(...), eq(...))`
- Nested conditions: `and(or(...), and(...))`

### 4. Operations（操作类型）- 6 种
- INSERT (single)
- INSERT (batch)
- SELECT
- UPDATE
- DELETE
- UPSERT (INSERT + UPDATE)

### 5. API Interface（接口维度）- 7 种
- Query Builder: `db.select().from(table).where(...)`
- Relational Query: `db.query.table.findFirst({ where: ... })`
- Explicit IRI helper: `db.findByIri(table, iri)`
- Batch: `db.batch([...])`
- Raw SPARQL: `db.executeSPARQL(sparql)`
- Transaction: `db.transaction(async (tx) => { ... })`
- Prepared statements: `db.prepare(...)`

### 6. Query Operators（查询操作符）- 15 种
**Comparison:**
- `eq`, `ne`, `gt`, `gte`, `lt`, `lte`

**Logical:**
- `and`, `or`, `not`

**Pattern:**
- `like`, `ilike`, `notLike`, `notIlike`

**Set:**
- `inArray`, `notInArray`

**Null:**
- `isNull`, `isNotNull`

### 7. Column Types（列类型）- 10 种
**Basic:**
- `string`, `int`, `boolean`, `float`

**Date/Time:**
- `date`, `datetime`, `timestamp`

**Complex:**
- `json`, `object`

**RDF-specific:**
- `uri()` with `.link()` as link target metadata

### 8. Column Modifiers（列修饰符）- 10 种
- `.primaryKey()`
- `.notNull()`
- `.default(value)`
- `.unique()`
- `.predicate(uri)`
- `.link(table)` (declares link target)
- `.inverse()`
- `.index()`
- `.check(condition)`
- `.generated()`

### 9. SPARQL Engine（查询引擎）- 3 种
- LDP only (vanilla CSS)
- SPARQL endpoint (xpod)
- Hybrid (LDP + SPARQL fallback)

### 10. Concurrency（并发场景）- 5 种
- Single operation
- Concurrent reads (same resource)
- Concurrent writes (same resource)
- Concurrent reads + writes
- Distributed writes (different clients)

### 11. Data Relationships（数据关系）- 6 种
- No relations
- One-to-one link: `.link()`
- One-to-many link: `.link()` + array
- Many-to-many: junction table
- Self-linking: `parent.link(parent)`
- Inverse relations: `.inverse()`

### 12. Query Features（查询特性）- 8 种
- Simple SELECT
- SELECT with WHERE
- SELECT with JOIN
- SELECT with GROUP BY
- SELECT with ORDER BY
- SELECT with LIMIT/OFFSET
- SELECT with DISTINCT
- Aggregations (COUNT, SUM, AVG, MIN, MAX)

### 13. Error Scenarios（错误场景）- 10 种
- Missing required variables
- Invalid URI format
- Network timeout
- 404 Not Found
- 403 Forbidden
- 409 Conflict (concurrent writes)
- Invalid RDF syntax
- Type mismatch
- Constraint violation
- SPARQL syntax error

### 14. Data Formats（数据格式）- 4 种
- Turtle (.ttl)
- JSON-LD (.jsonld)
- N-Triples (.nt)
- RDF/XML (.rdf)

### 15. Authentication（认证方式）- 4 种
- Client Credentials (DPoP)
- Authorization Code Flow
- Refresh Token
- Public access (no auth)

### 16. Pod Configuration（Pod 配置）- 5 种
- Single Pod
- Multiple Pods (same user)
- Cross-Pod queries
- Public Pod
- Private Pod with ACL

### 17. Network Conditions（网络条件）- 4 种
- Normal latency
- High latency (slow network)
- Intermittent connection
- Offline mode

### 18. Data Size（数据规模）- 5 种
- Small (< 10 records)
- Medium (10-100 records)
- Large (100-1000 records)
- Very large (1000+ records)
- Huge files (> 1MB per file)

### 19. Schema Evolution（Schema 演化）- 4 种
- Add column
- Remove column
- Change column type
- Rename column

### 20. Caching（缓存策略）- 3 种
- No cache
- In-memory cache
- Persistent cache

## 理论总组合数

2 × 5 × 8 × 6 × 7 × 15 × 10 × 10 × 3 × 5 × 6 × 8 × 10 × 4 × 4 × 5 × 4 × 5 × 4 × 3
= **约 1.5 亿种组合**

显然不可能全部测试。

## 实际测试策略（优先级分层）

### P0 - 核心功能（必须 100% 通过）- ~100 tests

**覆盖维度**:
- Storage Mode: 全部 (2)
- Template Variables: 前 3 种 (3)
- Query Patterns: 前 4 种 (4)
- Operations: INSERT, SELECT, UPDATE, DELETE (4)
- API Interface: Query Builder (1)
- Query Operators: eq, and (2)
- Column Types: string, int, datetime, uri (4)
- Column Modifiers: primaryKey, notNull, reference (3)
- SPARQL Engine: xpod (1)
- Concurrency: single (1)

**组合**: 2 × 3 × 4 × 4 = **96 tests** ✅ 已创建

### P1 - 常用场景（目标 90% 通过）- ~200 tests

**新增维度**:
- Template Variables: 全部 (5)
- Query Patterns: 全部 (8)
- API Interface: +Relational Query, findByIri (3)
- Query Operators: +gt, gte, lt, lte, like, inArray (8)
- Column Modifiers: +inverse, predicate (5)
- Concurrency: +concurrent reads (2)
- Data Relationships: one-to-one, one-to-many (2)
- Query Features: WHERE, JOIN, ORDER BY, LIMIT (4)

**组合**: ~200 tests

### P2 - 高级场景（目标 80% 通过）- ~150 tests

**新增维度**:
- Operations: +batch, upsert (6)
- API Interface: +batch, raw SPARQL (5)
- Query Operators: 全部 (15)
- Concurrency: 全部 (5)
- Data Relationships: 全部 (6)
- Query Features: 全部 (8)
- Error Scenarios: 前 5 种 (5)

**组合**: ~150 tests

### P3 - 边界场景（目标 70% 通过）- ~100 tests

**新增维度**:
- Error Scenarios: 全部 (10)
- Data Formats: 全部 (4)
- Authentication: 全部 (4)
- Pod Configuration: 全部 (5)
- Network Conditions: 全部 (4)
- Data Size: 全部 (5)

**组合**: ~100 tests

### P4 - 高级特性（目标 60% 通过）- ~50 tests

**新增维度**:
- Schema Evolution: 全部 (4)
- Caching: 全部 (3)
- SPARQL Engine: 全部 (3)

**组合**: ~50 tests

## 总计

**P0**: 100 tests (核心)
**P1**: 200 tests (常用)
**P2**: 150 tests (高级)
**P3**: 100 tests (边界)
**P4**: 50 tests (特性)

**总计**: ~600 tests

## 当前完成度

- ✅ P0: 96/100 (96%)
- ⚠️ P1: 20/200 (10%)
- ❌ P2: 5/150 (3%)
- ❌ P3: 0/100 (0%)
- ❌ P4: 0/50 (0%)

**总体**: 121/600 (20%)

## 快速提升策略

### 阶段 1: 补充 P0（1 天）
- 补充 4 个缺失的核心测试
- 确保所有 P0 测试通过

### 阶段 2: 扩展 P1（3-5 天）
- 从 Drizzle ORM 移植常用操作符测试
- 添加关系查询测试
- 添加并发读测试

### 阶段 3: 覆盖 P2（5-7 天）
- 批量操作测试
- 错误场景测试
- 高级查询特性测试

### 阶段 4: 完善 P3/P4（按需）
- 根据用户反馈优先级调整
- 边界场景和高级特性

## 测试生成工具

### 自动化测试生成器

```typescript
// scripts/generate-tests.ts
import { DIMENSIONS } from './test-dimensions';

function generateTests(priority: 'P0' | 'P1' | 'P2' | 'P3' | 'P4') {
  const dimensions = DIMENSIONS[priority];

  for (const storage of dimensions.storageMode) {
    for (const template of dimensions.templateVariables) {
      for (const query of dimensions.queryPatterns) {
        for (const operation of dimensions.operations) {
          generateTestCase({
            storage,
            template,
            query,
            operation,
            priority
          });
        }
      }
    }
  }
}
```

### 测试矩阵可视化

```bash
# 生成测试覆盖率矩阵
yarn test:matrix

# 输出:
# ┌─────────────┬────────┬────────┬────────┬────────┐
# │ Dimension   │ P0     │ P1     │ P2     │ Total  │
# ├─────────────┼────────┼────────┼────────┼────────┤
# │ Storage     │ 2/2    │ 2/2    │ 2/2    │ 100%   │
# │ Template    │ 3/5    │ 5/5    │ 5/5    │ 100%   │
# │ Query       │ 4/8    │ 8/8    │ 8/8    │ 100%   │
# │ Operations  │ 4/6    │ 4/6    │ 6/6    │ 100%   │
# └─────────────┴────────┴────────┴────────┴────────┘
```

## 你说的"变量还是少了"

你说得对！我之前只列了 10 个维度，现在扩展到了 **20 个维度**：

1. Storage Mode
2. Template Variables
3. Query Patterns
4. Operations
5. API Interface
6. Query Operators
7. Column Types
8. Column Modifiers
9. SPARQL Engine
10. Concurrency
11. **Data Relationships** ← 新增
12. **Query Features** ← 新增
13. **Error Scenarios** ← 新增
14. **Data Formats** ← 新增
15. **Authentication** ← 新增
16. **Pod Configuration** ← 新增
17. **Network Conditions** ← 新增
18. **Data Size** ← 新增
19. **Schema Evolution** ← 新增
20. **Caching** ← 新增

还有哪些维度我遗漏了吗？
