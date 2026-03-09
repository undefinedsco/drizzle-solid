import { describe, it, expect, beforeAll } from 'vitest';
import { createTestSession, createSecondSessionInstance, ensureContainer, getSessionPodBase, grantAccess } from './helpers';
import { run as runQuickStart } from '../../../examples/01-quick-start';
import { run as runRelational } from '../../../examples/02-relational-query';
import { runBobViewer } from '../../../examples/03-zero-config-discovery';
import { run as runNotifications } from '../../../examples/04-notifications';
import { run as runDataDiscovery, basicDiscovery, listAllRegistrations } from '../../../examples/05-data-discovery';
import { run as runFederatedQuery } from '../../../examples/06-federated-query';
import { run as runHooksAndProfile } from '../../../examples/07-hooks-and-profile';
import { run as runIriBasedOperations } from '../../../examples/08-iri-based-operations';
import { run as runSchemaInheritance } from '../../../examples/08-schema-inheritance';
import { run as runMultiVariableTemplates } from '../../../examples/09-multi-variable-templates';
import { setupSaiForExample } from '../../../examples/utils/sai-helpers';
import { drizzle } from '../../../src/driver';
import { createNoAuthPodSession, getSharedNoAuthXpodRuntime, isInProcessXpodEnabled } from './xpod-runtime';
import { podTable, string, datetime, uri, id } from '../../../src/core/schema';

// Mock process.env for the examples (which usually load from .env)
const setupEnv = (session: any) => {
  if (session.info.clientId) process.env.SOLID_CLIENT_ID = session.info.clientId;
  if (session.info.clientSecret) process.env.SOLID_CLIENT_SECRET = session.info.clientSecret;
  if (session.info.oidcIssuer) process.env.SOLID_OIDC_ISSUER = session.info.oidcIssuer;
};

const describeRealExamples = process.env.SOLID_ENABLE_REAL_TESTS === 'true' ? describe : describe.skip;

