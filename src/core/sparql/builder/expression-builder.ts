import { QueryCondition } from '../../query-conditions';
import { BinaryExpression, LogicalExpression, UnaryExpression } from '../../expressions';
import { PodTable, PodColumnBase } from '../../pod-table';
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
   * Set table context for URI reference resolution
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

  /**
   * Check if a column is a reference column that needs URI resolution
   * Delegates to uriResolver for consistency
   */
  private isReferenceColumn(column: PodColumnBase | any): boolean {
    return this.uriResolver.isReferenceColumn(column);
  }

  /**
   * Format a value for a reference column, resolving URI if needed
   * Uses uriResolver for consistent URI resolution
   */
  private formatReferenceValue(value: any, column: PodColumnBase | any, table: PodTable): string {
    const str = String(value);
    if (str.startsWith('<') && str.endsWith('>')) {
      const inner = str.slice(1, -1);
      if (this.uriResolver.isAbsoluteUri(inner)) {
        return str;
      }
      const context = this.getUriContext();
      try {
        const resolved = this.uriResolver.resolveReference(inner, column, context);
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
      const resolved = this.uriResolver.resolveReference(str, column, context);
      return `<${resolved}>`;
    } catch (e) {
      const tableName = table.config?.name ?? 'unknown';
      const columnName = column?.name ?? 'unknown';
      throw new Error(`[ExpressionBuilder] Failed to resolve URI for ${tableName}.${columnName}: ${e}`);
    }
  }

  /**
   * Format a subject comparison value, resolving UUID/relative IDs to full URIs.
   */
  private formatSubjectValue(value: any, table: PodTable, isVirtualId: boolean): string {
    const raw = String(value ?? '');
    if (raw.startsWith('<') && raw.endsWith('>')) {
      const inner = raw.slice(1, -1);
      if (this.uriResolver.isAbsoluteUri(inner)) {
        return raw;
      }
      const normalizedInner = inner.startsWith('#') ? inner.slice(1) : inner;
      const uri = this.uriResolver.resolveSubject(table, { id: normalizedInner });
      return `<${uri}>`;
    }
    if (this.uriResolver.isAbsoluteUri(raw)) return `<${raw}>`;

    const normalizedId = raw.startsWith('#') ? raw.slice(1) : raw;
    const uri = this.uriResolver.resolveSubject(table, { id: normalizedId });
    return `<${uri}>`;
  }

  private buildExpression(condition: QueryCondition | any, table: PodTable): string {
    if (!condition || typeof condition !== 'object') {
      return '';
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

    // Check if this is a reference column
    const isReference = this.isReferenceColumn(column);

    let value = condition.right;

    // Handle IN / NOT IN
    if (condition.operator === 'IN' || condition.operator === 'NOT IN') {
      if (!Array.isArray(value) || value.length === 0) return condition.operator === 'IN' ? 'false' : 'true';

      const formattedValues = value.map((v: any) => {
         if (isSubject) {
            return this.formatSubjectValue(v, table, isVirtualId);
         }
         if (isReference) {
            return this.formatReferenceValue(v, column, table);
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
    let formattedValue;

    if (isSubject) {
        formattedValue = this.formatSubjectValue(value, table, isVirtualId);
    } else if (isReference) {
        // Resolve reference URI
        formattedValue = this.formatReferenceValue(value, column, table);
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
