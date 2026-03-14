import { QueryCondition } from '../../query-conditions';
import { BinaryExpression, LogicalExpression, UnaryExpression } from '../../expressions';
import { PodTable, PodColumnBase } from '../../schema';
import { formatValue, resolveColumn, getPredicateForColumn } from '../helpers';
import type { UriContext, UriResolver } from '../../uri';
import { UriResolverImpl } from '../../uri';
import type { TableRegistryContext } from '../../ast-to-sparql';

export class ExpressionBuilder {
  private tableContext?: TableRegistryContext;
  private uriResolver: UriResolver;

  constructor(uriResolver: UriResolver = new UriResolverImpl()) {
    this.uriResolver = uriResolver;
  }

  /**
   * Set table context for URI link resolution
   */
  setTableContext(context: TableRegistryContext): void {
    this.tableContext = context;
  }

  /**
   * Convert TableRegistryContext to UriContext
   */
  private getUriContext(): UriContext | undefined {
    if (!this.tableContext) return undefined;
    return {
      baseUri: this.tableContext.baseUri,
      tableRegistry: this.tableContext.tableRegistry,
      tableNameRegistry: this.tableContext.tableNameRegistry,
    };
  }

  buildWhereClause(condition: QueryCondition | any, table: PodTable): string {
    const expr = this.buildExpression(condition, table);
    return expr ? `FILTER(${expr})` : '';
  }

  extractSubjectConstraint(
    condition: QueryCondition | any,
    table: PodTable
  ): { values: string[]; remainingCondition?: QueryCondition | any } | null {
    const extracted = this.extractSubjectConstraintInternal(condition, table);
    if (!extracted) {
      return null;
    }

    if (!extracted.values || extracted.values.length === 0) {
      return null;
    }

    return extracted;
  }

  /**
   * Check if a column is a link column that needs URI resolution
   * Delegates to uriResolver for consistency
   */
  private isLinkColumn(column: PodColumnBase | any): boolean {
    return this.uriResolver.isLinkColumn(column);
  }

  /**
   * Format a value for a link column, resolving URI if needed
   * Uses uriResolver for consistent URI resolution
   */
  private formatLinkValue(value: any, column: PodColumnBase | any, table: PodTable): string {
    const str = String(value);
    if (str.startsWith('<') && str.endsWith('>')) {
      const inner = str.slice(1, -1);
      if (this.uriResolver.isAbsoluteUri(inner)) {
        return str;
      }
      const context = this.getUriContext();
      try {
        const resolved = this.uriResolver.resolveLink(inner, column, context);
        return `<${resolved}>`;
      } catch (error) {
        const tableName = table.config?.name ?? 'unknown';
        const columnName = column?.name ?? 'unknown';
        throw new Error(`[ExpressionBuilder] Failed to resolve URI for ${tableName}.${columnName}: ${error}`);
      }
    }
    if (str.startsWith('<')) return str;
    
    try {
      // Pass context as parameter, not internal state
      const context = this.getUriContext();
      const resolved = this.uriResolver.resolveLink(str, column, context);
      return `<${resolved}>`;
    } catch (e) {
      const tableName = table.config?.name ?? 'unknown';
      const columnName = column?.name ?? 'unknown';
      throw new Error(`[ExpressionBuilder] Failed to resolve URI for ${tableName}.${columnName}: ${e}`);
    }
  }

  /**
   * Format a subject comparison value, resolving UUID/relative IDs to full URIs.
   * Returns either a formatted URI like `<http://...>` or a SPARQL expression for partial matching.
   */
  private formatSubjectValue(value: any, table: PodTable, isVirtualId: boolean): string | { partial: true; id: string } {
    const raw = String(value ?? '');
    if (raw.startsWith('<') && raw.endsWith('>')) {
      const inner = raw.slice(1, -1);
      if (this.uriResolver.isAbsoluteUri(inner)) {
        return raw;
      }
      const normalizedInner = inner.startsWith('#') ? inner.slice(1) : inner;
      try {
        const uri = this.uriResolver.resolveSubject(table, { id: normalizedInner });
        return `<${uri}>`;
      } catch {
        // Cannot resolve full URI, return partial match indicator
        return { partial: true, id: normalizedInner };
      }
    }
    if (this.uriResolver.isAbsoluteUri(raw)) return `<${raw}>`;

    const normalizedId = raw.startsWith('#') ? raw.slice(1) : raw;
    try {
      const uri = this.uriResolver.resolveSubject(table, { id: normalizedId });
      return `<${uri}>`;
    } catch {
      // Cannot resolve full URI, return partial match indicator
      return { partial: true, id: normalizedId };
    }
  }

