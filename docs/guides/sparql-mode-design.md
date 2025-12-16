# SPARQL 模式设计文档

本文档说明 drizzle-solid 的 SPARQL 模式实现。

> **相关文档**：
> - [xpod 特性文档](../xpod-features.md) - xpod 服务器功能介绍
> - [CSS Notifications 文档](./css-notifications.md) - Notifications 与 SPARQL 的配合

---

## 1. 概述

### 1.1 核心定位

**SPARQL 模式 = LDP 协议 + SPARQL 查询优化**

```
┌────────────────────────────────────────┐
│  drizzle-solid                         │
│                                        │
│  查询层（可选增强）：                    │
│  ┌──────────────────────────────┐      │
│  │  SPARQL SELECT               │      │
│  │  - 服务器端过滤               │      │
│  │  - 聚合和 JOIN                │      │
│  └──────────────────────────────┘      │
│                                        │
│  写入层：                              │
│  ┌──────────────────────────────┐      │
│  │  LDP PUT/PATCH/DELETE        │      │
│  │  - 触发 Notifications         │      │
│  │  - ACL 权限检查               │      │
│  └──────────────────────────────┘      │
└────────────────────────────────────────┘
```

### 1.2 执行策略

```typescript
// PodDialect.query() 中的策略路由
const strategy = operation.type === 'select'
  ? this.getStrategy(operation.table)  // SPARQL 或 LDP
  : this.strategyFactory.getLdpStrategy();  // 写操作强制 LDP
```

| 操作类型 | 有 sparqlEndpoint | 无 sparqlEndpoint |
|---------|-----------------|------------------|
| SELECT | SparqlStrategy | LdpStrategy |
| INSERT | LdpStrategy | LdpStrategy |
| UPDATE | LdpStrategy | LdpStrategy |
| DELETE | LdpStrategy | LdpStrategy |

### 1.3 快速配置

```typescript
// LDP 模式（默认）
const users = podTable('users', columns, {
  base: '/data/users/'
});

// SPARQL 模式（查询增强）
const users = podTable('users', columns, {
  base: '/data/users/',
  sparqlEndpoint: '/data/users/-/sparql'  // xpod sidecar 端点
});
```

---

## 2. 核心概念

### 2.1 Resource Mode（资源模式）

| 模式 | 说明 | 配置示例 | URI 格式 |
|------|------|----------|----------|
| **Fragment** | 所有记录在同一文件 | `base: '/data/tags.ttl'` | `resource.ttl#id` |
| **Document** | 每条记录独立文件 | `base: '/data/users/'` | `container/id.ttl` |

### 2.2 Graph 映射规则

| 模式 | SELECT | INSERT/UPDATE/DELETE |
|------|--------|----------------------|
| Fragment | `GRAPH <base_file.ttl>` | `GRAPH <base_file.ttl>` |
| Document (SPARQL) | `GRAPH ?g`（自动聚合） | LDP 写入各文件 |
| Document (LDP) | 逐文件 GET | 各文件独立 Graph |

**关键理解**：
- LDP 写入时，Graph = 文件 URI（如 `<alice.ttl>`）
- SPARQL SELECT 时，不指定 GRAPH 让服务器自动聚合

### 2.3 Subject URI 生成

| 模式 | Subject 格式 | 示例 |
|------|-------------|------|
| Fragment | `<base_file>#<id>` | `<http://pod/data/tags.ttl#tag-1>` |
| Document | `<container><id>.ttl` | `<http://pod/data/users/alice.ttl>` |

---

## 3. 配置详解

### 3.1 sparqlEndpoint 配置

`sparqlEndpoint` 仅影响 SELECT 查询，支持多种路径格式：

```typescript
// 1. 相对路径（推荐）
sparqlEndpoint: '/data/users/-/sparql'
// → 自动拼接到 podUrl
// → 使用 Solid 认证

// 2. 绝对 URL（同源）
sparqlEndpoint: 'https://pod.example/data/users/-/sparql'
// → 使用 Solid 认证

// 3. 绝对 URL（跨源）
sparqlEndpoint: 'https://external.example/sparql'
// → 无认证（公共端点）
```

