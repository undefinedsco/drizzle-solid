import { createTestSession, ensureContainer } from './tests/integration/css/helpers';

async function main() {
  const session = await createTestSession();
  console.log('Session WebID:', session.info.webId);

  const containerPath = `/test/n34t-${Date.now()}/`;
  const containerUrl = await ensureContainer(session, containerPath);
  console.log('Container URL:', containerUrl);

  const resourceUrl = `${containerUrl}data.ttl`;
  const subject = `${resourceUrl}#item1`;

  // Step 1: Create empty resource
  console.log('\n--- Step 1: Create empty resource with PUT ---');
  const createRes = await session.fetch(resourceUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/turtle' },
    body: ''
  });
  console.log('PUT status:', createRes.status, createRes.statusText);

  // Step 2: N3 PATCH with 4 triples
  const n3Body = `@prefix solid: <http://www.w3.org/ns/solid/terms#>.
_:patch a solid:InsertDeletePatch;
  solid:inserts {
    <${subject}> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://schema.org/Person> .
    <${subject}> <https://schema.org/identifier> "profile-123" .
    <${subject}> <https://schema.org/name> "Alice Example" .
    <${subject}> <https://schema.org/age> 30 .
  }.`;

  console.log('\n--- Step 2: N3 PATCH body (4 triples) ---');
  console.log('Body:\n', n3Body);

  console.log('\n--- Step 3: Sending N3 PATCH ---');
  const patchRes = await session.fetch(resourceUrl, {
    method: 'PATCH',
    headers: { 'Content-Type': 'text/n3' },
    body: n3Body
  });
  console.log('PATCH status:', patchRes.status, patchRes.statusText);

  // Step 4: Verify content
  console.log('\n--- Step 4: Verify content ---');
  const getRes = await session.fetch(resourceUrl, {
    headers: { Accept: 'text/turtle' }
  });
  console.log('GET status:', getRes.status);
  const content = await getRes.text();
  console.log('Content:\n', content);

  // Count
  const nameMatch = content.match(/"Alice Example"/g);
  const idMatch = content.match(/"profile-123"/g);
  console.log('\n--- Analysis ---');
  console.log('name occurrences:', nameMatch?.length || 0);
  console.log('identifier occurrences:', idMatch?.length || 0);

  // Cleanup
  await session.fetch(resourceUrl, { method: 'DELETE' });
  await session.fetch(containerUrl, { method: 'DELETE' });
}

main().catch(console.error);
