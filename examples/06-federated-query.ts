/**
 * Federated Query Example
 * 
 * This example demonstrates how to query data across multiple Pods.
 * We have a local friends list, and for each friend, we fetch their
 * posts from their respective Pods.
 */
import { drizzle, podTable, string, id, relations, FederatedQueryExecutor } from 'drizzle-solid';
import { getAuthenticatedSession, getPodBaseUrl } from './utils/auth';
import type { Session } from '@inrupt/solid-client-authn-node';

async function run(providedSession?: Session) {
  const session = providedSession || await getAuthenticatedSession();
  const podBase = getPodBaseUrl(session);

  // ============================================
  // Step 1: Define Tables
  // ============================================

  // Local friends table (stored in our Pod)
  const friends = podTable('friends', {
    id: id(),
    name: string('name').predicate('https://schema.org/name'),
    webId: string('webId').predicate('https://schema.org/identifier'),
  }, {
    base: `${podBase}data/friends.ttl`,
    type: 'https://schema.org/Person',
  });

  // Posts schema (no base - will be discovered dynamically from each friend's Pod)
  const posts = podTable('posts', {
    id: id(),
    title: string('title').predicate('https://schema.org/headline'),
    content: string('content').predicate('https://schema.org/content'),
  }, {
    type: 'https://schema.org/BlogPosting',
  });

  // ============================================
  // Step 2: Define Federated Relation
  // ============================================

  // The `discover` function tells the executor how to find
  // the WebID for each friend, which is used to locate their Pod
  const friendsRelations = relations(friends, ({ many }) => ({
    posts: many(posts.$schema, {
      discover: (friend: any) => friend.webId,
    }),
  }));

  // ============================================
  // Step 3: Initialize Database
  // ============================================

  const schema = { friends, posts, friendsRelations };
  const db = drizzle(session, { schema });

  // ============================================
  // Step 4: Prepare Test Data
  // ============================================

  console.log('Preparing test data...');

  // Clean up old data
  try {
    await session.fetch(`${podBase}data/friends.ttl`, { method: 'DELETE' });
  } catch {}

  // Insert some friends (in real use, these would be actual WebIDs)
  await db.insert(friends).values([
    { 
      id: 'alice', 
      name: 'Alice', 
      webId: 'https://alice.solidcommunity.net/profile/card#me' 
    },
    { 
      id: 'bob', 
      name: 'Bob', 
      webId: 'https://bob.inrupt.net/profile/card#me' 
    },
  ]);

  console.log('Friends inserted.');

  // ============================================
  // Step 5: Execute Federated Query
  // ============================================

  console.log('\n--- Method 1: Using db.query with federated relations ---');

  // This would work if we had real Pods with proper TypeIndex setup
  // For now, let's demonstrate the concept:
  const friendsList = await db.query.friends.findMany();
  console.log('Friends:', JSON.stringify(friendsList, null, 2));

  // Check for any federated errors
  const errors = db.getLastFederatedErrors();
  if (errors.length > 0) {
    console.log('Federated errors:', errors);
  }

  // ============================================
  // Step 6: Direct Executor Usage
  // ============================================

  console.log('\n--- Method 2: Using FederatedQueryExecutor directly ---');

  const executor = new FederatedQueryExecutor({
    fetch: session.fetch,
    timeout: 10000, // 10 second timeout
  });

  // Execute federated query on the friends we just retrieved
  const result = await executor.execute(
    friendsList.map(f => ({ ...f })), // Clone the rows
    {
      type: 'many',
      table: posts.$schema,
      isFederated: true,
      discover: (friend: any) => friend.webId,
      relationName: 'posts',
    },
    {
      parallel: true,
      maxConcurrency: 3,
    }
  );

  console.log('Federated query result:');
  for (const friend of result.data) {
    console.log(`  ${friend.name} (${friend.webId}):`);
    console.log(`    Posts: ${(friend as any).posts?.length || 0}`);
  }

  if (result.errors && result.errors.length > 0) {
    console.log('\nSome queries failed:');
    for (const error of result.errors) {
      console.log(`  [${error.code}] Path: ${error.path.join('.')}`);
      console.log(`    Message: ${error.message}`);
      if (error.url) {
        console.log(`    URL: ${error.url}`);
      }
    }
  }

  // ============================================
  // Step 7: Handle Multiple WebIDs
  // ============================================

  console.log('\n--- Method 3: Multiple WebIDs per row ---');

  // For groups or teams, you might have multiple WebIDs per row
  const groups = podTable('groups', {
    id: id(),
    name: string('name').predicate('https://schema.org/name'),
  }, {
    type: 'https://schema.org/Organization',
  });

  // Simulate a group with member WebIDs
  const groupData = [
    {
      id: 'team1',
      name: 'Development Team',
      memberWebIds: [
        'https://alice.solidcommunity.net/profile/card#me',
        'https://bob.inrupt.net/profile/card#me',
      ],
    },
  ];

  const groupResult = await executor.execute(
    groupData,
    {
      type: 'many',
      table: posts.$schema,
      isFederated: true,
      discover: (group: any) => group.memberWebIds, // Returns array of WebIDs
      relationName: 'memberPosts',
    },
    {
      parallel: true,
      maxConcurrency: 5,
    }
  );

  console.log('Group result:');
  for (const group of groupResult.data) {
    console.log(`  ${group.name}:`);
    console.log(`    Member posts: ${(group as any).memberPosts?.length || 0}`);
  }

  console.log('\nDone!');
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

export { run };
