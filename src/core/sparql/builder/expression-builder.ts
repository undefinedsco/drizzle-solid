import { QueryCondition } from '../../query-conditions';
import { BinaryExpression, LogicalExpression, UnaryExpression } from '../../expressions';
import { PodTable } from '../../pod-table';
import { formatValue, resolveColumn, getPredicateForColumn } from '../helpers';
import { subjectResolver } from '../../subject';

export class ExpressionBuilder {
  buildWhereClause(condition: QueryCondition | any, table: PodTable): string {
    const expr = this.buildExpression(condition, table);
    return expr ? `FILTER(${expr})` : '';
  }

  private buildExpression(condition: QueryCondition | any, table: PodTable): string {
    // Check if this is a drizzle-orm SQL object
    if (this.isDrizzleSQL(condition)) {
      return this.buildFromDrizzleSQL(condition, table);
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

  /**
   * Check if value is a drizzle-orm SQL object
   */
  private isDrizzleSQL(value: any): boolean {
    if (!value || typeof value !== 'object') return false;
    // Check for drizzle-orm SQL class signature
    const entityKind = value.constructor?.[Symbol.for('drizzle:entityKind')];
    return entityKind === 'SQL' || (Array.isArray(value.queryChunks) && typeof value.getSQL === 'function');
  }

  /**
   * Parse drizzle-orm SQL object and convert to SPARQL expression
   */
  private buildFromDrizzleSQL(sql: any, table: PodTable): string {
    const chunks = sql.queryChunks;
    if (!chunks || chunks.length === 0) return '';

    // Parse the SQL structure based on chunks
    return this.parseChunks(chunks, table);
  }

  private parseChunks(chunks: any[], table: PodTable): string {
    // Detect pattern: eq/neq/gt/lt etc -> ['', column, ' op ', value, '']
    // Detect pattern: and/or -> ['(', SQL{[SQL, ' and/or ', SQL]}, ')']
    // Detect pattern: in -> ['', column, ' in ', array, '']
    // Detect pattern: isNull -> ['', column, ' is null', '']

    // Find operator by looking for StringChunk with operator text
    let operator = '';
    let columnChunk: any = null;
    let valueChunk: any = null;
    let nestedSQLs: any[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkName = chunk?.constructor?.name;

      if (chunkName === 'StringChunk') {
        const val = chunk.value?.[0] || '';
        if (val.includes(' = ')) operator = '=';
        else if (val.includes(' <> ') || val.includes(' != ')) operator = '!=';
        else if (val.includes(' > ')) operator = '>';
        else if (val.includes(' >= ')) operator = '>=';
        else if (val.includes(' < ')) operator = '<';
        else if (val.includes(' <= ')) operator = '<=';
        else if (val.includes(' in ')) operator = 'IN';
        else if (val.includes(' not in ')) operator = 'NOT IN';
        else if (val.includes(' like ')) operator = 'LIKE';
        else if (val.includes(' is null')) operator = 'IS NULL';
        else if (val.includes(' is not null')) operator = 'IS NOT NULL';
        else if (val.includes(' and ')) operator = 'AND';
        else if (val.includes(' or ')) operator = 'OR';
      } else if (chunkName?.startsWith('Pod') && chunkName.endsWith('Column')) {
        // It's one of our PodColumn types
        columnChunk = chunk;
      } else if (this.isDrizzleSQL(chunk)) {
        // Nested SQL (for and/or or wrapped conditions)
        nestedSQLs.push(chunk);
      } else if (Array.isArray(chunk)) {
        // Array value for IN clause
        valueChunk = chunk;
      } else if (typeof chunk === 'string' || typeof chunk === 'number' || typeof chunk === 'boolean') {
        // Direct value
        valueChunk = chunk;
      } else if (chunkName === 'Param') {
        valueChunk = chunk.value;
      }
    }

    // Handle AND/OR: drizzle wraps as ['(', SQL{[SQL, ' and ', SQL]}, ')']
    // So we need to look inside the nested SQL for the actual operator and conditions
    if (nestedSQLs.length === 1 && !operator && !columnChunk) {
      // This might be a wrapper like '(' + nestedSQL + ')'
      // Check if the nested SQL contains AND/OR
      const innerResult = this.parseChunks(nestedSQLs[0].queryChunks, table);
      if (innerResult) return innerResult;
    }

    // Handle AND/OR with nested SQLs (direct pattern)
    if ((operator === 'AND' || operator === 'OR') && nestedSQLs.length > 0) {
      const parts = nestedSQLs
        .map(sql => this.buildFromDrizzleSQL(sql, table))
        .filter(s => s.length > 0);
      if (parts.length === 0) return '';
      const op = operator === 'OR' ? ' || ' : ' && ';
      return `(${parts.join(op)})`;
    }

    // Handle IS NULL / IS NOT NULL
    if (operator === 'IS NULL' || operator === 'IS NOT NULL') {
      const colName = columnChunk?.name;
      if (!colName) return '';
      
      // Check if this is a virtual id column (uses @id predicate)
      const column = table.columns[colName];
      const isIdColumn = colName === 'id';
      const idPredicate = isIdColumn && column ? getPredicateForColumn(column, table) : null;
      const isVirtualId = isIdColumn && idPredicate === '@id';
      const isSubject = colName === 'subject' || colName === '@id' || isVirtualId;
      
      const variable = isSubject ? '?subject' : `?${colName}`;
      return operator === 'IS NULL' ? `!(BOUND(${variable}))` : `BOUND(${variable})`;
    }

    // Handle comparison operators
    if (columnChunk && operator) {
      const colName = columnChunk.name;
      const column = table.columns[colName];
      
      // Check if this is a virtual id column (uses @id predicate)
      const isIdColumn = colName === 'id';
      const idPredicate = isIdColumn && column ? getPredicateForColumn(column, table) : null;
      const isVirtualId = isIdColumn && idPredicate === '@id';
      const isSubject = colName === 'subject' || colName === '@id' || isVirtualId;
      
      const variable = isSubject ? '?subject' : `?${colName}`;

      // Handle IN
      if (operator === 'IN' || operator === 'NOT IN') {
        if (!Array.isArray(valueChunk) || valueChunk.length === 0) {
          return operator === 'IN' ? 'false' : 'true';
        }
        const formattedValues = valueChunk.map((v: any) => {
          if (isSubject && isVirtualId) {
            // Convert id value to full URI
            const uri = subjectResolver.resolve(table, { id: String(v) });
            return `<${uri}>`;
          }
          return formatValue(v, column);
        }).join(', ');
        const expr = `${variable} IN(${formattedValues})`;
        return operator === 'NOT IN' ? `!(${expr})` : expr;
      }

      // Handle LIKE
      if (operator === 'LIKE') {
        let pattern = String(valueChunk)
          .replace(/[.+^${}()|[\\]/g, '\\$&')
          .replace(/%/g, '.*')
          .replace(/_/g, '.');
        return `REGEX(STR(${variable}), "^${pattern}$", "i")`;
      }

      // Basic comparison
      let formattedValue: string;
      if (isSubject && isVirtualId) {
        // Convert id value to full URI for @id predicate
        const uri = subjectResolver.resolve(table, { id: String(valueChunk) });
        formattedValue = `<${uri}>`;
      } else {
        formattedValue = formatValue(valueChunk, column) as string;
      }
      return `(${variable} ${operator} ${formattedValue})`;
    }

    return '';
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

    let value = condition.right;

    // Handle IN / NOT IN
    if (condition.operator === 'IN' || condition.operator === 'NOT IN') {
      if (!Array.isArray(value) || value.length === 0) return condition.operator === 'IN' ? 'false' : 'true';

      const formattedValues = value.map((v: any) => {
         if (isSubject) {
            // Convert id value to full URI
            if (isVirtualId) {
              const uri = subjectResolver.resolve(table, { id: String(v) });
              return `<${uri}>`;
            }
            const str = String(v);
            return str.startsWith('<') ? str : `<${str}>`;
         }
         return formatValue(v, column);
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
      const left = formatValue(min, column);
      const right = formatValue(max, column);
      const expr = `(${variable} >= ${left} && ${variable} <= ${right})`;
      return condition.operator === 'NOT BETWEEN' ? `!${expr}` : expr;
    }

    // Basic operators (=, !=, <, >, <=, >=)
    let formattedValue;

    if (isSubject) {
        // Convert id value to full URI for @id predicate
        if (isVirtualId) {
          const uri = subjectResolver.resolve(table, { id: String(value) });
          formattedValue = `<${uri}>`;
        } else {
          const str = String(value);
          formattedValue = str.startsWith('<') ? str : `<${str}>`;
        }
    } else {
        formattedValue = formatValue(value, column);
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
