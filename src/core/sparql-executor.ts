// SPARQL query executor using Comunica Solid
import './comunica-patch'; // 导入 Comunica 兼容性补丁
import { QueryEngine } from '@comunica/query-sparql-solid';
import { SPARQLQuery } from '../types/sparql-types';

export interface SPARQLExecutorConfig {
  sources: string[];
  fetch?: typeof fetch;
  logging?: boolean;
}

export class ComunicaSPARQLExecutor {
  protected sources: string[];
  protected fetchFn: typeof fetch;
  protected logging: boolean;
  private engine: QueryEngine | null = null;

  constructor(config: SPARQLExecutorConfig) {
    this.sources = [...config.sources];
    this.fetchFn = this.createSafeFetch(config.fetch || fetch);
    this.logging = config.logging || false;
  }

  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  // 创建安全的 fetch 函数，修复 Comunica 的 HTTP 处理问题
  private createSafeFetch(originalFetch: typeof fetch): typeof fetch {
    return async (url: string | URL | Request, options?: RequestInit) => {
      try {
        const response = await originalFetch(url, options);
        
        // 创建一个完全安全的响应对象
        const safeHeaders = new Map<string, string>();
        
        // 安全地复制所有 headers
        if (response.headers) {
          response.headers.forEach((value, key) => {
            safeHeaders.set(key.toLowerCase(), value || '');
          });
        }
        
        // 创建安全的 Headers 对象
        const safeFetchHeaders = {
          get: (name: string) => {
            const key = name.toLowerCase();
            return safeHeaders.get(key) || null;
          },
          has: (name: string) => {
            const key = name.toLowerCase();
            return safeHeaders.has(key);
          },
          forEach: (callback: (value: string, key: string) => void) => {
            safeHeaders.forEach((value, key) => callback(value, key));
          },
          entries: () => safeHeaders.entries(),
          keys: () => safeHeaders.keys(),
          values: () => safeHeaders.values(),
          [Symbol.iterator]: () => safeHeaders.entries(),
          // 添加 includes 方法，这是 Comunica 需要的
          includes: (searchString: string) => {
            if (!searchString) return false;
            for (const [key, value] of Array.from(safeHeaders.entries())) {
              if (key.toLowerCase().includes(searchString.toLowerCase()) || 
                  value.toLowerCase().includes(searchString.toLowerCase())) {
                return true;
              }
            }
            return false;
          }
        };
        
        // 创建安全的响应对象
        const safeResponse = {
          ...response,
          headers: safeFetchHeaders,
          // 确保所有可能被 Comunica 访问的属性都存在
          status: response.status || 200,
          statusText: response.statusText || 'OK',
          ok: response.ok !== undefined ? response.ok : true,
          url: response.url || (typeof url === 'string' ? url : url.toString()),
          type: response.type || 'basic',
          redirected: response.redirected || false,
          // 添加可能被 Comunica 访问的其他属性
          body: response.body,
          bodyUsed: response.bodyUsed || false,
          // 确保 headers 也有 includes 方法（以防直接访问）
          includes: (searchString: string) => {
            if (!searchString) return false;
            for (const [key, value] of Array.from(safeHeaders.entries())) {
              if (key.toLowerCase().includes(searchString.toLowerCase()) || 
                  value.toLowerCase().includes(searchString.toLowerCase())) {
                return true;
              }
            }
            return false;
          },
          // 安全的方法包装
          text: async () => {
            try {
              return await response.text();
            } catch (error: unknown) {
              if (this.logging) {
                console.warn('[SafeFetch] Text parsing failed:', this.formatError(error));
              }
              return '';
            }
          },
          json: async () => {
            try {
              return await response.json();
            } catch (error: unknown) {
              if (this.logging) {
                console.warn('[SafeFetch] JSON parsing failed:', this.formatError(error));
              }
              return {};
            }
          },
          clone: () => {
            try {
              return this.createSafeFetch(originalFetch)(url, options);
            } catch (error: unknown) {
              if (this.logging) {
                console.warn('[SafeFetch] Clone failed:', this.formatError(error));
              }
              return safeResponse;
            }
          }
        };
        
        return safeResponse as unknown as Response;
      } catch (error: unknown) {
        if (this.logging) {
          console.error('[SafeFetch] Error:', this.formatError(error));
        }
        throw error;
      }
    };
  }

