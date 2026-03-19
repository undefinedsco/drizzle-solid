/**
 * LDP Executor Implementation
 *
 * 负责 LDP 模式下的写操作 (N3 Patch)，剥离自 PodDialect
 */

import type { PodTable } from '../schema';
import type { ComunicaSPARQLExecutor } from '../sparql-executor';
import { TripleBuilderImpl } from '../triple/builder';
import type { UriResolver } from '../uri';

type QueryBinding = {
  get: (key: string) => unknown;
};

type QueryTerm = {
  termType?: string;
  value?: string;
};

export class LdpExecutor {
  private sparqlExecutor: ComunicaSPARQLExecutor;
  private fetchFn: typeof fetch;
  private tripleBuilder: TripleBuilderImpl;
  private uriResolver: UriResolver;

  constructor(sparqlExecutor: ComunicaSPARQLExecutor, fetchFn: typeof fetch, uriResolver: UriResolver) {
    this.sparqlExecutor = sparqlExecutor;
    this.fetchFn = fetchFn;
    this.uriResolver = uriResolver;
    this.tripleBuilder = new TripleBuilderImpl(uriResolver);
  }

  /**
   * 设置表注册表（用于 URI 引用自动补全）
   * @param classRegistry rdfClass -> tables[] 的映射
   * @param nameRegistry tableName -> table 的映射
   */
  setTableRegistry(
    classRegistry: Map<string, PodTable[]>,
    nameRegistry: Map<string, PodTable>
  ): void {
    this.tripleBuilder.setTableRegistry(classRegistry, nameRegistry);
  }

  /**
   * 设置基础 URI
   */
  setBaseUri(uri: string): void {
    this.tripleBuilder.setBaseUri(uri);
  }

  /**
   * 执行 INSERT 操作
   */
  async executeInsert(
    rows: any[],
    table: PodTable,
    resourceUrl: string
  ): Promise<any[]> {
    const insertTriples: string[] = [];

    rows.forEach((row, idx) => {
      // 使用 SubjectResolver 生成 URI
      const subject = this.uriResolver.resolveSubject(table, row, idx);

      // 1. rdf:type
      const typeTriple = this.tripleBuilder.buildTypeTriple(subject, table.config.type as string);
      insertTriples.push(...this.tripleBuilder.toN3Strings([typeTriple]));

      // 2. 处理所有列（跳过纯主键列）
      Object.entries(table.columns ?? {}).forEach(([key, col]) => {
        if (row[key] === undefined || row[key] === null) return;

        // 跳过纯主键列（predicate 为 @id 的列）
        // 这类列只用于生成 subject URI，不需要单独的三元组
        // 但如果主键列有显式的 predicate（如 schema:identifier），则应该写入
        if ((col as any)._virtualId) return;
        const predicate = (col as any).options?.predicate || (col as any)._predicateUri;
        if (predicate === '@id') return;

        const result = this.tripleBuilder.buildInsert(subject, col as any, row[key], table);
        insertTriples.push(...this.tripleBuilder.toN3Strings(result.triples));

        if (result.childTriples && result.childTriples.length > 0) {
          insertTriples.push(...this.tripleBuilder.toN3Strings(result.childTriples));
        }
      });
    });

    if (insertTriples.length === 0) {
      return [];
    }

    const mode = this.uriResolver.getResourceMode(table);

    // Document Mode: 每条记录写入各自的文件
    // 但如果多条记录共享同一个资源 URL（如同一天的 messages.ttl），则合并写入
    if (mode === 'document') {
      // 按 resourceUrl 分组收集三元组
      const resourceTriples = new Map<string, string[]>();

      for (let idx = 0; idx < rows.length; idx++) {
        const row = rows[idx];
        const subject = this.uriResolver.resolveSubject(table, row, idx);

        // 从 subject URI 提取资源 URL (去掉 fragment 如果有)
        const docResourceUrl = this.uriResolver.getResourceUrl(subject);

        // 收集该记录的三元组
        const recordTriples: string[] = [];
        const typeTriple = this.tripleBuilder.buildTypeTriple(subject, table.config.type as string);
        recordTriples.push(...this.tripleBuilder.toN3Strings([typeTriple]));

        Object.entries(table.columns ?? {}).forEach(([key, col]) => {
          if (row[key] === undefined || row[key] === null) return;
          // 跳过纯主键列（predicate 为 @id 的列）
          if ((col as any)._virtualId) return;
          const predicate = (col as any).options?.predicate || (col as any)._predicateUri;
          if (predicate === '@id') return;
          const result = this.tripleBuilder.buildInsert(subject, col as any, row[key], table);
          recordTriples.push(...this.tripleBuilder.toN3Strings(result.triples));
          if (result.childTriples && result.childTriples.length > 0) {
            recordTriples.push(...this.tripleBuilder.toN3Strings(result.childTriples));
          }
        });

        if (recordTriples.length === 0) continue;

        // 按 resourceUrl 分组
        const existing = resourceTriples.get(docResourceUrl) || [];
        existing.push(...recordTriples);
        resourceTriples.set(docResourceUrl, existing);
      }

      // 对每个唯一的 resourceUrl 执行一次写入
      const results: any[] = [];
      for (const [docResourceUrl, triples] of resourceTriples.entries()) {
        // 检查资源是否已存在，如果存在则使用 PATCH 追加
        const headRes = await this.fetchFn(docResourceUrl, { method: 'HEAD' });
        const resourceExists = headRes.ok || headRes.status === 405;

        let response;
        if (resourceExists) {
          // 资源已存在，使用 SPARQL UPDATE 追加三元组
          const sparql = `INSERT DATA {\n${triples.join('\n')}\n}`;

          response = await this.fetchFn(docResourceUrl, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/sparql-update' },
            body: sparql
          });
        } else {
          // 资源不存在，使用 PUT 创建
          const body = triples.join('\n');

          response = await this.fetchFn(docResourceUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'text/turtle' },
            body
          });
        }

