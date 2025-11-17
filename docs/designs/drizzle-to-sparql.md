# Drizzle → SPARQL Translation Design

设计目标：解释如何把 Drizzle 的关系模型查询映射到 SPARQL 三元组查询，并给出映射配置、IR、编译流程、执行路径与边界。

## 1. 总体架构

```
Drizzle Builder → (工作流包装器) → 关系型 IR
     │                               │
     └── 映射配置 (subject/predicate) ┘
              ↓
        SPARQL 生成器 (基于 sparqljs)
              ↓
        (可选) 执行器（Comunica → SPARQL endpoint）
```

- **映射层**：定义表→RDF 类、列→谓词、subject 模板、对象属性、图等。
- **IR**：捕获 Drizzle DSL 的 select/from/join/where/order/group/limit 等结构。
- **SPARQL 生成器**：使用映射 + IR 构造 SPARQL.js AST，再序列化字符串。
- **执行层（可选）**：把 SPARQL 发给 HTTP/SPARQL endpoint（Comunica）。

## 2. 映射设计

最小配置（TypeScript）示例：

```ts
const mapping = {
  users: {
    subject: 'https://ex.com/user/{id}',
    class: 'ex:User',
    graph: 'https://ex.com/graph/main',
    columns: {
      id: { predicate: 'ex:userId', kind: 'datatype', datatype: 'xsd:integer' },
      name: { predicate: 'foaf:name', kind: 'datatype', datatype: 'xsd:string', lang: 'zh' },
      email: { predicate: 'foaf:mbox', kind: 'datatype', datatype: 'xsd:string' },
      orgId: { predicate: 'ex:memberOf', kind: 'object', ref: 'orgs' }
    },
    joins: [
      { localColumn: 'orgId', predicate: 'ex:memberOf', targetTable: 'orgs', targetColumn: 'id' }
    ]
  },
  orgs: {
    subject: 'https://ex.com/org/{id}',
    class: 'ex:Org',
    columns: {
      id: { predicate: 'ex:orgId', kind: 'datatype', datatype: 'xsd:integer' },
      name: { predicate: 'ex:orgName', kind: 'datatype', datatype: 'xsd:string' }
    }
  }
};
```

要素：
- `subject`: IRI 模板，可含 `{column}` 占位符。
- `class`: rdf:type（可选）。
- `columns`: 每列的 predicate + datatype 或对象引用。
- `joins`: 声明外键对应的谓词，便于把 join 翻译成 RDF 边。

## 3. 获取 Drizzle 查询 IR

### 3.1 包装 Drizzle DSL（推荐）

实现一个“代理”层，复用 Drizzle 的 helper 名称（`eq`, `and`, `join` 等），在调用时记录 IR，同时把调用转发给原函数，这样在应用中写一次查询就能同时获取 SQL 与 IR。

### 3.2 IR 结构示例

```json
{
  "sources": [{ "table": "users", "alias": "u" }],
  "joins": [
    { "type": "left", "left": "u", "right": { "table": "orgs", "alias": "o" },
      "on": { "eq": ["u.orgId", "o.id"] } }
  ],
  "select": [
    { "expr": "u.id", "as": "userId" },
    { "expr": "u.name", "as": "userName" },
    { "expr": "o.name", "as": "orgName" }
  ],
  "where": { "and": [ { "eq": ["u.active", true] }, { "like": ["u.name", "%张%"] } ] },
  "groupBy": [],
  "orderBy": [{ "expr": "u.id", "direction": "asc" }],
  "limit": 10,
  "offset": 0,
  "distinct": false
}
```

## 4. 编译规则

1. **主语变量**：每个来源/别名 `a` 使用变量 `?a`；若映射指定 class，则加 `?a rdf:type ex:Class`（可包在 `GRAPH`）。
2. **列映射**：列 `a.col` → 谓词 `:p`，绑定变量 `?a_col`，添加三元组 `?a :p ?a_col`。对象属性列把 `?a :p ?b` 连接两表。
3. **Join**：
   - 若 `joins` 声明 predicate，则 `INNER JOIN` → 同一个 BGP；`LEFT JOIN` → `OPTIONAL { ... }`。
   - 否则退化为 `FILTER(?a_fk = ?b_pk)`。
