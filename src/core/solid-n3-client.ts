/**
 * SolidN3Client - 轻量级 Solid Pod 客户端
 * 
 * 使用 N3.js + 原生 SPARQL UPDATE 替代 Comunica
 * 
 * 架构:
 * - 查询: HTTP GET → JSON-LD → N3 Store → 本地 SPARQL 查询
 * - 修改: SPARQL UPDATE → HTTP PATCH → Solid Pod
 */

import { Store, Parser, Writer, DataFactory, Quad } from 'n3';
import { fetch } from '@inrupt/universal-fetch';

const { namedNode, literal, quad } = DataFactory;

export interface QueryResult {
  bindings: Record<string, string>[];
}

export interface SparqlBinding {
  [variable: string]: {
    type: 'uri' | 'literal' | 'bnode';
    value: string;
    datatype?: string;
    'xml:lang'?: string;
  };
}

export class SolidN3Client {
  private cache: Map<string, { store: Store; timestamp: number }> = new Map();
  private cacheTimeout = 5 * 60 * 1000; // 5分钟缓存

  constructor(private defaultFetch = fetch) {}

  /**
   * 执行 SPARQL SELECT 查询
   * 通过 HTTP GET 获取数据，然后在本地 N3 Store 中查询
   */
  async query(endpoint: string, sparqlQuery: string): Promise<QueryResult> {
    // 解析 SPARQL 查询以确定需要访问的资源
    const resources = this.extractResourcesFromQuery(sparqlQuery, endpoint);
    
    // 获取所有相关资源的数据
    const store = new Store();
    for (const resource of resources) {
      const resourceStore = await this.getResourceStore(resource);
      store.addQuads(resourceStore.getQuads(null, null, null, null));
    }

    // 在本地执行 SPARQL 查询
    return this.executeLocalQuery(store, sparqlQuery);
  }

