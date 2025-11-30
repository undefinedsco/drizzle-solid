import { createTestSession, ensureContainer } from './tests/integration/css/helpers';

async function main() {
  const session = await createTestSession();
  console.log('Session WebID:', session.info.webId);

  const containerPath = `/test/directn3-${Date.now()}/`;
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

  // Step 2: N3 PATCH to insert data - exactly matching what drizzle-solid sends
  const patch = `@prefix solid: <http://www.w3.org/ns/solid/terms#>.
_:patch a solid:InsertDeletePatch;
  solid:inserts {
    <${subject}> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://schema.org/Person> .
    <${subject}> <https://schema.org/identifier> "profile-123" .
    <${subject}> <https://schema.org/name> "Alice Example" .
    <${subject}> <https://schema.org/age> 30 .
    <${subject}> <https://schema.org/dateCreated> "2025-01-01T00:00:00.000Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .
  }.`;

  console.log('\n--- Step 2: N3 PATCH ---');
  console.log('PATCH body:\n', patch);

  const patchRes = await session.fetch(resourceUrl, {
    method: 'PATCH',
    headers: { 'Content-Type': 'text/n3' },
    body: patch
  });
  console.log('PATCH status:', patchRes.status, patchRes.statusText);
  if (!patchRes.ok) {
    const body = await patchRes.text();
    console.log('PATCH error body:', body);
  }

  // Step 3: Verify content
  console.log('\n--- Step 3: Verify content ---');
  const getRes = await session.fetch(resourceUrl, {
    headers: { Accept: 'text/turtle' }
  });
  console.log('GET status:', getRes.status);
  const content = await getRes.text();
  console.log('Content:\n', content);

  // Check for duplicates
  const lines = content.split('\n');
  const counts: Record<string, number> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('@') && !trimmed.startsWith('#')) {
      counts[trimmed] = (counts[trimmed] || 0) + 1;
    }
  }
  console.log('\n--- Duplicate check ---');
  for (const [line, count] of Object.entries(counts)) {
    if (count > 1) {
      console.log(`DUPLICATE (${count}x): ${line}`);
    }
  }

  // Cleanup
  await session.fetch(resourceUrl, { method: 'DELETE' });
  await session.fetch(containerUrl, { method: 'DELETE' });
}

main().catch(console.error);
