# Issue Triage Guide

如果 `drizzle-solid` 要作为文档、examples、未来 public skills 的权威中心，那么所有外部反馈都必须先被正确分型。

这份文档定义：

- 新问题进入仓库时如何判断归属
- 什么属于代码问题、文档问题、工具问题
- 每一类问题最终需要沉淀成什么仓库资产
- 哪个 issue 模板应该被使用

## 两个维度

每个 issue 都至少要有两个维度：

### 1. `kind`：问题归属

这是“谁负责修”的主轴。

- `kind:code`：库行为、API、查询、类型、运行时语义有问题
- `kind:docs`：README / guides / examples / migration / skills guidance 不清晰、缺失或错误
- `kind:tooling`：安装、脚本、CI、发布、Context7 同步、xpod/CSS 本地开发体验有问题
- `kind:decision`：不是直接 bug，而是产品口径、建模准则、支持范围需要明确决策

### 2. `area`：问题落点

这是“问题发生在哪一块”的辅轴。

建议使用：

- `area:core-api`
- `area:query`
- `area:modeling`
- `area:migration`
- `area:examples`
- `area:docs`
- `area:skills`
- `area:tooling`
- `area:testing`
- `area:context7`

## 四类问题怎么判断

### `kind:code`

满足以下任一条件，优先归到代码问题：

- 文档承诺了某个行为，但实际 API / runtime 不按这个行为工作
- 同样输入下，库返回错误结果、抛错、类型错误或不兼容行为
- query builder、IRI 解析、link 语义、写操作目标解析等核心行为有偏差
- regression 重新出现

典型例子：

- `entity(table, iri).update()` 行为不正确
- `returning()` 返回形状不符合当前公开口径
- `link()` 字段在某种场景下解析失败
- `where` / `select` / `insert` / `update` 与当前支持范围不一致

必须沉淀的资产：

- 回归测试
- 必要的实现修复
- 如果用户可见，再补文档或 example

### `kind:docs`

满足以下任一条件，优先归到文档问题：

- API 本身没坏，但用户无法从 README / guides / examples 正确用出来
- Context7 页面内容过时、不清楚、缺少关键前置条件
- example 讲法和当前主口径不一致
- 迁移指南缺少关键解释
- 未来 public skills 的规则没有公开文档依据

典型例子：

- 文档没解释为什么写操作要用 exact-target / IRI
- README 还在讲旧入口，example 已经改成新入口
- Context7 缺少 `@comunica/query-sparql-solid` 的安装说明

必须沉淀的资产：

- README / docs 更新
- 如有必要，example 更新
- 如果 example 对外承诺变了，还要补验证

### `kind:tooling`

满足以下任一条件，优先归到工具问题：

- 安装、脚本、workflow、CI、发布流程、验证流程不稳定
- 本地开发环境过重或不可用
- xpod / CSS / Context7 同步 / examples 验证链路出问题
- 问题不在业务 API，而在工程支撑层

典型例子：

- `Context7` workflow 参数错误
- `examples:check` 和实际 example 覆盖关系失真
- 本地测试 runtime 起不来
- release workflow 和版本规则不一致

必须沉淀的资产：

- workflow / script / config 修复
- 必要的文档说明
- 若可能，增加自动校验防回归

### `kind:decision`

满足以下任一条件，优先归到决策问题：

- 用户想要的不是明确 bug 修复，而是支持边界澄清
- 存在多种合理行为，需要产品口径统一
- 涉及 Drizzle 兼容范围、Solid 建模语义、raw SQL/SPARQL 支持边界等
- 需要先决定“应不应该支持”，再决定“怎么做”

典型例子：

- `having` 要不要支持
- `toSQL()` 是否保留
- 是否允许隐式扫描式 updateMany/deleteMany
- public skills 是否应该默认建议某种建模方案

必须沉淀的资产：

- 决策记录或文档结论
- 若决定支持，再拆成代码 / docs / tooling 工作
- 若决定不支持，也要更新迁移文档与错误提示口径

## 快速判断表

| 现象 | 优先归属 |
| --- | --- |
| 行为错了、结果错了、类型错了 | `kind:code` |
| 行为没错，但用户很难用对 | `kind:docs` |
| 脚本、CI、安装、同步、发布坏了 | `kind:tooling` |
| 先要决定是否支持/怎么定义语义 | `kind:decision` |

## 一个问题可以有多个标签，但只能有一个主归属

例如：

- 文档误导导致用户用错，但库本身也缺少清晰报错
  - 主归属：`kind:code`
  - 次标签：`area:docs`
- Context7 页面过时，是因为 README 没更新
  - 主归属：`kind:docs`
  - 次标签：`area:context7`
- xpod 本地 runtime 起不来，README 也没讲清楚
  - 主归属：`kind:tooling`
  - 次标签：`area:docs`

规则：

- 先找最需要动手修复的根问题
- 其他影响面用 `area` 或补充说明表达

## 模板选择

目前推荐这样选择 issue 模板：

- 运行时/API/类型/查询行为错误 → `Runtime / API Bug`
- README / guides / examples / Context7 / skills guidance 问题 → `Skills / Guidance Feedback`
- 安装、脚本、workflow、CI、发布、Context7 同步、开发环境问题 → `Tooling / Environment Problem`

如果用户不确定：

- 先提交也可以
- 维护者在 triage 时负责重分类

## 关闭条件

### 代码问题

必须有：

- 回归测试或可验证修复
- 受影响文档同步（如用户可见）

### 文档问题

必须有：

- 文档更新
- 如涉及 example，对应 example 和验证也要更新

### 工具问题

必须有：

- workflow / script / config 修复
- 至少一次成功验证

### 决策问题

必须有：

- 清晰结论
- 文档化的支持边界
- 若需要，再拆出后续 issue

## 维护建议

作为权威中心，仓库不应该只“修 bug”，还要保证每个 issue 最终变成一种稳定资产：

- 代码
- 测试
- 文档
- example
- workflow
- 决策记录
- future public skill 更新

如果一个 issue 关闭后没有留下任何稳定资产，说明 triage 质量还不够。