  /**
   * 执行 SPARQL UPDATE 操作
   * 直接发送到 Solid Pod
   */
  async update(endpoint: string, sparqlUpdate: string): Promise<void> {
    const response = await this.defaultFetch(endpoint, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/sparql-update',
      },
      body: sparqlUpdate,
    });

    if (!response.ok) {
      throw new Error(`SPARQL UPDATE failed: ${response.status} ${response.statusText}`);
    }

    // 清除相关缓存
    this.invalidateCache(endpoint);
  }

  /**
   * 获取资源的 N3 Store（带缓存）
   */
  private async getResourceStore(resourceUrl: string): Promise<Store> {
    // 检查缓存
    const cached = this.cache.get(resourceUrl);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.store;
    }

    // 获取资源数据
    const response = await this.defaultFetch(resourceUrl, {
      headers: {
        'Accept': 'text/turtle, application/ld+json, application/n-triples',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch resource: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    const data = await response.text();

    // 解析为 N3 Store
    const store = new Store();
    const parser = new Parser({ 
      baseIRI: resourceUrl,
      format: this.getParserFormat(contentType)
    });

    try {
      const quads = parser.parse(data);
      store.addQuads(quads);
    } catch (error) {
      // 如果是 JSON-LD，尝试转换
      if (contentType.includes('json')) {
        await this.parseJsonLd(data, store, resourceUrl);
      } else {
        throw new Error(`Failed to parse resource: ${error}`);
      }
    }

    // 缓存结果
    this.cache.set(resourceUrl, { store, timestamp: Date.now() });
    return store;
  }

  /**
   * 解析 JSON-LD 到 N3 Store
   */
  private async parseJsonLd(jsonData: string, store: Store, baseUri: string): Promise<void> {
    try {
      const jsonLd = JSON.parse(jsonData);
      
      if (Array.isArray(jsonLd)) {
        for (const item of jsonLd) {
          this.processJsonLdItem(item, store, baseUri);
        }
      } else {
        this.processJsonLdItem(jsonLd, store, baseUri);
      }
    } catch (error) {
      throw new Error(`Failed to parse JSON-LD: ${error}`);
    }
  }

  /**
   * 处理单个 JSON-LD 项目
   */
  private processJsonLdItem(item: any, store: Store, baseUri: string): void {
    if (!item['@id']) return;

    const subject = namedNode(this.resolveUri(item['@id'], baseUri));

    // 处理类型
    if (item['@type']) {
      const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
      for (const type of types) {
        store.addQuad(quad(
          subject,
          namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
          namedNode(type)
        ));
      }
    }

    // 处理其他属性
    for (const [predicate, values] of Object.entries(item)) {
      if (predicate === '@id' || predicate === '@type') continue;

      const predicateNode = namedNode(predicate);
      const valueArray = Array.isArray(values) ? values : [values];

      for (const value of valueArray) {
        let objectNode;
        
        if (typeof value === 'object' && value !== null) {
          if (value['@id']) {
            objectNode = namedNode(this.resolveUri(value['@id'], baseUri));
          } else if (value['@value'] !== undefined) {
            objectNode = literal(value['@value'], value['@type'] || value['@language']);
          } else {
            continue;
          }
        } else {
          objectNode = literal(String(value));
        }

        store.addQuad(quad(subject, predicateNode, objectNode));
      }
    }
  }

  /**
   * 在本地 Store 中执行 SPARQL 查询
   */
  private executeLocalQuery(store: Store, sparqlQuery: string): QueryResult {
    // 这里是一个简化的 SPARQL 解析器
    // 实际项目中可以使用 sparqljs 或类似库
    const query = this.parseSparqlSelect(sparqlQuery);
    const bindings: Record<string, string>[] = [];

    // 简单的三元组模式匹配
    for (const pattern of query.patterns) {
      const quads = store.getQuads(
        pattern.subject ? namedNode(pattern.subject) : null,
        pattern.predicate ? namedNode(pattern.predicate) : null,
        pattern.object ? (pattern.object.startsWith('http') ? namedNode(pattern.object) : literal(pattern.object)) : null,
        null
      );

      for (const quad of quads) {
        const binding: Record<string, string> = {};
        
        if (pattern.subject?.startsWith('?')) {
          binding[pattern.subject] = quad.subject.value;
        }
        if (pattern.predicate?.startsWith('?')) {
          binding[pattern.predicate] = quad.predicate.value;
        }
        if (pattern.object?.startsWith('?')) {
          binding[pattern.object] = quad.object.value;
        }

        bindings.push(binding);
      }
    }

    return { bindings };
  }

  /**
   * 从 SPARQL 查询中提取需要访问的资源
   */
  private extractResourcesFromQuery(sparqlQuery: string, defaultEndpoint: string): string[] {
    // 简化实现：假设查询的是默认端点
    // 实际实现中需要解析 FROM 子句等
    return [defaultEndpoint];
  }

  /**
   * 简化的 SPARQL SELECT 解析器
   */
  private parseSparqlSelect(sparqlQuery: string): { patterns: Array<{ subject?: string; predicate?: string; object?: string }> } {
    // 这是一个非常简化的解析器
    // 实际项目中应该使用 sparqljs
    const patterns: Array<{ subject?: string; predicate?: string; object?: string }> = [];
    
    // 提取 WHERE 子句中的三元组模式
    const whereMatch = sparqlQuery.match(/WHERE\s*\{([^}]+)\}/i);
    if (whereMatch) {
      const whereClause = whereMatch[1];
      const triplePattern = /(\S+)\s+(\S+)\s+(\S+)\s*\./g;
      let match;
      
      while ((match = triplePattern.exec(whereClause)) !== null) {
        patterns.push({
          subject: match[1],
          predicate: match[2],
          object: match[3]
        });
      }
    }
    
    return { patterns };
  }

  /**
   * 获取解析器格式
   */
  private getParserFormat(contentType: string): string {
    if (contentType.includes('turtle')) return 'text/turtle';
    if (contentType.includes('n-triples')) return 'application/n-triples';
    if (contentType.includes('n3')) return 'text/n3';
    if (contentType.includes('rdf+xml')) return 'application/rdf+xml';
    return 'text/turtle'; // 默认
  }

  /**
   * 解析相对 URI
   */
  private resolveUri(uri: string, baseUri: string): string {
    if (uri.startsWith('http://') || uri.startsWith('https://')) {
      return uri;
    }
    if (uri.startsWith('#')) {
      return baseUri + uri;
    }
    return new URL(uri, baseUri).toString();
  }

  /**
   * 清除缓存
   */
  private invalidateCache(resourceUrl: string): void {
    this.cache.delete(resourceUrl);
  }

  /**
   * 清除所有缓存
   */
  public clearCache(): void {
    this.cache.clear();
  }

  /**
   * 便捷方法：获取资源的所有三元组
   */
  async getResource(resourceUrl: string): Promise<Quad[]> {
    const store = await this.getResourceStore(resourceUrl);
    return store.getQuads(null, null, null, null);
  }

  /**
   * 便捷方法：将 Store 序列化为 Turtle
   */
  async serializeToTurtle(store: Store): Promise<string> {
    const writer = new Writer({ format: 'text/turtle' });
    const quads = store.getQuads(null, null, null, null);
    
    return new Promise((resolve, reject) => {
      writer.addQuads(quads);
      writer.end((error, result) => {
        if (error) reject(error);
        else resolve(result);
      });
    });
  }
}