import { PodTable } from '../pod-table';
import { DataDiscovery, DataLocation, DiscoverOptions, DataRegistrationInfo, RegisterOptions, ShapeInfo } from './types';
import { INTEROP, SHAPETREES } from './interop-types';
import { registrySetTable, dataRegistryTable, dataRegistrationTable, accessGrantTable, dataGrantTable, applicationRegistrationTable } from './interop-tables';
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

export class InteropDiscovery implements DataDiscovery {
  // Cache for ShapeTree -> Shape URL resolution
  private shapeTreeCache: Map<string, { expectsType?: string; shape?: string }> = new Map();

  constructor(
    private webId: string,
    private fetchFn: typeof fetch,
    private clientId?: string
  ) {}

  async register(table: PodTable, options?: RegisterOptions): Promise<void> {
    const rdfClass = typeof table.config.type === 'string' ? table.config.type : (table.config.type as any).value;
    
    // 1. Check if already registered (unless force is set)
    if (!options?.force) {
      const existing = await this.discover(rdfClass);
      if (existing.length > 0) {
        console.log(`[InteropDiscovery] ${table.config.name} already registered, skipping`);
        return;
      }
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
      shapeTreeThing = setUrl(shapeTreeThing, SHAPETREES.expectsType, rdfClass);
      
      // If Shape URL is provided, link it
      if (options?.shapeUrl) {
        shapeTreeThing = setUrl(shapeTreeThing, SHAPETREES.shape, options.shapeUrl);
      }

      // 5. Create DataRegistration
      let registrationThing = createThing({ url: registrationResourceUrl });
      registrationThing = setUrl(registrationThing, 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type', INTEROP.DataRegistration);
      // Use clientId as registeredBy if available, otherwise use webId
      registrationThing = setUrl(registrationThing, INTEROP.registeredBy, this.clientId ?? this.webId);
      registrationThing = setDatetime(registrationThing, 'http://www.w3.org/ns/solid/interop#registeredAt', new Date());
      registrationThing = setUrl(registrationThing, INTEROP.registeredShapeTree, shapeTreeUrl);
      
      // 6. Save Registration Resource (contains both DataRegistration and ShapeTree)
      // First try to get existing dataset, otherwise create a new empty one via save
      let existingDataset;
      try {
        existingDataset = await getSolidDataset(registrationResourceUrl, { fetch: this.fetchFn });
      } catch {
        // Resource doesn't exist, will be created
        existingDataset = null;
      }
      
      // Use empty dataset as base, add things to it
      let datasetToSave = createSolidDataset();
      datasetToSave = setThing(datasetToSave, registrationThing);
      datasetToSave = setThing(datasetToSave, shapeTreeThing);
      await saveSolidDatasetAt(registrationResourceUrl, datasetToSave, { fetch: this.fetchFn });

      // 7. Link from DataRegistry
      let registryDataset = await getSolidDataset(targetRegistryUrl, { fetch: this.fetchFn });
      let registryThing = getThing(registryDataset, targetRegistryUrl);
      if (!registryThing) throw new Error('Registry Thing missing in Dataset');

      const hasDataRegistrationPred = getPredicateForColumn(dataRegistryTable.columns.hasDataRegistration, dataRegistryTable);
      registryThing = addUrl(registryThing, hasDataRegistrationPred, registrationResourceUrl);
      
      registryDataset = setThing(registryDataset, registryThing);
      await saveSolidDatasetAt(targetRegistryUrl, registryDataset, { fetch: this.fetchFn });

      // Update cache
      this.shapeTreeCache.set(shapeTreeUrl, {
        expectsType: rdfClass,
        shape: options?.shapeUrl
      });

      console.log(`[InteropDiscovery] Registered ${table.config.name} at ${registrationResourceUrl}`);
      console.log(`[InteropDiscovery] -> ShapeTree: ${shapeTreeUrl}`);
      console.log(`[InteropDiscovery] -> expectsType: ${rdfClass}`);
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

             // Get registeredBy for appId filtering
             const registeredByPred = getPredicateForColumn(dataRegistrationTable.columns.registeredBy, dataRegistrationTable);
             const registeredBy = getUrl(registrationThing, registeredByPred);

             // Filter by appId if specified
             if (options?.appId && registeredBy !== options.appId) {
               continue;
             }

             const shapeTreeInfo = await this.resolveShapeTree(shapeTreeUrl);
             const matches = shapeTreeInfo?.expectsType === rdfClass;
             
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
    try {
      // 1. RegistrySet -> AgentRegistry
      const registrySetDataset = await getSolidDataset(registrySetUrl, { fetch: this.fetchFn });
      const registrySetThing = getThing(registrySetDataset, registrySetUrl);
      if (!registrySetThing) {
          console.warn(`[InteropDiscovery] RegistrySet Thing not found at ${registrySetUrl}`);
          return [];
      }

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
                
                if (agent === this.clientId) {
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

                       // Get data owner for registeredBy
                       const dataOwnerPred = getPredicateForColumn(dataGrantTable.columns.dataOwner, dataGrantTable);
                       const dataOwner = getUrl(dataGrantThing, dataOwnerPred);

                       // Filter by appId if specified (here appId refers to data owner/registrant)
                       if (options?.appId && dataOwner !== options.appId) {
                         continue;
                       }

                       const shapeTreeInfo = await this.resolveShapeTree(shapeTreeUrl);
                       const matches = shapeTreeInfo?.expectsType === rdfClass;
                       
                       if (matches) {
                         const hasDataRegistrationPred = getPredicateForColumn(dataGrantTable.columns.hasDataRegistration, dataGrantTable);
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
                try {
                  const registrationDataset = await getSolidDataset(registrationUrl, { fetch: this.fetchFn });
                  const registrationThing = getThing(registrationDataset, registrationUrl);
                  if (!registrationThing) continue;

                  const registeredShapeTreePred = getPredicateForColumn(dataRegistrationTable.columns.registeredShapeTree, dataRegistrationTable);
                  const shapeTreeUrl = getUrl(registrationThing, registeredShapeTreePred);
                  
                  if (!shapeTreeUrl) continue;

                  const registeredByPred = getPredicateForColumn(dataRegistrationTable.columns.registeredBy, dataRegistrationTable);
                  const registeredBy = getUrl(registrationThing, registeredByPred);

                  const registeredAtPred = getPredicateForColumn(dataRegistrationTable.columns.registeredAt, dataRegistrationTable);
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
    return info?.expectsType === rdfClass;
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
