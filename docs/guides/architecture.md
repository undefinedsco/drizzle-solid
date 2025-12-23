# Architecture Overview

This document summarizes the current code architecture and the direction for refactors.
It is intended to keep boundaries clear and make breaking changes easier to plan.

## Layers and Responsibilities

1. Public API
   - Entry points: `src/index.ts`, `src/driver.ts`, `src/solid.ts`
   - Exposes stable APIs and core types; hides internal wiring where possible.

2. Core Services (no IO)
   - Query builders, AST/SPARQL conversion, schema/shape, URI handling.
   - Expected to be deterministic and easy to test in isolation.

3. Adapters / IO
   - LDP/SPARQL execution, notifications, federated queries.
   - Owns network IO and retries.

4. Utilities
   - RDF helpers and Thing operations that stay stateless.

## Key Components

- PodDialect: Orchestrates runtime, services, and execution pipeline.
- PodRuntime: Owns session, podUrl/webId, and connection state.
- PodServices: Builds stateful helpers (resolver/shape/discovery/strategy).
- PodExecutor: Executes queries and coordinates LDP/SPARQL strategies.
- PodAsyncSession: Executes queries with lifecycle checks.
- PodDatabase: Public-facing surface area (query builders + services).

## Discovery Access

Discovery is exposed from the database instance:

```typescript
const db = drizzle(session);

// Composite discovery: TypeIndex first, SAI (Interop) fallback
const locations = await db.discovery.discover('https://schema.org/Person');
```

The discovery pipeline supports both TypeIndex and SAI (Interop) flows.

## Connection Lifecycle

`drizzle()` constructs the database instance without forcing a network preflight by default.
Call `await db.connect()` if you want a proactive Pod check, or pass `{ autoConnect: true }`
to `drizzle()` to preserve eager connect behavior. Otherwise the first query will connect
lazy via `PodExecutor`.

## Refactor Direction (Breaking Change Friendly)

### Phase A: Remove mutable singletons

Goal: eliminate cross-instance state leakage.

- Replace module-level singletons with per-instance services.
- Ensure all stateful utilities are constructed inside `PodDialect` (or injected).
- Deprecate legacy `subjectResolver` path and consolidate on `uriResolver`.

Targets:
- `src/core/subject/*` -> remove or thin compatibility wrapper.
- `src/core/uri/resolver.ts` -> stop using module-level instance.
- `src/core/discovery/provider-cache.ts` -> avoid shared global cache.

Status:
- Core services now use per-instance `UriResolver` injected from `PodDialect`.
- `subjectResolver`/`uriResolver` singleton exports have been removed from public API.
- `providerCache` singleton export has been removed; use `new ProviderCache()` instead.

### Phase B: Split PodDialect responsibilities

Goal: turn `PodDialect` into a thin orchestrator.

Proposed split:
- `PodRuntime` (connection/session, podUrl/webId, fetch)
- `PodServices` (resolver/shape/discovery/strategy)
- `PodExecutor` (SPARQL + LDP execution pipeline)

Status:
- `PodRuntime`, `PodServices`, and `PodExecutor` are introduced and wired into `PodDialect`.

### Phase C: Public API consolidation

Goal: narrow the exported surface while preserving discovery access.

- Keep `db.discovery` as the primary entry point for discovery.
- Avoid exporting implementation classes unless required for advanced use.
- Maintain TypeIndex + SAI (Interop) support through the composite pipeline.

These steps help avoid cross-instance state leakage and reduce coupling.

Status:
- Internal implementation classes are no longer exported from `src/index.ts`.
- Discovery remains accessible via `db.discovery` (TypeIndex + SAI composite).
