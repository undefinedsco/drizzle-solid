# Drizzle-Solid 功能演进规划 (Library Evolution)

## 1. 核心目标 (Objective)

将 `drizzle-solid` 升级为支持 **Solid 身份-存储分离架构 (IdP-SP Separation)** 的智能 ORM。使开发者只需关注用户的 WebID，无需关心数据实际存储的物理位置、网络拓扑或域名变更。

## 2. 智能路由与发现 (Smart Routing & Discovery)

### A. WebID 解析器 (The Resolver)
*   **现状**: 假设 WebID 的 Origin 即为存储的 Origin。
*   **升级**:
    1.  **自动发现**: 当执行 `drizzle.connect(webId)` 时，内部首先 Fetch 该 WebID 的 Profile Document。
    2.  **指针提取**: 解析 Profile 中的 `pim:storage` (WSIM) 或 `solid:pod` 谓词，获取真实的 SPARQL Endpoint (Storage Root)。
    3.  **透明转发**: 后续所有的 CRUD 操作（SELECT/INSERT/UPDATE），自动将请求路由到解析出的 **Storage Url**，而非 WebID Url。
*   **缓存机制**: 对解析结果（WebID -> StorageUrl）进行内存缓存，并设置合理的 TTL，以减少 HTTP 请求开销。

### B. 故障恢复与重试
*   **场景**: 用户家庭网络波动，或动态域名（DDNS）变更导致 404/502。
*   **策略**:
    *   当遇到连接错误时，自动清除路由缓存。
    *   重新 Fetch WebID Profile，获取最新的 Storage 指针（应对用户刚刚切换域名的情况）。
    *   实施指数退避重试 (Exponential Backoff)。

## 3. 基于 Type Index 的数据寻址 (Type Index Addressing)

### A. 痛点
Solid Pod 是文件系统，不同用户可能将同类数据（如 Photo）存储在不同路径。硬编码路径会导致互操作性差。

### B. 解决方案
*   **集成 Solid Type Index**: Drizzle-Solid 将内置对 Public/Private Type Index 标准的支持。
*   **智能写入逻辑**:
    *   当开发者定义 Schema 时：
        ```typescript
        export const photos = solidTable('http://schema.org/ImageObject', ...);
        ```
    *   执行 `db.insert(photos)` 时：
        1.  ORM 自动查询用户的 Type Index，寻找 `http://schema.org/ImageObject` 注册的容器路径 (Container Registration)。
        2.  如果找到 (e.g., `/public/images/`)，则构建 URL 写入该路径。
        3.  如果未找到，则根据预设策略（如按日期 `yyyy/mm/dd`）创建新路径，并自动**注册到 Type Index** 中。

## 4. 增强的 SPARQL 构建器 (Enhanced SPARQL Builder)

### A. 联邦查询支持 (Federated Query)
*   **场景**: 社交图谱查询（例如“查询我的朋友的名字”），数据跨越多个 Pod/域名。
*   **功能**:
    *   支持 `with: { relation: true }` 语法（Auto-Follow）。
    *   当查询结果包含外部 URI 时，ORM 可配置为自动发起并行请求获取外部数据，并在内存中做 Graph Merge。

### B. 服务器方言适配 (Dialect Adapter)
*   **CSS (Comunica) 优化**: 针对 Community Solid Server 的查询引擎特性，优化生成的 SPARQL 语法，避免不支持的特性。
*   **Patch 更新模式**: 针对不支持完整 SPARQL Update 的低端服务器或特定文件类型，提供 **"Fetch -> Modify in Memory -> N3 Patch"** 的降级更新模式。

## 5. 开发者体验 (DX)

### API 变更示例

```typescript
// 初始化连接
// 开发者只需提供稳定的 WebID，无需关心底层存储在哪里
const db = await drizzle.connect({
  webId: "https://id.xpod.io/alice#me",
  fetch: authFetch
});

// 写入数据
// Drizzle 自动处理路由、Type Index 查找、路径生成
await db.insert(photos).values({
  title: "Sunset",
  url: "https://.../sunset.jpg"
});

// 读取数据
// Drizzle 自动路由到真实的 Storage 节点进行 SPARQL 查询
const result = await db.select().from(photos);
```