### 3.2 鉴权策略

```
sparqlEndpoint 解析流程：

1. 是否为绝对 URL？
   ├─ 是 → 直接使用
   └─ 否 → 拼接到 podUrl

2. 是否同源？
   ├─ 同源 → session.fetch（Solid 认证）
   └─ 跨源 → 标准 fetch（无认证）
```

### 3.3 完整配置示例

**Fragment Mode：**

```typescript
const tags = podTable('tags', {
  id: string('id').primaryKey(),
  name: string('name').predicate('http://schema.org/name')
}, {
  type: 'http://schema.org/Tag',
  base: '/data/tags.ttl',
  subjectTemplate: '#{id}',
  sparqlEndpoint: '/data/tags.ttl/-/sparql'
});
```

**Document Mode：**

```typescript
const users = podTable('users', {
  id: string('id').primaryKey(),
  name: string('name').predicate('http://schema.org/name')
}, {
  type: 'http://schema.org/Person',
  base: '/data/users/',
  // document 模式下 fragment 是“可选的”，完全由 subjectTemplate 决定：
  // - '{id}.ttl'      -> /data/users/alice.ttl
  // - '{id}.ttl#it'   -> /data/users/alice.ttl#it（区分“文档”与“文档描述的对象”）
  subjectTemplate: '{id}.ttl',
  sparqlEndpoint: '/data/users/-/sparql'
});
```

---

## 4. 模式对比

### 4.1 三种模式总览

| 特性 | 原生 CSS | xpod LDP | xpod SPARQL |
|------|----------|----------|-------------|
| 底层存储 | 文件系统 | Quadstore | Quadstore |
| 查询方式 | GET + 客户端过滤 | GET + 客户端过滤 | SPARQL SELECT |
| 写入方式 | PUT/PATCH | PUT/PATCH | PUT/PATCH（LDP） |
| 服务器端过滤 | ❌ | ❌ | ✅ |
| 跨文件 JOIN | ❌ | ❌ | ✅ |
| 聚合操作 | ❌ | ❌ | ✅ |
| 兼容性 | ✅ 所有 Solid | ✅ 所有 Solid | ⚠️ 需要 xpod |

### 4.2 性能对比

| 操作 | LDP 模式 | SPARQL 模式 | 说明 |
|------|----------|-------------|------|
| 条件查询（10%匹配） | ⭐ | ⭐⭐⭐⭐⭐ | SPARQL 服务器端过滤 |
| 聚合统计 | ⭐ | ⭐⭐⭐⭐⭐ | SPARQL COUNT/SUM |
| JOIN 查询 | ⭐ | ⭐⭐⭐⭐⭐ | SPARQL 服务器端 JOIN |
| 单条 CRUD | ⭐⭐⭐ | ⭐⭐⭐ | 差异不大 |

### 4.3 选择建议

```
你的需求是？
│
├─ 简单 CRUD、兼容性优先
│   └─→ LDP 模式（不设置 sparqlEndpoint）
│
├─ 复杂查询、性能优先
│   └─→ SPARQL 模式（设置 sparqlEndpoint）
│
└─ 两者兼顾
    └─→ 混合使用（不同表不同模式）
```

---

## 5. 测试覆盖矩阵

### 5.1 测试维度

| 维度 | 选项 |
|------|------|
| Resource Mode | fragment, document |
| ID Predicate | @id (virtual), custom predicate |
| Operation | SELECT, INSERT, UPDATE, DELETE |
| WHERE | 无条件, id=, id IN, 其他字段 |

### 5.2 组合矩阵

