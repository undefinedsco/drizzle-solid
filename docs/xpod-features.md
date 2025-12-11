# xpod - 扩展的 Community Solid Server

xpod 是对 Community Solid Server (CSS) 的扩展实现，提供了增强的 SPARQL 1.1 支持和 Quadstore 底层存储。

**仓库地址**：https://github.com/undefinedsco/xpod

---

## 核心特性对比

### 原生 CSS vs xpod

| 特性 | 原生 CSS | xpod |
|------|----------|------|
| **底层存储** | 文件系统（Turtle/N3 文件） | 混合存储：Quadstore (RDF) + 文件系统 (非RDF) |
| **SPARQL Query** | ❌ 不支持 | ✅ SPARQL 1.1 完整支持 |
| **SPARQL Update** | ❌ 不支持 | ✅ SPARQL 1.1 Update 完整支持 |
| **LDP 协议** | ✅ 完整支持 | ✅ 完整支持 + 内部 SPARQL 转换 |
| **LDP PATCH** | ✅ 基于文件的 patch | ✅ 转换为 SPARQL UPDATE (原子性) |
| **跨文件查询** | ❌ 不支持 | ✅ 支持（通过 SPARQL） |
| **Graph 支持** | ❌ 无 Graph 概念 | ✅ 完整的 Named Graph 支持 |
| **SPARQL Endpoint** | ❌ 不支持 | ✅ Sidecar 模式 (`/-/sparql` 后缀) |
| **性能** | 文件 I/O | 索引化四元组存储 |

---

## SPARQL Endpoint 支持

xpod 为每个资源和容器提供了 **Sidecar 模式**的 SPARQL endpoint，通过在路径后添加 `/-/sparql` 后缀访问。

### Endpoint 路径规则

| 资源类型 | 资源路径 | SPARQL Endpoint | 说明 |
|----------|----------|-----------------|------|
| **文件资源** | `/data/posts.ttl` | `/data/posts.ttl/-/sparql` | 查询该文件的 Named Graph |
| **容器** | `/data/users/` | `/data/users/-/sparql` | 查询容器及其所有子资源 |
| **根容器** | `/` | `/-/sparql` | 查询整个 Pod |
| **用户 Pod** | `/alice/` | `/alice/-/sparql` | 查询 Alice 的整个 Pod |

### 使用示例

#### 1. 查询单个文件资源

```typescript
// 文件: /data/posts.ttl
// SPARQL Endpoint: /data/posts.ttl/-/sparql

const query = `
  SELECT ?id ?title ?content
  WHERE {
    ?subject a <https://schema.org/BlogPost> ;
             <https://schema.org/id> ?id ;
             <https://schema.org/title> ?title ;
             <https://schema.org/content> ?content .
  }
`;

const response = await fetch('https://alice.example/data/posts.ttl/-/sparql', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/sparql-query',
    'Authorization': `Bearer ${accessToken}`
  },
  body: query
});
```

#### 2. 查询容器（聚合所有子资源）

```typescript
// 容器: /data/users/
// SPARQL Endpoint: /data/users/-/sparql
// 自动聚合: /data/users/alice.ttl, /data/users/bob.ttl, ...

const query = `
  SELECT ?user ?name ?email
  WHERE {
    ?user a <http://xmlns.com/foaf/0.1/Person> ;
          <http://xmlns.com/foaf/0.1/name> ?name ;
          <http://xmlns.com/foaf/0.1/mbox> ?email .
  }
`;

const response = await fetch('https://alice.example/data/users/-/sparql', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/sparql-query',
    'Authorization': `Bearer ${accessToken}`
  },
  body: query
});
```

#### 3. SPARQL UPDATE 操作

```typescript
// 在容器的 Named Graph 中插入数据
const update = `
  INSERT DATA {
    GRAPH <https://alice.example/data/users/> {
      <https://alice.example/data/users/charlie.ttl> a <http://xmlns.com/foaf/0.1/Person> ;
        <http://xmlns.com/foaf/0.1/name> "Charlie" ;
        <http://xmlns.com/foaf/0.1/mbox> "charlie@example.com" .
    }
  }
`;

const response = await fetch('https://alice.example/data/users/-/sparql', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/sparql-update',
    'Authorization': `Bearer ${accessToken}`
  },
  body: update
});
```

### drizzle-solid 配置

在 drizzle-solid 中使用 SPARQL endpoint：

