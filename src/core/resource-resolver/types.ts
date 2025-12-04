/**
 * ResourceResolver Interface
 *
 * Abstracts the difference between fragment mode and document mode
 * for resource URL resolution and listing.
 */

import type { PodTable } from '../pod-table';
import type { QueryCondition } from '../query-conditions';

export interface ResourceResolver {
  /**
   * Get the mode this resolver handles
   */
  readonly mode: 'fragment' | 'document';

  /**
   * Get the container URL for a table
   */
  getContainerUrl(table: PodTable): string;

  /**
   * Get the default resource URL for a table (used for fragment mode reads)
   */
  getResourceUrl(table: PodTable): string;

  /**
   * Resolve subject URI for a record
   */
  resolveSubject(table: PodTable, record: Record<string, any>, index?: number): string;

  /**
   * Parse id from a subject URI
   */
  parseId(table: PodTable, subjectUri: string): string;

  /**
   * Get the resource URL that contains a given subject
   */
  getResourceUrlForSubject(subjectUri: string): string;

  /**
   * Extract id values from a query condition
   */
  extractIdValues(condition: QueryCondition | undefined): string[];

  /**
   * Resolve resource URLs to query for a SELECT operation
   * - With id condition: returns specific resource URLs
   * - Without id condition: returns all resources to scan
   */
  resolveSelectSources(
    table: PodTable,
    containerUrl: string,
    condition?: QueryCondition,
    listContainer?: () => Promise<string[]>
  ): Promise<string[]>;

  /**
   * Resolve subjects for UPDATE/DELETE operations
   * - With id condition: resolves subjects directly from ids
   * - Without id condition: needs to query resources to find subjects
   */
  resolveSubjectsForMutation(
    table: PodTable,
    condition: QueryCondition,
    findSubjects: (resourceUrl: string) => Promise<string[]>,
    listContainer: () => Promise<string[]>
  ): Promise<string[]>;
}

export interface ResourceResolverFactory {
  /**
   * Get the appropriate resolver for a table based on its configuration
   */
  getResolver(table: PodTable): ResourceResolver;
}
