# Drizzle-Solid Architecture Design & Implementation Record

> Version: 0.2.0 (Implemented)
> Date: 2025-11-30
> Status: Phase 1 Completed / Phase 2 Planned

## 1. Implementation Summary (v0.2.0)

### 1.1 Key Achievements
1.  ✅ **Separation of Concerns**: Split `PodDialect` into modular components: `SubjectResolver`, `TripleBuilder`, `DataDiscovery`, and `LdpExecutor`.
2.  ✅ **Unified Handling**: Centralized handlers for special column types (`inline`, `inverse`, `array`, `uri`).
3.  ✅ **Robust Execution**: Implemented a stable Read-Modify-Write strategy for LDP operations to handle CSS concurrency issues.
4.  ✅ **Extensibility**: `DataDiscovery` interface prepares the ground for future Interop Spec support.

### 1.2 Core Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         PodSession                               │
│  (Facade - Unified Entry Point)                                  │
└─────────────────────────────────────────────────────────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
┌───────────────┐      ┌─────────────────┐      ┌─────────────────┐
│ DataDiscovery │      │ SubjectResolver │      │  TripleBuilder  │
│ (Discovery)   │      │ (URI Gen)       │      │  (RDF Gen)      │
└───────────────┘      └─────────────────┘      └─────────────────┘
        │                        │                        │
        ▼                        ▼                        ▼
┌───────────────┐      ┌─────────────────┐      ┌─────────────────┐
│ TypeIndex     │      │ TemplateResolver│      │ ColumnHandlers  │
│ (Implemented) │      │ (Implemented)   │      │ (Implemented)   │
├───────────────┤      └─────────────────┘      ├─────────────────┤
│ InteropSpec   │                               │ - InlineHandler │
│ (Planned)     │                               │ - InverseHandler│
└───────────────┘                               │ - ArrayHandler  │
                                                │ - UriHandler    │
                                                └─────────────────┘
        │
        ▼
┌───────────────┐
│ LdpExecutor   │
│ (Execution)   │
└───────────────┘
```

## 2. Implementation Decision Records (ADR)

### 2.1 Decision: PUT over PATCH for Updates
During integration testing with Community Solid Server (CSS), `N3 Patch` proved unreliable for `DELETE` operations involving literals (due to strict matching of `xsd:integer` shorthand vs canonical forms) and caused data duplication.
**Decision**: We implemented `applyByPut` in `LdpExecutor`. It fetches the full resource, modifies the triple set in memory, and overwrites the resource using `PUT`. This guarantees state consistency.

### 2.2 Decision: Explicit Integer Typing
To minimize ambiguity between client and server, `TripleBuilder` and `LdpExecutor` now enforce explicit `xsd:integer` typing for numbers, or handle shorthand strictly where appropriate.

### 2.3 Decision: Cache Invalidation
`Comunica` caching was aggressive, leading to stale reads after writes. We added explicit `invalidateHttpCache` calls in `LdpExecutor` before Read-Modify-Write cycles and after successful writes.

## 3. Future Roadmap

### 3.1 Phase 1.4: ShapeManager (Planned)
- Goal: Generate SHACL Shape files from `PodTable` definitions.
- Status: Design exists, implementation pending.

### 3.2 Phase 2: Interop Spec (Planned)
- Goal: Support Solid Application Interoperability specification.
- Path: Implement `InteropDiscovery` implementing `DataDiscovery` interface.

### 3.3 Cleanup: Deprecate Hardcoded Default Predicates
- **Issue**: `ASTToSPARQLConverter` currently maintains a hardcoded list of `defaultPredicates` (e.g., mapping 'name' to `foaf:name`). This is an anti-pattern.
- **Goal**: Remove `defaultPredicates` and force explicit predicate definition or use a standard `vocab` library.
- **Action**: Deprecate current usage, warn users, and eventually remove in v0.3.0.

---

# Appendix: Original Design Proposal (Reference)

> The following content is the original design proposal (v0.2.0-draft). Most of the interfaces defined below have been implemented in the `src/core/` directory.

## 1. Background & Objectives

### 1.1 Problems Solved
1. **God Class**: `pod-dialect.ts` was overloaded.
2. **Code Duplication**: Logic for inline objects was scattered.
3. **ID/Fragment Issues**: Fixed default `subjectTemplate` behavior.
4. **Extensibility**: Added `DataDiscovery` layer.

## 2. Core Interface Definitions (Reference)

### 2.1 DataDiscovery (Implemented)

```typescript
// src/core/discovery/types.ts

interface DataLocation {
  container: string;
  subjectPattern?: string;
  shape?: string;
  source: 'typeindex' | 'interop';
}

interface DataDiscovery {
  register(table: PodTable): Promise<void>;
  discover(rdfClass: string): Promise<DataLocation[]>;
  isRegistered(rdfClass: string): Promise<boolean>;
}
```

### 2.2 SubjectResolver (Implemented)

```typescript
// src/core/subject/types.ts

type ResourceMode = 'document' | 'fragment';

interface SubjectResolver {
  resolve(table: PodTable, record: Record<string, any>, index?: number): string;
  parse(uri: string, table: PodTable): ParsedSubject | null;
  getResourceUrl(subjectUri: string): string;
  getResourceMode(table: PodTable): ResourceMode;
}
```

### 2.3 TripleBuilder (Implemented)

```typescript
// src/core/triple/types.ts

interface TripleBuilder {
  buildInsert(subject: string, column: PodColumn, value: any, table: PodTable): BuildResult;
  buildDelete(subject: string, column: PodColumn, table: PodTable): BuildResult;
  toN3Strings(triples: Triple[]): string[];
  buildN3Patch(deleteTriples: string[], insertTriples: string[]): string;
}
```

### 2.4 ShapeManager (Planned)

```typescript
// src/core/shape/types.ts

interface ShapeManager {
  generateShape(table: PodTable): Shape;
  toSHACL(shape: Shape): string;
  saveShape(shape: Shape, location: string): Promise<void>;
  validate(data: Record<string, any>, shape: Shape): ValidationResult;
}
```

## 3. URI Pattern Design (Implemented)

### 3.1 Resource Modes

| Mode | Example URI | Characteristics |
|------|-------------|-----------------|
| **document** | `/data/users/alice.ttl` | One file per record. Inferred from base ending in `/`. |
| **fragment** | `/data/users.ttl#alice` | Shared file. Inferred from base ending in `.ttl`. |

### 3.2 Subject Pattern Logic

- **Default**: `{id}` (fragment mode) or `{id}.ttl` (document mode).
- **Variables**: `{id}`, `{yyyy}`, `{mm}`, `{dd}`, `{timestamp}`.
- **Singleton**: `#me` (fixed fragment).

## 4. References

- [Solid TypeIndex](https://solid.github.io/type-indexes/)
- [Solid Application Interoperability](https://solid.github.io/data-interoperability-panel/specification/)
- [SHACL](https://www.w3.org/TR/shacl/)
- [Community Solid Server Issues](docs/investigations/css-issues-report.md)