  /**
   * Build a STRENDS suffix from the template by substituting {id} and
   * extracting the meaningful tail. Purely template-driven — no mode branching.
   *
   * Examples:
   *   "#{id}"                       + id=alice       → "#alice"
   *   "{id}.ttl#it"                 + id=alice       → "/alice.ttl#it"
   *   "{chatId}/index.ttl#{id}"     + id=thread_abc  → "/index.ttl#thread_abc"
   */
  private buildSuffixFromTemplate(id: string, table: PodTable): string {
    const template = table.config?.subjectTemplate || '{id}.ttl';
    const replaced = template.replace(/\{id\}/g, id);

    // No unresolved variables → use the full replaced string
    if (!replaced.includes('{')) {
      return replaced.startsWith('#') ? replaced : '/' + replaced;
    }

    // Still has unresolved variables → take the tail after the last one
    const lastBrace = replaced.lastIndexOf('}');
    const tail = replaced.substring(lastBrace + 1); // e.g. "/index.ttl#thread_abc"
    return tail;
  }

  /**
   * Check if value is a drizzle-orm SQL object
   */
  private isDrizzleSQL(value: any): boolean {
    if (!value || typeof value !== 'object') return false;
    // Check for drizzle-orm SQL class signature
    const entityKind = value.constructor?.[Symbol.for('drizzle:entityKind')];
    return entityKind === 'SQL' || (Array.isArray(value.queryChunks) && typeof value.getSQL === 'function');
  }

  private buildExpression(condition: QueryCondition | any, table: PodTable): string {
    if (!condition || typeof condition !== 'object') {
      return '';
    }

    // Check if this is a drizzle-orm SQL object
    if (this.isDrizzleSQL(condition)) {
      throw new Error('Drizzle-ORM operators are not supported. Please use the operators provided by drizzle-solid.');
    }

    switch (condition.type) {
      case 'logical_expr':
        return this.buildLogicalExpression(condition as LogicalExpression, table);
      case 'unary_expr':
        return this.buildUnaryExpression(condition as UnaryExpression, table);
      case 'binary_expr':
        return this.buildBinaryExpression(condition as BinaryExpression, table);
      default:
        return '';
    }
  }

  private extractSubjectConstraintInternal(
    condition: QueryCondition | any,
    table: PodTable
  ): { values: string[]; remainingCondition?: QueryCondition | any } | null {
    if (!condition || typeof condition !== 'object') {
      return null;
    }

    if (this.isDrizzleSQL(condition)) {
      return null;
    }

    if (condition.type === 'binary_expr') {
      return this.extractSubjectConstraintFromBinary(condition as BinaryExpression, table);
    }

    if (condition.type === 'logical_expr' && condition.operator === 'AND' && Array.isArray(condition.expressions)) {
      let values: string[] | null = null;
      const remaining: any[] = [];

      for (const expression of condition.expressions) {
        const extracted = this.extractSubjectConstraintInternal(expression, table);
        if (extracted?.values?.length) {
          if (values === null) {
            values = [...extracted.values];
          } else {
            const next = new Set(extracted.values);
            values = values.filter((value) => next.has(value));
          }

          if (extracted.remainingCondition) {
            remaining.push(extracted.remainingCondition);
          }
          continue;
        }

        remaining.push(expression);
      }

      if (!values || values.length === 0) {
        return null;
      }

      if (remaining.length === 0) {
        return { values };
      }

      if (remaining.length === 1) {
        return { values, remainingCondition: remaining[0] };
      }

      return {
        values,
        remainingCondition: new LogicalExpression('AND', remaining),
      };
    }

    return null;
  }

