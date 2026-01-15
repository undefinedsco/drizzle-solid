/**
 * Document Mode ResourceResolver
 *
 * In document mode, each record is stored in its own file (e.g., users/alice.ttl)
 * The subject URI is the document URL itself
 */

import type { PodTable } from '../schema';
import type { QueryCondition } from '../query-conditions';
import { BaseResourceResolver } from './base-resolver';
import { v4 as uuidv4 } from 'uuid';

export class DocumentResourceResolver extends BaseResourceResolver {
  readonly mode = 'document' as const;

  getContainerUrl(table: PodTable): string {
    // In document mode, use the table's container path
    const containerPath = table.getContainerPath();

    // If absolute URL, return as-is
    if (containerPath.startsWith('http://') || containerPath.startsWith('https://')) {
      return containerPath;
    }

    // Resolve relative path against pod base
    // Note: paths starting with '/' should be relative to pod base, not origin
    // e.g., '/.data/providers/' with pod base 'http://localhost:3000/test/'
    // should resolve to 'http://localhost:3000/test/.data/providers/'
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

  resolveSubject(table: PodTable, record: Record<string, any>, _index?: number): string {
    const containerUrl = this.getContainerUrl(table);

    // Use provided id or generate UUID
    const id = record.id ?? uuidv4();

    // Subject URI is the document URL itself
    return `${containerUrl}${id}.ttl`;
  }

  parseId(table: PodTable, subjectUri: string): string {
    // Extract filename without extension
    const containerUrl = this.getContainerUrl(table);

    if (subjectUri.startsWith(containerUrl)) {
      const filename = subjectUri.substring(containerUrl.length);
      // Remove .ttl extension
      if (filename.endsWith('.ttl')) {
        return filename.slice(0, -4);
      }
      return filename;
    }

    // Fallback: extract last path segment without extension
    const parts = subjectUri.split('/');
    const filename = parts[parts.length - 1];
    if (filename.endsWith('.ttl')) {
      return filename.slice(0, -4);
    }
    return filename;
  }

  getResourceUrlForSubject(subjectUri: string): string {
    // In document mode, subject URI is the resource URL
    return subjectUri;
  }

  async resolveSelectSources(
    table: PodTable,
    containerUrl: string,
    condition?: QueryCondition,
    listContainer?: () => Promise<string[]>
  ): Promise<string[]> {
    // With id condition: query specific files directly
    const idValues = this.extractIdValues(condition);

    if (idValues.length > 0) {
      return idValues.map(id => this.resolveSubject(table, { id }));
    }

    // Without id condition: scan container for all .ttl files
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
    // With id condition: resolve subjects directly from ids
    const idValues = this.extractIdValues(condition);
    if (idValues.length > 0) {
      return idValues.map(id => this.resolveSubject(table, { id }));
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
