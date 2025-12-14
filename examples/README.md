# Drizzle Solid Examples

This folder hosts the canonical end-to-end walkthroughs referenced in the docs. Each script assumes you have installed dependencies (`yarn install`) and configured credentials via environment variables.

## Example lineup
- `01-quick-start.ts`: Quick start demo with basic CRUD operations.
- `02-relational-query.ts`: Demonstrates relational queries with `db.query` API.
- `03-zero-config-discovery.ts`: Zero-config access using SAI auto-discovery (Bob reads Alice's shared data without knowing URLs).
- `04-notifications.ts`: Real-time notifications using Solid Notifications Protocol (WebSocket/SSE).
- `05-data-discovery.ts`: Comprehensive data discovery API examples:
  - Basic discovery with `db.discover()`
  - Filtering by appId
  - Listing all registrations with `db.discoverAll()`
  - Shape selection in `db.locationToTable()`
  - One-step discover and create tables
  - Cross-Pod discovery
  - Multi-Shape scenario explanation

### Utility files
- `setup.ts`: Common setup utilities.
- `utils/auth.ts`: Authentication helpers.
- `utils/sai-helpers.ts`: SAI environment setup helpers.

## Key Concepts

### Data Discovery
Data discovery allows apps to find data locations dynamically instead of hardcoding paths.

```typescript
// Discover all Person data locations
const locations = await db.discover('https://schema.org/Person');

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
