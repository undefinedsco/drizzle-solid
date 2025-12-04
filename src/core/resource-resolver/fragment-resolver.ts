/**
 * Fragment Mode ResourceResolver
 *
 * In fragment mode, all records are stored in a single file (e.g., tags.ttl)
 * Each record has a subject URI with a fragment identifier (e.g., tags.ttl#uuid)
 */

import type { PodTable } from '../pod-table';
import type { QueryCondition } from '../query-conditions';
import { BaseResourceResolver } from './base-resolver';
import { v4 as uuidv4 } from 'uuid';

export class FragmentResourceResolver extends BaseResourceResolver {
  readonly mode = 'fragment' as const;

  getContainerUrl(table: PodTable): string {
    const resourceUrl = this.getResourceUrl(table);
    const lastSlash = resourceUrl.lastIndexOf('/');
    return resourceUrl.substring(0, lastSlash + 1);
  }

  getResourceUrl(table: PodTable): string {
    return this.resolveBaseUrl(table);
  }

  resolveSubject(table: PodTable, record: Record<string, any>, index?: number): string {
    const resourceUrl = this.getResourceUrl(table);

    // Use provided id or generate UUID
    const id = record.id ?? `${uuidv4()}`;

    return `${resourceUrl}#${id}`;
  }

  parseId(table: PodTable, subjectUri: string): string {
    // Extract fragment from URI
    const hashIndex = subjectUri.indexOf('#');
    if (hashIndex === -1) {
      // Fallback: use last path segment
      const parts = subjectUri.split('/');
      return parts[parts.length - 1];
    }
    return subjectUri.substring(hashIndex + 1);
  }

  getResourceUrlForSubject(subjectUri: string): string {
    // Remove fragment to get resource URL
    const hashIndex = subjectUri.indexOf('#');
    if (hashIndex === -1) {
      return subjectUri;
    }
    return subjectUri.substring(0, hashIndex);
  }

  async resolveSelectSources(
    table: PodTable,
    containerUrl: string,
    condition?: QueryCondition,
    _listContainer?: () => Promise<string[]>
  ): Promise<string[]> {
    // Fragment mode: always query the single resource file
    return [this.getResourceUrl(table)];
  }

  async resolveSubjectsForMutation(
    table: PodTable,
    condition: QueryCondition,
    findSubjects: (resourceUrl: string) => Promise<string[]>,
    _listContainer: () => Promise<string[]>
  ): Promise<string[]> {
    // Fragment mode: query the single resource file for matching subjects
    const resourceUrl = this.getResourceUrl(table);
    return findSubjects(resourceUrl);
  }
}