  // Initialize Comunica engine
  private async initEngine(): Promise<QueryEngine> {
    if (!this.engine) {
      this.engine = new QueryEngine();
    }
    return this.engine;
  }

  // Execute SPARQL query
  async executeQuery(sparqlQuery: SPARQLQuery): Promise<any[]> {
    try {
      const engine = await this.initEngine();
      
      // Log query if logging is enabled
      if (this.logging) {
        console.log(`[Comunica] Executing ${sparqlQuery.type} query:`, sparqlQuery.query);
      }
      
      if (sparqlQuery.type === 'SELECT') {
        return await this.executeSelectInternal(sparqlQuery, engine);
      } else if (sparqlQuery.type === 'ASK') {
        return await this.executeAskInternal(sparqlQuery, engine);
      } else if (['INSERT', 'UPDATE', 'DELETE'].includes(sparqlQuery.type)) {
        return await this.executeUpdate(sparqlQuery, engine);
      } else {
        throw new Error(`Unsupported query type: ${sparqlQuery.type}`);
      }
    } catch (error: unknown) {
      console.error('SPARQL query execution failed:', this.formatError(error));
      throw error;
    }
  }

  // Execute SELECT query directly - 简化版本，直接读取资源
  async executeSelect(query: string): Promise<any[]> {
    try {
      if (this.logging) {
        console.log('[SPARQL] Executing SELECT query with full processing');
      }
      
      // 使用完整的 SPARQL 查询处理而不是简化版本
      const sparqlQuery: SPARQLQuery = {
        type: 'SELECT',
        query: query.trim()
      };

      // 使用第一个数据源执行查询
      const sourceUrl = this.sources[0];
      if (!sourceUrl) {
        throw new Error('No data sources configured');
      }

      if (this.logging) {
        console.log('[SPARQL] Query object:', sparqlQuery);
        console.log('[SPARQL] Source URL:', sourceUrl);
      }

      return await this.executeQueryWithSource(sparqlQuery, sourceUrl);
      
      const results: any[] = [];
      
      for (const source of this.sources) {
        try {
          const response = await this.fetchFn(source, {
            method: 'GET',
            headers: {
              'Accept': 'text/turtle, application/n-triples, application/rdf+xml'
            }
          });
          
          if (response.ok) {
            const data = await response.text();
            if (this.logging) {
              console.log(`[Simple] Raw data from ${source}:`, data.substring(0, 200) + '...');
            }
            
            // 简单解析，返回原始数据
            results.push({ source, data, success: true });
          } else {
            console.warn(`GET failed for ${source}: ${response.status} ${response.statusText}`);
            results.push({ source, error: `${response.status} ${response.statusText}`, success: false });
          }
        } catch (error: unknown) {
          const errorMessage = this.formatError(error);
          console.warn(`Error reading ${source}:`, errorMessage);
          results.push({ source, error: errorMessage, success: false });
        }
      }
      
      return results;
    } catch (error: unknown) {
      if (this.logging) {
        console.error('[Simple] SELECT query execution failed:', this.formatError(error));
      }
      throw error;
    }
  }

