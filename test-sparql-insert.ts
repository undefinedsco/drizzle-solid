import { createTestSession, ensureContainer } from './tests/integration/css/helpers';

async function main() {
  const session = await createTestSession();
  console.log('Session WebID:', session.info.webId);

  const containerPath = `/test/sparqlins-${Date.now()}/`;
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

  // Step 2: SPARQL UPDATE INSERT
  const sparqlInsert = `
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX schema: <https://schema.org/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

INSERT DATA {
  <${subject}> rdf:type schema:Person .
  <${subject}> schema:identifier "profile-123" .
  <${subject}> schema:name "Alice Example" .
  <${subject}> schema:age 30 .
  <${subject}> schema:dateCreated "2025-01-01T00:00:00.000Z"^^xsd:dateTime .
}`;

  console.log('\n--- Step 2: SPARQL UPDATE INSERT ---');
  console.log('SPARQL:\n', sparqlInsert);

  const patchRes = await session.fetch(resourceUrl, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/sparql-update' },
    body: sparqlInsert
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

  // Cleanup
  await session.fetch(resourceUrl, { method: 'DELETE' });
  await session.fetch(containerUrl, { method: 'DELETE' });
}

main().catch(console.error);
