import { getSolidDataset, getThing, getUrl, getStringNoLocale, saveSolidDatasetAt, createThing, buildThing, setThing, createSolidDataset, getThingAll } from '@inrupt/solid-client';
import { RDF_PREDICATES } from './rdf-constants';

export interface TypeIndexEntry {
  rdfClass: string;           // RDF 类型 URI (如 http://schema.org/Person)
  containerPath: string;      // 容器相对路径 (如 /users/)
  forClass: string;          // 对应的本地类名 (如 'Person', 'BlogPost')
  instanceContainer?: string; // 实例容器路径（自动从 webId 推导）
  classRegistry?: string;    // 类注册表路径
  table?: any;               // 可选的预定义表结构
}

export interface DiscoveredTable {
  name: string;
  columns: Record<string, any>;
  config: {
    containerPath: string;
    rdfClass: string;
  };
}

export interface TypeIndexConfig {
  webId: string;
  podUrl: string;
  fetch?: typeof fetch;
  autoCreate?: boolean;      // 是否自动创建 TypeIndex
  autoRegister?: boolean;    // 是否自动注册新类型
}

export class TypeIndexManager {
  private fetchFn: typeof fetch;
  private webId: string;
  private podUrl: string;

  constructor(webId: string, podUrl: string, fetchFn: typeof fetch = globalThis.fetch) {
    this.webId = webId;
    this.podUrl = podUrl;
    this.fetchFn = fetchFn;
  }