  // Execute SELECT query
  private async executeSelectInternal(sparqlQuery: SPARQLQuery, engine: QueryEngine): Promise<any[]> {
    try {
      // 确保有有效的 sources
      if (this.sources.length === 0) {
        throw new Error('No sources configured for SPARQL query');
      }
      
      const bindingsStream = await engine.queryBindings(sparqlQuery.query, {
        sources: this.sources as [string, ...string[]],
        fetch: this.fetchFn,
        // 添加额外的配置来避免 HTTP 处理问题
        httpTimeout: 30000,
        httpRetryCount: 1,
        httpRetryDelay: 1000
      });
      
      const bindings = await bindingsStream.toArray();

      return bindings.map((binding: any) => {
        const result: Record<string, unknown> = {};

        const assignValue = (key: unknown, value: unknown) => {
          const keyName = this.extractBindingKeyName(key);
          if (!keyName) {
            return;
          }
          result[keyName] = this.convertComunicaTerm(value);
        };

        if (binding && typeof binding.forEach === 'function') {
          binding.forEach((value: unknown, key: unknown) => assignValue(key, value));
        } else if (binding && typeof binding.entries === 'function') {
          for (const [key, value] of binding.entries()) {
            assignValue(key, value);
          }
        } else {
          for (const key in binding) {
            if (Object.prototype.hasOwnProperty.call(binding, key)) {
              assignValue(key, (binding as Record<string, unknown>)[key]);
            }
          }
        }

        return result;
      });
    } catch (error: unknown) {
      console.error('SELECT query failed:', this.formatError(error));
      throw error;
    }
  }

  // Execute ASK query
  private async executeAskInternal(sparqlQuery: SPARQLQuery, engine: QueryEngine): Promise<any[]> {
    try {
      if (this.logging) {
        console.log(`[Comunica] Executing ASK query:`, sparqlQuery.query);
      }
      
      // 确保有有效的 sources
      if (this.sources.length === 0) {
        throw new Error('No sources configured for SPARQL query');
      }
      
      const result = await engine.queryBoolean(sparqlQuery.query, {
        sources: this.sources as [string, ...string[]],
        fetch: this.fetchFn,
        httpTimeout: 30000,
        httpRetryCount: 1,
        httpRetryDelay: 1000
      });
      
      return [{ result }];
    } catch (error: unknown) {
      console.error('ASK query failed:', this.formatError(error));
      throw error;
    }
  }

