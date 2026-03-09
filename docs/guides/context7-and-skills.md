# Context7 与 Skills

这份文档定义 `drizzle-solid` 在 Context7 上的公开分发口径，以及后续 public skills 的维护方式。

## 当前状态

今天已经稳定存在的是 **Context7 Library**，不是 public skills。

已公开同步的内容：

- `README.md`
- `docs/`
- `examples/`

同步入口：

- `.github/workflows/context7-sync.yml`

当前 workflow 做的是：

- 对 `main` 上的 `README.md` / `docs/**` / `examples/**` 变更执行 `refresh`
- 使用 `/undefinedsco/drizzle-solid` 作为 Context7 library 标识

注意：

- 如果 Context7 上还没有首次注册的 library 页面，需要先在 Context7 UI 中手动 `Add Library`
- 仓库里的本地 `SKILL.md` / agent instructions **不会自动进入 Context7 Library**

## 公开内容的唯一来源

对外口径必须只有一套 canonical source。

### 文档 canonical source

- `README.md`
- `docs/guides/`
- `docs/api/`
- `examples/`

### 示例 canonical source

- `examples/manifest.json`
- `tests/integration/css/examples-verification.test.ts`

### 问题处理 canonical source

- `docs/guides/issue-handling.md`
- GitHub Issues

## Skills 的定位

Context7 的 `Library` 和 `Skills` 不是一回事：

- `Library`：文档、API、示例、概念说明
- `Skills`：给 AI 助手安装的可复用能力包 / 工作流 / 决策准则

对 `drizzle-solid` 来说，适合做成 public skills 的内容包括：

- Solid / RDF 建模准则
- `drizzle-orm` → `drizzle-solid` 迁移套路
- Pod 布局设计（`base` / `subjectTemplate` / IRI）
- 测试与 examples 维护流程

当前结论：

- 先把 `Context7 Library` 维护稳定
- 再发布一组 **公开、稳定、面向外部用户** 的 skills
- 不把本地内部 agent 指令原样公开，而是提炼成对外版本

## 问题如何回流

来自外部项目、Context7 Library、未来 public skills 的新问题，统一回流到当前仓库的 **GitHub Issues**。

原则：

- `Issues` 是唯一的长期归档入口
- 不把问题散落在聊天记录、Context7 评论区、多个仓库里
- 一旦确认是可复现的问题、缺失的指导、错误的样例或不清晰的建模口径，就创建 issue

适合走 issue 的情况：

- 文档说法与实际 API 不一致
- Context7 页面内容过时或缺关键步骤
- example 不可运行或不可验证
- 建模准则不清晰，导致 agent / 用户反复犯同类错误
- 未来 public skills 的默认决策不合理
- 迁移指南缺失关键场景

## 推荐 issue 分类

建议使用以下标签进行分流：

- `area:docs`
- `area:skills`
- `area:modeling`
- `area:migration`
- `area:examples`
- `type:bug`
- `type:missing-guidance`
- `type:feature-request`

这些标签不是单独维护一套产品，而是帮助把 **文档 / skills / examples / API** 的问题重新沉淀回同一个仓库。

## 外部反馈处理流程

1. 用户在外部项目里使用 `drizzle-solid` 文档或未来 public skills
2. 遇到不清晰、错误或缺失的指导
3. 在当前仓库提交 issue
4. 维护者判断问题落点：
   - 文档
   - example
   - 测试
   - skill
   - 实现/API
5. 修复后同步更新对应材料
6. 由 Context7 workflow 自动 refresh 文档侧内容

## 维护规则

### 1. skills 不能脱离文档单独演化

public skills 的规则，必须来自公开文档和稳定 API，而不是只存在于内部记忆里。

### 2. examples 是对外承诺的一部分

如果 public skill 推荐某种写法，对应 example 和验证测试必须存在。

### 3. 文档修复优先沉淀为仓库资产

一次外部反馈最终至少应落成以下之一：

- 文档补充
- example 补充
- 回归测试
- 新 issue / 决策记录
- public skill 更新

## 下一步计划

在 `Context7 Library` 稳定后，优先规划以下 public skills：

- `solid-modeling`
- `drizzle-solid-migration`
- `pod-layout-design`
- `drizzle-solid-testing`

在这些 skills 发布前，所有对外问题仍以仓库文档和 GitHub Issues 为准。
