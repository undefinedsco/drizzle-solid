import { pod, podTable, id, uri, INTEROP } from 'drizzle-solid';
import { Session } from '@inrupt/solid-client-authn-node';
import { getSolidDataset, getThing, getUrlAll, removeUrl, saveSolidDatasetAt, setThing } from '@inrupt/solid-client';

export const getSaiTables = (podBase: string) => {
  const registriesPath = `${podBase}registries/chat-example/`;
  const agentRegistryPath = `${registriesPath}agents/`;
  const appRegResource = `${agentRegistryPath}chat-app.ttl`;

  const registrySet = podTable('set', {
    id: id(),
    hasAgentRegistry: uri('hasAgentRegistry').array().predicate('http://www.w3.org/ns/solid/interop#hasAgentRegistry'),
  }, { type: INTEROP.RegistrySet, base: registriesPath, containerPath: registriesPath });

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

export async function setupSaiForExample(
  ownerSession: Session,
  granteeClientId: string,
  dataContainerUrl: string,
  rdfClass = 'http://schema.org/Thing',
  options?: { registeredShapeTree?: string },
) {
  const ownerPodBase = ownerSession.info.webId!.split('profile')[0];
  const sai = getSaiTables(ownerPodBase);
  const client = pod(ownerSession);
  const typeSuffix = rdfClass.split(/[\/#]/).pop() || 'type';
  const bootstrapTable = podTable(`sai-bootstrap-${typeSuffix.toLowerCase()}`, {
    id: id(),
  }, {
    type: rdfClass,
    base: dataContainerUrl,
    containerPath: dataContainerUrl,
    saiRegistryPath: sai.registriesPath,
  });

  try {
    await ownerSession.fetch(sai.appRegResource, { method: 'DELETE' });
  } catch {}

  try {
    const profileUrl = ownerSession.info.webId!.split('#')[0];
    const profileDataset = await getSolidDataset(profileUrl, { fetch: ownerSession.fetch });
    const profileThing = getThing(profileDataset, ownerSession.info.webId!);
    if (profileThing) {
      const registrySets = getUrlAll(profileThing, INTEROP.hasRegistrySet);
      if (registrySets.length > 0) {
        let updatedThing = profileThing;
        for (const registrySetUrl of registrySets) {
          updatedThing = removeUrl(updatedThing, INTEROP.hasRegistrySet, registrySetUrl);
        }
        const updatedDataset = setThing(profileDataset, updatedThing);
        await saveSolidDatasetAt(profileUrl, updatedDataset, { fetch: ownerSession.fetch });
      }
    }
  } catch {}

  await client.init(bootstrapTable);

  await ownerSession.fetch(sai.appRegResource, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/turtle' },
    body: '',
  }).catch(() => {});

  const grantId = 'grant-chat';
  const dataGrantId = 'grant-chat-data';

  await client.collection(sai.dataGrant).create({
    id: dataGrantId,
    hasDataRegistration: dataContainerUrl,
    registeredShapeTree: options?.registeredShapeTree || `${ownerPodBase}shapes/message-tree.ttl`,
    scopeOfGrant: 'http://www.w3.org/ns/solid/interop#AllFromRegistry',
  });

  await client.collection(sai.accessGrant).create({
    id: grantId,
    hasDataGrant: [`${sai.appRegResource}#${dataGrantId}`],
  });

  await client.collection(sai.applicationRegistration).create({
    id: 'app-chat',
    registeredAgent: granteeClientId,
    hasAccessGrant: `${sai.appRegResource}#${grantId}`,
  });

  console.log(`✅ SAI Environment setup complete for ${ownerSession.info.webId}`);
}