  // Execute UPDATE query (INSERT/UPDATE/DELETE) - 改进版本处理409冲突
  private async executeUpdate(sparqlQuery: SPARQLQuery, engine: QueryEngine): Promise<any[]> {
    try {
      if (this.logging) {
        console.log(`[Simple] Executing ${sparqlQuery.type} query:`, sparqlQuery.query);
      }
      
      const results: any[] = [];
      
      for (const source of this.sources) {
        try {
          // 支持所有类型的 UPDATE 查询，包括复杂的 DELETE WHERE
          if (this.logging) {
            console.log(`[Comunica] Executing UPDATE query on ${source}:`, sparqlQuery.query.substring(0, 100) + '...');
          }
          
          // 先尝试获取资源的 ETag（如果存在）
          let etag = null;
          try {
            const getResponse = await this.fetchFn(source, {
              method: 'HEAD',
              headers: { 'Accept': 'text/turtle' }
            });
            if (getResponse.ok) {
              etag = getResponse.headers.get('ETag');
              if (this.logging && etag) {
                console.log(`[UPDATE] Got ETag for ${source}: ${etag}`);
              }
            }
          } catch (headError) {
            // HEAD 请求失败不影响主要操作
            if (this.logging) {
              console.log(`[UPDATE] HEAD request failed for ${source}, continuing without ETag`);
            }
          }
          
          // 构建请求头
          const headers: Record<string, string> = {
            'Content-Type': 'application/sparql-update',
            'If-Match': etag ?? '*'
          };

          const performPatch = async (customHeaders: Record<string, string>) => {
            return this.fetchFn(source, {
              method: 'PATCH',
              headers: customHeaders,
              body: sparqlQuery.query
            });
          };

          let response = await performPatch(headers);
          
          if (response.ok) {
            results.push({ success: true, source, status: response.status });
            await this.invalidateCache(engine, source);
          } else if (response.status === 409 || response.status === 412) {
            // 409 冲突 - 尝试多种重试策略
            if (this.logging) {
              console.log(`[UPDATE] ${response.status} conflict for ${source}, trying multiple retry strategies`);
            }
            
            let retrySuccess = false;

            // 如果是 412，优先尝试重新获取最新的 ETag
            if (response.status === 412) {
              try {
                const latestHead = await this.fetchFn(source, {
                  method: 'HEAD',
                  headers: { 'Accept': 'text/turtle' }
                });

                if (latestHead.ok) {
                  const latestEtag = latestHead.headers.get('ETag');
                  if (latestEtag) {
                    const retryHeaders = {
                      ...headers,
                      'If-Match': latestEtag
                    };

                    const retryWithEtag = await performPatch(retryHeaders);
                    if (retryWithEtag.ok) {
                      results.push({
                        success: true,
                        source,
                        status: retryWithEtag.status,
                        retried: true,
                        strategy: 'refreshed-etag'
                      });
                      await this.invalidateCache(engine, source);
                      retrySuccess = true;
                    }
                  }
                }
              } catch (retryEtagError) {
                if (this.logging) {
                  console.log(`[UPDATE] Retry with refreshed ETag failed:`, retryEtagError);
                }
              }
            }
            
            // 策略1: 不使用 ETag 重试
            if (!retrySuccess) {
              try {
                const retryResponse1 = await performPatch({
                  'Content-Type': 'application/sparql-update'
                });
                
                if (retryResponse1.ok) {
                  results.push({ success: true, source, status: retryResponse1.status, retried: true, strategy: 'no-etag' });
                  await this.invalidateCache(engine, source);
                  retrySuccess = true;
                }
              } catch (retry1Error) {
                if (this.logging) {
                  console.log(`[UPDATE] Retry strategy 1 failed:`, retry1Error);
                }
              }
            }
            
            // 策略2: 如果策略1失败，尝试使用 PUT 方法（某些服务器支持）
            if (!retrySuccess) {
              try {
                // 先获取当前资源内容
                const getResponse = await this.fetchFn(source, {
                  method: 'GET',
                  headers: { 'Accept': 'text/turtle' }
                });
                
                if (getResponse.ok) {
                  // 使用 PUT 替换整个资源
                  const retryResponse2 = await this.fetchFn(source, {
                    method: 'PUT',
                    headers: {
                      'Content-Type': 'application/sparql-update'
                    },
                    body: sparqlQuery.query
                  });
                  
                  if (retryResponse2.ok) {
                    results.push({ success: true, source, status: retryResponse2.status, retried: true, strategy: 'put-method' });
                    await this.invalidateCache(engine, source);
                    retrySuccess = true;
                  }
                }
              } catch (retry2Error) {
                if (this.logging) {
                  console.log(`[UPDATE] Retry strategy 2 failed:`, retry2Error);
                }
              }
            }
            
            // 如果所有重试策略都失败
            if (!retrySuccess) {
              const errorText = await response.text();
              results.push({ 
                success: false, 
                source, 
                error: `All retry strategies failed: ${response.status} ${response.statusText}`, 
                details: errorText 
              });
            }
          } else {
            const errorText = await response.text();
            results.push({ success: false, source, error: `${response.status} ${response.statusText}`, details: errorText });
          }
        } catch (error: unknown) {
          results.push({ success: false, source, error: this.formatError(error) });
        }
      }
      
      return results;
    } catch (error: unknown) {
      console.error('UPDATE query failed:', this.formatError(error));
      throw error;
    }
  }

  private async invalidateCache(engine: QueryEngine, source: string): Promise<void> {
    const invalidate = (engine as unknown as { invalidateHttpCache?: (url?: string) => Promise<void> }).invalidateHttpCache;
    if (typeof invalidate === 'function') {
      try {
        await invalidate.call(engine, source);
      } catch (error: unknown) {
        if (this.logging) {
          console.warn(`[UPDATE] Failed to invalidate cache for ${source}:`, this.formatError(error));
        }
      }
    }
  }



