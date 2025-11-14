# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Drizzle Solid is a TypeScript ORM adapter that brings Drizzle ORM's type-safe query builder to Solid Pod RDF data storage. It translates SQL-like operations into SPARQL queries and provides a familiar Drizzle API for working with decentralized Solid data.

## Development Commands

### Build and Test
```bash
npm run build          # Compile TypeScript to dist/
npm run test           # Run all Jest tests
npm run test:watch     # Run tests in watch mode
npm run test:coverage  # Run tests with coverage report
npm run lint           # ESLint check on src/**/*.ts
npm run lint:fix       # Auto-fix linting issues
npm run quality        # Run lint + test (CI pipeline)
```

### Development and Examples
```bash
npm run dev                    # Run main entry point with ts-node
npm run example:setup          # Pod setup and creation tutorial
npm run example:auth           # Authentication and session reuse demo
npm run example:usage          # Basic CRUD operations walkthrough
npm run server:start           # Start local Community Solid Server
npm run server:setup           # Create preset test accounts
```

### Testing Infrastructure
```bash
npm run server:start:sandbox   # CSS server in sandboxed mode
npm run clean:only            # Clean test data
npm run test:sparql           # Test native SPARQL execution
```

## Architecture Overview

### Core Components

**PodDialect** (`src/core/pod-dialect.ts`)
- Main Drizzle dialect implementation for Solid Pods
- Handles session management and Pod discovery
- Orchestrates query conversion and execution
- Manages resource containers and TypeIndex integration

**AST-to-SPARQL Conversion** (`src/core/ast-to-sparql.ts`, `src/core/ast-to-sparql-v2.ts`)
- Converts Drizzle SQL AST to SPARQL queries using sparqljs
- Handles SELECT, INSERT, UPDATE, DELETE operations
- Supports complex WHERE conditions, JOINs, aggregations
- Implements fallback strategies for unsupported operations

**SPARQL Execution** (`src/core/sparql-executor.ts`)
- Wraps Comunica engine for Pod queries
- Handles PATCH operations for updates/deletes
- Implements client-side aggregation fallback when CSS/Comunica lacks support
- Manages authentication and fetch integration

**Pod Table System** (`src/core/pod-table.ts`)
- Defines table schemas with RDF predicate mappings
- Supports standard types: string, int, bool, date, json, object
- Configurable namespaces and custom RDF classes
- TypeScript inference for table operations

**Type Safety** (`src/core/compile-time-types.ts`, `src/core/zod-integration.ts`)
- Compile-time type checking with Drizzle patterns
- Runtime validation via Zod schemas
- Type inference for insert/update/select operations

**Conflict Resolution** (`src/core/conflict-resolution.ts`)
- Handles concurrent write conflicts (412 Precondition Failed errors)
- Automatic retry with exponential backoff
- Multiple merge strategies: last-write-wins, field-level-merge, timestamp-based, user-resolution
- Leverages Solid's ETag mechanism for optimistic concurrency control

### Data Flow

1. **Query Building**: Use Drizzle query builders (select, insert, update, delete)
2. **AST Conversion**: SQL AST → SPARQL via ASTToSPARQLConverter
3. **Execution Strategy**: 
   - Simple operations → Native SPARQL via Comunica
   - Complex operations (aggregates, JOINs) → Client-side fallback after SPARQL fetch
4. **RDF Mapping**: Results mapped back to TypeScript objects via table schemas

### Testing Structure

- **Unit Tests** (`tests/unit/`): Core component testing, AST conversion, type safety
- **Integration Tests** (`tests/integration/css/`): Full CRUD operations against Community Solid Server
- **Test Configuration**: Jest with ts-jest, global setup/teardown for CSS server

### Key Dependencies

- **drizzle-orm**: Core ORM functionality and AST system
- **@comunica/query-sparql-solid**: SPARQL execution engine
- **@inrupt/solid-client**: Solid Protocol operations
- **sparqljs**: SPARQL query parsing and generation
- **n3**: RDF/Turtle parsing and serialization
- **zod**: Runtime type validation

## Development Guidelines

### When Working with Core Files

