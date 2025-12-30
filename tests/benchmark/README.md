# Performance Benchmarks

性能测试套件，用于对比 drizzle-solid 不同执行模式的性能表现。

## 测试文件

| 文件 | 描述 |
|------|------|
| `batch-operations.test.ts` | 批量读写性能测试，对比 Document/Fragment/SPARQL 三种模式 |
| `large-dataset-10k.test.ts` | 10000 条记录的大数据集性能测试 |
| `pagination-30.test.ts` | 分页查询（30条/页）性能测试 |
| `filter-pushdown.test.ts` | SPARQL Filter 下推性能测试 |

## 运行方式

```bash
# 运行所有 benchmark 测试
npx vitest run tests/benchmark

# 运行单个测试
npx vitest run tests/benchmark/large-dataset-10k.test.ts
```

## 前置条件

- 需要运行中的 Solid Server（默认 localhost:3000）
- 部分测试需要 SPARQL endpoint 支持

## 性能对比结论

| 场景 | Fragment Mode | SPARQL Mode | 说明 |
|------|---------------|-------------|------|
| 小数据集 (<100) | ✅ 快 | ➖ 相当 | Fragment 模式无额外开销 |
| 大数据集 + Filter | ❌ 慢 | ✅ 快 | SPARQL Filter 下推优势明显 |
| 分页查询 | ❌ 需全量加载 | ✅ LIMIT/OFFSET | SPARQL 原生支持分页 |
| 写入操作 | ✅ PUT 简单 | ➖ INSERT DATA | 差异不大 |