describeRealExamples('Examples Verification Suite', () => {
  let session: any;
  let bobSession: any;

  beforeAll(async () => {
    session = await createTestSession({ shared: false });
    setupEnv(session);
  }, 60000);

  it('01-quick-start.ts should run successfully', async () => {
    // Pass session to reuse authentication
    await runQuickStart(session);
  }, 60000);

  it('02-relational-query.ts should run successfully', async () => {
    await runRelational(session);
  }, 60000);

  it('03-zero-config-discovery.ts should run successfully', async () => {
    // Setup Alice (Owner)
    const aliceSession = session;
    const alicePodBase = getSessionPodBase(aliceSession);
    const chatContainer = `${alicePodBase}data/chat-example-zero/`;
    const chatRoomUrl = `${chatContainer}message.ttl`;

    // Alice creates data
    const aliceDb = drizzle(aliceSession);
    const aliceTable = podTable('msg', {
        id: id(),
        content: string('content').predicate('http://schema.org/text'),
        author: uri('author').predicate('http://schema.org/author'),
        createdAt: datetime('createdAt').predicate('http://schema.org/dateCreated')
    }, { base: chatRoomUrl, type: 'http://schema.org/Message', subjectTemplate: '#{id}' });
    
    await ensureContainer(aliceSession, chatContainer);
    await aliceSession.fetch(chatRoomUrl, { method: 'DELETE' }).catch(() => {});
    await aliceDb.insert(aliceTable).values({ 
        content: 'Hello from Alice', 
        author: aliceSession.info.webId, 
        createdAt: new Date() 
    });

    // Setup Bob (Viewer)
    bobSession = await createSecondSessionInstance();
    // Fix Client ID for Bob's session (required for InteropDiscovery)
    let bobClientId = bobSession.info?.clientId || process.env.SOLID_CLIENT_ID_2 || 'https://app.example/id';
    // Ensure it's a valid URI (e.g., if UUID from env, wrap in urn:uuid:)
    if (!bobClientId.includes(':')) {
        bobClientId = `urn:uuid:${bobClientId}`;
    }
    if (bobSession.info) (bobSession.info as any).clientId = bobClientId;

    // *** CRITICAL FIX: Create ShapeTree ***
    // The SAI helper uses this hardcoded URL
    const shapeTreeUrl = `${alicePodBase}shapes/message-tree.ttl`;
    // Ensure container exists
    await ensureContainer(aliceSession, 'shapes/');
    // Create ShapeTree resource
    await aliceSession.fetch(shapeTreeUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/turtle' },
        body: `<${shapeTreeUrl}> <http://www.w3.org/ns/shapetrees#expectsType> <http://schema.org/Message> .`
    });
    // Grant Bob access to ShapeTree (so InteropDiscovery can read it)
    await grantAccess(aliceSession, shapeTreeUrl, bobSession.info.webId, ['Read']);
    
    // Setup SAI (Alice grants access to Bob)
    // We need Bob's Client ID for the grant.
    await setupSaiForExample(aliceSession, bobClientId, chatContainer, 'http://schema.org/Thing', { registeredShapeTree: shapeTreeUrl });

    // Setup Bob's Registry (to point to Alice's grant)
    // This is the part normally done by the user accepting the grant.
    // We reuse the helper from the previous iteration or similar logic.
    // Since setupSaiForExample puts everything in Alice's pod, 
    // Bob needs to find Alice's RegistrySet. 
    // WAIT: SAI Discovery usually works by Bob checking HIS OWN registry for grants FROM Alice.
    // Or, if using TypeIndex, Bob checks HIS TypeIndex.
    
    // In our InteropDiscovery implementation:
    // It checks the CURRENT USER'S (Bob's) Profile -> RegistrySet -> AgentRegistry.
    // And looks for a Data Grant.
    
    // So we need to write the Data Grant into BOB's Pod.
    await setupSaiForExample(bobSession, bobClientId, chatContainer, 'http://schema.org/Thing', { registeredShapeTree: shapeTreeUrl }); // Bob keeps a local receipt pointing to Alice's ShapeTree
    // No, that represents "Bob has a receipt of the grant".
    // Technically, the Data Grant in Bob's registry should point to Alice's data.
    
    // Let's cheat slightly and put the Data Grant in Bob's registry pointing to Alice's container.
    // The `setupSaiForExample` helper creates a RegistrySet and puts a Data Grant in it.
    // If we run it with `bobSession` but `dataContainerUrl` = Alice's container, 
    // it effectively sets up Bob to "know" about Alice's data.
    
    // Also need Physical ACL
    await grantAccess(aliceSession, chatContainer, bobSession.info.webId, ['Read', 'Append', 'Write']);
    await grantAccess(aliceSession, chatRoomUrl, bobSession.info.webId, ['Read', 'Append', 'Write']);

    // Run Bob's logic
    const messages = await runBobViewer(bobSession);
    
    expect(messages).toBeDefined();
    expect(messages.length).toBeGreaterThan(0);
    // Use .some() to find Alice's message, as previous test runs might leave data or order might vary
    const foundAliceMsg = messages.some(m => m.content && m.content.includes('Alice'));
    expect(foundAliceMsg).toBe(true);
  }, 120000);

  it('05-data-discovery.ts should run successfully', async () => {
    const aliceSession = session;

    await runDataDiscovery(aliceSession);
    
    // Test basic discovery function
    const locations = await basicDiscovery(aliceSession);
    expect(locations).toBeDefined();
    expect(Array.isArray(locations)).toBe(true);
    
    // Test list all registrations
    const registrations = await listAllRegistrations(aliceSession);
    expect(registrations).toBeDefined();
    expect(Array.isArray(registrations)).toBe(true);
  }, 120000);

});

const describeXpodExamples = process.env.SOLID_ENABLE_REAL_TESTS === 'true' && isInProcessXpodEnabled() ? describe : describe.skip;

describeXpodExamples('Examples Verification Suite (xpod no-auth runtime)', () => {
  let runtime: Awaited<ReturnType<typeof getSharedNoAuthXpodRuntime>>;
  let xpodSession: Awaited<ReturnType<typeof createNoAuthPodSession>>;

  beforeAll(async () => {
    runtime = await getSharedNoAuthXpodRuntime();
    xpodSession = await createNoAuthPodSession(runtime, 'test');
  }, 120000);


  it('04-notifications.ts should run successfully', async () => {
    await runNotifications(xpodSession as any);
  }, 120000);

  it('06-federated-query.ts should run successfully', async () => {
    await runFederatedQuery(xpodSession as any);
  }, 120000);

  it('07-hooks-and-profile.ts should run successfully', async () => {
    await runHooksAndProfile(xpodSession as any);
  }, 120000);

  it('08-iri-based-operations.ts should run successfully', async () => {
    await runIriBasedOperations(xpodSession as any);
  }, 120000);

  it('08-schema-inheritance.ts should run successfully', async () => {
    await runSchemaInheritance(xpodSession as any);
  }, 120000);

  it('09-multi-variable-templates.ts should run successfully', async () => {
    await runMultiVariableTemplates(xpodSession as any);
  }, 120000);
});
