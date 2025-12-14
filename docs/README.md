# drizzle-solid 文档索引

## 🚀 快速开始

- [快速开始（本地）](./quick-start-local.md) - 本地开发快速入门
- [快速开始（CSS）](./quick-start-css.md) - 连接 CSS Pod 服务器

## 📚 核心概念

### 架构设计

- [架构概览](./architecture.md) - 整体架构设计
- [SPARQL 模式设计](./guides/sparql-mode-design.md) - 包含测试覆盖矩阵

### Resource Mode（资源模式）

- **Fragment Mode**: 单文件多资源（`/data/tags.ttl#tag-1`）
- **Document Mode**: 多文件单资源（`/data/users/alice.ttl`）

### Execution Mode（执行策略）

- **LDP Mode**: 标准 Solid LDP 协议（默认）
- **SPARQL Mode**: SELECT 查询增强（需要 xpod）

## 🔧 功能指南

### 数据发现与 SAI

- [数据发现与 SAI 互操作](./guides/data-discovery.md) - 动态发现 Pod 中的数据位置
  - TypeIndex vs SAI 对比
  - DataLocation 结构（Container 为中心）
  - Shape 选择机制
  - 跨 Pod 数据访问

### SPARQL 模式

- [SPARQL 模式设计](./guides/sparql-mode-design.md) ⭐ **最完整的 SPARQL 模式文档**
  - 什么是 SPARQL 模式？
  - 与 LDP 模式的对比
  - Graph 处理详解
  - 执行策略路由
  - 使用场景和最佳实践

### xpod 集成

- [xpod 特性文档](./xpod-features.md) - xpod（扩展 CSS）的功能说明
  - Quadstore 架构
  - SPARQL 端点
  - 性能优化
  - 迁移指南

### 其他功能

- [CSS Notifications](./guides/css-notifications.md) - Solid Notifications 支持
- [JOIN 设计](./guides/right-full-join-sparql-design.md) - JOIN 查询实现
- [Drizzle to SPARQL](./designs/drizzle-to-sparql.md) - SQL → SPARQL 转换

## 📖 开发指南

### 测试

- [测试策略](../TESTING_STRATEGY.md) - 测试方法和覆盖
- [SPARQL 模式设计 - 测试矩阵](./guides/sparql-mode-design.md#5-测试覆盖矩阵) - 测试覆盖矩阵

### 开发工具

- [Agent 指南](../AGENTS.md) - AI Agent 使用说明
- [Claude 指南](../CLAUDE.md) - Claude 开发助手
- [Gemini 指南](../GEMINI.md) - Gemini 开发助手

## 🗃️ 归档文档

历史调研和设计文档：

- [SPARQL 调研结果](./archive/solid-sparql-investigation-results.md)
- [SPARQL 原生分析](./archive/solid-sparql-native-analysis.md)
- [SPARQL 原生支持结论](./archive/solid-sparql-native-support-conclusion.md)
- [SPARQL 现实检查](./archive/solid-sparql-reality-check.md)
- [SPARQL 结论](./archive/solid-sparql-conclusion.md)

## 🎯 文档导航建议

### 我想了解 SPARQL 模式

1. 从 [SPARQL 模式设计](./guides/sparql-mode-design.md) 开始（最全面）
2. 如果使用 xpod，阅读 [xpod 特性](./xpod-features.md)
3. 查看 [测试覆盖矩阵](./guides/sparql-mode-design.md#5-测试覆盖矩阵)

### 我想了解技术实现

1. [架构概览](./architecture.md) - 整体设计
2. [SPARQL 模式设计](./guides/sparql-mode-design.md) - 执行策略和测试矩阵
3. [SPARQL 模式设计](./guides/sparql-mode-design.md) - 详细实现

### 我想开发新功能

1. [测试策略](../TESTING_STRATEGY.md) - 如何编写测试
2. [测试覆盖矩阵](./guides/sparql-mode-design.md#5-测试覆盖矩阵) - 需要覆盖的场景
3. 相关的 [Agent 指南](../AGENTS.md)

---

## 📝 文档维护

- **核心设计文档**: 位于 `docs/guides/`
- **快速开始**: 位于 `docs/` 根目录
- **归档文档**: 位于 `docs/archive/`
- **开放规范**: 位于 `openspec/`

如果文档有不清楚的地方，请提 Issue 或 PR！