  /**
   * 获取当前配置
   */
  getConfig(): TypeIndexConfig {
    return {
      webId: this.webId,
      podUrl: this.podUrl,
      fetch: this.fetchFn,
      autoCreate: true,
      autoRegister: true
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config: TypeIndexConfig): void {
    this.webId = config.webId;
    this.podUrl = config.podUrl;
    if (config.fetch) {
      this.fetchFn = config.fetch;
    }
  }

  /**
   * 从 WebID Profile 中发现 TypeIndex
   */
  async findTypeIndex(): Promise<string | null> {
    try {
      // 获取用户的 WebID 文档
      const profileDataset = await getSolidDataset(this.webId, { fetch: this.fetchFn });
      const profile = getThing(profileDataset, this.webId);

      if (!profile) {
        throw new Error('Could not find profile in WebID document');
      }

      // 1. 首先从 profile 中查找 TypeIndex 链接
      const typeIndexUrls = getUrl(profile, 'http://www.w3.org/ns/solid/terms#typeIndex');
      
      if (typeIndexUrls) {
        const typeIndexUrl = Array.isArray(typeIndexUrls) ? typeIndexUrls[0] : typeIndexUrls;
        console.log(`Found TypeIndex in profile: ${typeIndexUrl}`);
        return typeIndexUrl;
      }

      // 2. 如果 profile 中没有，尝试从存储根目录查找
      const storageUrls = getUrl(profile, RDF_PREDICATES.SOLID_STORAGE);
      
      if (storageUrls) {
        const storageUrl = Array.isArray(storageUrls) ? storageUrls[0] : storageUrls;
        
        try {
          const storageDataset = await getSolidDataset(storageUrl, { fetch: this.fetchFn });
          const storageThing = getThing(storageDataset, storageUrl);
          
          if (storageThing) {
            const typeIndexLink = getUrl(storageThing, 'http://www.w3.org/ns/solid/terms#typeIndex');
            if (typeIndexLink) {
              const typeIndexUrl = Array.isArray(typeIndexLink) ? typeIndexLink[0] : typeIndexLink;
              console.log(`Found TypeIndex in storage: ${typeIndexUrl}`);
              return typeIndexUrl;
            }
          }
        } catch (error) {
          console.log('Could not access storage directory:', error);
        }
      }

      // 3. 最后尝试标准位置
      const standardTypeIndexUrl = `${this.podUrl}settings/typeIndex.ttl`;
      try {
        await getSolidDataset(standardTypeIndexUrl, { fetch: this.fetchFn });
        console.log(`Found TypeIndex at standard location: ${standardTypeIndexUrl}`);
        return standardTypeIndexUrl;
      } catch {
        console.log('No TypeIndex found');
        return null;
      }
    } catch (error) {
      console.error('Error finding TypeIndex:', error);
      return null;
    }
  }

  /**
   * 创建 TypeIndex（自动链接到 profile）
   */
  async createTypeIndex(): Promise<string> {
    // 使用标准位置，自动链接到 profile
    const typeIndexUrl = `${this.podUrl}settings/typeIndex.ttl`;
    
    try {
      // 1. 创建 TypeIndex 文档
      const typeIndexThing = buildThing(createThing({ url: typeIndexUrl }))
        .addUrl(RDF_PREDICATES.RDF_TYPE, 'http://www.w3.org/ns/solid/terms#TypeIndex')
        .addStringNoLocale(RDF_PREDICATES.FOAF_NAME, 'Type Index')
        .addStringNoLocale('http://purl.org/dc/terms/description', 'Type index for this Pod')
        .build();

      const dataset = setThing(createSolidDataset(), typeIndexThing);
      
      // 保存 TypeIndex 文档
      await saveSolidDatasetAt(typeIndexUrl, dataset, { fetch: this.fetchFn });
      
      // 2. 自动链接到用户的 profile
      await this.linkTypeIndexToProfile(typeIndexUrl);
      
      console.log(`TypeIndex created and linked to profile: ${typeIndexUrl}`);
      return typeIndexUrl;
    } catch (error) {
      console.error('Error creating TypeIndex:', error);
      throw error;
    }
  }

  /**
   * 将 TypeIndex 链接到用户的 profile
   */
  private async linkTypeIndexToProfile(typeIndexUrl: string): Promise<void> {
    try {
      // 获取用户的 profile
      const profileDataset = await getSolidDataset(this.webId, { fetch: this.fetchFn });
      const profile = getThing(profileDataset, this.webId);

      if (!profile) {
        throw new Error('Could not find profile in WebID document');
      }

      // 添加 TypeIndex 链接到 profile
      const updatedProfile = buildThing(profile)
        .addUrl('http://www.w3.org/ns/solid/terms#typeIndex', typeIndexUrl)
        .build();

      const updatedDataset = setThing(profileDataset, updatedProfile);
      
      // 保存更新后的 profile
      await saveSolidDatasetAt(this.webId, updatedDataset, { fetch: this.fetchFn });
      
      console.log(`TypeIndex linked to profile: ${typeIndexUrl}`);
    } catch (error) {
      console.error('Error linking TypeIndex to profile:', error);
      throw error;
    }
  }

  /**
   * 注册类型到 TypeIndex
   */
  async registerType(entry: TypeIndexEntry, typeIndexUrl?: string): Promise<void> {
    const targetTypeIndexUrl = typeIndexUrl || await this.findTypeIndex();
    
    if (!targetTypeIndexUrl) {
      throw new Error('TypeIndex not found. Please create one first.');
    }

    try {
      // 获取现有的 TypeIndex 文档
      let dataset;
      try {
        dataset = await getSolidDataset(targetTypeIndexUrl, { fetch: this.fetchFn });
      } catch (error) {
        // TypeIndex 不存在，创建新的
        dataset = createSolidDataset();
      }

      // 自动推导 instanceContainer
      const instanceContainer = entry.instanceContainer || `${this.podUrl}${entry.containerPath}`;
      
      // 创建类型注册条目
      const entryId = `#${entry.forClass.toLowerCase()}`;
      const entryThing = buildThing(createThing({ url: `${targetTypeIndexUrl}${entryId}` }))
        .addUrl(RDF_PREDICATES.RDF_TYPE, 'http://www.w3.org/ns/solid/terms#TypeRegistration')
        .addUrl('http://www.w3.org/ns/solid/terms#forClass', entry.rdfClass)
        .addUrl('http://www.w3.org/ns/solid/terms#instanceContainer', instanceContainer)
        .addStringNoLocale(RDF_PREDICATES.FOAF_NAME, entry.forClass)
        .build();

      // 将条目添加到 TypeIndex
      dataset = setThing(dataset, entryThing);

      // 保存更新后的 TypeIndex
      await saveSolidDatasetAt(targetTypeIndexUrl, dataset, { fetch: this.fetchFn });
      
      console.log(`Type ${entry.forClass} registered to TypeIndex`);
    } catch (error) {
      console.error('Error registering type:', error);
      throw error;
    }
  }

  /**
   * 从 TypeIndex 中发现已注册的类型
   */
  async discoverTypes(typeIndexUrl?: string): Promise<TypeIndexEntry[]> {
    const targetTypeIndexUrl = typeIndexUrl || await this.findTypeIndex();
    
    if (!targetTypeIndexUrl) {
      return [];
    }

    try {
      const dataset = await getSolidDataset(targetTypeIndexUrl, { fetch: this.fetchFn });
      const entries: TypeIndexEntry[] = [];

      // 查找所有类型注册条目
      const things = getThingAll(dataset);
      
      for (const thing of things) {
        const type = getUrl(thing, RDF_PREDICATES.RDF_TYPE);
        if (type === 'http://www.w3.org/ns/solid/terms#TypeRegistration') {
          const forClass = getUrl(thing, 'http://www.w3.org/ns/solid/terms#forClass');
          const instanceContainer = getUrl(thing, 'http://www.w3.org/ns/solid/terms#instanceContainer');
          const name = getStringNoLocale(thing, RDF_PREDICATES.FOAF_NAME);

          if (forClass && instanceContainer && name) {
            // 将绝对 URL 转换为相对路径，确保以斜杠结尾
            let containerPath = instanceContainer.replace(this.podUrl, '');
            if (!containerPath.endsWith('/')) {
              containerPath += '/';
            }
            
            entries.push({
              rdfClass: forClass,
              containerPath: containerPath,
              forClass: name,
              instanceContainer: instanceContainer
            });
          }
        }
      }

      return entries;
    } catch (error) {
      console.error('Error discovering types:', error);
      return [];
    }
  }

  /**
   * 发现特定的类型定义（按需发现）
   * @param rdfClassUri 要发现的 RDF 类型 URI
   */
  async discoverSpecificType(rdfClassUri: string): Promise<TypeIndexEntry | null> {
    try {
      // 1. 首先尝试从 TypeIndex 发现
      const typeIndexUrl = await this.findTypeIndex();
      if (typeIndexUrl) {
        const allTypes = await this.discoverTypes(typeIndexUrl);
        const specificType = allTypes.find(entry => entry.rdfClass === rdfClassUri);
        if (specificType) {
          return specificType;
        }
      }

      // 2. 如果 TypeIndex 中没有，尝试从 Profile 推断
      const profileTypes = await this.discoverTypesFromProfile();
      const inferredType = profileTypes.find(entry => entry.rdfClass === rdfClassUri);
      if (inferredType) {
        return inferredType;
      }

      // 3. 如果都没有找到，返回 null
      return null;
    } catch (error) {
      console.error(`Error discovering specific type ${rdfClassUri}:`, error);
      return null;
    }
  }

  /**
   * 发现多个特定类型
   * @param rdfClassUris 要发现的 RDF 类型 URI 数组
   */
  async discoverSpecificTypes(rdfClassUris: string[]): Promise<TypeIndexEntry[]> {
    const results: TypeIndexEntry[] = [];
    
    for (const rdfClassUri of rdfClassUris) {
      const typeEntry = await this.discoverSpecificType(rdfClassUri);
      if (typeEntry) {
        results.push(typeEntry);
      }
    }
    
    return results;
  }

  /**
   * 发现并创建可用的表定义
   * @param rdfClassUri 要发现的 RDF 类型 URI
   * @returns 可用的表定义，如果未找到则返回 null
   */
  async discoverTable(rdfClassUri: string): Promise<DiscoveredTable | null> {
    const typeEntry = await this.discoverSpecificType(rdfClassUri);
    if (!typeEntry) {
      return null;
    }

    // 从容器 URL 提取容器路径
    const containerPath = typeEntry.containerPath;
    
    // 根据 RDF 类型推断基本字段
    const columns = this.inferColumnsFromRdfClass(rdfClassUri);
    
    return {
      name: typeEntry.forClass.toLowerCase(),
      columns,
      config: {
        containerPath,
        rdfClass: typeEntry.rdfClass
      }
    };
  }

  /**
   * 发现并创建多个可用的表定义
   * @param rdfClassUris 要发现的 RDF 类型 URI 数组
   * @returns 可用的表定义数组
   */
  async discoverTables(rdfClassUris: string[]): Promise<DiscoveredTable[]> {
    const results: DiscoveredTable[] = [];
    
    for (const rdfClassUri of rdfClassUris) {
      const table = await this.discoverTable(rdfClassUri);
      if (table) {
        results.push(table);
      }
    }
    
    return results;
  }

  /**
   * 根据 RDF 类型推断基本字段
   * @param rdfClassUri RDF 类型 URI
   * @returns 推断的字段定义
   */
  private inferColumnsFromRdfClass(rdfClassUri: string): Record<string, any> {
    const baseColumns = {
      id: { type: 'int', primaryKey: true }
    };

    // 根据常见的 RDF 类型推断字段
    if (rdfClassUri.includes('schema.org/Person')) {
      return {
        ...baseColumns,
        name: { type: 'string', required: true },
        email: { type: 'string', required: false }
      };
    } else if (rdfClassUri.includes('schema.org/BlogPosting')) {
      return {
        ...baseColumns,
        title: { type: 'string', required: true },
        content: { type: 'string', required: false },
        author: { type: 'string', required: false }
      };
    } else if (rdfClassUri.includes('schema.org/Comment')) {
      return {
        ...baseColumns,
        text: { type: 'string', required: true },
        author: { type: 'string', required: false }
      };
    }

    // 默认字段
    return {
      ...baseColumns,
      name: { type: 'string', required: true }
    };
  }

  /**
   * 自动发现和注册类型（用于数据消费方）
   */
  async autoDiscoverAndRegister(webId?: string): Promise<TypeIndexEntry[]> {
    const targetWebId = webId || this.webId;
    
    try {
      // 1. 查找 TypeIndex
      const typeIndexUrl = await this.findTypeIndex();
      
      if (!typeIndexUrl) {
        console.log('No TypeIndex found for user');
        return [];
      }

      // 2. 发现已注册的类型
      const entries = await this.discoverTypes(typeIndexUrl);
      
      console.log(`Discovered ${entries.length} types from TypeIndex`);
      return entries;
    } catch (error) {
      console.error('Error in auto discovery:', error);
      return [];
    }
  }

  /**
   * 检查类型是否已注册
   */
  async isTypeRegistered(rdfClass: string, typeIndexUrl?: string): Promise<boolean> {
    const entries = await this.discoverTypes(typeIndexUrl);
    return entries.some(entry => entry.rdfClass === rdfClass);
  }

  /**
   * 从 Profile 中自动发现类型（不依赖 TypeIndex）
   */
  async discoverTypesFromProfile(): Promise<TypeIndexEntry[]> {
    try {
      // 获取用户的 WebID 文档
      const profileDataset = await getSolidDataset(this.webId, { fetch: this.fetchFn });
      const profile = getThing(profileDataset, this.webId);

      if (!profile) {
        throw new Error('Could not find profile in WebID document');
      }

      // 查找存储空间
      const storageUrls = getUrl(profile, RDF_PREDICATES.SOLID_STORAGE);
      const entries: TypeIndexEntry[] = [];

      if (storageUrls) {
        const storageUrl = Array.isArray(storageUrls) ? storageUrls[0] : storageUrls;
        
        // 发现容器并推断类型
        const storageDataset = await getSolidDataset(storageUrl, { fetch: this.fetchFn });
        const storageThing = getThing(storageDataset, storageUrl);

        if (storageThing) {
          const containedUrls = getUrl(storageThing, RDF_PREDICATES.LDP_CONTAINS);
          
          if (containedUrls) {
            const urls = Array.isArray(containedUrls) ? containedUrls : [containedUrls];
            
            for (const url of urls) {
              try {
                const containerDataset = await getSolidDataset(url, { fetch: this.fetchFn });
                const containerThing = getThing(containerDataset, url);
                
                if (containerThing) {
                  // 尝试从容器元数据推断类型
                  const name = getStringNoLocale(containerThing, RDF_PREDICATES.FOAF_NAME);
                  
                  if (name) {
                    // 基于容器名称推断 RDF 类型
                    const rdfClass = this.inferRdfClassFromContainerName(name);
                    
                    // 将绝对 URL 转换为相对路径，确保以斜杠结尾
                    let containerPath = url.replace(this.podUrl, '');
                    if (!containerPath.endsWith('/')) {
                      containerPath += '/';
                    }
                    
                    entries.push({
                      rdfClass,
                      containerPath,
                      forClass: this.capitalizeFirst(name),
                      instanceContainer: url
                    });
                  }
                }
              } catch (error) {
                console.warn(`Could not access container ${url}:`, error);
              }
            }
          }
        }
      }

      return entries;
    } catch (error) {
      console.error('Error discovering types from profile:', error);
      return [];
    }
  }

  /**
   * 基于容器名称推断 RDF 类型
   */
  private inferRdfClassFromContainerName(containerName: string): string {
    const name = containerName.toLowerCase();
    
    // 常见类型的映射
    const typeMapping: Record<string, string> = {
      'people': 'http://schema.org/Person',
      'persons': 'http://schema.org/Person',
      'users': 'http://schema.org/Person',
      'posts': 'http://schema.org/BlogPosting',
      'articles': 'http://schema.org/Article',
      'events': 'http://schema.org/Event',
      'places': 'http://schema.org/Place',
      'organizations': 'http://schema.org/Organization',
      'products': 'http://schema.org/Product',
      'reviews': 'http://schema.org/Review',
      'comments': 'http://schema.org/Comment',
      'photos': 'http://schema.org/ImageObject',
      'images': 'http://schema.org/ImageObject',
      'documents': 'http://schema.org/Document',
      'files': 'http://schema.org/MediaObject'
    };

    return typeMapping[name] || `https://example.com/vocab#${this.capitalizeFirst(containerName)}`;
  }

  /**
   * 首字母大写
   */
  private capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}
