/**
 * Cross-Pod Access Test
 *
 * Tests that Bob (with his session) can read data from Alice's Pod
 * when given appropriate authorization and using absolute URLs.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from '../../../src/driver';
import { createTestSession, createSecondSessionInstance, ensureContainer, grantAccess } from './helpers';
import { podTable, string, id } from '../../../src/core/schema';
import { eq } from '../../../src/core/query-conditions';

describe('CSS integration: Cross-Pod Access', () => {
  let aliceSession: any;
  let bobSession: any;
  let alicePodBase: string;
  let bobPodBase: string;

  beforeAll(async () => {
    // Setup: Get both sessions
    aliceSession = await createTestSession({ shared: false });
    try {
      bobSession = await createSecondSessionInstance();
    } catch (e) {
      console.warn('Skipping cross-pod test: Second user credentials not found');
      return;
    }

    alicePodBase = aliceSession.info.webId.split('profile')[0];
    bobPodBase = bobSession.info.webId.split('profile')[0];

    console.log('Alice Pod:', alicePodBase);
    console.log('Bob Pod:', bobPodBase);

    // Alice creates some test data
    const testContainer = `${alicePodBase}cross-pod-test/`;
    await ensureContainer(aliceSession, 'cross-pod-test/');

    // Create test data using Alice's session
    const dataUrl = `${testContainer}items.ttl`;
    const turtleData = `
      @prefix schema: <https://schema.org/>.
      <#item1> a schema:Thing;
        schema:identifier "item1";
        schema:name "Alice's Item 1".
      <#item2> a schema:Thing;
        schema:identifier "item2";
        schema:name "Alice's Item 2".
    `;

    const putRes = await aliceSession.fetch(dataUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/turtle' },
      body: turtleData
    });

    if (!putRes.ok) {
      throw new Error(`Failed to create test data: ${putRes.status}`);
    }

    // Grant Bob read access to Alice's container
    console.log('🔐 Granting Bob access...');
    console.log('  - Bob WebID:', bobSession.info.webId);
    console.log('  - Container:', testContainer);
    console.log('  - Data URL:', dataUrl);

    try {
      await grantAccess(aliceSession, testContainer, bobSession.info.webId, ['Read']);
      console.log('  ✓ Container ACL set');
    } catch (e) {
      console.error('  ✗ Container ACL failed:', e);
    }

    try {
      await grantAccess(aliceSession, dataUrl, bobSession.info.webId, ['Read']);
      console.log('  ✓ Data ACL set');
    } catch (e) {
      console.error('  ✗ Data ACL failed:', e);
    }

    // Verify ACL was created
    const aclUrl = `${dataUrl}.acl`;
    const aclCheck = await aliceSession.fetch(aclUrl);
    console.log('  ACL check:', aclCheck.status);
    if (aclCheck.ok) {
      const aclContent = await aclCheck.text();
      console.log('  ACL FULL content:\n', aclContent);
    }

    // Small delay to allow CSS to propagate ACL changes
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('✅ Test data created and access granted');
  }, 60000);

  it('Bob should directly fetch Alice data with his authenticated session', async () => {
    if (!bobSession) {
      console.warn('Skipping: No Bob session');
      return;
    }

    // Verify Bob's session is actually authenticated
    console.log('🔒 Bob session check:');
    console.log('  - isLoggedIn:', bobSession.info.isLoggedIn);
    console.log('  - WebID:', bobSession.info.webId);

    // First verify Bob can access his own Pod
    const bobProfileUrl = `${bobPodBase}profile/card`;
    const bobOwnFetch = await bobSession.fetch(bobProfileUrl);
    console.log('📡 Bob own profile fetch:', bobOwnFetch.status);

    // Try unauthenticated fetch first to verify the resource exists
    const aliceDataUrl = `${alicePodBase}cross-pod-test/items.ttl`;
    console.log('🔍 Unauthenticated fetch (expect 401):', aliceDataUrl);
    const unauthResponse = await fetch(aliceDataUrl, {
      headers: { 'Accept': 'text/turtle' }
    });
    console.log('📡 Unauthenticated:', unauthResponse.status);

    // Alice fetching her own data (should work)
    console.log('🔍 Alice fetching her own data:');
    const aliceOwn = await aliceSession.fetch(aliceDataUrl, {
      headers: { 'Accept': 'text/turtle' }
    });
    console.log('📡 Alice own fetch:', aliceOwn.status);
    if (aliceOwn.ok) {
      const text = await aliceOwn.text();
      console.log('📄 Alice sees:', text.substring(0, 100));
    }

    // Now try Bob's authenticated fetch
    console.log('🔍 Bob directly fetching Alice data (authenticated):');
    const response = await bobSession.fetch(aliceDataUrl, {
      headers: { 'Accept': 'text/turtle' }
    });

    console.log('📡 Bob fetch response:', response.status, response.statusText);

    // Show response headers for debugging
    const wwwAuth = response.headers.get('www-authenticate');
    if (wwwAuth) {
      console.log('  WWW-Authenticate:', wwwAuth);
    }

    if (response.ok) {
      const text = await response.text();
      console.log('📄 Content:', text.substring(0, 200));
    } else {
      const errorText = await response.text();
      console.log('❌ Error body:', errorText.substring(0, 300));
    }

    expect(response.ok).toBe(true);
  });

  it('Bob should read Alice data using absolute URL in table config', async () => {
    if (!bobSession) {
      console.warn('Skipping: No Bob session');
      return;
    }

    // Define a table pointing to Alice's Pod using ABSOLUTE URL
    const aliceContainer = `${alicePodBase}cross-pod-test/`;
    const aliceItemsTable = podTable('items', {
      id: id(),
      name: string('name').predicate('https://schema.org/name'),
    }, {
      type: 'https://schema.org/Thing',
      base: `${aliceContainer}items.ttl`,  // Absolute URL to Alice's resource
      typeIndex: false,  // Disable type index for this test
    });

    console.log('Table base:', aliceItemsTable.config.base);
    console.log('Table containerPath:', aliceItemsTable.getContainerPath());
    console.log('Table resourcePath:', (aliceItemsTable as any).getResourcePath?.());

    // Bob's db instance
    const bobDb = drizzle(bobSession);

    // Try to select from Alice's data
    console.log('🔍 Bob attempting to read Alice\'s data...');

    try {
      const items = await bobDb.select().from(aliceItemsTable);
      console.log('📦 Results:', items);

      expect(items.length).toBe(2);
      expect(items.map(i => i.name).sort()).toEqual(["Alice's Item 1", "Alice's Item 2"]);
    } catch (error) {
      console.error('❌ Error:', error);
      throw error;
    }
  });

  it('Bob should read Alice data using base config with .ttl suffix', async () => {
    if (!bobSession) {
      console.warn('Skipping: No Bob session');
      return;
    }

    // Use `base` (the correct option) pointing directly to the .ttl file
    const aliceResourceUrl = `${alicePodBase}cross-pod-test/items.ttl`;
    const aliceItemsTable = podTable('items2', {
      id: id(),
      name: string('name').predicate('https://schema.org/name'),
    }, {
      type: 'https://schema.org/Thing',
      base: aliceResourceUrl,  // Direct resource URL using `base` (correct option)
      typeIndex: false,
    });

    console.log('Table base:', aliceItemsTable.config.base);
    console.log('Table resourcePath:', (aliceItemsTable as any).getResourcePath?.());

    const bobDb = drizzle(bobSession);

    console.log('🔍 Bob attempting to read via base (file URL)...');

    try {
      const items = await bobDb.select().from(aliceItemsTable);
      console.log('📦 Results:', items);

      expect(items.length).toBe(2);
    } catch (error) {
      console.error('❌ Error:', error);
      throw error;
    }
  });

  afterAll(async () => {
    // Cleanup
    if (aliceSession) {
      try {
        await aliceSession.fetch(`${alicePodBase}cross-pod-test/`, { method: 'DELETE' });
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  });
});