  private extractBindingKeyName(key: unknown): string | null {
    if (key === null || key === undefined) {
      return null;
    }

    if (typeof key === 'string') {
      return key;
    }

    if (typeof key === 'object') {
      const candidate = key as { value?: unknown; termType?: string };
      if (candidate && typeof candidate.value === 'string') {
        return candidate.value;
      }
      if (candidate && candidate.termType === 'Variable' && typeof candidate.value === 'string') {
        return candidate.value;
      }
    }

    if (typeof key === 'symbol') {
      return key.description ?? key.toString();
    }

    return String(key);
  }

  // Convert Comunica term to JavaScript value
  private convertComunicaTerm(term: any): any {
    if (!term) return null;
    
    switch (term.termType) {
      case 'NamedNode':
        return term.value;
      case 'Literal':
        // Handle typed literals
        if (term.datatype && term.datatype.value) {
          const datatypeIri = term.datatype.value;
          if (typeof datatypeIri === 'string') {
            if (datatypeIri.includes('#integer') || datatypeIri.includes('#int')) {
              return parseInt(term.value, 10);
            } else if (datatypeIri.includes('#decimal') || datatypeIri.includes('#double')) {
              return parseFloat(term.value);
            } else if (datatypeIri.includes('#boolean')) {
              return term.value === 'true';
            } else if (datatypeIri.includes('#dateTime')) {
              return new Date(term.value);
            } else if (datatypeIri.includes('#json')) {
              try {
                return JSON.parse(term.value);
            } catch (error: unknown) {
              console.warn('Failed to parse JSON value:', term.value, this.formatError(error));
              return term.value;
            }
            }
          }
        }
        return term.value;
      case 'BlankNode':
        return `_:${term.value}`;
      default:
        return term.value;
    }
  }

  // Query specific container
  async queryContainer(containerUrl: string, customQuery?: SPARQLQuery): Promise<any[]> {
    const absoluteContainerUrl = containerUrl && containerUrl.startsWith('http') 
      ? containerUrl 
      : `${this.sources[0]}${containerUrl || ''}`;
    
    let sparqlQuery: SPARQLQuery;
    
    if (customQuery) {
      sparqlQuery = customQuery;
    } else {
      const query = `
        SELECT ?subject ?predicate ?object WHERE {
          ?subject ?predicate ?object .
          FILTER(STRSTARTS(STR(?subject), "${absoluteContainerUrl}"))
        }
      `;
      
      sparqlQuery = {
        type: 'SELECT',
        query: query,
      };
    }
    
    return this.executeQueryWithSource(sparqlQuery, absoluteContainerUrl);
  }