  private extractSubjectConstraintFromBinary(
    condition: BinaryExpression,
    table: PodTable
  ): { values: string[]; remainingCondition?: QueryCondition | any } | null {
    const colName = this.resolveColumnName(condition.left);
    if (!colName) {
      return null;
    }

    const column = table.columns[colName];
    const isIdColumn = colName === 'id';
    const idPredicate = isIdColumn && column ? getPredicateForColumn(column, table) : null;
    const isVirtualId = isIdColumn && idPredicate === '@id';
    const isSubject = colName === 'subject' || colName === '@id' || isVirtualId;

    if (!isSubject) {
      return null;
    }

    if (condition.operator === '=') {
      const formatted = this.formatSubjectValue(condition.right, table, isVirtualId);
      if (typeof formatted === 'string' && formatted.startsWith('<') && formatted.endsWith('>')) {
        return { values: [formatted.slice(1, -1)] };
      }
      return null;
    }

    if (condition.operator === 'IN' && Array.isArray(condition.right) && condition.right.length > 0) {
      const values: string[] = [];
      for (const entry of condition.right) {
        const formatted = this.formatSubjectValue(entry, table, isVirtualId);
        if (typeof formatted !== 'string' || !formatted.startsWith('<') || !formatted.endsWith('>')) {
          return null;
        }
        values.push(formatted.slice(1, -1));
      }
      return values.length > 0 ? { values } : null;
    }

    return null;
  }

  private buildLogicalExpression(condition: LogicalExpression, table: PodTable): string {
    if (!condition.expressions || condition.expressions.length === 0) return '';
    
    const parts = condition.expressions
      .map(c => this.buildExpression(c as QueryCondition, table))
      .filter(s => s.length > 0);

    if (parts.length === 0) return '';

    const op = condition.operator === 'OR' ? ' || ' : ' && ';
    return `(${parts.join(op)})`;
  }

  private buildUnaryExpression(condition: UnaryExpression, table: PodTable): string {
    const op = condition.operator;
    
    if (op === 'NOT') {
      const expr = this.buildExpression(condition.value as QueryCondition, table);
      return `!(${expr})`;
    }

    // IS NULL / IS NOT NULL
    // For UnaryExpression, 'value' holds the target column
    const colName = this.resolveColumnName(condition.value);
    if (!colName) return '';
    
    // Check if this is a virtual id column (uses @id predicate)
    const column = table.columns[colName];
    const isIdColumn = colName === 'id';
    const idPredicate = isIdColumn && column ? getPredicateForColumn(column, table) : null;
    const isVirtualId = isIdColumn && idPredicate === '@id';
    const isSubject = colName === 'subject' || colName === '@id' || isVirtualId;
    
    const variable = isSubject ? '?subject' : `?${colName}`;
    
    if (op === 'IS NULL') {
      return `!(BOUND(${variable}))`;
    }
    if (op === 'IS NOT NULL') {
      return `BOUND(${variable})`;
    }
    
    // EXISTS / NOT EXISTS
    if (op === 'EXISTS' || op === 'NOT EXISTS') {
       const subquery = String(condition.value);
       const expr = `EXISTS { ${subquery} }`;
       return op === 'NOT EXISTS' ? `!(${expr})` : expr;
    }

    return '';
  }

