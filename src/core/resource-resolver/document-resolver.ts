/**
 * Document Mode ResourceResolver
 *
 * In document mode, each record is stored in its own file (e.g., users/alice.ttl)
 * The subject URI includes the document URL and possibly a fragment.
 * 
 * 设计原则：
 * - base = containerPath (如 http://pod/.data/items/)
 * - 默认模板: {id}.ttl#it
 * - 写入: id = "alice" → relativePath = "alice.ttl#it" → uri = base + relativePath
 * - 读取: uri - base = "alice.ttl#it" → 反向解析模板 → id = "alice"
 */

import type { PodTable } from '../schema';
import type { QueryCondition } from '../query-conditions';
import { BaseResourceResolver } from './base-resolver';
import { getGlobalDebugLogger } from '../utils/debug-logger';

/**
 * 默认的 document 模板
 */
const DEFAULT_TEMPLATE = '{id}.ttl#it';

export class DocumentResourceResolver extends BaseResourceResolver {
  readonly mode = 'document' as const;

  private buildUnsupportedCollectionReadError(table: PodTable): Error {
    return new Error(
      `Document-mode collection queries over plain LDP are not supported for table "${table.config.name}". ` +
      `Configure a global query capability (SPARQL endpoint or index), ` +
      `or use findByLocator()/findByIri() for exact-target reads.`
    );
  }

  private buildUnsupportedCollectionMutationError(table: PodTable): Error {
    return new Error(
      `Document-mode collection mutations over plain LDP are not supported for table "${table.config.name}". ` +
      `Use updateByLocator()/updateByIri() or deleteByLocator()/deleteByIri() ` +
      `for exact-target mutations.`
    );
  }

  /**
   * 获取默认模板
   */
  protected getDefaultTemplate(): string {
    return DEFAULT_TEMPLATE;
  }

  getContainerUrl(table: PodTable): string {
    // In document mode, use the table's container path
    const containerPath = table.getContainerPath();

    // If absolute URL, return as-is
    if (containerPath.startsWith('http://') || containerPath.startsWith('https://')) {
      return containerPath;
    }

    // Resolve relative path against pod base
    const base = this.podBaseUrl.endsWith('/') ? this.podBaseUrl : `${this.podBaseUrl}/`;
    const normalizedPath = containerPath.startsWith('/') ? containerPath.slice(1) : containerPath;
    return new URL(normalizedPath, base).toString();
  }

  getResourceUrl(table: PodTable): string {
    // Default resource URL for document mode (used for type index, etc.)
    // This is the container + table name + .ttl
    const containerUrl = this.getContainerUrl(table);
    return `${containerUrl}${table.config.name}.ttl`;
  }

  /**
   * 获取表的 base URL
   * 
   * Document 模式下，base 是容器路径（以 / 结尾）
   */
  protected getBaseUrlForTable(table: PodTable): string {
    return this.getContainerUrl(table);
  }

  getResourceUrlForSubject(subjectUri: string): string {
    // In document mode, remove fragment to get resource URL
    const hashIndex = subjectUri.indexOf('#');
    if (hashIndex !== -1) {
      return subjectUri.substring(0, hashIndex);
    }
    return subjectUri;
  }

  async resolveSelectSources(
    table: PodTable,
    containerUrl: string,
    condition?: QueryCondition,
    listContainer?: (url?: string) => Promise<string[]>
  ): Promise<string[]> {
    const debug = getGlobalDebugLogger();

    const template = this.getEffectiveTemplate(table);
    const requiredVars = Array.from(
      new Set(this.getTemplateVariables(template).map((variable) => variable.field)),
    ).filter((field) => field !== 'id' && field !== 'index');
    const idValues = this.extractIdValues(condition);

    // Collect all available template variable values from condition
    const templateValues: Record<string, string> = this.extractTemplateValues(condition, requiredVars);
    if (idValues.length > 0 && !('id' in templateValues)) {
      templateValues['id'] = idValues[0];
    }

    debug.group(`[Document Resolver] Resolving SELECT sources for table: ${(table as any).name || 'unknown'}`);
    debug.log('Template:', template);
    debug.log('ID values from condition:', idValues);
    debug.log('Template values:', templateValues);

    // 1. Full URI via @id → use directly
    if (idValues.length > 0) {
      const idValue = idValues[0];
      if (this.isAbsoluteUri(idValue)) {
        debug.log('Full URI provided, using directly');
        debug.groupEnd();
        return idValues.map(id => this.getResourceUrlForSubject(id));
      }
    }

    // 2. Try resolveSubject with all available values
    if (idValues.length > 0) {
      const allVarsPresent = requiredVars.every(v => v in templateValues);

      if (allVarsPresent) {
        debug.log('All variables present, resolving directly');
        const sources = idValues.map(id => {
          const subjectUri = this.resolveSubject(table, { ...templateValues, id });
          return this.getResourceUrlForSubject(subjectUri);
        });
        debug.log('Resolved sources:', sources);
        debug.groupEnd();
        return sources;
      }

      // id present but missing other required variables → error
      const missing = requiredVars.filter(v => !(v in templateValues));
      debug.error('Missing required variables:', missing);
      debug.groupEnd();
      throw new Error(
        `Cannot resolve subjectTemplate '${template}': ` +
        `missing required variable(s) [${missing.join(', ')}] in query condition. ` +
        `Add eq(table.${missing[0]}, value) to your where clause.`
      );
    }

    debug.error('Document-mode LDP collection query is unsupported without an exact target');
    debug.groupEnd();
    void containerUrl;
    void listContainer;
    throw this.buildUnsupportedCollectionReadError(table);
  }

  async resolveSubjectsForMutation(
    table: PodTable,
    condition: QueryCondition,
    findSubjects: (resourceUrl: string) => Promise<string[]>,
    listContainer: () => Promise<string[]>
  ): Promise<string[]> {
    const template = this.getEffectiveTemplate(table);
    const requiredVars = Array.from(
      new Set(this.getTemplateVariables(template).map((variable) => variable.field)),
    ).filter((field) => field !== 'id' && field !== 'index');
    const idValues = this.extractIdValues(condition);

    // Collect all available template variable values from condition
    const templateValues: Record<string, string> = this.extractTemplateValues(condition, requiredVars);
    if (idValues.length > 0 && !('id' in templateValues)) {
      templateValues['id'] = idValues[0];
    }

    // 1. Full URI via @id → use directly
    if (idValues.length > 0) {
      const idValue = idValues[0];
      if (this.isAbsoluteUri(idValue)) {
        return idValues;
      }
    }

    // 2. Try resolveSubject with all available values
    if (idValues.length > 0) {
      const allVarsPresent = requiredVars.every(v => v in templateValues);

      if (allVarsPresent) {
        return idValues.map(id => this.resolveSubject(table, { ...templateValues, id }));
      }

      // id present but missing other required variables → error
      const missing = requiredVars.filter(v => !(v in templateValues));
      throw new Error(
        `Cannot resolve subjectTemplate '${template}' for mutation: ` +
        `missing required variable(s) [${missing.join(', ')}] in query condition. ` +
        `Add eq(table.${missing[0]}, value) to your where clause.`
      );
    }

    void findSubjects;
    void listContainer;
    throw this.buildUnsupportedCollectionMutationError(table);
  }
}
