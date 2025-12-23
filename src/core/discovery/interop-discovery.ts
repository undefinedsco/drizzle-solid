import { PodTable } from '../pod-table';
import { DataDiscovery, DataLocation, DiscoverOptions, DataRegistrationInfo, RegisterOptions, ShapeInfo } from './types';
import { INTEROP, SHAPETREES } from './interop-types';
import { registrySetSchema, dataRegistrySchema, dataRegistrationSchema, accessGrantSchema, dataGrantSchema, applicationRegistrationSchema } from './interop-tables';
import { getPredicateForColumn } from '../sparql/helpers';
import { getSolidDataset, getThing, getUrl, getUrlAll, getThingAll, createThing, setThing, addUrl, saveSolidDatasetAt, createContainerAt, setUrl, setDatetime, createSolidDataset } from '@inrupt/solid-client';

// 内部类型：原始发现结果（未按 container 合并）
interface RawDiscoveryResult {
  container: string;
  shape?: string;
  shapeTree?: string;
  registeredBy?: string;
  source: 'typeindex' | 'interop' | 'config';
}

const normalizeRdfClass = (value?: string): string | undefined => {
  if (!value) return value;
  if (value.startsWith('http://schema.org/')) {
    return value.replace('http://schema.org/', 'https://schema.org/');
  }
  return value;
};

export class InteropDiscovery implements DataDiscovery {
  // Cache for ShapeTree -> Shape URL resolution
  private shapeTreeCache: Map<string, { expectsType?: string; shape?: string }> = new Map();

  constructor(
    private webId: string,
    private fetchFn: typeof fetch,
    private clientId?: string
  ) {}

