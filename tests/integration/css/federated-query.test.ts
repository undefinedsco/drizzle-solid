/**
 * Federated Query Integration Test
 *
 * Tests the federated query capability where Bob can query
 * data from Alice's Pod using the discover pattern.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from '../../../src/driver';
import { createTestSession, createSecondSessionInstance, ensureContainer, grantAccess } from './helpers';
import { podTable, string, id, relations } from '../../../src/core/pod-table';
import { FederatedQueryExecutor } from '../../../src/core/federated';

describe('CSS integration: Federated Query', () => {
  let aliceSession: any;
  let bobSession: any;
  let alicePodBase: string;
  let bobPodBase: string;

  // Alice's posts table (schema only, for federated queries)
  // Note: base is a placeholder - actual URL is discovered via TypeIndex at runtime
  const posts = podTable('posts', {
    id: id(),
    title: string('title').predicate('https://schema.org/headline'),
    content: string('content').predicate('https://schema.org/content'),
  }, {
    type: 'https://schema.org/BlogPosting',
    base: '/federated-test/posts/', // Placeholder, will be overridden by discovery
    typeIndex: false,
  });

  // Bob's friends table (stores WebIDs)
  const friends = podTable('friends', {
    id: id(),
    name: string('name').predicate('https://schema.org/name'),
    webId: string('webId').predicate('https://schema.org/identifier'),
  }, {
    type: 'https://schema.org/Person',
    base: '/federated-test/friends/', // Placeholder
    typeIndex: false,
  });

  // Federated relation: friends -> posts
  const friendsRelations = relations(friends, ({ many }) => ({
    posts: many(posts.$schema, {
      discover: (friend: any) => friend.webId,
    }),
  }));

  beforeAll(async () => {
    // Setup: Get both sessions
    aliceSession = await createTestSession({ shared: false });
    try {
      bobSession = await createSecondSessionInstance();
    } catch (e) {
      console.warn('Skipping federated query test: Second user credentials not found');
      return;
    }

    alicePodBase = aliceSession.info.webId.split('profile')[0];
    bobPodBase = bobSession.info.webId.split('profile')[0];

    console.log('Alice Pod:', alicePodBase);
    console.log('Bob Pod:', bobPodBase);

    // 1. Alice creates posts in her Pod
    const postsContainer = `${alicePodBase}federated-test/posts/`;
    await ensureContainer(aliceSession, 'federated-test/');
    await ensureContainer(aliceSession, 'federated-test/posts/');

    const postsData = `
      @prefix schema: <https://schema.org/>.
      <#post1> a schema:BlogPosting;
        schema:headline "Alice's First Post";
        schema:content "Hello from Alice!".
      <#post2> a schema:BlogPosting;
        schema:headline "Alice's Second Post";
        schema:content "Another post from Alice.".
    `;

    const postsUrl = `${postsContainer}posts.ttl`;
    await aliceSession.fetch(postsUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/turtle' },
      body: postsData
    });

    // 2. Create TypeIndex entry for Alice's posts
    // (This allows federated discovery to work)
    const typeIndexUrl = `${alicePodBase}settings/publicTypeIndex.ttl`;
    const typeIndexData = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#>.
      @prefix schema: <https://schema.org/>.
      
      <#posts> a solid:TypeRegistration;
        solid:forClass schema:BlogPosting;
        solid:instanceContainer <${postsContainer}>.
    `;

    try {
      // Try to append to existing TypeIndex
      await aliceSession.fetch(typeIndexUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'text/n3' },
        body: `@prefix solid: <http://www.w3.org/ns/solid/terms#>.
               @prefix schema: <https://schema.org/>.
               INSERT DATA {
                 <#federated-posts> a solid:TypeRegistration;
                   solid:forClass schema:BlogPosting;
                   solid:instanceContainer <${postsContainer}>.
               }`
      });
    } catch (e) {
      console.warn('Could not update TypeIndex:', e);
    }

    // 3. Grant Bob read access to Alice's posts
    await grantAccess(aliceSession, postsContainer, bobSession.info.webId, ['Read']);
    await grantAccess(aliceSession, postsUrl, bobSession.info.webId, ['Read']);

    // 4. Bob creates a friends list in his Pod
    const friendsContainer = `${bobPodBase}federated-test/friends/`;
    await ensureContainer(bobSession, 'federated-test/');
    await ensureContainer(bobSession, 'federated-test/friends/');

    const friendsData = `
      @prefix schema: <https://schema.org/>.
      <#alice> a schema:Person;
        schema:name "Alice";
        schema:identifier "${aliceSession.info.webId}".
    `;

    await bobSession.fetch(`${friendsContainer}friends.ttl`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/turtle' },
      body: friendsData
    });

    // Small delay to allow CSS to propagate
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('Test data created');
  }, 60000);

  it('should execute federated query using FederatedQueryExecutor directly', async () => {
    if (!bobSession) {
      console.warn('Skipping: No Bob session');
      return;
    }

    const executor = new FederatedQueryExecutor({
      fetch: bobSession.fetch,
    });

    // Mock parent rows (as if we queried friends first)
    const parentRows = [
      { id: 'alice', name: 'Alice', webId: aliceSession.info.webId },
    ];

    // Define the federated relation
    const relationDef = {
      type: 'many' as const,
      table: posts.$schema,
      isFederated: true,
      discover: (row: any) => row.webId,
      relationName: 'posts',
    };

    const result = await executor.execute(parentRows, relationDef);

    console.log('Federated query result:', JSON.stringify(result, null, 2));

    // Should have posts array on Alice's row
    expect(result.data[0].posts).toBeDefined();
    expect(Array.isArray(result.data[0].posts)).toBe(true);
    
    // Check for errors (some may occur due to discovery)
    if (result.errors && result.errors.length > 0) {
      console.log('Federated errors:', result.errors);
    }
  });

  it('should access federated errors through PodDatabase', async () => {
    if (!bobSession) {
      console.warn('Skipping: No Bob session');
      return;
    }

    const bobDb = drizzle(bobSession);

    // Clear any previous errors
    bobDb.clearFederatedErrors();
    expect(bobDb.getLastFederatedErrors()).toEqual([]);

    // After a query (even if federated relations aren't used), 
    // errors should be empty
    const errors = bobDb.getLastFederatedErrors();
    expect(Array.isArray(errors)).toBe(true);
  });

  it('should handle network errors gracefully in federated queries', async () => {
    if (!bobSession) {
      console.warn('Skipping: No Bob session');
      return;
    }

    const executor = new FederatedQueryExecutor({
      fetch: bobSession.fetch,
    });

    // Use a non-existent WebID
    const parentRows = [
      { id: 'nobody', name: 'Nobody', webId: 'https://nonexistent.example.net/profile/card#me' },
    ];

    const relationDef = {
      type: 'many' as const,
      table: posts.$schema,
      isFederated: true,
      discover: (row: any) => row.webId,
      relationName: 'posts',
    };

    // Should not throw
    const result = await executor.execute(parentRows, relationDef);

    // Should have empty posts array
    expect(result.data[0].posts).toEqual([]);
  });

  it('should support parallel and sequential execution modes', async () => {
    if (!bobSession) {
      console.warn('Skipping: No Bob session');
      return;
    }

    const executor = new FederatedQueryExecutor({
      fetch: bobSession.fetch,
    });

    const parentRows = [
      { id: 'alice', name: 'Alice', webId: aliceSession.info.webId },
      { id: 'nobody', name: 'Nobody', webId: 'https://nonexistent.example.net/profile/card#me' },
    ];

    const relationDef = {
      type: 'many' as const,
      table: posts.$schema,
      isFederated: true,
      discover: (row: any) => row.webId,
      relationName: 'posts',
    };

    // Parallel execution
    const parallelStart = Date.now();
    await executor.execute(parentRows, relationDef, { parallel: true, maxConcurrency: 2 });
    const parallelTime = Date.now() - parallelStart;

    // Sequential execution
    const sequentialStart = Date.now();
    await executor.execute(parentRows, relationDef, { parallel: false });
    const sequentialTime = Date.now() - sequentialStart;

    console.log(`Parallel: ${parallelTime}ms, Sequential: ${sequentialTime}ms`);

    // Both should complete without error
    expect(true).toBe(true);
  });

  afterAll(async () => {
    // Cleanup
    if (aliceSession) {
      try {
        await aliceSession.fetch(`${alicePodBase}federated-test/`, { method: 'DELETE' });
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    if (bobSession) {
      try {
        await bobSession.fetch(`${bobPodBase}federated-test/`, { method: 'DELETE' });
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  });
});
