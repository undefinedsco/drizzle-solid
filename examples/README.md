# Drizzle Solid Examples

This folder hosts the canonical end-to-end walkthroughs referenced in the docs. Each script assumes you have installed dependencies (`yarn install`) and configured credentials via environment variables.

## Example lineup
- `01-quick-start.ts`: Quick start demo with basic CRUD operations.
- `02-relational-query.ts`: Demonstrates relational queries with `db.query` API.
- `03-zero-config-discovery.ts`: Zero-config access using SAI auto-discovery (Bob reads Alice's shared data without knowing URLs).
- `04-notifications.ts`: Real-time notifications using Solid Notifications Protocol (WebSocket/SSE).
- `05-data-discovery.ts`: Comprehensive data discovery API examples:
  - Basic discovery with `db.discovery.discover()`
  - Filtering by appId
  - Listing all registrations with `db.discovery.discoverAll()`
  - Shape selection in `db.locationToTable()`
  - One-step discover and create tables
  - Cross-Pod discovery
  - Multi-Shape scenario explanation
- `06-federated-query.ts`: Federated queries across multiple Pods.
- `07-hooks-and-profile.ts`: Using hooks and profile management.
- `08-iri-based-operations.ts`: IRI-level operations for single entity queries and subscriptions:
  - `db.findByIri()` - Query by complete IRI (local or remote)
  - `db.subscribeByIri()` - Subscribe to a single entity's changes
  - `db.updateByIri()` - Update by IRI
  - `db.deleteByIri()` - Delete by IRI

### Utility files
- `setup.ts`: Common setup utilities (used by tests).
- `utils/sai-helpers.ts`: SAI environment setup helpers (used by tests).

## Key Concepts

### IRI-based Operations
For single-entity operations (detail pages, viewing shared resources), use the `*ByIri` methods:

```typescript
// Query by IRI - works for both local and remote Pods
const profile = await db.findByIri(profileTable, 'https://alice.pod/profile/card#me');

// Subscribe to changes on a specific entity
const unsubscribe = await db.subscribeByIri(profileTable, iri, {
  onUpdate: (data) => console.log('Updated:', data),
  onDelete: () => console.log('Deleted'),
  onError: (error) => console.error(error)
});

// Update by IRI
await db.updateByIri(agentTable, iri, { name: 'New Name' });

// Delete by IRI
await db.deleteByIri(agentTable, iri);
```

Note: Using `@id` directly in `where()` conditions is no longer supported. Use `*ByIri` methods instead.

### Data Discovery
Data discovery allows apps to find data locations dynamically instead of hardcoding paths.

```typescript
// Discover all Person data locations
const locations = await db.discovery.discover('https://schema.org/Person');

// Each location has:
// - container: the data storage URL (primary key)
// - shapes: array of Shape definitions from different apps
// - source: 'typeindex' | 'interop' | 'config'
```

### Shape Selection
When a container has multiple Shapes (from different apps), you can choose which one to use:

```typescript
// Use first available Shape (default)
const table = await db.locationToTable(location);

// Select by appId
const table = await db.locationToTable(location, { 
  appId: 'https://acme.com/app#id' 
});

// Select by Shape URL or object
const table = await db.locationToTable(location, { 
  shape: 'https://shapes.example/Person.shacl' 
});
```

## Running
```bash
yarn example:setup      # launches CSS and seeds pods
yarn example:auth       # runs authentication example
yarn example:usage      # runs basic usage example
yarn example:notify     # runs 04-notifications.ts
yarn example:discovery  # runs 05-data-discovery.ts
```

Make sure `yarn server:start` (Community Solid Server) is running in another terminal before invoking the examples.
