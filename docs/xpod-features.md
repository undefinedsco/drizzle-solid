# xpod Features

`xpod` 是 `drizzle-solid` 的推荐开发/运行时目标之一，因为它在同进程体验、SPARQL pushdown 和本地开发摩擦上更友好。

## 为什么它更适合本地开发

- 更适合进程内启动和测试隔离
- 更容易复用同一套 SPARQL / Pod runtime 依赖
- 对 `drizzle-solid` 的 SPARQL 路径支持更强

## 在同进程里复用 xpod 的 SPARQL 引擎

```ts
import { createRequire } from 'node:module';
import {
  pod,
  createNodeModuleSparqlEngineFactory,
} from '@undefineds.co/drizzle-solid';

const requireFromHere = createRequire(import.meta.url);

const client = pod(session, {
  sparql: {
    createQueryEngine: createNodeModuleSparqlEngineFactory(
      requireFromHere.resolve('@undefineds.co/xpod/package.json')
    ),
  },
});
```

## 什么时候会用 Drizzle-shaped surface

如果你在 `xpod` 上跑已有 builder / read-facade 代码，仍然可以：

```ts
const db = client.asDrizzle();
```

但主线应用代码依然建议围绕：

- `client.collection()`
- `client.entity()`
- `client.discovery`
- `client.sparql()`

## 兼容口径

当前官方支持的 `@comunica/query-sparql-solid` 版本是 `4.x`。

如果宿主已经内置了这份依赖，不建议在应用里再装第二份。