```typescript
import { podTable, string } from 'drizzle-solid';

// Fragment Mode - 单文件资源
const posts = podTable('posts', {
  id: string('id').primaryKey(),
  title: string('title'),
  content: string('content')
}, {
  base: '/data/posts.ttl',           // 资源路径
  sparqlEndpoint: '/data/posts.ttl/-/sparql',  // Sidecar endpoint
  type: 'https://schema.org/BlogPost'
});

// Document Mode - 容器
const users = podTable('users', {
  id: string('id').primaryKey(),
  name: string('name'),
  email: string('email')
}, {
  base: '/data/users/',              // 容器路径
  sparqlEndpoint: '/data/users/-/sparql',      // Sidecar endpoint
  subjectTemplate: '{id}.ttl',       // 每个用户独立文件
  type: 'http://xmlns.com/foaf/0.1/Person'
});
```

### Sidecar 模式的优势

1. **路径一致性**：SPARQL endpoint 路径与资源路径直接关联，易于理解和使用
2. **权限继承**：Endpoint 的访问权限与资源的 ACL 权限一致
3. **自动发现**：客户端可以根据资源路径自动构造 SPARQL endpoint 路径
4. **容器聚合**：容器的 endpoint 自动聚合所有子资源，无需手动指定

---

## xpod 的架构优势

### 1. Quadstore 底层存储

```
原生 CSS 架构:
┌────────────┐
│  LDP 协议  │
├────────────┤
│  文件系统  │
│  .ttl 文件 │
└────────────┘

xpod 架构:
┌─────────────────────────────┐
│  LDP 协议  │  SPARQL 协议   │
├─────────────┴────────────────┤
│  协议转换层 (LDP→SPARQL)     │
├──────────────────────────────┤
│  SPARQL 1.1 引擎             │
├──────────────────────────────┤
│  混合存储层                  │
│  ┌──────────┬─────────────┐ │
│  │ Quadstore│  文件系统   │ │
│  │ (RDF数据)│ (非RDF数据) │ │
│  └──────────┴─────────────┘ │
└──────────────────────────────┘
```

#### 混合存储策略

xpod 采用**智能混合存储**策略，根据内容类型自动选择存储方式：

| 内容类型 | 存储方式 | 示例 |
|----------|----------|------|
| **RDF 数据** | Quadstore（四元组存储） | `.ttl`, `.n3`, `.jsonld`, `.rdf` |
| **Solid 元数据** | Quadstore（四元组存储） | `.acl` (访问控制), `.meta` (元数据) |
| **非 RDF 数据** | 文件系统（原样存储） | 图片、视频、PDF、任意二进制文件 |

**自动转换规则：**

```
PUT /data/profile.ttl (Content-Type: text/turtle)
  ↓
解析为 RDF 三元组
  ↓
存储到 Quadstore (GRAPH <profile.ttl>)
  ✅ 支持 SPARQL 查询

PUT /data/profile.ttl.acl (Content-Type: text/turtle)
  ↓
识别为 Solid ACL 文件（天然 RDF）
  ↓
存储到 Quadstore (GRAPH <profile.ttl.acl>)
  ✅ 支持 SPARQL 查询访问控制规则

PUT /data/profile.ttl.meta (Content-Type: text/turtle)
  ↓
识别为 Solid 元数据文件（天然 RDF）
  ↓
存储到 Quadstore (GRAPH <profile.ttl.meta>)
  ✅ 支持 SPARQL 查询元数据

PUT /data/photo.jpg (Content-Type: image/jpeg)
  ↓
识别为非 RDF 内容
  ↓
直接存储到文件系统
  ✅ 保留原始文件，支持 LDP GET
```

**优势：**
- ✅ **RDF 数据**：享受 Quadstore 的所有优势（SPARQL 查询、跨文件聚合、事务性）
- ✅ **非 RDF 数据**：保留原始格式，无损存储
- ✅ **统一接口**：两种数据都通过 LDP 协议访问，对客户端透明
- ✅ **灵活性**：Pod 可以同时存储结构化数据和媒体文件

#### Solid 元数据文件的特殊处理

Solid 生态系统中的元数据文件（`.acl`, `.meta`）是**天然的 RDF 数据**，xpod 会自动识别并存入 Quadstore：

