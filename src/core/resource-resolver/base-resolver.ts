/**
 * Base ResourceResolver with shared logic
 */

import type { PodTable } from '../schema';
import type { QueryCondition } from '../query-conditions';
import type { ResourceResolver } from './types';

export abstract class BaseResourceResolver implements ResourceResolver {
  abstract readonly mode: 'fragment' | 'document';

  protected podBaseUrl: string;

  constructor(podBaseUrl: string) {
    this.podBaseUrl = podBaseUrl;
  }

  abstract getContainerUrl(table: PodTable): string;
  abstract getResourceUrl(table: PodTable): string;
  abstract resolveSubject(table: PodTable, record: Record<string, any>, index?: number): string;
  abstract parseId(table: PodTable, subjectUri: string): string;
  abstract getResourceUrlForSubject(subjectUri: string): string;

  abstract resolveSelectSources(
    table: PodTable,
    containerUrl: string,
    condition?: QueryCondition,
    listContainer?: () => Promise<string[]>
  ): Promise<string[]>;

  abstract resolveSubjectsForMutation(
    table: PodTable,
    condition: QueryCondition,
    findSubjects: (resourceUrl: string) => Promise<string[]>,
    listContainer: () => Promise<string[]>
  ): Promise<string[]>;

  /**
   * Extract id values from a query condition
   * Shared logic for both fragment and document mode
   */
  extractIdValues(condition: QueryCondition | Record<string, any> | undefined): string[] {
    if (!condition) return [];

    const ids: string[] = [];

    // Handle simple object: { id: 'value' } or { id: ['v1', 'v2'] }
    if (typeof condition === 'object' && !('type' in condition) && 'id' in condition) {
      const idValue = (condition as any).id;
      if (Array.isArray(idValue)) {
        ids.push(...idValue.map(String));
      } else if (idValue != null) {
        ids.push(String(idValue));
      }
      return ids;
    }

    this.collectIdValues(condition, ids);
    return ids;
  }

  protected collectIdValues(condition: any, ids: string[]): void {
    if (!condition) return;

    // BinaryExpression: { type: 'binary_expr', left: ..., operator: ..., right: ... }
    if (condition.type === 'binary_expr') {
      let colName: string | undefined;
      const left = condition.left;

      if (typeof left === 'string') {
        colName = left;
      } else if (left && typeof left === 'object') {
        // PodColumnBase or similar object with name property
        colName = left.name;
      }

      if (colName === 'id') {
        if (condition.operator === '=' && condition.right != null) {
          ids.push(String(condition.right));
        } else if (condition.operator === 'IN' && Array.isArray(condition.right)) {
          ids.push(...condition.right.map(String));
        }
      }
    }

    // LogicalExpression: { type: 'logical_expr', operator: 'AND'|'OR', expressions: [...] }
    if (condition.type === 'logical_expr' && Array.isArray(condition.expressions)) {
      for (const expr of condition.expressions) {
        this.collectIdValues(expr, ids);
      }
    }
  }

  /**
   * Resolve base URL for a table's base configuration
   */
  protected resolveBaseUrl(table: PodTable): string {
    const base = table.config.base || table.config.name;

    // Absolute URL
    if (base.startsWith('http://') || base.startsWith('https://')) {
      return base;
    }

    // Relative path - resolve against pod base
    return new URL(base, this.podBaseUrl).toString();
  }
}
