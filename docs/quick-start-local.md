# 本地环境快速开始指南

本指南演示如何在本地使用 Community Solid Server（CSS）运行 Drizzle Solid 示例与集成测试。

## 前置条件
- Node.js 18+ 与 npm
- 已执行 `npm install`
- `.env.local` 中配置 `SOLID_CLIENT_ID`、`SOLID_CLIENT_SECRET`、`SOLID_OIDC_ISSUER`（由 `npm run server:setup` 自动生成）

## 一键演示

```bash
npm run example:setup   # 初始化 CSS、预设账户与 .env.local
npm run server:start    # 在独立终端保持运行
npm run example:auth    # 验证认证流程
npm run example:usage   # 运行 CRUD 示例
```

> `npm run example:setup` 可重复执行；它会在 `solid-server-data/` 下同步配置并刷新凭证。

## 示例概览

| 脚本 | 作用 |
| --- | --- |
| `examples/01-server-setup.ts` | 下载/校验 CSS 构建，写入预设账户与环境变量 |
| `examples/02-authentication.ts` | 使用客户端凭证登录，打印访问令牌和 Pod 元数据 |
| `examples/03-basic-usage.ts` | 定义表结构、执行 CRUD、演示条件查询与聚合回放 |

运行 `npm run example:usage` 时，可看到：
- 预期 Pod 容器与 Turtle 资源的创建日志
- 插入/查询/更新/删除的 SPARQL 输出
- 复杂条件、聚合与 JOIN 的本地回放结果

## 预设账户

| 用户 | 邮箱 | 密码 | WebID |
| --- | --- | --- | --- |
| Alice | alice@example.com | alice123 | http://localhost:3001/alice/profile/card#me |
| Bob | bob@example.com | bob123 | http://localhost:3001/bob/profile/card#me |

凭证位于 `config/preset-accounts.json`，`server:setup` 会基于此文件生成 `.env.local`。

## 常见问题

| 现象 | 处理建议 |
| --- | --- |
| `npm run server:start` 卡住或报错 | 确认 3001 端口未被占用；必要时执行 `lsof -i :3001` 并结束旧进程 |
| 认证脚本返回 401 | `.env.local` 未生成或凭证已失效，重新运行 `npm run example:setup` |
| CRUD 示例删除/更新无效 | CSS 正常行为：先确认容器存在，可运行 `npm run example:setup` 或手动调用 `ensureContainer` |

## 后续步骤
- 阅读 `docs/guides/authentication.md` 深入了解会话管理
- 参考 `tests/integration/css/drizzle-crud.test.ts` 编写自定义集成测试
- 完成改动后运行 `npm run quality` 确认 lint 与测试均通过
