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
import { UriResolverImpl } from '../uri/resolver';

/**
 * 默认的 document 模板
 */
const DEFAULT_TEMPLATE = '{id}.ttl#it';

export class DocumentResourceResolver extends BaseResourceResolver {
  readonly mode = 'document' as const;
  private uriResolver = new UriResolverImpl();

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
    // 1. Check if subjectTemplate has variables other than {id}
    const template = this.getEffectiveTemplate(table);
    const variables = Array.from(template.matchAll(/\{([^}]+)\}/g)).map(m => m[1]);
    const requiredVars = variables.filter(v => v !== 'id' && v !== 'index');
    const idValues = this.extractIdValues(condition);

    // 2. With id condition: only use fast path if template has no other variables
    if (idValues.length > 0 && requiredVars.length === 0) {
      return idValues.map(id => {
        const subjectUri = this.resolveSubject(table, { id });
        return this.getResourceUrlForSubject(subjectUri);
      });
    }

    // 3. Multi-variable template: try to resolve with all available values
    if (requiredVars.length > 0) {
      const templateValues = this.extractTemplateValues(condition, requiredVars);

      // Merge id values into templateValues if available
      if (idValues.length > 0 && !('id' in templateValues)) {
        templateValues['id'] = idValues[0];
      }

      const allVarsPresent = requiredVars.every(v => v in templateValues);

      // id provided but missing other required template variables — error
      if (idValues.length > 0 && !allVarsPresent) {
        const missing = requiredVars.filter(v => !(v in templateValues));
        throw new Error(
          `Cannot resolve subjectTemplate '${template}': ` +
          `missing required variable(s) [${missing.join(', ')}] in query condition. ` +
          `Add eq(table.${missing[0]}, value) to your where clause.`
        );
      }

      if (allVarsPresent) {
        // Check if we also have id - if so, we can resolve the complete path
        const hasId = idValues.length > 0 || 'id' in templateValues;

        if (hasId) {
          // All variables including id are present - resolve directly
          const id = idValues[0] || templateValues['id'];
          const subjectUri = this.resolveSubject(table, { ...templateValues, id });
          return [this.getResourceUrlForSubject(subjectUri)];
        }

        // All required vars present but no id - resolve to specific sub-container
        let partialPath = template;
        for (const [key, val] of Object.entries(templateValues)) {
           const column = (table as any).columns?.[key];
           // Use unified normalization logic from UriResolver
           const normalizedVal = this.uriResolver.normalizeValue(val, column);
           partialPath = partialPath.replace(new RegExp(`\\{${key}\\}`, 'g'), normalizedVal);
        }

        const baseUrl = this.getContainerUrl(table);
        const firstbrace = partialPath.indexOf('{');
        let relativeContainer = partialPath;
        if (firstbrace !== -1) {
           const lastSlashBeforeBrace = partialPath.lastIndexOf('/', firstbrace);
           if (lastSlashBeforeBrace !== -1) {
             relativeContainer = partialPath.substring(0, lastSlashBeforeBrace + 1);
           } else {
             relativeContainer = '';
           }
        }

        if (relativeContainer && listContainer) {
           const specificContainer = new URL(relativeContainer, baseUrl).toString();
           // List the specific sub-container instead of the base container
           const resources = await listContainer(specificContainer);
           return resources.filter(url => url.endsWith('.ttl') && !url.endsWith('/'));
        }
      }
    }

    // 3. Fallback: scan base container for all .ttl files
    if (!listContainer) {
      return [];
    }

    const allResources = await listContainer();
    return allResources.filter(url => url.endsWith('.ttl') && !url.endsWith('/'));
  }

  async resolveSubjectsForMutation(
    table: PodTable,
    condition: QueryCondition,
    findSubjects: (resourceUrl: string) => Promise<string[]>,
    listContainer: () => Promise<string[]>
  ): Promise<string[]> {
    // Check if subjectTemplate has variables other than {id}
    const template = this.getEffectiveTemplate(table);
    const variables = Array.from(template.matchAll(/\{([^}]+)\}/g)).map(m => m[1]);
    const requiredVars = variables.filter(v => v !== 'id' && v !== 'index');
    const idValues = this.extractIdValues(condition);

    // With id condition: only use fast path if template has no other variables
    if (idValues.length > 0 && requiredVars.length === 0) {
      return idValues.map(id => this.resolveSubject(table, { id }));
    }

    // Multi-variable template: check if all variables can be resolved
    if (idValues.length > 0 && requiredVars.length > 0) {
      const templateValues = this.extractTemplateValues(condition, requiredVars);

      // Merge id values into templateValues
      if (!('id' in templateValues)) {
        templateValues['id'] = idValues[0];
      }

      const allVarsPresent = requiredVars.every(v => v in templateValues);

      // id provided but missing other required template variables — error
      if (!allVarsPresent) {
        const missing = requiredVars.filter(v => !(v in templateValues));
        throw new Error(
          `Cannot resolve subjectTemplate '${template}' for mutation: ` +
          `missing required variable(s) [${missing.join(', ')}] in query condition. ` +
          `Add eq(table.${missing[0]}, value) to your where clause.`
        );
      }

      // All variables present, can resolve subject directly
      return idValues.map(id => this.resolveSubject(table, { ...templateValues, id }));
    }

    // Without id condition: scan container and find matching subjects
    const subjects: string[] = [];
    const containerFiles = await listContainer();

    for (const fileUrl of containerFiles) {
      if (fileUrl.endsWith('.ttl') && !fileUrl.endsWith('/')) {
        try {
          const foundSubjects = await findSubjects(fileUrl);
          subjects.push(...foundSubjects);
        } catch {
          // Skip files that can't be queried
        }
      }
    }

    return subjects;
  }
}
