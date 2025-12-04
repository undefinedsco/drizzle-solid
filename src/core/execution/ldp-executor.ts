/**
 * LDP Executor Implementation
 *
 * 负责 LDP 模式下的写操作 (N3 Patch)，剥离自 PodDialect
 */

import type { PodTable } from '../pod-table';
import type { ComunicaSPARQLExecutor } from '../sparql-executor';
import { tripleBuilder } from '../triple/builder';
import type { TripleBuilder } from '../triple/types';
import { subjectResolver } from '../subject';

export class LdpExecutor {
  private sparqlExecutor: ComunicaSPARQLExecutor;
  private fetchFn: typeof fetch;
  private tripleBuilder: TripleBuilder;
  
  // 用于跟踪 N3 Patch 请求数
  private n3PatchCounter = 0;

  constructor(sparqlExecutor: ComunicaSPARQLExecutor, fetchFn: typeof fetch) {
    this.sparqlExecutor = sparqlExecutor;
    this.fetchFn = fetchFn;
    this.tripleBuilder = tripleBuilder;
  }

  /**
   * 执行 INSERT 操作
   */
  async executeInsert(
    rows: any[],
    table: PodTable,
    resourceUrl: string
  ): Promise<any[]> {
    const deleteTriples: string[] = [];
    const insertTriples: string[] = [];

    rows.forEach((row, idx) => {
      // 使用 SubjectResolver 生成 URI
      const subject = subjectResolver.resolve(table, row, idx);
      
      // 1. rdf:type
      const typeTriple = this.tripleBuilder.buildTypeTriple(subject, table.config.type as string);
      insertTriples.push(...this.tripleBuilder.toN3Strings([typeTriple]));

      // 2. 处理所有列
      Object.entries(table.columns ?? {}).forEach(([key, col]) => {
        if (row[key] === undefined || row[key] === null) return;
        
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

    const mode = subjectResolver.getResourceMode(table);

    // Document Mode: 每条记录单独写入各自的文件
    if (mode === 'document') {
      const results: any[] = [];
      for (let idx = 0; idx < rows.length; idx++) {
        const row = rows[idx];
        const subject = subjectResolver.resolve(table, row, idx);

        // 从 subject URI 提取资源 URL (去掉 fragment 如果有)
        const docResourceUrl = subjectResolver.getResourceUrl(subject);
        console.log(`[LdpExecutor] Document mode INSERT: subject=${subject}, resourceUrl=${docResourceUrl}`);

        // 收集该记录的三元组
        const recordTriples: string[] = [];
        const typeTriple = this.tripleBuilder.buildTypeTriple(subject, table.config.type as string);
        recordTriples.push(...this.tripleBuilder.toN3Strings([typeTriple]));

        Object.entries(table.columns ?? {}).forEach(([key, col]) => {
          if (row[key] === undefined || row[key] === null) return;
          const result = this.tripleBuilder.buildInsert(subject, col as any, row[key], table);
          recordTriples.push(...this.tripleBuilder.toN3Strings(result.triples));
          if (result.childTriples && result.childTriples.length > 0) {
            recordTriples.push(...this.tripleBuilder.toN3Strings(result.childTriples));
          }
        });

        if (recordTriples.length === 0) continue;

        const body = recordTriples.join('\n');
        const response = await this.fetchFn(docResourceUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'text/turtle' },
          body
        });

        if (![200, 201, 202, 204, 205].includes(response.status)) {
          const text = await response.text().catch(() => '');
          throw new Error(`PUT failed for ${docResourceUrl}: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`);
        }

        await this.sparqlExecutor.invalidateHttpCache(docResourceUrl);
        results.push({ success: true, source: docResourceUrl, status: response.status, via: 'put' });
      }
      return results;
    }

    // Fragment Mode: 所有记录写入同一个文件
    const exists = await this.resourceExists(resourceUrl);
    if (exists) {
      return this.executeN3Patch(resourceUrl, [], insertTriples, []);
    }

    // 资源不存在时，使用 PUT 创建
    const body = insertTriples.join('\n');
    let response = await this.fetchFn(resourceUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/turtle' },
      body
    });

    if (![200, 201, 202, 204, 205].includes(response.status)) {
      // 尝试使用 SPARQL UPDATE (INSERT DATA) 作为降级
      const sparql = `INSERT DATA {\n${insertTriples.join('\n')}\n}`;
      try {
        const patchRes = await this.fetchFn(resourceUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/sparql-update' },
          body: sparql
        });
        if (patchRes.ok) {
          await this.sparqlExecutor.invalidateHttpCache(resourceUrl);
          return [{ success: true, source: resourceUrl, status: patchRes.status, via: 'sparql-update' }];
        }
        response = patchRes;
      } catch (fallbackError) {
        const text = await response.text().catch(() => '');
        const err: any = new Error(`PUT failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''} (fallback error: ${String(fallbackError)})`);
        err.status = response?.status;
        throw err;
      }

      const text = await response.text().catch(() => '');
      const err: any = new Error(`PUT failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`);
      err.status = response.status;
      throw err;
    }

    await this.sparqlExecutor.invalidateHttpCache(resourceUrl);
    return [{ success: true, source: resourceUrl, status: response.status, via: 'put' }];
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
    const mode = subjectResolver.getResourceMode(table);

    for (const subject of subjects) {
      // Document mode: 从 subject URI 获取资源 URL
      const targetResourceUrl = mode === 'document'
        ? subjectResolver.getResourceUrl(subject)
        : resourceUrl;

      // 1. 获取普通字段的 Patch 数据（无 WHERE 子句）
      const patchData = await this.buildUpdatePatchPayload(subject, table, data, targetResourceUrl);
      
      if (!patchData) continue;
      
      const { deleteTriples, insertTriples } = patchData;
      
      // 2. 处理内联对象字段（TripleBuilder 的 buildDelete 和 buildInsert 已经处理了逻辑）
      // 但我们需要先查询旧的内联对象以便删除
      // 这里需要特殊的逻辑来处理"更新"语义：先删旧的，再插新的
      
      // 额外的内联对象清理逻辑
      const entries = Object.entries(data).filter(([_, value]) => value !== undefined);
      for (const [key, rawValue] of entries) {
        const col = (table as any).columns?.[key] as any;
        if (!col) continue;
        
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

      const res = await this.executeN3Patch(targetResourceUrl, finalDeletes, finalInserts, []);
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
    const mode = subjectResolver.getResourceMode(table);

    for (const subject of subjects) {
      try {
        // Document mode: 从 subject URI 获取资源 URL
        const targetResourceUrl = mode === 'document'
          ? subjectResolver.getResourceUrl(subject)
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

  private async resourceExists(resourceUrl: string): Promise<boolean> {
    try {
      const response = await this.fetchFn(resourceUrl, { method: 'HEAD' });
      if (response.ok || response.status === 405) return true;
      if (response.status === 404) return false;
      return response.ok;
    } catch {
      return false;
    }
  }

  private async buildUpdatePatchPayload(
    subject: string,
    table: PodTable,
    data: Record<string, any>,
    resourceUrl: string
  ): Promise<{ deleteTriples: string[]; insertTriples: string[] } | null> {
    const deleteTriples: string[] = [];
    const insertTriples: string[] = [];

    for (const [key, rawValue] of Object.entries(data)) {
      if (rawValue === undefined) continue;
      
      const col = (table as any).columns?.[key] as any;
      if (!col) continue;
      
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

      if (isInverse) {
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

    return { deleteTriples, insertTriples };
  }

  private async executeN3Patch(
    resourceUrl: string,
    deleteTriples: string[],
    insertTriples: string[],
    wherePatterns: string[] = []
  ): Promise<any[]> {
    if (deleteTriples.length === 0 && insertTriples.length === 0) {
      return [];
    }

    // Skip SPARQL Update for now as it causes transaction issues in CSS
    // const sparqlUpdate = this.buildDataUpdate(deleteTriples, insertTriples);
    // if (sparqlUpdate) {
    //   const ok = await this.trySparqlPatch(resourceUrl, sparqlUpdate);
    //   if (ok) {
    //     await this.sparqlExecutor.invalidateHttpCache(resourceUrl);
    //     return [{ success: true, source: resourceUrl, status: 205, via: 'sparql-update' }];
    //   }
    // }

    // Use PUT fallback (Read-Modify-Write) for consistency
    const putOk = await this.applyByPut(resourceUrl, deleteTriples, insertTriples);
    if (putOk) {
      await this.sparqlExecutor.invalidateHttpCache(resourceUrl);
      return [{ success: true, source: resourceUrl, status: 200, via: 'put-rewrite' }];
    }

    // Fallback to N3 Patch if PUT logic fails (should unlikely happen if resource is accessible)
    this.n3PatchCounter++;
    const patch = this.tripleBuilder.buildN3Patch(deleteTriples, insertTriples, wherePatterns);
    
    let response;
    let lastError;

    for (let i = 0; i < 3; i++) {
      try {
        response = await this.fetchFn(resourceUrl, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'text/n3'
          },
          body: patch
        });

        if (response.status === 404) {
          // 创建资源后重试
          const createRes = await this.fetchFn(resourceUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'text/turtle' },
            body: ''
          });
          if (!createRes.ok && createRes.status !== 409) {
            throw new Error(`Failed to create resource ${resourceUrl}: ${createRes.status} ${createRes.statusText}`);
          }
          response = await this.fetchFn(resourceUrl, {
            method: 'PATCH',
            headers: { 'Content-Type': 'text/n3' },
            body: patch
          });
        }

        if (response.ok) break;
        
        if (response.status >= 500 || response.status === 409) {
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
        break;
      } catch (e) {
        lastError = e;
        if (i < 2) await new Promise(r => setTimeout(r, 1000));
      }
    }

    if (!response || !response.ok) {
      const text = response ? await response.text().catch(() => '') : '';
      const status = response ? response.status : 'Network Error';
      const statusText = response ? response.statusText : (lastError instanceof Error ? (lastError as Error).message : String(lastError));
      const error: any = new Error(`N3 PATCH failed: ${status} ${statusText}${text ? ` - ${text}` : ''}`);
      error.status = status;
      throw error;
    }

    await this.sparqlExecutor.invalidateHttpCache(resourceUrl);

    return [{ success: true, source: resourceUrl, status: response.status, via: 'n3' }];
  }

  private buildDataUpdate(deleteTriples: string[], insertTriples: string[]): string | null {
    const normalize = (t: string): string =>
      t.trim().endsWith('.') ? t.trim() : `${t.trim()} .`;

    const deletes = deleteTriples.length > 0
      ? `DELETE DATA {\n${deleteTriples.map(normalize).join('\n')}\n};\n`
      : '';
    const inserts = insertTriples.length > 0
      ? `INSERT DATA {\n${insertTriples.map(normalize).join('\n')}\n};`
      : '';

    const payload = `${deletes}${inserts}`.trim();
    return payload.length === 0 ? null : payload;
  }

  private async trySparqlPatch(resourceUrl: string, sparql: string): Promise<boolean> {
    try {
      const response = await this.fetchFn(resourceUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/sparql-update' },
        body: sparql
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  private async applyByPut(resourceUrl: string, deleteTriples: string[], insertTriples: string[]): Promise<boolean> {
    try {
      // Ensure we have the latest version before reading for RMW
      await this.sparqlExecutor.invalidateHttpCache(resourceUrl);

      const bindings = await this.sparqlExecutor.queryBindings(
        'SELECT ?s ?p ?o WHERE { ?s ?p ?o . }',
        resourceUrl
      );

      // Simple normalization: just trim. Both deleteTriples and current are constructed with "s p o ." format.
      const normalize = (t: string): string => t.trim();

      const currentStrings = bindings
        .map((binding) => {
          const s = this.formatTerm(binding.get('s'));
          const p = this.formatTerm(binding.get('p'));
          const o = this.formatTerm(binding.get('o'));
          if (!s || !p || !o) return null;
          return `${s} ${p} ${o} .`;
        })
        .filter((v): v is string => !!v);
        
      const current = new Set(currentStrings);

      deleteTriples.map(normalize).forEach((t) => current.delete(t));
      insertTriples.map(normalize).forEach((t) => current.add(t));

      const body = Array.from(current).join('\n');
      
      const response = await this.fetchFn(resourceUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/turtle' },
        body
      });

      return response.ok;
    } catch (error) {
      return false;
    }
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
    const bindings = await this.sparqlExecutor.queryBindings(query, resourceUrl);
    
    const triples: string[] = [];
    const childSubjects: string[] = [];

    bindings.forEach((binding) => {
      const p = binding.get('p');
      const o = binding.get('o');
      
      if (!p || !o) return;

      triples.push(`<${subject}> ${this.formatTerm(p)} ${this.formatTerm(o)} .`);

      if (o.termType === 'NamedNode') {
         // Check against table schema to see if this is an inline column
         const pVal = p.value;
         for (const [colName, col] of Object.entries((table as any).columns)) {
            const predicate = this.tripleBuilder.getPredicateUri(col as any, table);
            // Check if column is inline
            const isInline = (col as any).dataType === 'object' || (col as any).dataType === 'json' || 
                     ((col as any).dataType === 'array' && ((col as any).elementType === 'object' || (col as any).options?.baseType === 'object'));
            
            if (predicate === pVal && isInline) {
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
    const bindings = await this.sparqlExecutor.queryBindings(query, resourceUrl);
    
    // console.log(`[LdpExecutor] fetchExistingObjects: ${subject} ${predicate} -> ${bindings.length} results`);

    return bindings
      .map((binding) => this.formatTerm(binding.get('o')))
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