  private async ensureRegistrySet(
    profileDataset: any,
    profileThing: any,
    options?: RegisterOptions
  ): Promise<string> {
    if (!options?.registryPath) {
      throw new Error('Missing registryPath for SAI registry auto-creation.');
    }
    const registriesPath = options.registryPath.endsWith('/')
      ? options.registryPath
      : `${options.registryPath}/`;
    const registriesParent = registriesPath.replace(/[^/]+\/$/, '');
    const agentRegistryUrl = `${registriesPath}agents/`;
    const setResourceUrl = `${registriesPath}set.ttl`;
    const setId = 'set-drizzle-solid';
    const registrySetUrl = `${setResourceUrl}#${setId}`;
    const dataRegistryResourceUrl = `${registriesPath}data-registry.ttl`;
    const dataRegistryId = 'data-registry';
    const dataRegistryUrl = `${dataRegistryResourceUrl}#${dataRegistryId}`;

    try {
      if (registriesParent && registriesParent !== registriesPath) {
        await createContainerAt(registriesParent, { fetch: this.fetchFn });
      }
      await createContainerAt(registriesPath, { fetch: this.fetchFn });
    } catch {}

    try {
      await createContainerAt(agentRegistryUrl, { fetch: this.fetchFn });
    } catch {}

    const dataRegistryThing = setUrl(
      createThing({ url: dataRegistryUrl }),
      'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
      INTEROP.DataRegistry
    );
    let dataRegistryDataset: ReturnType<typeof createSolidDataset> | undefined;
    try {
      dataRegistryDataset = await getSolidDataset(dataRegistryResourceUrl, { fetch: this.fetchFn });
    } catch {
      dataRegistryDataset = undefined;
    }
    if (dataRegistryDataset) {
      const existingThing = getThing(dataRegistryDataset, dataRegistryUrl);
      if (!existingThing) {
        const updatedDataset = setThing(dataRegistryDataset, dataRegistryThing);
        await saveSolidDatasetAt(dataRegistryResourceUrl, updatedDataset, { fetch: this.fetchFn });
      }
    } else {
      let newDataset = createSolidDataset();
      newDataset = setThing(newDataset, dataRegistryThing);
      await saveSolidDatasetAt(dataRegistryResourceUrl, newDataset, { fetch: this.fetchFn });
    }

    let registrySetThing = createThing({ url: registrySetUrl });
    registrySetThing = setUrl(registrySetThing, 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type', INTEROP.RegistrySet);
    registrySetThing = addUrl(registrySetThing, INTEROP.hasDataRegistry, dataRegistryUrl);
    registrySetThing = addUrl(registrySetThing, 'http://www.w3.org/ns/solid/interop#hasAgentRegistry', agentRegistryUrl);
    let registrySetDataset: ReturnType<typeof createSolidDataset> | undefined;
    try {
      registrySetDataset = await getSolidDataset(setResourceUrl, { fetch: this.fetchFn });
    } catch {
      registrySetDataset = undefined;
    }
    if (registrySetDataset) {
      const existingThing = getThing(registrySetDataset, registrySetUrl);
      if (!existingThing) {
        const updatedDataset = setThing(registrySetDataset, registrySetThing);
        await saveSolidDatasetAt(setResourceUrl, updatedDataset, { fetch: this.fetchFn });
      } else {
        const hasDataRegistryPred = getPredicateForColumn(registrySetSchema.columns.hasDataRegistry, registrySetSchema);
        const hasAgentRegistryPred = getPredicateForColumn(registrySetSchema.columns.hasAgentRegistry, registrySetSchema);
        const dataRegistries = getUrlAll(existingThing, hasDataRegistryPred);
        const agentRegistries = getUrlAll(existingThing, hasAgentRegistryPred);
        let updatedThing = existingThing;
        if (!dataRegistries.includes(dataRegistryUrl)) {
          updatedThing = addUrl(updatedThing, hasDataRegistryPred, dataRegistryUrl);
        }
        if (!agentRegistries.includes(agentRegistryUrl)) {
          updatedThing = addUrl(updatedThing, hasAgentRegistryPred, agentRegistryUrl);
        }
        if (updatedThing !== existingThing) {
          const updatedDataset = setThing(registrySetDataset, updatedThing);
          await saveSolidDatasetAt(setResourceUrl, updatedDataset, { fetch: this.fetchFn });
        }
      }
    } else {
      let newDataset = createSolidDataset();
      newDataset = setThing(newDataset, registrySetThing);
      await saveSolidDatasetAt(setResourceUrl, newDataset, { fetch: this.fetchFn });
    }

    const updatedProfileThing = setUrl(profileThing, INTEROP.hasRegistrySet, registrySetUrl);
    const updatedProfileDataset = setThing(profileDataset, updatedProfileThing);
    const profileUrl = this.webId.split('#')[0];
    await saveSolidDatasetAt(profileUrl, updatedProfileDataset, { fetch: this.fetchFn });

    return registrySetUrl;
  }

  async register(table: PodTable, options?: RegisterOptions): Promise<void> {
    if (!options?.registryPath) {
      throw new Error('registryPath is required for SAI registration.');
    }
    const rdfClass = typeof table.config.type === 'string' ? table.config.type : (table.config.type as any).value;
    const normalizedClass = normalizeRdfClass(rdfClass) ?? rdfClass;
    
    try {
      // 1. Ensure RegistrySet exists (auto-create if missing)
      const profileDataset = await getSolidDataset(this.webId, { fetch: this.fetchFn });
      const profileThing = getThing(profileDataset, this.webId);
      if (!profileThing) throw new Error('Profile not found');

    let registrySetUrl = getUrl(profileThing, INTEROP.hasRegistrySet);
    let registrySetDataset;
    let registrySetThing;
    if (registrySetUrl) {
      try {
        registrySetDataset = await getSolidDataset(registrySetUrl, { fetch: this.fetchFn });
        registrySetThing = getThing(registrySetDataset, registrySetUrl);
      } catch {
        registrySetDataset = undefined;
        registrySetThing = undefined;
      }
    }
      if (!registrySetUrl || !registrySetThing) {
        registrySetUrl = await this.ensureRegistrySet(profileDataset, profileThing, options);
        registrySetDataset = await getSolidDataset(registrySetUrl, { fetch: this.fetchFn });
        registrySetThing = getThing(registrySetDataset, registrySetUrl);
        if (!registrySetThing) throw new Error('RegistrySet not found');
      }

      // 2. Check if already registered (unless force is set)
      if (!options?.force) {
        const existing = await this.discover(rdfClass);
        if (existing.length > 0) {
          console.log(`[InteropDiscovery] ${table.config.name} already registered, skipping`);
          return;
        }
      }

      const dataRegistryPred = getPredicateForColumn(registrySetSchema.columns.hasDataRegistry, registrySetSchema);
      const dataRegistryUrls = getUrlAll(registrySetThing, dataRegistryPred);
      
      if (dataRegistryUrls.length === 0) throw new Error('No DataRegistry found');
      const targetRegistryUrl = dataRegistryUrls[0];

      // 3. Create DataRegistration Container
      const slug = options?.containerSlug ?? table.config.name;
      const registryContainer = targetRegistryUrl.endsWith('/') ? targetRegistryUrl : targetRegistryUrl + '/';
      const dataContainerUrl = `${registryContainer}${slug}/`;

      // Create data container if not exists
      try {
        await getSolidDataset(dataContainerUrl, { fetch: this.fetchFn });
      } catch (e) {
        await createContainerAt(dataContainerUrl, { fetch: this.fetchFn });
      }

      const registrationResourceUrl = `${registryContainer}${slug}`;
      
      // 4. Create ShapeTree (as a fragment in the same resource)
      const shapeTreeUrl = `${registrationResourceUrl}#ShapeTree`;
      let shapeTreeThing = createThing({ url: shapeTreeUrl });
      shapeTreeThing = setUrl(shapeTreeThing, 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type', SHAPETREES.ShapeTree);
      shapeTreeThing = setUrl(shapeTreeThing, SHAPETREES.expectsType, normalizedClass);
      
      // If Shape URL is provided, link it
      if (options?.shapeUrl) {
        shapeTreeThing = setUrl(shapeTreeThing, SHAPETREES.shape, options.shapeUrl);
      }

      // 5. Create DataRegistration
      let registrationThing = createThing({ url: registrationResourceUrl });
      registrationThing = setUrl(registrationThing, 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type', INTEROP.DataRegistration);
      // Use clientId when it looks like a URL, otherwise fallback to webId.
      const registeredBy = this.clientId && /^https?:\/\//.test(this.clientId)
        ? this.clientId
        : this.webId;
      registrationThing = setUrl(registrationThing, INTEROP.registeredBy, registeredBy);
      registrationThing = setDatetime(registrationThing, 'http://www.w3.org/ns/solid/interop#registeredAt', new Date());
      registrationThing = setUrl(registrationThing, INTEROP.registeredShapeTree, shapeTreeUrl);
      
      // 6. Save Registration Resource (contains both DataRegistration and ShapeTree)
      // First try to get existing dataset, otherwise create a new empty one via save
      let existingDataset;
      try {
        existingDataset = await getSolidDataset(registrationResourceUrl, { fetch: this.fetchFn });
      } catch {
        existingDataset = null;
      }

      let datasetToSave = existingDataset ?? createSolidDataset();
      let updated = false;

      const existingRegistration = getThing(datasetToSave, registrationResourceUrl);
      if (!existingRegistration) {
        datasetToSave = setThing(datasetToSave, registrationThing);
        updated = true;
      } else {
        let updatedRegistration = existingRegistration;
        const existingBy = getUrl(existingRegistration, INTEROP.registeredBy);
        const existingShapeTree = getUrl(existingRegistration, INTEROP.registeredShapeTree);

        if (!existingBy) {
          updatedRegistration = setUrl(updatedRegistration, INTEROP.registeredBy, registeredBy);
        }
        if (!existingShapeTree) {
          updatedRegistration = setUrl(updatedRegistration, INTEROP.registeredShapeTree, shapeTreeUrl);
        }
        if (updatedRegistration !== existingRegistration) {
          datasetToSave = setThing(datasetToSave, updatedRegistration);
          updated = true;
        }
      }

      const existingShapeTreeThing = getThing(datasetToSave, shapeTreeUrl);
      if (!existingShapeTreeThing) {
        datasetToSave = setThing(datasetToSave, shapeTreeThing);
        updated = true;
      }

      if (!existingDataset || updated) {
        await saveSolidDatasetAt(registrationResourceUrl, datasetToSave, { fetch: this.fetchFn });
      }

      // 7. Link from DataRegistry
      let registryDataset = await getSolidDataset(targetRegistryUrl, { fetch: this.fetchFn });
      let registryThing = getThing(registryDataset, targetRegistryUrl);
      if (!registryThing) throw new Error('Registry Thing missing in Dataset');

      const hasDataRegistrationPred = getPredicateForColumn(dataRegistrySchema.columns.hasDataRegistration, dataRegistrySchema);
      registryThing = addUrl(registryThing, hasDataRegistrationPred, registrationResourceUrl);
      
      registryDataset = setThing(registryDataset, registryThing);
      await saveSolidDatasetAt(targetRegistryUrl, registryDataset, { fetch: this.fetchFn });

      // Update cache
      this.shapeTreeCache.set(shapeTreeUrl, {
        expectsType: normalizedClass,
        shape: options?.shapeUrl
      });

      console.log(`[InteropDiscovery] Registered ${table.config.name} at ${registrationResourceUrl}`);
      console.log(`[InteropDiscovery] -> ShapeTree: ${shapeTreeUrl}`);
      console.log(`[InteropDiscovery] -> expectsType: ${normalizedClass}`);
      if (options?.shapeUrl) {
        console.log(`[InteropDiscovery] -> Shape: ${options.shapeUrl}`);
      }

    } catch (e) {
      console.error('[InteropDiscovery] Registration failed:', e);
      throw e;
    }
  }


  async discover(rdfClass: string, options?: DiscoverOptions): Promise<DataLocation[]> {
    try {
      const rawResults: RawDiscoveryResult[] = [];

      // 1. Fetch Profile
      const profileDataset = await getSolidDataset(this.webId, { fetch: this.fetchFn });
      const profileThing = getThing(profileDataset, this.webId);
      
      if (!profileThing) return [];

      const registrySetUrls = getUrlAll(profileThing, INTEROP.hasRegistrySet);
      if (registrySetUrls.length === 0) {
        return [];
      }
      
      for (const registrySetUrl of registrySetUrls) {
        // Strategy A: Direct Data Registration (Owner access)
        const ownerResults = await this.discoverDataRegistrationsRaw(registrySetUrl, rdfClass, options);
        rawResults.push(...ownerResults);

        // Strategy B: Access Grants (Shared access)
        const sharedResults = await this.discoverAccessGrantsRaw(registrySetUrl, rdfClass, options);
        rawResults.push(...sharedResults);
      }
      
      // 按 container 合并结果
      return this.mergeByContainer(rawResults);

    } catch (error) {
      console.error('[InteropDiscovery] Discovery failed:', error);
      return [];
    }
  }

  /**
   * 按 container 合并原始结果
   * 同一个 container 的多个 Shape 合并到 shapes 数组中
   */
  private mergeByContainer(rawResults: RawDiscoveryResult[]): DataLocation[] {
    const containerMap = new Map<string, DataLocation>();

    for (const raw of rawResults) {
      const existing = containerMap.get(raw.container);
      
      const shapeInfo: ShapeInfo | undefined = raw.shape ? {
        url: raw.shape,
        shapeTree: raw.shapeTree,
        registeredBy: raw.registeredBy,
        source: raw.source
      } : undefined;

      if (existing) {
        // 已有此 container，添加 shape 到数组（如果有且不重复）
        if (shapeInfo && !existing.shapes.some(s => s.url === shapeInfo.url)) {
          existing.shapes.push(shapeInfo);
        }
      } else {
        // 新 container
        containerMap.set(raw.container, {
          container: raw.container,
          shapes: shapeInfo ? [shapeInfo] : [],
          source: raw.source
        });
      }
    }

    return Array.from(containerMap.values());
  }

  // ... (discoverDataRegistrations remains same)

  private async discoverDataRegistrationsRaw(registrySetUrl: string, rdfClass: string, options?: DiscoverOptions): Promise<RawDiscoveryResult[]> {
    const results: RawDiscoveryResult[] = [];
    const normalizedClass = normalizeRdfClass(rdfClass) ?? rdfClass;
    try {
      // Fetch RegistrySet
      const registrySetDataset = await getSolidDataset(registrySetUrl, { fetch: this.fetchFn });
      const registrySetThing = getThing(registrySetDataset, registrySetUrl);
      if (!registrySetThing) return [];

      // Use predicate from Table Definition
      const hasDataRegistryPred = getPredicateForColumn(registrySetSchema.columns.hasDataRegistry, registrySetSchema);
      const dataRegistryUrls = getUrlAll(registrySetThing, hasDataRegistryPred);

      for (const registryUrl of dataRegistryUrls) {
        try {
          const registryDataset = await getSolidDataset(registryUrl, { fetch: this.fetchFn });
          const registryThing = getThing(registryDataset, registryUrl);
          if (!registryThing) continue;

          const hasDataRegistrationPred = getPredicateForColumn(dataRegistrySchema.columns.hasDataRegistration, dataRegistrySchema);
          const registrationUrls = getUrlAll(registryThing, hasDataRegistrationPred);

          for (const registrationUrl of registrationUrls) {
             const registrationDataset = await getSolidDataset(registrationUrl, { fetch: this.fetchFn });
             const registrationThing = getThing(registrationDataset, registrationUrl);
             if (!registrationThing) continue;

             const registeredShapeTreePred = getPredicateForColumn(dataRegistrationSchema.columns.registeredShapeTree, dataRegistrationSchema);
             const shapeTreeUrl = getUrl(registrationThing, registeredShapeTreePred);
             
             if (!shapeTreeUrl) continue;

             // Get registeredBy for appId filtering
             const registeredByPred = getPredicateForColumn(dataRegistrationSchema.columns.registeredBy, dataRegistrationSchema);
             const registeredBy = getUrl(registrationThing, registeredByPred);

             // Filter by appId if specified
             if (options?.appId && registeredBy !== options.appId) {
               continue;
             }

             const shapeTreeInfo = await this.resolveShapeTree(shapeTreeUrl);
             const matches = normalizeRdfClass(shapeTreeInfo?.expectsType) === normalizedClass;
             
             if (matches) {
               results.push({
                 container: registrationUrl, 
                 source: 'interop',
                 shapeTree: shapeTreeUrl,
                 shape: shapeTreeInfo?.shape,
                 registeredBy: registeredBy ?? undefined
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
    return results;
  }

  private async discoverAccessGrantsRaw(registrySetUrl: string, rdfClass: string, options?: DiscoverOptions): Promise<RawDiscoveryResult[]> {
    if (!this.clientId) {
        console.warn('[InteropDiscovery] No ClientID available, skipping Access Grant discovery');
        return [];
    }
    
    const results: RawDiscoveryResult[] = [];
    const normalizedClass = normalizeRdfClass(rdfClass) ?? rdfClass;
    try {
      // 1. RegistrySet -> AgentRegistry
      const registrySetDataset = await getSolidDataset(registrySetUrl, { fetch: this.fetchFn });
      const registrySetThing = getThing(registrySetDataset, registrySetUrl);
      if (!registrySetThing) {
          console.warn(`[InteropDiscovery] RegistrySet Thing not found at ${registrySetUrl}`);
          return [];
      }

      const agentRegistryPred = getPredicateForColumn(registrySetSchema.columns.hasAgentRegistry, registrySetSchema);
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
                const registeredAgentPred = getPredicateForColumn(applicationRegistrationSchema.columns.registeredAgent, applicationRegistrationSchema);
                const agent = getUrl(regThing, registeredAgentPred);
                
                if (agent === this.clientId) {
                  const hasAccessGrantPred = getPredicateForColumn(applicationRegistrationSchema.columns.hasAccessGrant, applicationRegistrationSchema);
                  const accessGrantUrls = getUrlAll(regThing, hasAccessGrantPred);

                  for (const grantUrl of accessGrantUrls) {
                    // Check if grant is in same dataset (common) or fetch
                    let grantThing = getThing(regDataset, grantUrl);
                    if (!grantThing) {
                       const grantDataset = await getSolidDataset(grantUrl, { fetch: this.fetchFn }).catch(() => null);
                       if (grantDataset) grantThing = getThing(grantDataset, grantUrl);
                    }
                    
                    if (!grantThing) continue;

                    const hasDataGrantPred = getPredicateForColumn(accessGrantSchema.columns.hasDataGrant, accessGrantSchema);
                    const dataGrantUrls = getUrlAll(grantThing, hasDataGrantPred);

                    for (const dataGrantUrl of dataGrantUrls) {
                       // Same check for data grant
                       let dataGrantThing = getThing(regDataset, dataGrantUrl);
                       if (!dataGrantThing) {
                          const dataGrantDataset = await getSolidDataset(dataGrantUrl, { fetch: this.fetchFn }).catch(() => null);
                          if (dataGrantDataset) dataGrantThing = getThing(dataGrantDataset, dataGrantUrl);
                       }
                       
                       if (!dataGrantThing) continue;

                       const shapeTreePred = getPredicateForColumn(dataGrantSchema.columns.registeredShapeTree, dataGrantSchema);
                       const shapeTreeUrl = getUrl(dataGrantThing, shapeTreePred);
                       
                       if (!shapeTreeUrl) continue;

                       // Get data owner for registeredBy
                       const dataOwnerPred = getPredicateForColumn(dataGrantSchema.columns.dataOwner, dataGrantSchema);
                       const dataOwner = getUrl(dataGrantThing, dataOwnerPred);

                       // Filter by appId if specified (here appId refers to data owner/registrant)
                       if (options?.appId && dataOwner !== options.appId) {
                         continue;
                       }

                       const shapeTreeInfo = await this.resolveShapeTree(shapeTreeUrl);
                       const matches = normalizeRdfClass(shapeTreeInfo?.expectsType) === normalizedClass;
                       
                       if (matches) {
                         const hasDataRegistrationPred = getPredicateForColumn(dataGrantSchema.columns.hasDataRegistration, dataGrantSchema);
                         const registrationUrl = getUrl(dataGrantThing, hasDataRegistrationPred);
                         
                         console.log(`[InteropDiscovery] Found matching Data Grant: ${dataGrantUrl}`);
                         console.log(`[InteropDiscovery] -> ShapeTree: ${shapeTreeUrl}`);
                         console.log(`[InteropDiscovery] -> Shape: ${shapeTreeInfo?.shape}`);
                         console.log(`[InteropDiscovery] -> Data Registration: ${registrationUrl}`);

                         if (registrationUrl) {
                            results.push({
                              container: registrationUrl,
                              source: 'interop',
                              shapeTree: shapeTreeUrl,
                              shape: shapeTreeInfo?.shape,
                              registeredBy: dataOwner ?? undefined
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
    return results;
  }

  async isRegistered(rdfClass: string): Promise<boolean> {
    const locations = await this.discover(rdfClass);
    return locations.length > 0;
  }

  /**
   * 按应用 ID 发现所有数据位置
   * @param appId 应用标识符
   */
  async discoverByApp(appId: string): Promise<DataLocation[]> {
    try {
      const allRegistrations = await this.discoverAll();
      const filtered = allRegistrations.filter(reg => reg.registeredBy === appId);
      
      // 转换为 RawDiscoveryResult 然后合并
      const rawResults: RawDiscoveryResult[] = filtered.map(reg => ({
        container: reg.container,
        source: 'interop' as const,
        shapeTree: reg.shapeTree,
        shape: reg.shape,
        registeredBy: reg.registeredBy
      }));
      
      return this.mergeByContainer(rawResults);
    } catch (error) {
      console.error('[InteropDiscovery] discoverByApp failed:', error);
      return [];
    }
  }

  /**
   * 获取所有数据注册
   */
  async discoverAll(): Promise<DataRegistrationInfo[]> {
    const registrations: DataRegistrationInfo[] = [];

    try {
      // 1. Fetch Profile
      const profileDataset = await getSolidDataset(this.webId, { fetch: this.fetchFn });
      const profileThing = getThing(profileDataset, this.webId);
      
      if (!profileThing) return [];

      const registrySetUrls = getUrlAll(profileThing, INTEROP.hasRegistrySet);
      
      for (const registrySetUrl of registrySetUrls) {
        try {
          const registrySetDataset = await getSolidDataset(registrySetUrl, { fetch: this.fetchFn });
          const registrySetThing = getThing(registrySetDataset, registrySetUrl);
          if (!registrySetThing) continue;

          const hasDataRegistryPred = getPredicateForColumn(registrySetSchema.columns.hasDataRegistry, registrySetSchema);
          const dataRegistryUrls = getUrlAll(registrySetThing, hasDataRegistryPred);

          for (const registryUrl of dataRegistryUrls) {
            try {
              const registryDataset = await getSolidDataset(registryUrl, { fetch: this.fetchFn });
              const registryThing = getThing(registryDataset, registryUrl);
              if (!registryThing) continue;

              const hasDataRegistrationPred = getPredicateForColumn(dataRegistrySchema.columns.hasDataRegistration, dataRegistrySchema);
              const registrationUrls = getUrlAll(registryThing, hasDataRegistrationPred);

              for (const registrationUrl of registrationUrls) {
                try {
                  const registrationDataset = await getSolidDataset(registrationUrl, { fetch: this.fetchFn });
                  const registrationThing = getThing(registrationDataset, registrationUrl);
                  if (!registrationThing) continue;

                  const registeredShapeTreePred = getPredicateForColumn(dataRegistrationSchema.columns.registeredShapeTree, dataRegistrationSchema);
                  const shapeTreeUrl = getUrl(registrationThing, registeredShapeTreePred);
                  
                  if (!shapeTreeUrl) continue;

                  const registeredByPred = getPredicateForColumn(dataRegistrationSchema.columns.registeredBy, dataRegistrationSchema);
                  const registeredBy = getUrl(registrationThing, registeredByPred);

                  const registeredAtPred = getPredicateForColumn(dataRegistrationSchema.columns.registeredAt, dataRegistrationSchema);
                  const registeredAtStr = getUrl(registrationThing, registeredAtPred);
                  const registeredAt = registeredAtStr ? new Date(registeredAtStr) : undefined;

                  const shapeTreeInfo = await this.resolveShapeTree(shapeTreeUrl);

                  registrations.push({
                    registrationUrl,
                    container: registrationUrl,
                    rdfClass: shapeTreeInfo?.expectsType ?? '',
                    shapeTree: shapeTreeUrl,
                    shape: shapeTreeInfo?.shape,
                    registeredBy: registeredBy ?? undefined,
                    registeredAt
                  });
                } catch (e) {
                  console.warn(`[InteropDiscovery] Error reading registration ${registrationUrl}:`, e);
                }
              }
            } catch (e) {
              console.warn(`[InteropDiscovery] Error reading registry ${registryUrl}:`, e);
            }
          }
        } catch (e) {
          console.warn(`[InteropDiscovery] Error reading RegistrySet ${registrySetUrl}:`, e);
        }
      }
    } catch (error) {
      console.error('[InteropDiscovery] discoverAll failed:', error);
    }

    return registrations;
  }

  private async checkShapeTreeMatchesClass(shapeTreeUrl: string, rdfClass: string): Promise<boolean> {
    const info = await this.resolveShapeTree(shapeTreeUrl);
    return normalizeRdfClass(info?.expectsType) === (normalizeRdfClass(rdfClass) ?? rdfClass);
  }

  /**
   * 解析 ShapeTree，获取 expectsType 和 shape URL
   * 结果会被缓存以提高性能
   */
  private async resolveShapeTree(shapeTreeUrl: string): Promise<{ expectsType?: string; shape?: string } | null> {
    // Check cache first
    if (this.shapeTreeCache.has(shapeTreeUrl)) {
      return this.shapeTreeCache.get(shapeTreeUrl)!;
    }

    try {
      const shapeTreeDataset = await getSolidDataset(shapeTreeUrl, { fetch: this.fetchFn });
      const shapeTreeThing = getThing(shapeTreeDataset, shapeTreeUrl);
      
      if (!shapeTreeThing) {
        this.shapeTreeCache.set(shapeTreeUrl, {});
        return null;
      }

      const expectsType = getUrl(shapeTreeThing, SHAPETREES.expectsType) ?? undefined;
      const shape = getUrl(shapeTreeThing, SHAPETREES.shape) ?? undefined;
      
      const result = { expectsType, shape };
      this.shapeTreeCache.set(shapeTreeUrl, result);
      return result;
    } catch (e) {
      console.warn(`[InteropDiscovery] Failed to fetch ShapeTree ${shapeTreeUrl}:`, e);
      this.shapeTreeCache.set(shapeTreeUrl, {});
      return null;
    }
  }
}
