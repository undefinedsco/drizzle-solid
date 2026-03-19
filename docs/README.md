# drizzle-solid 文档索引

## 快速入口
- `README.md`：项目定位、能力边界、安装概览
- `docs/guides/installation.md`：安装、认证、SPARQL 引擎装配
- `docs/quick-start-local.md`：本地 CSS / xpod 开发路径
- `docs/api/README.md`：当前公共 API 参考

## 核心指南
- `docs/guides/concepts.md`：Solid / Pod / subjectTemplate 基础概念
- `docs/guides/authentication.md`：认证与 Session 使用方式
- `docs/guides/multi-variable-templates.md`：多变量模板与确定性 mutation 语义
- `docs/guides/data-discovery.md`：数据发现与互操作能力
- `docs/guides/testing.md`：测试唯一正式口径；测试分层、examples、parity、execution-path 护栏
- `docs/guides/issue-handling.md`：Issue 复现、修复、回归流程
- `docs/guides/decisions/README.md`：决策记录与建模/支持边界模板
- `docs/guides/decisions/0001-keep-exact-target-paths-exact.md`：全局执行语义原则
- `docs/guides/decisions/0002-require-complete-join-locator-for-multi-variable-templates.md`：join 特例决策

## xpod 与服务能力
- `docs/xpod-features.md`：xpod 能力矩阵、sidecar SPARQL、迁移建议
- `docs/guides/css-notifications.md`：Solid Notifications 设计与实现细节
- `docs/federated-queries.md`：联邦查询说明

## 执行与路线
- `ACTION-PLAN.md`：测试 / parity backlog 与执行记录，不是测试规范
- `docs/PROGRESS.md`：阶段性进展
- `docs/designs/drizzle-to-sparql.md`：Drizzle → SPARQL 转换设计
- `docs/designs/xpod-architecture-v2.md`：xpod 相关架构设计
- `docs/designs/drizzle-solid-v2-roadmap.md`：中长期路线图

## 历史材料
- `docs/archive/`：历史调研与废弃设计文档
- `docs/TEST-STRATEGY.md`：早期测试矩阵设计，仅供背景参考
- `docs/TEST-DIMENSIONS-COMPLETE.md`：扩展测试维度分析，仅供背景参考
- `FINAL-SUMMARY.md`：历史性测试总结，仅供背景参考

## 阅读顺序建议
- 新用户：`README.md` → `docs/guides/installation.md` → `docs/api/README.md`
- 做数据建模：`docs/guides/concepts.md` → `docs/guides/multi-variable-templates.md`
- 做 xpod 集成：`docs/xpod-features.md` → `docs/api/README.md`
- 做测试与发布：`docs/guides/testing.md` → `tests/fixtures/drizzle-parity/queue.json` → `ACTION-PLAN.md`
