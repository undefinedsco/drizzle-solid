# Federated Queries

联邦查询是高级读取能力。

推荐入口：

- `const client = pod(session, { schema })`
- `client.query.*` 作为 Drizzle-shaped 读 surface
- `client.getLastFederatedErrors()` 读取最近一次联邦错误
- `FederatedQueryExecutor` 做更底层、更可控的执行

## 关系式联邦读取

```ts
const client = pod(session, { schema: { friends, friendsRelations } });

const results = await client.query.friends.findMany({
  with: {
    posts: true,
  },
});

const errors = client.getLastFederatedErrors();
```

这类查询适合：

- 从本地数据中拿到 WebID / 远端入口
- 再基于 discover 规则去远端 Pod 拉关联数据

## 直接使用执行器

```ts
import { FederatedQueryExecutor } from '@undefineds.co/drizzle-solid';

const executor = new FederatedQueryExecutor({
  fetch: session.fetch,
  timeout: 10000,
});
```

这样适合：

- 需要更明确的并发/超时控制
- 需要直接处理部分成功、部分失败
- 不想把流程包进 Drizzle-shaped relation surface

## 语义提醒

联邦查询本质上是跨 Pod 的图读取能力，不是 SQL 数据库里的跨库 join 等价物。

重点关注：

- 远端是否真的暴露了你可访问的数据
- discover 规则能否稳定找到目标位置
- 失败是否应当局部降级，而不是整体失败

相关 example：`examples/06-federated-query.ts`
