# Architecture Overview

This document summarizes the current `drizzle-solid` architecture.

## Public API layers

### 1. Constructors

- `pod(session, config?)`
- `drizzle(session, config?)`

它们共享同一底层运行时，只是 API 组织方式不同。仓库文档与 examples 默认先展示 `pod()` 这一层的语义组织。

### 2. Semantic-first façade

- `PodClient`
- `PodCollection`
- `PodEntity`

这层更强调：

- collection-oriented reads
- exact entity targets
- runtime binding semantics

### 3. Drizzle-shaped core

- `PodDatabase`
- builder APIs: `select / insert / update / delete`
- `db.query.*` read facade
- discovery / federation / SPARQL services

## Core runtime pieces

- `PodDialect`: orchestrates runtime, services, and execution
- `PodRuntime`: owns session, pod URL / webId, and connection state
- `PodExecutor`: coordinates LDP/SPARQL execution strategies
- `PodDatabase`: Drizzle-aligned public surface + services
- `PodClient`: semantic façade over `PodDatabase`

## Discovery access

如果你用 `pod()`：

```ts
const client = pod(session);
const locations = await client.discovery.discover('https://schema.org/Person');
```

如果你保持 `drizzle()`：

```ts
const db = drizzle(session);
const locations = await db.discovery.discover('https://schema.org/Person');
```

## Connection lifecycle

`pod(session)` and `drizzle(session)` both construct clients lazily.

- use `connect()` when you want an eager Pod check
- use `init(table)` when your app owns storage and needs bootstrap
- otherwise the first real operation connects through the execution pipeline

## Key takeaway

The architectural split is about **API organization**, not about changing the underlying runtime model. New docs/examples simply default to the semantic-first surface.

真正的变化重点仍然是：

- resource placement
- IRI identity
- read vs write semantics
- SPARQL-native escape hatches