  // Execute query with specific source
  async executeQueryWithSource(sparqlQuery: SPARQLQuery, sourceUrl: string): Promise<any[]> {
    try {
      const engine = await this.initEngine();
      
      if (this.logging) {
        console.log(`[Comunica] Executing ${sparqlQuery.type} query on ${sourceUrl}:`, sparqlQuery.query);
        console.log(`[Debug] sparqlQuery object:`, JSON.stringify(sparqlQuery, null, 2));
      }
      
      if (sparqlQuery.type === 'SELECT') {
        const bindingsStream = await engine.queryBindings(sparqlQuery.query, {
          sources: [sourceUrl] as [string, ...string[]],
          fetch: this.fetchFn
        });
        
        const bindings = await bindingsStream.toArray();
        const results = bindings.map((binding: any) => {
          const result: Record<string, unknown> = {};
          
          // 调试：打印 binding 对象结构
          if (this.logging && bindings.indexOf(binding) === 0) {
            console.log('[Debug] Binding object:', binding);
            console.log('[Debug] Binding type:', typeof binding);
            console.log('[Debug] Binding constructor:', binding.constructor?.name);
            console.log('[Debug] Binding keys:', Object.keys(binding));
            console.log('[Debug] Has entries method:', typeof binding.entries);
            console.log('[Debug] Has keys method:', typeof binding.keys);
            console.log('[Debug] Has get method:', typeof binding.get);
          }
          
          // 处理不同版本的 Comunica binding 对象
          if (binding.entries && typeof binding.entries === 'function') {
            // 新版本 Comunica
            try {
              for (const [key, value] of binding.entries()) {
                const keyName = this.extractBindingKeyName(key);
                if (keyName) {
                  result[keyName] = this.convertComunicaTerm(value);
                }
              }
            } catch (error: unknown) {
              console.warn('[Warning] binding.entries() failed:', this.formatError(error));
              // 回退到其他方法
            }
          } else if (binding.keys && typeof binding.keys === 'function') {
            // 旧版本 Comunica - 这是我们当前的情况
            try {
              for (const variable of binding.keys()) {
                const term = binding.get(variable);
                if (term) {
                  // 正确提取变量名和值
                  const varName = this.extractBindingKeyName(variable);
                  if (!varName) {
                    continue;
                  }
                  const termValue = this.convertComunicaTerm(term);
                  result[varName] = termValue;
                  
                  // 调试第一个绑定的详细信息
                  if (this.logging && bindings.indexOf(binding) === 0) {
                    console.log(`[Debug] Variable: ${varName}, Term: ${termValue}`);
                    console.log(`[Debug] Variable object:`, variable);
                    console.log(`[Debug] Term object:`, term);
                  }
                }
              }
            } catch (error: unknown) {
              console.warn('[Warning] binding.keys()/get() failed:', this.formatError(error));
            }
          }
          
          // 如果上面的方法都失败了，尝试直接遍历
          if (Object.keys(result).length === 0) {
            for (const key in binding) {
              if (Object.prototype.hasOwnProperty.call(binding, key) && key !== 'type' && key !== 'size') {
                const value = binding[key];
                if (value) {
                  const keyName = this.extractBindingKeyName(key);
                  if (keyName) {
                    result[keyName] = this.convertComunicaTerm(value);
                  }
                }
              }
            }
          }
          
          return result;
        });
        
        if (this.logging) {
          console.log(`[Comunica] ${sparqlQuery.type} query results:`, results);
        }
        return results;
      } else if (sparqlQuery.type === 'ASK') {
        const result = await engine.queryBoolean(sparqlQuery.query, {
          sources: [sourceUrl] as [string, ...string[]],
          fetch: this.fetchFn
        });
        
        if (this.logging) {
          console.log(`[Comunica] ${sparqlQuery.type} query result:`, result);
        }
        return [{ result }];
      } else {
        // For UPDATE queries, use the improved executeUpdate method
        // Temporarily set sources to just this one source
        const originalSources = this.sources;
        this.sources = [sourceUrl];
        
        try {
          const results = await this.executeUpdate(sparqlQuery, engine);
          
          // Check if operation was successful
          const failures = results.filter(r => !r.success);
          if (failures.length > 0) {
            const firstError = failures[0];
            const errorMessage = (firstError && firstError.error) ? firstError.error : 'UPDATE operation failed';
            throw new Error(errorMessage);
          }
          
          if (this.logging) {
            console.log(`[Comunica] ${sparqlQuery.type} operation completed successfully`);
          }
          
          return results;
        } finally {
          // Restore original sources
          this.sources = originalSources;
        }
      }
    } catch (error: unknown) {
      if (this.logging) {
        console.error('[Comunica] Query execution failed:', this.formatError(error));
      }
      throw error;
    }
  }

  // Add data source
  addSource(source: string): void {
    if (!this.sources.includes(source)) {
      this.sources.push(source);
    }
  }

  // Remove data source
  removeSource(source: string): void {
    const index = this.sources.indexOf(source);
    if (index > -1) {
      this.sources.splice(index, 1);
    }
  }

  // Get all sources
  getSources(): string[] {
    return [...this.sources];
  }
}

// 为了向后兼容，保留旧的类名别名
export const SolidSPARQLExecutor = ComunicaSPARQLExecutor;