        if (![200, 201, 202, 204, 205].includes(response.status)) {
          const text = await response.text().catch(() => '');
          throw new Error(`Write failed for ${docResourceUrl}: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`);
        }

        await this.sparqlExecutor.invalidateHttpCache(docResourceUrl);
        const lastSlash = docResourceUrl.lastIndexOf('/');
        if (lastSlash > 0) {
          const containerUrl = docResourceUrl.slice(0, lastSlash + 1);
          await this.sparqlExecutor.invalidateHttpCache(containerUrl);
        }
        // Also invalidate global cache to ensure SPARQL endpoint queries see the new data
        await this.sparqlExecutor.invalidateHttpCache(undefined as any).catch(() => undefined);
        results.push({ success: true, source: docResourceUrl, status: response.status, via: resourceExists ? 'patch' : 'put' });
      }
      return results;
    }

    // Fragment Mode: 所有记录写入同一个文件
    // 使用 SPARQL UPDATE (INSERT DATA) 进行插入
    const sparql = `INSERT DATA {\n${insertTriples.join('\n')}\n}`;
    
    let response = await this.fetchFn(resourceUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/sparql-update' },
      body: sparql
    });

    // 如果返回 201（创建）但实际可能没创建资源，验证一下
    // 如果资源不存在 (404) 或创建后仍不可访问，先 PUT 创建再重试
    if (response.status === 404 || response.status === 201) {
      // 验证资源是否真的存在
      const checkRes = await this.fetchFn(resourceUrl, { method: 'HEAD' });
      if (!checkRes.ok && checkRes.status !== 405) {
        // 资源不存在，先创建
        const createRes = await this.fetchFn(resourceUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'text/turtle' },
          body: ''
        });
        if (createRes.ok || createRes.status === 409 || createRes.status === 201) {
          // 重试 SPARQL UPDATE
          response = await this.fetchFn(resourceUrl, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/sparql-update' },
            body: sparql
          });
        }
      }
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const err: any = new Error(`SPARQL UPDATE INSERT failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`);
      err.status = response.status;
      throw err;
    }

    // 清理缓存：资源本身和容器
    await this.sparqlExecutor.invalidateHttpCache(resourceUrl);
    const lastSlash = resourceUrl.lastIndexOf('/');
    if (lastSlash > 0) {
      const containerUrl = resourceUrl.slice(0, lastSlash + 1);
      await this.sparqlExecutor.invalidateHttpCache(containerUrl);
    }
    // Also invalidate global cache to ensure SPARQL endpoint queries see the new data
    await this.sparqlExecutor.invalidateHttpCache(undefined as any).catch(() => undefined);

    return [{ success: true, source: resourceUrl, status: response.status, via: 'sparql-update' }];
  }

  /**
   * 执行 UPDATE 操作
   */
  async executeUpdate(
    table: PodTable,
    data: Record<string, any>,
    subjects: string[],
    resourceUrl: string
  ): Promise<any[]> {
    if (!subjects.length) {
      return [];
    }

    const results: any[] = [];
    const mode = this.uriResolver.getResourceMode(table);

    for (const subject of subjects) {
      // Document mode: 从 subject URI 获取资源 URL
      const targetResourceUrl = mode === 'document'
        ? this.uriResolver.getResourceUrl(subject)
        : resourceUrl;

      // 1. 获取普通字段的 Patch 数据（无 WHERE 子句）
      const patchData = await this.buildUpdatePatchPayload(subject, table, data, targetResourceUrl);
      
      if (!patchData) continue;
      
      const { deleteTriples, insertTriples, deleteWherePatterns } = patchData;
      
      // 2. 处理内联对象字段（TripleBuilder 的 buildDelete 和 buildInsert 已经处理了逻辑）
      // 但我们需要先查询旧的内联对象以便删除
      // 这里需要特殊的逻辑来处理"更新"语义：先删旧的，再插新的
      
      // 额外的内联对象清理逻辑
      const entries = Object.entries(data).filter(([_, value]) => value !== undefined);
      for (const [key] of entries) {
        // 跳过系统字段
        if (key === '@id' || key === 'subject') continue;
        
        const col = (table as any).columns?.[key] as any;
        if (!col) continue;
        
        // 跳过虚拟 ID 列
        if ((col as any)._virtualId || col.options?.predicate === '@id') continue;
        
        // 检查是否是内联对象列
        const isInline = col.dataType === 'object' || col.dataType === 'json' || 
                       (col.dataType === 'array' && (col.elementType === 'object' || col.options?.baseType === 'object'));
        
        if (!isInline) continue;

        const predicate = this.tripleBuilder.getPredicateUri(col, table);

        // A. 查找旧的内联对象
        // 使用 SPARQL 查询找到旧的链接
        const childUris = await this.fetchExistingObjects(targetResourceUrl, subject, predicate);

        for (const childUriRaw of childUris) {
           let childUri = childUriRaw;
           if (!childUri.startsWith('<') && !childUri.startsWith('_:')) {
             childUri = `<${childUri}>`;
           }

           // 删除链接: <subject> <predicate> <childUri> .
           deleteTriples.push(`<${subject}> <${predicate}> ${childUri} .`);

           // 删除子对象的所有三元组 (递归)
           if (childUri.startsWith('<')) {
             const cleanUri = childUri.slice(1, -1);
             const childTriples = await this.fetchRecursiveTriplesToDelete(cleanUri, table, targetResourceUrl);
             deleteTriples.push(...childTriples);
           }
        }

        // B. 插入逻辑由 buildInsert 处理，已经包含在 patchData.insertTriples 中
      }

      // 去重和冲突检查
      const uniqueDeletes = Array.from(new Set(deleteTriples));
      const uniqueInserts = Array.from(new Set(insertTriples));

      // CSS N3 Patch forbids deleting and inserting the same triple in one patch
      const finalDeletes = uniqueDeletes.filter(t => !uniqueInserts.includes(t));
      const finalInserts = uniqueInserts.filter(t => !uniqueDeletes.includes(t));

      if (finalDeletes.length === 0 && finalInserts.length === 0) {
          continue;
      }

      const res = await this.executeN3Patch(targetResourceUrl, finalDeletes, finalInserts, [], deleteWherePatterns);
      results.push(...res);
      
      // Delay between updates to prevent server overload/locking
      await new Promise(r => setTimeout(r, 200));
    }

    return results;
  }

  /**
   * 执行 DELETE 操作
   */
  async executeDelete(
    subjects: string[],
    table: PodTable,
    resourceUrl: string
  ): Promise<any[]> {
    const results: any[] = [];
    const mode = this.uriResolver.getResourceMode(table);

    for (const subject of subjects) {
      try {
        // Document mode: 从 subject URI 获取资源 URL
        const targetResourceUrl = mode === 'document'
          ? this.uriResolver.getResourceUrl(subject)
          : resourceUrl;

        // Recursively fetch all triples for this subject and its inline children
        const deleteTriples = await this.fetchRecursiveTriplesToDelete(subject, table, targetResourceUrl);
        const uniqueDeletes = Array.from(new Set(deleteTriples));

        if (uniqueDeletes.length > 0) {
          const patchRes = await this.executeN3Patch(
            targetResourceUrl,
            uniqueDeletes,
            [],
            [] // Empty WHERE since we delete explicit triples
          );
          results.push(...patchRes);
        }
      } catch (error) {
        console.error(`[DELETE] Failed to delete subject ${subject}:`, error);
        throw error;
      }
    }

    return results;
  }

  // ================= Private Helpers =================

  /**
   * Execute a function with exponential backoff retry on server errors
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<{ response: Response | null; result?: T; shouldRetry: boolean; fallback?: () => Promise<T> }>,
    maxRetries: number = 3
  ): Promise<{ response: Response | null; result?: T; lastError?: unknown }> {
    let response: Response | null = null;
    let lastError: unknown;

    for (let i = 0; i < maxRetries; i++) {
      try {
        const outcome = await fn();
        response = outcome.response;

        if (outcome.result !== undefined) {
          return { response, result: outcome.result };
        }

        if (outcome.fallback) {
          const fallbackResult = await outcome.fallback();
          return { response, result: fallbackResult };
        }

        if (!outcome.shouldRetry) {
          break;
        }

        await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      } catch (e) {
        lastError = e;
        if (i < maxRetries - 1) {
          await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
      }
    }

    return { response, lastError };
  }

  /**
   * Build error from failed response
   */
  private async buildPatchError(
    response: Response | null,
    lastError: unknown,
    errorPrefix: string
  ): Promise<Error> {
    const text = response ? await response.text().catch(() => '') : '';
    const status = response ? response.status : 'Network Error';
    const statusText = response ? response.statusText : (lastError instanceof Error ? lastError.message : String(lastError));
    const error: any = new Error(`${errorPrefix} failed: ${status} ${statusText}${text ? ` - ${text}` : ''}`);
    error.status = status;
    return error;
  }

  private async buildUpdatePatchPayload(
    subject: string,
    table: PodTable,
    data: Record<string, any>,
    resourceUrl: string
  ): Promise<{ deleteTriples: string[]; insertTriples: string[]; deleteWherePatterns: string[] } | null> {
    const deleteTriples: string[] = [];
    const insertTriples: string[] = [];
    const deleteWherePatterns: string[] = [];

    for (const [key, rawValue] of Object.entries(data)) {
      if (rawValue === undefined) continue;
      
      // 跳过 @id 和 subject 等系统字段（不允许修改主键）
      if (key === '@id' || key === 'subject') continue;
      
      const col = (table as any).columns?.[key] as any;
      if (!col) continue;
      
      // 跳过虚拟 ID 列（predicate 是 @id，不是有效的 RDF URI）
      if ((col as any)._virtualId || col.options?.predicate === '@id') continue;
      
      // 内联对象特殊处理在 executeUpdate 主循环中做
      const isInline = col.dataType === 'object' || col.dataType === 'json' || 
                     (col.dataType === 'array' && (col.elementType === 'object' || col.options?.baseType === 'object'));
      
      if (isInline) {
        // 只处理插入部分，删除部分由主循环处理
        if (rawValue !== null) {
            const result = this.tripleBuilder.buildInsert(subject, col, rawValue, table);
            insertTriples.push(...this.tripleBuilder.toN3Strings(result.triples));
            if (result.childTriples) {
                insertTriples.push(...this.tripleBuilder.toN3Strings(result.childTriples));
            }
        }
        continue;
      }

      const predicate = this.tripleBuilder.getPredicateUri(col, table);
      const isInverse = Boolean(col.options?.inverse);
      const safeKey = key.replace(/[^a-zA-Z0-9_]/g, '_');

      if (isInverse) {
         // Delete all inverse links for this predicate to avoid stale values.
         deleteWherePatterns.push(`?s_${safeKey} <${predicate}> <${subject}> .`);
         // Inverse logic
         const existingSubjects = await this.fetchInverseSubjects(resourceUrl, subject, predicate);
         
         existingSubjects.forEach(s => {
           let sUri = s;
           if (!sUri.startsWith('<') && !sUri.startsWith('_:')) sUri = `<${sUri}>`;
           deleteTriples.push(`${sUri} <${predicate}> <${subject}> .`);
         });

         if (rawValue !== null) {
             // 使用 TripleBuilder 构建插入
             const result = this.tripleBuilder.buildInsert(subject, col, rawValue, table);
             insertTriples.push(...this.tripleBuilder.toN3Strings(result.triples));
         }
         continue;
      }

      // Normal logic
      // fetch existing values to build concrete delete triples
      // Delete all existing predicate values to avoid stale literals (e.g. updatedAt duplication).
      deleteWherePatterns.push(`<${subject}> <${predicate}> ?o_${safeKey} .`);

      const existingValues = await this.fetchExistingObjects(resourceUrl, subject, predicate);
      
      existingValues.forEach((existing) => {
        // existing is already formatted N3 term from formatTerm
        deleteTriples.push(`<${subject}> <${predicate}> ${existing} .`);
      });

      if (rawValue === null) {
        continue;
      }

      const result = this.tripleBuilder.buildInsert(subject, col, rawValue, table);
      insertTriples.push(...this.tripleBuilder.toN3Strings(result.triples));
    }

    return { deleteTriples, insertTriples, deleteWherePatterns };
  }

  /**
   * 执行更新操作
   *
   * 优先尝试 SPARQL UPDATE (application/sparql-update)，
   * xpod 内部使用 SPARQL，标准 CSS 也支持。
   * 如果失败，回退到 N3 Patch。
   */
  private async executeN3Patch(
    resourceUrl: string,
    deleteTriples: string[],
    insertTriples: string[],
    wherePatterns: string[] = [],
    deleteWherePatterns: string[] = []
  ): Promise<any[]> {
    if (deleteTriples.length === 0 && insertTriples.length === 0 && deleteWherePatterns.length === 0) {
      return [];
    }

    const sparqlUpdate = this.buildSparqlUpdate(deleteTriples, insertTriples, deleteWherePatterns);

    const { response, result, lastError } = await this.retryWithBackoff<any[]>(async () => {
      const res = await this.fetchFn(resourceUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/sparql-update' },
        body: sparqlUpdate
      });

      if (res.ok) {
        await this.sparqlExecutor.invalidateHttpCache(resourceUrl);
        return {
          response: res,
          result: [{ success: true, source: resourceUrl, status: res.status, via: 'sparql-update' }],
          shouldRetry: false
        };
      }

      // SPARQL UPDATE not supported, fallback to N3 Patch
      if (res.status === 415 || res.status === 405) {
        const fallbackDeletes = deleteWherePatterns.length > 0
          ? [...deleteTriples, ...deleteWherePatterns]
          : deleteTriples;
        const fallbackWhere = deleteWherePatterns.length > 0
          ? deleteWherePatterns
          : wherePatterns;
        return {
          response: res,
          shouldRetry: false,
          fallback: () => this.executeN3PatchInternal(resourceUrl, fallbackDeletes, insertTriples, fallbackWhere)
        };
      }

      // Server error, retry
      const shouldRetry = res.status >= 500 || res.status === 409;
      return { response: res, shouldRetry };
    });

    if (result) {
      return result;
    }

    throw await this.buildPatchError(response, lastError, 'SPARQL UPDATE');
  }

  /**
   * 构建 SPARQL UPDATE 查询
   */
  private buildSparqlUpdate(
    deleteTriples: string[],
    insertTriples: string[],
    deleteWherePatterns: string[]
  ): string {
    const parts: string[] = [];
    
    if (deleteWherePatterns.length > 0) {
      for (const pattern of deleteWherePatterns) {
        parts.push(`DELETE WHERE {\n${pattern}\n}`);
      }
    }

    if (deleteTriples.length > 0) {
      parts.push(`DELETE DATA {\n${deleteTriples.join('\n')}\n}`);
    }
    
    if (insertTriples.length > 0) {
      parts.push(`INSERT DATA {\n${insertTriples.join('\n')}\n}`);
    }
    
    // 如果同时有删除和插入，用分号连接（CSS 支持多条语句）
    return parts.join(';\n');
  }

  /**
   * 内部 N3 Patch 实现（作为 SPARQL UPDATE 的回退）
   */
  private async executeN3PatchInternal(
    resourceUrl: string,
    deleteTriples: string[],
    insertTriples: string[],
    wherePatterns: string[] = []
  ): Promise<any[]> {
    const patch = this.tripleBuilder.buildN3Patch(deleteTriples, insertTriples, wherePatterns);

    const { response, result, lastError } = await this.retryWithBackoff<any[]>(async () => {
      let res = await this.fetchFn(resourceUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'text/n3' },
        body: patch
      });

      // Resource not found, create it and retry
      if (res.status === 404) {
        const createRes = await this.fetchFn(resourceUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'text/turtle' },
          body: ''
        });
        if (!createRes.ok && createRes.status !== 409) {
          throw new Error(`Failed to create resource ${resourceUrl}: ${createRes.status} ${createRes.statusText}`);
        }
        res = await this.fetchFn(resourceUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'text/n3' },
          body: patch
        });
      }

      if (res.ok) {
        await this.sparqlExecutor.invalidateHttpCache(resourceUrl);
        return {
          response: res,
          result: [{ success: true, source: resourceUrl, status: res.status, via: 'n3' }],
          shouldRetry: false
        };
      }

      const shouldRetry = res.status >= 500 || res.status === 409;
      return { response: res, shouldRetry };
    });

    if (result) {
      return result;
    }

    throw await this.buildPatchError(response, lastError, 'N3 PATCH');
  }

  private formatTerm(term: any): string {
    if (!term) return '';
    if (term.termType === 'NamedNode') return `<${term.value}>`;
    if (term.termType === 'BlankNode') return `_:${term.value}`;
    if (term.termType === 'Literal') {
      // Robust escaping for N-Triples/Turtle
      const escaped = String(term.value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
        
      const quoted = `"${escaped}"`;
      if (term.language) return `${quoted}@${term.language}`;
      if (term.datatype && term.datatype.value) {
        if (term.datatype.value === 'http://www.w3.org/2001/XMLSchema#integer' || term.datatype.value.endsWith('#integer')) {
          return term.value;
        }
        if (term.datatype.value !== 'http://www.w3.org/2001/XMLSchema#string') {
          return `${quoted}^^<${term.datatype.value}>`;
        }
      }
      return quoted;
    }
    return String(term.value ?? term);
  }

  private async fetchRecursiveTriplesToDelete(
    subject: string,
    table: PodTable,
    resourceUrl: string,
    visited = new Set<string>()
  ): Promise<string[]> {
    if (visited.has(subject)) return [];
    visited.add(subject);

    const query = `SELECT ?p ?o WHERE { <${subject}> ?p ?o . }`;
    const bindings = await this.sparqlExecutor.queryBindings(query, resourceUrl) as QueryBinding[];
    
    const triples: string[] = [];
    const childSubjects: string[] = [];

    bindings.forEach((binding) => {
      const p = binding.get('p') as QueryTerm | null;
      const o = binding.get('o') as QueryTerm | null;
      
      if (!p || !o) return;

      triples.push(`<${subject}> ${this.formatTerm(p)} ${this.formatTerm(o)} .`);

      if (o.termType === 'NamedNode') {
         // Check against table schema to see if this is an inline column
         const pVal = p.value;
         for (const [, col] of Object.entries((table as any).columns)) {
            const predicate = this.tripleBuilder.getPredicateUri(col as any, table);
            // Check if column is inline
            const isInline = (col as any).dataType === 'object' || (col as any).dataType === 'json' ||
                     ((col as any).dataType === 'array' && ((col as any).elementType === 'object' || (col as any).options?.baseType === 'object'));

            if (predicate === pVal && isInline && typeof o.value === 'string') {
               childSubjects.push(o.value);
            }
         }
      }
    });
    
    for (const childSubject of childSubjects) {
      const childTriples = await this.fetchRecursiveTriplesToDelete(childSubject, table, resourceUrl, visited);
      triples.push(...childTriples);
    }

    return triples;
  }

  private async fetchExistingObjects(
    resourceUrl: string,
    subject: string,
    predicate: string
  ): Promise<string[]> {
    const query = `SELECT ?o WHERE { <${subject}> <${predicate}> ?o . }`;
    const bindings = await this.sparqlExecutor.queryBindings(query, resourceUrl) as QueryBinding[];

    return bindings
      .map((binding) => {
        const o = binding.get?.('o');
        return this.formatTerm(o);
      })
      .filter((val): val is string => !!val);
  }

  private async fetchInverseSubjects(
    resourceUrl: string,
    object: string,
    predicate: string
  ): Promise<string[]> {
    const query = `SELECT ?s WHERE { ?s <${predicate}> <${object}> . }`;
    const rows = await this.sparqlExecutor.queryContainer(resourceUrl, { type: 'SELECT', query });
    
    return rows.map((row: any) => row.s ?? row['?s']).filter(Boolean) as string[];
  }
}