4. **WHERE**：
   - `eq`/`ne`/比较 → `FILTER`。
   - `isNull` → `FILTER(!BOUND(?var))`。
   - `like`/`ilike` → `FILTER regex(str(?var), translatedPattern, flags)`。
   - `in` → `VALUES ?var { ... }` 或 disjunction。
   - `and/or/not` → 嵌套 BGP + FILTER。
5. **SELECT 投影**：映射 `expr` 所绑定的变量，加 `BIND` 处理常量或表达式。
6. **GROUP BY & 聚合**：直接转换为 SPARQL GROUP BY + COUNT/SUM/AVG 等。
7. **ORDER BY/LIMIT/OFFSET/DISTINCT**：直接映射。
8. **NULL 语义**：Drizzle 的 NULL ≈ SPARQL 未绑定；比较时需要结合 `BOUND()`。

## 5. 示例

Drizzle DSL:

```ts
const q = db.select({
  userId: users.id,
  userName: users.name,
  orgName: orgs.name
})
.from(users.as('u'))
.leftJoin(orgs.as('o'), eq(users.orgId, orgs.id))
.where(and(eq(users.active, true), ilike(users.name, '%张%')))
.orderBy(asc(users.id))
.limit(10);
```

SPARQL：

```sparql
SELECT ?u_id ?u_name ?o_name
WHERE {
  GRAPH <https://ex.com/graph/main> {
    ?u a ex:User ;
       ex:userId ?u_id ;
       foaf:name ?u_name .
    OPTIONAL {
      ?u ex:memberOf ?o .
      ?o ex:orgName ?o_name .
    }
    ?u ex:active ?u_active .
    FILTER(?u_active = true)
    FILTER(CONTAINS(LCASE(STR(?u_name)), LCASE("张")))
  }
}
ORDER BY ASC(?u_id)
LIMIT 10
```

## 6. Subject 解析

- `subject template` 负责把 `{id}` 等列值拼到 IRI。
- 运行时若输入 fragment：`
  - SELECT plain object：`where({ id: '#me' })` → `https://...#me`。
  - `@id` 已是绝对 IRI 可直接用；非 http(s) 则 fallback literal。
- INSERT/UPDATE/DELETE 统一用 `generateSubjectUri()` 推导。

## 7. Regex / LIKE

- `like` → 自动转为 regex（`%` → `.*`, `_` → `.`，默认 `i` flag）。
- `regex(column, pattern, flags)` → 原样传给 SPARQL `regex(str(?col), pattern, flags)`。
- `id`/`@id` lookup 均使用 equality（不再依赖 regex 末尾匹配）。

## 8. 执行路径

```
Drizzle builder → PodDialect → ASTToSPARQLConverter
    → SPARQL.js AST → (stringify) → Comunica Executor → Solid Pod
```

- SPARQL.js 提供 AST；我们 `stringify()` 成字符串。
- Comunica 将字符串解析成 SPARQL Algebra，带着 DPoP/oidc 会话发请求，返回 bindings。

## 9. 写操作（INSERT/UPDATE/DELETE）

- INSERT：`INSERT DATA { <subj> predicate value . ... }`
- UPDATE：`DELETE { ... } INSERT { ... } WHERE { ... }`（对每个列和 predicate 生成模板）。
- DELETE：`DELETE WHERE { <subj> ?p ?o }` 或更细粒度。

## 10. 边界与限制

1. 必须有映射；无映射无法生成 predicate 或 subject。
2. 多值属性可能导致 SQL → RDF 行数不一致，需要 DISTINCT/聚合兜底。
3. 复杂 SQL（窗口函数、CTE、递归、特定方言函数）暂不支持。
4. SQL NULL vs RDF 未绑定：需要用 `BOUND` 显式区分。
5. JOIN 中如果没有 RDF predicate 声明，只能退化为列值等式，会失去图语义。
6. 规范化 IR/映射仍在演进中，未来的 refactor 会优先把 plain object `.where` 转换为 QueryCondition，以便统一走 ASTToSPARQL。

## 11. 实现记录

- `podTable` 现提供 `subjectTemplate` + `mapping`，`ASTToSPARQLConverter.generateSubjectUri` 会优先按模板插值并基于 Pod URL 归一化。
- `SelectQueryBuilder` 会把 `.where()` 的对象形式转换成 `QueryCondition`，再封装成 `SelectQueryPlan`，`PodDialect` 直接把 plan 交给 `convertSelectPlan` 生成 SPARQL。
