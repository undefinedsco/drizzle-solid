import { PodTable } from '../pod-table';
import { DataDiscovery, DataLocation } from './types';
import { INTEROP, SHAPETREES } from './interop-types';
import { registrySetTable, dataRegistryTable, dataRegistrationTable, accessGrantTable, dataGrantTable, applicationRegistrationTable } from './interop-tables';
import { getPredicateForColumn } from '../sparql/helpers';
import { getSolidDataset, getThing, getUrl, getUrlAll, getThingAll, createThing, setThing, addUrl, saveSolidDatasetAt, createContainerAt, setUrl, setDatetime, createSolidDataset } from '@inrupt/solid-client';

export class InteropDiscovery implements DataDiscovery {
  constructor(
    private webId: string,
    private fetchFn: typeof fetch,
    private clientId?: string
  ) {}

  async register(table: PodTable): Promise<void> {
    const rdfClass = typeof table.config.type === 'string' ? table.config.type : (table.config.type as any).value;
    
    // 1. Check if already registered
    const existing = await this.discover(rdfClass);
    if (existing.length > 0) {
      return;
    }

    try {
      // 2. Find DataRegistry
      const profileDataset = await getSolidDataset(this.webId, { fetch: this.fetchFn });
      const profileThing = getThing(profileDataset, this.webId);
      if (!profileThing) throw new Error('Profile not found');

      const registrySetUrl = getUrl(profileThing, INTEROP.hasRegistrySet);
      if (!registrySetUrl) throw new Error('No RegistrySet found in profile');

      const registrySetDataset = await getSolidDataset(registrySetUrl, { fetch: this.fetchFn });
      const registrySetThing = getThing(registrySetDataset, registrySetUrl);
      if (!registrySetThing) throw new Error('RegistrySet not found');

      const dataRegistryPred = getPredicateForColumn(registrySetTable.columns.hasDataRegistry, registrySetTable);
      const dataRegistryUrls = getUrlAll(registrySetThing, dataRegistryPred);
      
      if (dataRegistryUrls.length === 0) throw new Error('No DataRegistry found');
      const targetRegistryUrl = dataRegistryUrls[0]; // Pick the first one for now

      // 3. Create DataRegistration Container
      // The registration is usually a container that holds the data instances
      // We need to generate a slug. Use table name.
      const slug = table.config.name;
      // Ensure registry url ends with /
      const registryContainer = targetRegistryUrl.endsWith('/') ? targetRegistryUrl : targetRegistryUrl + '/';
      const newRegistrationUrl = `${registryContainer}${slug}/`;

      // Check if it exists (it shouldn't if discover failed, but maybe raw container exists)
      try {
        await getSolidDataset(newRegistrationUrl, { fetch: this.fetchFn });
        // If it exists but wasn't discovered, maybe it's missing metadata?
        // For now, assume we can overwrite or update metadata
      } catch (e) {
        // Create container
        await createContainerAt(newRegistrationUrl, { fetch: this.fetchFn });
      }

      const registrationResourceUrl = `${registryContainer}${slug}`; // Resource
      
      // We actually need to create a new resource for the registration
      let newRegistrationThing = createThing({ name: slug });
      newRegistrationThing = setUrl(newRegistrationThing, 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type', INTEROP.DataRegistration);
      newRegistrationThing = setUrl(newRegistrationThing, INTEROP.registeredBy, this.webId);
      newRegistrationThing = setDatetime(newRegistrationThing, 'http://www.w3.org/ns/solid/interop#registeredAt', new Date());
      
      // ShapeTree: Use table's shape or generic
      // For now, we construct a dummy ShapeTree URL or use the Shape URL
      // Ideally we should create a ShapeTree resource too.
      const shapeTreeUrl = `${registrationResourceUrl}#ShapeTree`; // Self-contained?
      newRegistrationThing = setUrl(newRegistrationThing, INTEROP.registeredShapeTree, shapeTreeUrl);
      
      // 1. Save Registration Resource
      let newDataset = await getSolidDataset(registrationResourceUrl, { fetch: this.fetchFn }).catch(() => null);
      if (!newDataset) {
         newDataset = await saveSolidDatasetAt(registrationResourceUrl, createSolidDataset(), { fetch: this.fetchFn }); // Empty dataset
      }
      
      newDataset = setThing(newDataset!, newRegistrationThing);
      await saveSolidDatasetAt(registrationResourceUrl, newDataset, { fetch: this.fetchFn });

      // 2. Link from DataRegistry
      let registryDataset = await getSolidDataset(targetRegistryUrl, { fetch: this.fetchFn });
      let registryThing = getThing(registryDataset, targetRegistryUrl);
      if (!registryThing) throw new Error('Registry Thing missing in Dataset');

      const hasDataRegistrationPred = getPredicateForColumn(dataRegistryTable.columns.hasDataRegistration, dataRegistryTable);
      registryThing = addUrl(registryThing, hasDataRegistrationPred, registrationResourceUrl);
      
      registryDataset = setThing(registryDataset, registryThing);
      await saveSolidDatasetAt(targetRegistryUrl, registryDataset, { fetch: this.fetchFn });

      console.log(`[InteropDiscovery] Registered ${table.config.name} at ${registrationResourceUrl}`);

    } catch (e) {
      console.error('[InteropDiscovery] Registration failed:', e);
      throw e;
    }
  }


  async discover(rdfClass: string): Promise<DataLocation[]> {
    try {
      const locations: DataLocation[] = [];

      // 1. Fetch Profile
      const profileDataset = await getSolidDataset(this.webId, { fetch: this.fetchFn });
      const profileThing = getThing(profileDataset, this.webId);
      
      if (!profileThing) return [];

      const registrySetUrl = getUrl(profileThing, INTEROP.hasRegistrySet);
      if (!registrySetUrl) {
        return [];
      }

      // Strategy A: Direct Data Registration (Owner access)
      const ownerLocations = await this.discoverDataRegistrations(registrySetUrl, rdfClass);
      locations.push(...ownerLocations);

      // Strategy B: Access Grants (Shared access)
      const sharedLocations = await this.discoverAccessGrants(registrySetUrl, rdfClass);
      locations.push(...sharedLocations);
      
      console.log(`[InteropDiscovery] Discovering ${rdfClass} for ${this.webId}`);
      console.log(`[InteropDiscovery] Found ${locations.length} locations:`, JSON.stringify(locations, null, 2));

      return locations;

    } catch (error) {
      console.error('[InteropDiscovery] Discovery failed:', error);
      return [];
    }
  }

  // ... (discoverDataRegistrations remains same)

  private async discoverDataRegistrations(registrySetUrl: string, rdfClass: string): Promise<DataLocation[]> {
    const locations: DataLocation[] = [];
    try {
      // Fetch RegistrySet
      const registrySetDataset = await getSolidDataset(registrySetUrl, { fetch: this.fetchFn });
      const registrySetThing = getThing(registrySetDataset, registrySetUrl);
      if (!registrySetThing) return [];

      // Use predicate from Table Definition
      const hasDataRegistryPred = getPredicateForColumn(registrySetTable.columns.hasDataRegistry, registrySetTable);
      const dataRegistryUrls = getUrlAll(registrySetThing, hasDataRegistryPred);

      for (const registryUrl of dataRegistryUrls) {
        try {
          const registryDataset = await getSolidDataset(registryUrl, { fetch: this.fetchFn });
          const registryThing = getThing(registryDataset, registryUrl);
          if (!registryThing) continue;

          const hasDataRegistrationPred = getPredicateForColumn(dataRegistryTable.columns.hasDataRegistration, dataRegistryTable);
          const registrationUrls = getUrlAll(registryThing, hasDataRegistrationPred);

          for (const registrationUrl of registrationUrls) {
             const registrationDataset = await getSolidDataset(registrationUrl, { fetch: this.fetchFn });
             const registrationThing = getThing(registrationDataset, registrationUrl);
             if (!registrationThing) continue;

             const registeredShapeTreePred = getPredicateForColumn(dataRegistrationTable.columns.registeredShapeTree, dataRegistrationTable);
             const shapeTreeUrl = getUrl(registrationThing, registeredShapeTreePred);
             
             if (!shapeTreeUrl) continue;

             const matches = await this.checkShapeTreeMatchesClass(shapeTreeUrl, rdfClass);
             
             if (matches) {
               locations.push({
                 container: registrationUrl, 
                 source: 'interop',
                 shape: shapeTreeUrl
               });
             }
          }
        } catch (e) {
          console.warn(`[InteropDiscovery] Error checking registry ${registryUrl}:`, e);
        }
      }
    } catch (e) {
      console.warn(`[InteropDiscovery] Error exploring RegistrySet ${registrySetUrl}:`, e);
    }
    return locations;
  }

  async discoverAccessGrants(registrySetUrl: string, rdfClass: string): Promise<DataLocation[]> {
    if (!this.clientId) return [];
    
    const locations: DataLocation[] = [];
    try {
      // 1. RegistrySet -> AgentRegistry
      const registrySetDataset = await getSolidDataset(registrySetUrl, { fetch: this.fetchFn });
      const registrySetThing = getThing(registrySetDataset, registrySetUrl);
      if (!registrySetThing) return [];

      const agentRegistryPred = getPredicateForColumn(registrySetTable.columns.hasAgentRegistry, registrySetTable);
      const agentRegistryUrls = getUrlAll(registrySetThing, agentRegistryPred);

      for (const agentRegistryUrl of agentRegistryUrls) {
        try {
          const agentRegistryDataset = await getSolidDataset(agentRegistryUrl, { fetch: this.fetchFn });
          const agentRegistryThing = getThing(agentRegistryDataset, agentRegistryUrl);
          if (!agentRegistryThing) continue;

          // Find all candidate registration URLs: explicit links OR contained resources
          const hasAppRegPred = 'http://www.w3.org/ns/solid/interop#hasApplicationRegistration';
          const explicitAppRegs = getUrlAll(agentRegistryThing, hasAppRegPred);
          const containedResources = getUrlAll(agentRegistryThing, 'http://www.w3.org/ns/ldp#contains');
          
          const candidateUrls = Array.from(new Set([...explicitAppRegs, ...containedResources]));

          for (const candidateUrl of candidateUrls) {
            try {
              const regDataset = await getSolidDataset(candidateUrl, { fetch: this.fetchFn });
              // Iterate all things in the resource to find the ApplicationRegistration
              const things = getThingAll(regDataset);
              
              for (const regThing of things) {
                // Check registeredAgent
                const registeredAgentPred = getPredicateForColumn(applicationRegistrationTable.columns.registeredAgent, applicationRegistrationTable);
                const agent = getUrl(regThing, registeredAgentPred);
                
                console.log(`[InteropDiscovery] Checking Thing: ${regThing.url}`);
                console.log(`[InteropDiscovery] -> Registered Agent: ${agent} vs ClientID: ${this.clientId}`);
                
                if (agent === this.clientId) {
                  // Found our registration!
                  console.log(`[InteropDiscovery] Match found!`);
                  const hasAccessGrantPred = getPredicateForColumn(applicationRegistrationTable.columns.hasAccessGrant, applicationRegistrationTable);
                  const accessGrantUrls = getUrlAll(regThing, hasAccessGrantPred);

                  for (const grantUrl of accessGrantUrls) {
                    // Check if grant is in same dataset (common) or fetch
                    let grantThing = getThing(regDataset, grantUrl);
                    if (!grantThing) {
                       const grantDataset = await getSolidDataset(grantUrl, { fetch: this.fetchFn }).catch(() => null);
                       if (grantDataset) grantThing = getThing(grantDataset, grantUrl);
                    }
                    
                    if (!grantThing) continue;

                    const hasDataGrantPred = getPredicateForColumn(accessGrantTable.columns.hasDataGrant, accessGrantTable);
                    const dataGrantUrls = getUrlAll(grantThing, hasDataGrantPred);

                    for (const dataGrantUrl of dataGrantUrls) {
                       // Same check for data grant
                       let dataGrantThing = getThing(regDataset, dataGrantUrl);
                       if (!dataGrantThing) {
                          const dataGrantDataset = await getSolidDataset(dataGrantUrl, { fetch: this.fetchFn }).catch(() => null);
                          if (dataGrantDataset) dataGrantThing = getThing(dataGrantDataset, dataGrantUrl);
                       }
                       
                       if (!dataGrantThing) continue;

                       const shapeTreePred = getPredicateForColumn(dataGrantTable.columns.registeredShapeTree, dataGrantTable);
                       const shapeTreeUrl = getUrl(dataGrantThing, shapeTreePred);
                       
                       if (!shapeTreeUrl) continue;

                       const matches = await this.checkShapeTreeMatchesClass(shapeTreeUrl, rdfClass);
                       if (matches) {
                         const hasDataRegistrationPred = getPredicateForColumn(dataGrantTable.columns.hasDataRegistration, dataGrantTable);
                         const registrationUrl = getUrl(dataGrantThing, hasDataRegistrationPred);
                         
                         console.log(`[InteropDiscovery] Found matching Data Grant: ${dataGrantUrl}`);
                         console.log(`[InteropDiscovery] -> ShapeTree: ${shapeTreeUrl}`);
                         console.log(`[InteropDiscovery] -> Data Registration: ${registrationUrl}`);

                         if (registrationUrl) {
                            locations.push({
                              container: registrationUrl,
                              source: 'interop',
                              shape: shapeTreeUrl
                            });
                         }
                       } else {
                         console.log(`[InteropDiscovery] ShapeTree mismatch: ${shapeTreeUrl} vs ${rdfClass}`);
                       }
                    }
                  }
                }
              }
            } catch (e) {
              // Ignore individual registration fetch errors
            }
          }
        } catch (e) {
          console.warn(`[InteropDiscovery] Error checking AgentRegistry ${agentRegistryUrl}:`, e);
        }
      }
    } catch (e) {
      console.warn(`[InteropDiscovery] Error in AccessGrant discovery:`, e);
    }
    return locations;
  }

  async isRegistered(rdfClass: string): Promise<boolean> {
    const locations = await this.discover(rdfClass);
    return locations.length > 0;
  }

  private async checkShapeTreeMatchesClass(shapeTreeUrl: string, rdfClass: string): Promise<boolean> {
    try {
      // Fetch ShapeTree definition
      const shapeTreeDataset = await getSolidDataset(shapeTreeUrl, { fetch: this.fetchFn });
      const shapeTreeThing = getThing(shapeTreeDataset, shapeTreeUrl);
      
      if (!shapeTreeThing) return false;

      const expectsType = getUrl(shapeTreeThing, SHAPETREES.expectsType);
      
      return expectsType === rdfClass;
    } catch (e) {
      console.warn(`[InteropDiscovery] Failed to fetch ShapeTree ${shapeTreeUrl}:`, e);
      return false;
    }
  }
}