| 文件类型 | 用途 | RDF 本体 | 示例 |
|----------|------|----------|------|
| **`.acl`** | 访问控制列表 | [Web Access Control](http://www.w3.org/ns/auth/acl) | `profile.ttl.acl`, `.acl` |
| **`.meta`** | 资源元数据 | Dublin Core, Schema.org 等 | `photo.jpg.meta` |

**为什么是天然 RDF？**

1. **`.acl` 文件**：使用 WAC (Web Access Control) 本体定义权限规则

```turtle
# profile.ttl.acl 的内容示例
@prefix acl: <http://www.w3.org/ns/auth/acl#> .

<#owner>
    a acl:Authorization ;
    acl:agent <https://alice.example/profile/card#me> ;
    acl:accessTo <./profile.ttl> ;
    acl:mode acl:Read, acl:Write, acl:Control .

<#public>
    a acl:Authorization ;
    acl:agentClass acl:Agent ;
    acl:accessTo <./profile.ttl> ;
    acl:mode acl:Read .
```

2. **`.meta` 文件**：使用标准元数据本体描述资源

```turtle
# photo.jpg.meta 的内容示例
@prefix dc: <http://purl.org/dc/terms/> .
@prefix schema: <http://schema.org/> .

<./photo.jpg>
    dc:title "Summer Vacation" ;
    dc:created "2024-07-15T10:30:00Z"^^xsd:dateTime ;
    dc:creator <https://alice.example/profile/card#me> ;
    schema:contentSize "2048000"^^xsd:integer ;
    schema:encodingFormat "image/jpeg" ;
    schema:location "Beijing, China" .
```

**Quadstore 的优势：**

将 `.acl` 和 `.meta` 存入 Quadstore 后，可以进行强大的跨文件查询：

```sparql
-- 查找 Alice 拥有完全控制权的所有资源
SELECT ?resource
WHERE {
  GRAPH ?g {
    ?auth a <http://www.w3.org/ns/auth/acl#Authorization> ;
          <http://www.w3.org/ns/auth/acl#agent> <https://alice.example/profile/card#me> ;
          <http://www.w3.org/ns/auth/acl#accessTo> ?resource ;
          <http://www.w3.org/ns/auth/acl#mode> <http://www.w3.org/ns/auth/acl#Control> .
  }
}

-- 查找某个时间段创建的所有资源
SELECT ?resource ?title ?created
WHERE {
  GRAPH ?g {
    ?resource <http://purl.org/dc/terms/title> ?title ;
              <http://purl.org/dc/terms/created> ?created .
    FILTER(?created >= "2024-01-01T00:00:00Z"^^xsd:dateTime &&
           ?created < "2024-12-31T23:59:59Z"^^xsd:dateTime)
  }
}
```

**实际应用示例：**

```
/alice/
  ├─ .acl                 → Quadstore (Pod 根目录访问控制)
  ├─ profile/
  │  ├─ card.ttl          → Quadstore (用户 Profile 数据)
  │  └─ card.ttl.acl      → Quadstore (Profile 的访问控制规则)
  ├─ photos/
  │  ├─ .acl              → Quadstore (photos 容器的访问控制)
  │  ├─ vacation.jpg      → 文件系统 (原始图片)
  │  ├─ vacation.jpg.meta → Quadstore (图片的 RDF 元数据)
  │  ├─ vacation.jpg.acl  → Quadstore (图片的访问控制)
  │  └─ album.jsonld      → Quadstore (JSON-LD 相册数据)
  ├─ posts/
  │  ├─ .acl              → Quadstore
  │  ├─ post-1.ttl        → Quadstore
  │  ├─ post-1.ttl.meta   → Quadstore
  │  └─ post-2.ttl        → Quadstore
  └─ documents/
     ├─ .acl              → Quadstore
     ├─ resume.pdf        → 文件系统 (原始 PDF)
     ├─ resume.pdf.meta   → Quadstore (PDF 的元数据)
     └─ resume.pdf.acl    → Quadstore (PDF 的访问控制)
```

**存储分类说明：**

| 文件类型 | 存储位置 | 支持 SPARQL | 说明 |
|----------|----------|-------------|------|
| `.ttl`, `.n3`, `.jsonld` | Quadstore | ✅ | 用户数据 RDF 文件 |
| `.acl` | Quadstore | ✅ | Solid 访问控制列表（天然 RDF） |
| `.meta` | Quadstore | ✅ | Solid 元数据文件（天然 RDF） |
| `.jpg`, `.pdf` 等 | 文件系统 | ❌ | 二进制文件，保留原格式 |

**SPARQL 查询优势：**

```sparql
-- 查询所有允许公开访问的资源
SELECT ?resource ?mode
WHERE {
  GRAPH ?aclGraph {
    ?auth a <http://www.w3.org/ns/auth/acl#Authorization> ;
          <http://www.w3.org/ns/auth/acl#accessTo> ?resource ;
          <http://www.w3.org/ns/auth/acl#mode> ?mode ;
          <http://www.w3.org/ns/auth/acl#agentClass> <http://xmlns.com/foaf/0.1/Agent> .
  }
  FILTER(CONTAINS(STR(?aclGraph), ".acl"))
}

-- 查询所有照片的元数据
SELECT ?photo ?title ?date ?location
WHERE {
  GRAPH ?metaGraph {
    ?photo <http://purl.org/dc/terms/title> ?title ;
           <http://purl.org/dc/terms/created> ?date .
    OPTIONAL { ?photo <http://schema.org/location> ?location }
  }
  FILTER(CONTAINS(STR(?metaGraph), "photos/") && CONTAINS(STR(?metaGraph), ".meta"))
}
```

在这个例子中：
- **RDF 数据**（profile, posts, metadata）存储在 Quadstore，可以通过 SPARQL 查询
- **Solid 元数据**（`.acl`, `.meta`）也存储在 Quadstore，支持高级权限和元数据查询
- **媒体文件**（photos, PDF）存储在文件系统，保留原始格式
- 可以通过 SPARQL 跨文件查询所有访问控制规则和元数据

### 2. LDP 协议的 SPARQL 增强

xpod 在保持 LDP 协议兼容性的同时，内部使用 SPARQL 处理：

| LDP 操作 | xpod 内部转换 | 优势 |
|----------|---------------|------|
| **GET /file.ttl** | `SELECT * WHERE { GRAPH <file> {...} }` | 精确的 Graph 过滤 |
| **PUT /file.ttl** | `DELETE {...}; INSERT {...}` | 原子性替换 |
| **PATCH /file.ttl** | `DELETE {...} INSERT {...} WHERE {...}` | 原子性更新 |
| **DELETE /file.ttl** | `DELETE { GRAPH <file> { ?s ?p ?o } }` | 完整删除 Graph |

**原生 CSS vs xpod 的 PATCH 对比：**

```
原生 CSS PATCH:
1. 读取整个文件到内存
2. 解析为 RDF 三元组
3. 应用 patch 操作（删除/插入）
4. 序列化回 Turtle
5. 写入文件
❌ 非原子性，可能有并发问题

xpod PATCH:
1. 解析 patch 为 SPARQL UPDATE
2. 执行 DELETE/INSERT WHERE (单个事务)
3. Quadstore 保证原子性
✅ 原子性，无并发问题
```

### 3. SPARQL 1.1 完整支持

xpod 提供了完整的 SPARQL 1.1 Query 和 Update 支持：

#### SPARQL 1.1 Query 特性

```sparql
-- 跨文件查询（原生 CSS 无法实现）
SELECT ?user ?friend
WHERE {
  GRAPH ?g1 {
    ?user a foaf:Person ;
          foaf:knows ?friend .
  }
  GRAPH ?g2 {
    ?friend foaf:name ?friendName .
  }
}

-- 聚合查询
SELECT (COUNT(?user) as ?total)
WHERE {
  GRAPH <users/> {
    ?user a foaf:Person .
  }
}

-- 联合查询
SELECT ?item
WHERE {
  { GRAPH <tags/> { ?item a schema:Tag } }
  UNION
  { GRAPH <categories/> { ?item a schema:Category } }
}
```

#### SPARQL 1.1 Update 特性

```sparql
-- 条件批量更新
DELETE { GRAPH <users/> { ?user <status> ?old } }
INSERT { GRAPH <users/> { ?user <status> "active" } }
WHERE {
  GRAPH <users/> {
    ?user <status> ?old .
    ?user <lastLogin> ?login .
    FILTER (?login > "2024-01-01"^^xsd:date)
  }
}

-- 跨 Graph 数据移动
DELETE { GRAPH <temp/> { ?s ?p ?o } }
INSERT { GRAPH <archive/> { ?s ?p ?o } }
WHERE { GRAPH <temp/> { ?s ?p ?o } }
```

### 4. Graph 自动发现

xpod 的查询引擎支持智能 Graph 发现：

```sparql
-- 不指定 GRAPH，自动查询所有相关子图
SELECT ?s ?p ?o
WHERE {
  GRAPH ?g {
    ?s a foaf:Person .
  }
}

-- xpod 会自动查询：
-- - <users/> Graph 本身
-- - <users/alice.ttl> Graph
-- - <users/bob.ttl> Graph
-- - 所有 <users/*> 的子 Graph
```

**对比原生 CSS：**
- 原生 CSS：必须明确知道文件路径，逐个读取
- xpod：一次查询即可获取容器下所有数据

---

## xpod 对 drizzle-solid 的意义

### 1. 启用 SPARQL 模式

**SPARQL 模式定位**: LDP 协议的 SELECT 查询增强

原生 CSS 不支持 SPARQL 端点，drizzle-solid 只能使用 LDP 模式：
- 简单 CRUD 可以工作
- 复杂查询需要客户端处理（低效）

xpod 启用了 SPARQL 模式：
- **SELECT**: 服务器端查询和过滤（性能优化）
- **INSERT/UPDATE/DELETE**: 自动使用 LDP 策略（兼容性优先）
- 支持 JOIN、聚合、子查询

> 详细设计请参考 [SPARQL 模式设计文档](./guides/sparql-mode-design.md)

### 2. 统一的数据模型

```
原生 CSS 的数据视图:
/data/users/alice.ttl  ← 独立文件
/data/users/bob.ttl    ← 独立文件
/data/tags.ttl         ← 独立文件

(需要 N 次请求才能查询所有用户)

xpod 的数据视图:
Quadstore
├─ Graph <users/>
│  ├─ <users/alice.ttl> triples
│  └─ <users/bob.ttl> triples
└─ Graph <tags.ttl>
   └─ <tags.ttl#tag-1> triples

(单次 SPARQL 查询即可获取所有数据)
```

### 3. 性能优化

| 操作 | 原生 CSS | xpod |
|------|----------|------|
| 查询 100 个用户 | 100 次 HTTP GET | 1 次 SPARQL SELECT |
| 条件过滤 | 客户端过滤（传输所有数据） | 服务器端过滤（只返回匹配） |
| 批量更新 | N 次 PATCH（非原子） | 1 次 SPARQL UPDATE（原子） |
| JOIN 查询 | 客户端多次请求 + 内存 JOIN | 服务器端 JOIN |

---

## 使用 xpod 的前提条件

### 部署要求

1. **服务器**：部署 xpod (https://github.com/undefinedsco/xpod)
2. **端点配置**：确保 SPARQL 端点已启用
3. **权限配置**：SPARQL 端点需要适当的访问控制

### drizzle-solid 配置

指定 `sparqlEndpoint` 来启用 SPARQL SELECT 增强：

```typescript
const users = podTable('users', columns, {
  base: '/data/users/',
  sparqlEndpoint: '/data/-/sparql'  // 启用 SPARQL SELECT
});
```

**策略选择：**
- **有 `sparqlEndpoint`**：
  - SELECT → SPARQL 模式（性能优化）
  - INSERT/UPDATE/DELETE → LDP 模式（自动路由）
- **无 `sparqlEndpoint`**：全部使用 LDP 模式（兼容原生 CSS）

> 写操作自动路由到 LDP 避免 SPARQL UPDATE 的兼容性问题

---

## 迁移指南

### 从原生 CSS 迁移到 xpod

1. **部署 xpod**：替换原生 CSS
2. **数据迁移**：
   - 现有 .ttl 文件会被自动导入 Quadstore
   - Graph URI = 文件路径
3. **更新配置**：
   - 添加 `sparqlEndpoint` 配置
   - 测试 SPARQL 查询
4. **逐步启用**：
   - 先保持 LDP 模式运行
   - 逐步将复杂查询迁移到 SPARQL 模式

### 兼容性保证

✅ **向后兼容**：xpod 完全兼容原生 CSS 的 LDP 协议
- 现有客户端无需修改
- 可以同时使用 LDP 和 SPARQL 协议
- 数据在 Quadstore 中统一存储

---

## 参考资料

- **xpod 仓库**：https://github.com/undefinedsco/xpod
- **SPARQL 1.1 规范**：https://www.w3.org/TR/sparql11-query/
- **SPARQL 1.1 Update**：https://www.w3.org/TR/sparql11-update/
- **Solid 规范**：https://solidproject.org/TR/protocol