- **pod-dialect.ts**: Main integration point - handles session, discovery, and operation dispatch
- **ast-to-sparql*.ts**: Query conversion logic - test thoroughly as SPARQL generation is complex
- **sparql-executor.ts**: Execution layer - be careful with authentication and error handling
- **pod-table.ts**: Schema definitions - changes affect type inference across the codebase

### Testing Requirements

- Run `npm run test` before committing
- Integration tests require Community Solid Server - use `npm run server:start` 
- For single test files: `npm test -- --testNamePattern="your test"`
- Coverage reports available via `npm run test:coverage`

### Code Patterns

- Follow existing TypeScript strict mode patterns
- Use Drizzle-style query builders and type inference
- RDF operations should use established predicate mappings
- Error handling should distinguish between network, auth, and data validation issues

## Example Usage Patterns

See `examples/` directory for complete walkthroughs:
- `01-server-setup.ts`: Pod creation and server setup
- `02-authentication.ts`: Session management patterns
- `03-basic-usage.ts`: CRUD operations and query examples

### Handling Concurrent Write Conflicts

When multiple applications (or multiple instances of the same application) write to the same Solid resource simultaneously, 412 Precondition Failed errors can occur. The `ConflictResolver` handles these conflicts automatically.

#### Basic Usage - Automatic Retry

```typescript
import { getSolidDataset, setThing, buildThing } from '@inrupt/solid-client';
import { saveWithConflictResolution } from 'drizzle-solid';

// Simple retry with default settings (last-write-wins, 3 retries)
const result = await saveWithConflictResolution(
  session.fetch,
  'https://pod.example/data/notes.ttl',
  async (dataset) => {
    const thing = buildThing(createThing({ name: 'note1' }))
      .addStringNoLocale('https://schema.org/name', 'My Note')
      .addStringNoLocale('https://schema.org/description', 'Updated content')
      .build();

    return setThing(dataset, thing);
  }
);

if (result.success) {
  console.log(`Saved after ${result.retries} retries`);
} else {
  console.error(`Failed: ${result.error}`);
}
```

#### Advanced Usage - Field-Level Merge

```typescript
import { ConflictResolver } from 'drizzle-solid';

// Create resolver with field-level merge strategy
const resolver = new ConflictResolver(session.fetch, {
  strategy: 'field-level-merge',
  maxRetries: 5,
  retryDelay: 100,
  logging: true
});

// Save specific Thing with merge
const localThing = buildThing(createThing({ url: noteUrl }))
  .addStringNoLocale('https://schema.org/name', 'Updated Title')
  .addDatetime('https://schema.org/dateModified', new Date())
  .build();

const result = await resolver.saveThingWithMerge(
  'https://pod.example/data/notes.ttl',
  noteUrl,
  localThing,
  [
    'https://schema.org/name',
    'https://schema.org/dateModified'
  ]
);
```

#### Timestamp-Based Merge

```typescript
// Automatically choose the most recent version based on dateModified
const resolver = new ConflictResolver(session.fetch, {
  strategy: 'timestamp-based',
  maxRetries: 3
});

await resolver.saveThingWithMerge(
  resourceUrl,
  thingUrl,
  updatedThing,
  predicates
);
```

#### Custom Merge Strategy

```typescript
// Define custom conflict resolution logic
const resolver = new ConflictResolver(session.fetch, {
  strategy: 'user-resolution',
  resolver: (local, remote, predicates) => {
    // Custom logic: merge arrays, keep highest numeric values, etc.
    return buildThing(remote)
      .addStringNoLocale('https://schema.org/name',
        getStringNoLocale(local, 'https://schema.org/name'))
      .build();
  }
});
```

### Merge Strategies Explained

1. **last-write-wins** (default): Your local changes completely overwrite the remote version. Simple but may lose concurrent modifications from other apps.

2. **field-level-merge**: Only updates the predicates you specify, preserving other fields from the remote version. Best for selective updates when multiple apps modify different fields.

3. **timestamp-based**: Compares `dateModified` timestamps and keeps the most recent version. Useful when temporal ordering matters.

4. **user-resolution**: Provide a custom function to merge conflicts according to your application's business logic.