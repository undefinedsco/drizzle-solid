# Federated Queries

Federated queries allow you to query data across multiple Pods in a single operation. This is useful when you have a local list of users (with their WebIDs) and want to fetch related data from each user's Pod.

## Overview

In the Solid ecosystem, data is decentralized across different Pods. A federated query enables you to:

1. Query a local table (e.g., a friends list)
2. For each result, discover and fetch related data from the corresponding Pod
3. Return combined results with proper error handling

## Basic Usage

### Step 1: Define Tables

```typescript
import { podTable, string, id, relations } from 'drizzle-solid';

// Local table with WebIDs
const friends = podTable('friends', {
  id: id(),
  name: string('name').predicate('https://schema.org/name'),
  webId: string('webId').predicate('https://schema.org/identifier'),
}, {
  type: 'https://schema.org/Person',
  base: '/friends/',
});

// Remote schema (no base - discovered dynamically)
const posts = podTable('posts', {
  id: id(),
  title: string('title').predicate('https://schema.org/headline'),
  content: string('content').predicate('https://schema.org/content'),
}, {
  type: 'https://schema.org/BlogPosting',
});
```

### Step 2: Define Federated Relations

```typescript
const friendsRelations = relations(friends, ({ many }) => ({
  posts: many(posts.$schema, {
    discover: (friend) => friend.webId,
  }),
}));
```

Key points:
- Use `posts.$schema` instead of `posts` to indicate this is a federated relation
- The `discover` function extracts the WebID(s) from each parent row
- The system will automatically discover data locations using SAI or TypeIndex

### Step 3: Execute Federated Query

```typescript
const db = drizzle(session, { schema: { friends, friendsRelations } });

const results = await db.query.friends.findMany({
  with: {
    posts: true,
  },
});

// Check for errors
const errors = db.getLastFederatedErrors();
if (errors.length > 0) {
  console.log('Some queries failed:', errors);
}
```

## Direct Executor Usage

For more control, you can use `FederatedQueryExecutor` directly:

```typescript
import { FederatedQueryExecutor } from 'drizzle-solid';

const executor = new FederatedQueryExecutor({
  fetch: session.fetch,
  timeout: 30000,
});

const parentRows = [
  { id: 'alice', name: 'Alice', webId: 'https://alice.solidcommunity.net/profile/card#me' },
  { id: 'bob', name: 'Bob', webId: 'https://bob.inrupt.net/profile/card#me' },
];

const relationDef = {
  type: 'many',
  table: posts.$schema,
  isFederated: true,
  discover: (row) => row.webId,
  relationName: 'posts',
};

const result = await executor.execute(parentRows, relationDef, {
  parallel: true,
  maxConcurrency: 5,
  timeout: 30000,
});

console.log(result.data);    // Rows with posts attached
console.log(result.errors);  // Any errors that occurred
```

## Error Handling

Federated queries use GraphQL-style error handling:

```typescript
interface FederatedResult<T> {
  data: T;
  errors?: FederatedError[];
}

interface FederatedError {
  path: (string | number)[];  // e.g., [0, 'posts'] = first row's posts
  code: 'FORBIDDEN' | 'NOT_FOUND' | 'TIMEOUT' | 'NETWORK_ERROR' | 'DISCOVERY_FAILED';
  message: string;
  url?: string;
}
```

Example:

```typescript
const result = await executor.execute(parentRows, relationDef);

if (result.errors) {
  for (const error of result.errors) {
    console.log(`Error at path ${error.path.join('.')}: ${error.message}`);
    
    if (error.code === 'FORBIDDEN') {
      console.log('Access denied to:', error.url);
    }
  }
}

// Data is still available for successful queries
for (const row of result.data) {
  console.log(`${row.name} has ${row.posts.length} posts`);
}
```

## Discovery Strategy

The federated query executor uses the following discovery strategy:

1. **SAI (Solid Application Interoperability)** - Preferred
   - Checks `.well-known/solid` for `hasRegistrySet`
   - Navigates DataRegistry to find DataRegistrations matching the target type

2. **TypeIndex** - Fallback
   - Checks `.well-known/solid` for `publicTypeIndex`
   - Finds TypeRegistration matching the target type's `forClass`

### Provider Caching

To reduce network requests, provider information is cached:

- Cache key: Provider domain (e.g., `solidcommunity.net`)
- TTL: 24 hours (configurable)
- Same provider, different users share cached patterns

```typescript
import { ProviderCache } from 'drizzle-solid';

const cache = new ProviderCache({ ttl: 12 * 60 * 60 * 1000 }); // 12 hours

const executor = new FederatedQueryExecutor({
  providerCache: cache,
  fetch: session.fetch,
});
```

## Configuration Options

### FederatedQueryExecutor Options

```typescript
new FederatedQueryExecutor({
  providerCache?: ProviderCache,  // Custom provider cache
  fetch?: typeof fetch,           // Authenticated fetch function
  timeout?: number,               // Default timeout (ms), default: 30000
});
```

### Execute Options

```typescript
executor.execute(parentRows, relationDef, {
  parallel?: boolean,       // Execute in parallel (default: true)
  maxConcurrency?: number,  // Max concurrent requests (default: 5)
  timeout?: number,         // Timeout per request (ms)
});
```

## Multiple WebIDs

The `discover` function can return multiple WebIDs:

```typescript
const groupsRelations = relations(groups, ({ many }) => ({
  memberPosts: many(posts.$schema, {
    discover: (group) => group.memberWebIds, // Returns string[]
  }),
}));
```

All posts from all members will be collected into a single array.

## Best Practices

1. **Use appropriate concurrency**: Don't set `maxConcurrency` too high to avoid overwhelming remote servers

2. **Handle errors gracefully**: Some Pods may be offline or deny access; always check `errors`

3. **Consider timeouts**: Set reasonable timeouts for slow networks

4. **Cache when possible**: Use the built-in provider cache to reduce discovery requests

5. **Check permissions**: Ensure your application has read access to the remote data

## Limitations

- Federated queries are read-only
- Write operations must be performed directly on each Pod
- Discovery requires either SAI or TypeIndex to be configured on the target Pod
- Performance depends on network latency and the number of target Pods
