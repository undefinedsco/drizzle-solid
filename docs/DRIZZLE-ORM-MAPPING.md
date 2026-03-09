# Drizzle ORM 测试映射分析

## Drizzle ORM 测试规模

- **测试文件**: 12 个
- **代码行数**: 2,866 行
- **测试用例**: 135 个（仅 sqlite-common.ts）

## 问题：应该映射多少测试？

### 方法 1: 全部映射（不现实）

**如果全部映射**：
- 135 个测试 × 4 种 template = **540 tests**
- 工作量：~2 周
- 维护成本：高

**问题**：
- ❌ 很多测试不适用于 Solid（如 auto increment, migrations）
- ❌ 重复测试太多（如 insert + select 的各种变体）
- ❌ 维护成本太高

### 方法 2: 选择性映射（推荐）

**筛选标准**：
1. ✅ 适用于 Solid 场景
2. ✅ 覆盖核心功能
3. ✅ 有代表性
4. ❌ 排除 SQL 特有功能
5. ❌ 排除重复测试

**分类分析**：

#### A. 核心 CRUD（必须映射）- 20 tests

```typescript
// 从 Drizzle ORM 映射
- select all fields
- select partial
- select distinct
- insert single row
- insert multiple rows
- insert with default values
- update single row
- update with where
- delete single row
- delete with where
- insert + select
- insert returning
- update returning
- delete returning
```

**映射到 Solid**：
- Fragment mode × 7 operations = 7 tests
- Document mode × 7 operations = 7 tests
- Multi-variable template × 6 operations = 6 tests
- **小计**: 20 tests

#### B. Query Operators（必须映射）- 30 tests

```typescript
// 从 Drizzle ORM 映射
- eq, ne, gt, gte, lt, lte
- and, or, not
- like, ilike, notLike, notIlike
- inArray, notInArray
- isNull, isNotNull
- between, notBetween
- exists, notExists
```

**映射到 Solid**：
- 每个 operator × 2 templates (fragment + document) = 30 tests
- **小计**: 30 tests

#### C. Query Features（重要）- 25 tests

```typescript
// 从 Drizzle ORM 映射
- WHERE conditions
- ORDER BY (asc, desc)
- LIMIT
- OFFSET
- LIMIT + OFFSET
- Multiple WHERE conditions (AND)
- Multiple WHERE conditions (OR)
- Nested conditions
- DISTINCT
```

**映射到 Solid**：
- 每个 feature × 2-3 templates = 25 tests
- **小计**: 25 tests

#### D. Aggregations（重要）- 15 tests

```typescript
// 从 Drizzle ORM 映射
- COUNT(*)
- COUNT(column)
- COUNT(DISTINCT column)
- SUM(column)
- AVG(column)
- MIN(column)
- MAX(column)
- GROUP BY
- HAVING
```

**映射到 Solid**：
- 每个 aggregation × 1-2 templates = 15 tests
- **小计**: 15 tests

#### E. Joins（重要）- 20 tests

```typescript
// 从 Drizzle ORM 映射
- LEFT JOIN
- RIGHT JOIN
- INNER JOIN
- FULL JOIN
- Multiple joins
- Join with WHERE
- Join with ORDER BY
- Self join
```

**映射到 Solid**：
- 每个 join type × 2-3 scenarios = 20 tests
- **小计**: 20 tests

#### F. Batch Operations（重要）- 10 tests

```typescript
// 从 Drizzle ORM 映射
- Insert multiple rows
- Update multiple rows
- Delete multiple rows
- Batch with transaction
- Batch with error handling
```

**映射到 Solid**：
- 每个 operation × 2 templates = 10 tests
- **小计**: 10 tests

#### G. 不适用的测试（排除）- ~15 tests

```typescript
// 这些是 SQL 特有的，不适用于 Solid
❌ Auto increment
❌ Migrations
❌ Foreign key constraints
❌ Triggers
❌ Views
❌ Stored procedures
❌ Indexes (SQL 层面)
❌ Transactions (ACID)
```

## 重新计算：应该映射多少？

| 类别 | 测试数 | 优先级 |
|------|--------|--------|
| 核心 CRUD | 20 | P0 |
| Query Operators | 30 | P0 |
| Query Features | 25 | P1 |
| Aggregations | 15 | P1 |
| Joins | 20 | P1 |
| Batch Operations | 10 | P2 |
| **总计** | **120** | - |

## 对比

- ❌ 我之前说的：38 tests
- ✅ **实际应该映射：120 tests**
- 📊 Drizzle ORM 总数：135 tests
- 📊 映射比例：89%

## 为什么是 120 而不是 135？

**排除的 15 个测试**：
1. Auto increment（Solid 用 UUID）
2. Migrations（Solid 没有 schema migration）
3. Foreign key constraints（RDF 用 URI reference）
4. SQL 特有的类型（blob, bigint 等）
5. 数据库特有的功能（triggers, views）

## 实施计划

### Phase 1: P0 核心测试（50 tests）

```bash
# 1. 核心 CRUD（20 tests）
yarn generate:crud-tests

# 2. Query Operators（30 tests）
yarn generate:operator-tests

# 预计时间：2-3 天
```

### Phase 2: P1 常用功能（60 tests）

```bash
# 3. Query Features（25 tests）
yarn generate:feature-tests

# 4. Aggregations（15 tests）
yarn generate:aggregation-tests

# 5. Joins（20 tests）
yarn generate:join-tests

# 预计时间：3-5 天
```

### Phase 3: P2 高级功能（10 tests）

```bash
# 6. Batch Operations（10 tests）
yarn generate:batch-tests

# 预计时间：1-2 天
```

## 自动化生成工具

让我创建一个更强大的映射工具，能够自动生成这 120 个测试：

```typescript
// scripts/map-drizzle-comprehensive.ts
function mapDrizzleTests() {
  const categories = {
    crud: extractCRUDTests(),      // 20 tests
    operators: extractOperatorTests(), // 30 tests
    features: extractFeatureTests(),   // 25 tests
    aggregations: extractAggTests(),   // 15 tests
    joins: extractJoinTests(),         // 20 tests
    batch: extractBatchTests(),        // 10 tests
  };

  for (const [category, tests] of Object.entries(categories)) {
    generateTestFile(category, tests);
  }
}
```

## 最终测试需求（更新）

| 来源 | 之前估算 | 重新计算 | 差异 |
|------|----------|----------|------|
| 代码分支分析 | 56 | 56 | - |
| Bug 模式分析 | 32 | 32 | - |
| **Drizzle ORM 映射** | **38** | **120** | **+82** |
| Solid 特有场景 | 39 | 39 | - |
| 用户场景验证 | 25 | 25 | - |
| **总计** | **190** | **272** | **+82** |
| **去重后** | **~150** | **~220** | **+70** |

## 结论

你说得对！我之前低估了 Drizzle ORM 的映射需求。

- ❌ **之前**: 38 tests（只映射了 28%）
- ✅ **应该**: 120 tests（映射 89%）
- 📈 **增加**: +82 tests

**最终测试需求**: ~220 tests（不是 150）

但这仍然比 1.5 亿合理得多！

---

你觉得这个规模合理吗？需要我立即创建自动化工具来生成这 120 个测试吗？
