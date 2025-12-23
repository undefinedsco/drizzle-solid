import { podTable, id, uri, INTEROP } from 'drizzle-solid';
import { Session } from '@inrupt/solid-client-authn-node';
import { getSolidDataset, getThing, getUrlAll, removeUrl, saveSolidDatasetAt, setThing } from '@inrupt/solid-client';
import { drizzle } from 'drizzle-solid';

// SAI Table Definitions (Internal Helper)
export const getSaiTables = (podBase: string) => {
  const registriesPath = `${podBase}registries/chat-example/`;
  const agentRegistryPath = `${registriesPath}agents/`;
  const appRegResource = `${agentRegistryPath}chat-app.ttl`;

  const registrySet = podTable('set', {
    id: id(),
    hasAgentRegistry: uri('hasAgentRegistry').array().predicate('http://www.w3.org/ns/solid/interop#hasAgentRegistry'),
  }, { type: INTEROP.RegistrySet, containerPath: registriesPath });

  const dataGrant = podTable('data-grant', {
    id: id(),
    registeredShapeTree: uri('registeredShapeTree').predicate(INTEROP.registeredShapeTree),
    hasDataRegistration: uri('hasDataRegistration').predicate(INTEROP.hasDataRegistration),
    scopeOfGrant: uri('scopeOfGrant').predicate(INTEROP.scopeOfGrant),
  }, { type: INTEROP.DataGrant, base: appRegResource });

  const accessGrant = podTable('grant', {
    id: id(),
    hasDataGrant: uri('hasDataGrant').array().predicate(INTEROP.hasDataGrant),
  }, { type: INTEROP.AccessGrant, base: appRegResource });

  const applicationRegistration = podTable('app-reg', {
    id: id(),
    registeredAgent: uri('registeredAgent').predicate('http://www.w3.org/ns/solid/interop#registeredAgent'),
    hasAccessGrant: uri('hasAccessGrant').predicate(INTEROP.hasAccessGrant),
  }, { type: INTEROP.ApplicationRegistration, base: appRegResource });

  return { registrySet, dataGrant, accessGrant, applicationRegistration, appRegResource, registriesPath };
};

/**
 * Helper to setup a complete SAI environment for the Chat Example.
 * This simulates what an Authorization Agent would do:
 * 1. Create RegistrySet and link to Profile via db.init().
 * 2. Create an Application Registration for the 'Chat App'.
 * 3. Create an Access Grant containing a Data Grant pointing to the chat data.
 */
export async function setupSaiForExample(
  ownerSession: Session, 
  granteeClientId: string, 
  dataContainerUrl: string,
  rdfClass = 'http://schema.org/Thing'
) {
  const ownerPodBase = ownerSession.info.webId!.split('profile')[0];
  const sai = getSaiTables(ownerPodBase);
  const db = drizzle(ownerSession);
  const typeSuffix = rdfClass.split(/[\/#]/).pop() || 'type';
  const bootstrapTable = podTable(`sai-bootstrap-${typeSuffix.toLowerCase()}`, {
    id: id(),
  }, {
    type: rdfClass,
    containerPath: dataContainerUrl,
    saiRegistryPath: sai.registriesPath
  });

  // 1. Ensure RegistrySet via init (auto-creates SAI registries)
  try {
    await ownerSession.fetch(sai.appRegResource, { method: 'DELETE' });
  } catch {}

  // Clear stale hasRegistrySet values before init to avoid 404s on old links.
  try {
    const profileUrl = ownerSession.info.webId!.split('#')[0];
    const profileDataset = await getSolidDataset(profileUrl, { fetch: ownerSession.fetch });
    const profileThing = getThing(profileDataset, ownerSession.info.webId!);
    if (profileThing) {
      const registrySets = getUrlAll(profileThing, INTEROP.hasRegistrySet);
      if (registrySets.length > 0) {
        let updatedThing = profileThing;
        for (const registrySet of registrySets) {
          updatedThing = removeUrl(updatedThing, INTEROP.hasRegistrySet, registrySet);
        }
        const updatedDataset = setThing(profileDataset, updatedThing);
        await saveSolidDatasetAt(profileUrl, updatedDataset, { fetch: ownerSession.fetch });
      }
    }
  } catch {}

  await db.init(bootstrapTable);

  // 2. Grants
  await ownerSession.fetch(sai.appRegResource, { method: 'PUT', headers: { 'Content-Type': 'text/turtle' }, body: '' }).catch(() => {});
  
  const grantId = 'grant-chat';
  const dataGrantId = 'grant-chat-data';

  await db.insert(sai.dataGrant).values({
      id: dataGrantId,
      hasDataRegistration: dataContainerUrl,
      registeredShapeTree: 'http://localhost:3000/test/shapes/message-tree.ttl', // Dummy
      scopeOfGrant: 'http://www.w3.org/ns/solid/interop#AllFromRegistry'
  });

  await db.insert(sai.accessGrant).values({
      id: grantId,
      hasDataGrant: [`${sai.appRegResource}#${dataGrantId}`]
  });

  await db.insert(sai.applicationRegistration).values({
      id: 'app-chat',
      registeredAgent: granteeClientId,
      hasAccessGrant: `${sai.appRegResource}#${grantId}`
  });
  
  console.log(`✅ SAI Environment setup complete for ${ownerSession.info.webId}`);
}
