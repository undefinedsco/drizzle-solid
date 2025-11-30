import { createTestSession, ensureContainer } from './tests/integration/css/helpers';

async function main() {
  const session = await createTestSession();
  console.log('Session WebID:', session.info.webId);

  const containerPath = `/test/putttl-${Date.now()}/`;
  const containerUrl = await ensureContainer(session, containerPath);
  console.log('Container URL:', containerUrl);

  const resourceUrl = `${containerUrl}data.ttl`;

  // Step 1: PUT with Turtle content directly
  const turtleContent = `
@prefix schema: <https://schema.org/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

<#item1> a schema:Person ;
    schema:identifier "profile-123" ;
    schema:name "Alice Example" ;
    schema:age 30 ;
    schema:dateCreated "2025-01-01T00:00:00.000Z"^^xsd:dateTime .
`;

  console.log('\n--- Step 1: PUT with Turtle content ---');
  console.log('Turtle:\n', turtleContent);

  const createRes = await session.fetch(resourceUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/turtle' },
    body: turtleContent
  });
  console.log('PUT status:', createRes.status, createRes.statusText);

  // Step 2: Verify content
  console.log('\n--- Step 2: Verify content ---');
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