| # | Resource Mode | ID Predicate | Operation | WHERE | 测试点 |
|---|---------------|--------------|-----------|-------|--------|
| 1 | fragment | @id | SELECT | 无 | id 从 subject 提取 |
| 2 | fragment | @id | SELECT | id = | ?subject 比较完整 URI |
| 3 | fragment | @id | SELECT | id IN | ?subject IN (URIs) |
| 4 | fragment | @id | INSERT | - | URI 生成 #id |
| 5 | fragment | @id | UPDATE | id = | 定位到正确 subject |
| 6 | fragment | @id | DELETE | id = | 删除正确 subject |
| 7 | document | @id | SELECT | 无 | id 从文件名提取 |
| 8 | document | @id | SELECT | id = | ?subject 比较完整 URI |
| 9 | document | @id | SELECT | id IN | ?subject IN (URIs) |
| 10 | document | @id | INSERT | - | 创建 id.ttl 文件 |
| 11 | document | @id | UPDATE | id = | 定位到正确文件 |
| 12 | document | @id | DELETE | id = | 删除正确文件 |
| 13 | fragment | custom | SELECT | 无 | ?id 变量查询 |
| 14 | fragment | custom | SELECT | id = | ?id = "value" |
| 15 | fragment | custom | INSERT | - | 写入 predicate triple |
| 16 | fragment | custom | UPDATE | id = | 正常属性更新 |
| 17 | document | custom | SELECT | 无 | ?id 变量查询 |
| 18 | document | custom | SELECT | id = | ?id = "value" |
| 19 | document | custom | INSERT | - | 写入 predicate triple |
| 20 | document | custom | UPDATE | id = | 正常属性更新 |

### 5.3 当前测试覆盖

- ✅ Fragment Mode CRUD
- ✅ Document Mode SELECT
- ✅ Document Mode INSERT
- ✅ Document Mode UPDATE/DELETE
- ✅ SPARQL endpoint SELECT
- ✅ LDP 写入 + SPARQL 读取混合模式

---

## 6. 实现细节

### 6.1 LDP → SPARQL 内部转换（服务器端）

xpod 在服务器内部将 LDP 操作转换为 SPARQL：

| LDP 操作 | 内部 SPARQL | Graph |
|----------|-------------|-------|
| GET /alice.ttl | `SELECT * WHERE { GRAPH <alice.ttl> {...} }` | 文件 URI |
| PUT /alice.ttl | `DELETE {...} INSERT {...}` | 文件 URI |
| PATCH /alice.ttl | `DELETE {...} INSERT {...}` | 文件 URI |
| DELETE /alice.ttl | `DELETE { GRAPH <alice.ttl> {...} }` | 文件 URI |

**这个转换对客户端透明**，确保了：
- ✅ Notifications 触发
- ✅ ACL 权限检查
- ✅ 原子性操作

### 6.2 批量更新策略

**Fragment Mode**：单次 PATCH 到文件

```typescript
// 所有 fragments 在同一文件，单次请求
await session.fetch('/data/tags.ttl', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/sparql-update' },
  body: sparqlUpdate
});
```

**Document Mode**：并发 PATCH 各文件

```typescript
// 每个文件独立 PATCH
const matches = await queryMatches();  // SPARQL SELECT
await Promise.all(matches.map(record => 
  session.fetch(`/data/users/${record.id}.ttl`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/sparql-update' },
    body: generateSparqlForFile(record)
  })
));
```

| 模式 | 策略 | 请求数 | 通知粒度 |
|------|------|--------|----------|
| Fragment | 单次 PATCH | 1 | 文件级 |
| Document | 并发 PATCH | N | 每文件一次 |

### 6.3 SPARQL 示例

**Fragment Mode SELECT：**

```sparql
SELECT ?subject ?name WHERE {
  GRAPH <http://pod/data/tags.ttl> {
    ?subject rdf:type <http://schema.org/Tag> .
    OPTIONAL { ?subject <http://schema.org/name> ?name . }
  }
}
```

**Document Mode SELECT：**

```sparql
SELECT ?subject ?name WHERE {
  GRAPH ?g {
    ?subject rdf:type <http://schema.org/Person> .
    OPTIONAL { ?subject <http://schema.org/name> ?name . }
  }
}
```

---

## 7. 源码参考

| 模块 | 路径 | 说明 |
|------|------|------|
| SPARQL 策略 | `src/core/execution/sparql-strategy.ts` | SELECT 执行 |
| LDP 策略 | `src/core/execution/ldp-strategy.ts` | 写入执行 |
| Subject 解析 | `src/core/subject/resolver.ts` | URI 生成 |
| SPARQL 构建 | `src/core/sparql/builder/` | 查询构建 |
