import { createTestSession, ensureContainer } from './tests/integration/css/helpers';

async function main() {
  const session = await createTestSession();
  console.log('Session WebID:', session.info.webId);

  const containerPath = `/test/sparqldebug-${Date.now()}/`;
  const containerUrl = await ensureContainer(session, containerPath);
  console.log('Container URL:', containerUrl);

  const resourceUrl = `${containerUrl}data.ttl`;

  // First create empty resource
  console.log('\n--- Creating empty resource ---');
  const createRes = await session.fetch(resourceUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/turtle' },
    body: ''
  });
  console.log('Create status:', createRes.status, createRes.statusText);

  // Try SPARQL UPDATE instead
  const sparqlUpdate = `
PREFIX schema: <https://schema.org/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

INSERT DATA {
  <${resourceUrl}#item1> rdf:type schema:Person .
  <${resourceUrl}#item1> schema:name "Test User" .
  <${resourceUrl}#item1> schema:age 25 .
}`;

  console.log('\n--- Sending SPARQL UPDATE ---');
  console.log('SPARQL:\n', sparqlUpdate);

  const patchRes = await session.fetch(resourceUrl, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/sparql-update' },
    body: sparqlUpdate
  });
  console.log('PATCH status:', patchRes.status, patchRes.statusText);
  const patchBody = await patchRes.text();
  if (patchBody) console.log('PATCH response body:', patchBody);

  // Fetch to verify
  console.log('\n--- Fetching resource ---');
  const getRes = await session.fetch(resourceUrl, {
    headers: { 'Accept': 'text/turtle' }
  });
  console.log('GET status:', getRes.status);
  const content = await getRes.text();
  console.log('Content length:', content.length);
  console.log('Content:\n', content);

  // Cleanup
  await session.fetch(resourceUrl, { method: 'DELETE' });
  await session.fetch(containerUrl, { method: 'DELETE' });
}

main().catch(console.error);