  private buildBinaryExpression(condition: BinaryExpression, table: PodTable): string {
    const colName = this.resolveColumnName(condition.left);
    if (!colName) return '';

    const column = table.columns[colName];

    // Determine if id column uses @id predicate (virtual) or real predicate
    const isIdColumn = colName === 'id';
    const idPredicate = isIdColumn && column ? getPredicateForColumn(column, table) : null;
    const isVirtualId = isIdColumn && idPredicate === '@id';

    // For @id predicate, compare against ?subject; otherwise use column variable
    const isSubject = colName === 'subject' || colName === '@id' || isVirtualId;
    const variable = isSubject ? '?subject' : `?${colName}`;

    // Check if this is a link column
    const isLink = this.isLinkColumn(column);

    let value = condition.right;

    // Handle IN / NOT IN
    if (condition.operator === 'IN' || condition.operator === 'NOT IN') {
      if (!Array.isArray(value) || value.length === 0) return condition.operator === 'IN' ? 'false' : 'true';

      if (isSubject) {
        // Check if any values need partial matching
        const results = value.map((v: any) => this.formatSubjectValue(v, table, isVirtualId));
        const hasPartial = results.some((r: any) => typeof r === 'object' && r.partial);

        if (hasPartial) {
          // Use STRENDS for partial matching — suffix derived from template
          const conditions = results.map((r: any) => {
            if (typeof r === 'object' && r.partial) {
              const escapedId = r.id.replace(/"/g, '\\"');
              const suffix = this.buildSuffixFromTemplate(escapedId, table);
              return `STRENDS(STR(${variable}), "${suffix}")`;
            }
            return `(${variable} = ${r})`;
          });
          const expr = `(${conditions.join(' || ')})`;
          return condition.operator === 'NOT IN' ? `!(${expr})` : expr;
        }

        // All values resolved to full URIs
        const formattedValues = results.join(', ');
        const expr = `${variable} IN(${formattedValues})`;
        return condition.operator === 'NOT IN' ? `!(${expr})` : expr;
      }

      const formattedValues = value.map((v: any) => {
         if (isLink) {
            return this.formatLinkValue(v, column, table);
         }
         return formatValue(v, column, this.uriResolver, this.getUriContext());
      }).join(', ');

      const expr = `${variable} IN(${formattedValues})`;
      return condition.operator === 'NOT IN' ? `!(${expr})` : expr;
    }

    // Handle REGEX
    if (condition.operator === 'REGEX') {
      const pattern = (value as any).pattern ?? value;
      const flags = (value as any).flags ?? '';
      return `REGEX(STR(${variable}), "${pattern}", "${flags}")`;
    }

    // Handle LIKE
    if (condition.operator === 'LIKE') {
      let pattern = String(value)
        .replace(/[.+^${}()|[\\]/g, '\\$&')
        .replace(/%/g, '.*')
        .replace(/_/g, '.');
      return `REGEX(STR(${variable}), "^${pattern}$", "i")`;
    }
    // Handle ILIKE
    if (condition.operator === 'ILIKE') {
      let pattern = String(value)
        .replace(/[.+^${}()|[\\]/g, '\\$&')
        .replace(/%/g, '.*')
        .replace(/_/g, '.');
      return `REGEX(STR(${variable}), "^${pattern}$", "i")`;
    }

    // Handle BETWEEN / NOT BETWEEN
    if (condition.operator === 'BETWEEN' || condition.operator === 'NOT BETWEEN') {
      if (!Array.isArray(value) || value.length !== 2) return '';
      const [min, max] = value;
      const left = formatValue(min, column, this.uriResolver, this.getUriContext());
      const right = formatValue(max, column, this.uriResolver, this.getUriContext());
      const expr = `(${variable} >= ${left} && ${variable} <= ${right})`;
      return condition.operator === 'NOT BETWEEN' ? `!${expr}` : expr;
    }

    // Basic operators (=, !=, <, >, <=, >=)
    let formattedValue: string | string[] | { partial: true; id: string };

    if (isSubject) {
        formattedValue = this.formatSubjectValue(value, table, isVirtualId);

        // Handle partial match (when full URI cannot be resolved)
        if (typeof formattedValue === 'object' && formattedValue.partial) {
          const escapedId = formattedValue.id.replace(/"/g, '\\"');
          const suffix = this.buildSuffixFromTemplate(escapedId, table);
          if (condition.operator === '=') {
            return `STRENDS(STR(${variable}), "${suffix}")`;
          } else if (condition.operator === '!=') {
            return `!STRENDS(STR(${variable}), "${suffix}")`;
          }
          // For other operators, fall through with escaped ID
          formattedValue = `"${escapedId}"`;
        }
    } else if (isLink) {
        // Resolve link URI
        formattedValue = this.formatLinkValue(value, column, table);
    } else {
        formattedValue = formatValue(value, column, this.uriResolver, this.getUriContext());
    }

    return `(${variable} ${condition.operator} ${formattedValue})`;
  }

  private resolveColumnName(target: any): string {
     if (typeof target === 'string') {
        return target.includes('.') ? target.split('.')[1] : target;
     }
     if (target && typeof target === 'object' && 'name' in target) {
        return target.name;
     }
     // Handle simple object wrapper { column: 'name' } from old style if any remnants
     if (target && typeof target === 'object' && 'column' in target) {
        return target.column;
     }
     return '';
  }
}
