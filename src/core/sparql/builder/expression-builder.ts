import { QueryCondition } from '../../query-conditions';
import { PodTable } from '../../pod-table';
import { formatValue, resolveColumn } from '../helpers';

export class ExpressionBuilder {
  buildWhereClause(condition: QueryCondition, table: PodTable): string {
    const expr = this.buildExpression(condition, table);
    return expr ? `FILTER(${expr})` : '';
  }

  private buildExpression(condition: QueryCondition, table: PodTable): string {
    switch (condition.type) {
      case 'logical_expr':
        return this.buildLogicalExpression(condition, table);
      case 'unary_expr':
        return this.buildUnaryExpression(condition, table);
      case 'binary_expr':
        return this.buildBinaryExpression(condition, table);
      default:
        return '';
    }
  }

  private buildLogicalExpression(condition: QueryCondition, table: PodTable): string {
    if (!condition.conditions || condition.conditions.length === 0) return '';
    
    const parts = condition.conditions
      .map(c => this.buildExpression(c, table))
      .filter(s => s.length > 0);

    if (parts.length === 0) return '';

    const op = condition.operator === 'OR' ? ' || ' : ' && ';
    return `(${parts.join(op)})`;
  }

  private buildUnaryExpression(condition: QueryCondition, table: PodTable): string {
    const op = condition.operator;
    
    if (op === 'NOT') {
      const expr = this.buildExpression(condition.left, table);
      return `!(${expr})`;
    }

    // IS NULL / IS NOT NULL
    const colName = condition.column || (condition.left as any)?.column;
    if (!colName) return '';
    
    const variable = (colName === 'subject' || colName === '@id') ? '?subject' : `?${colName}`;
    
    if (op === 'IS NULL') {
      return `!(BOUND(${variable}))`;
    }
    if (op === 'IS NOT NULL') {
      return `BOUND(${variable})`;
    }
    
    return '';
  }

  private buildBinaryExpression(condition: QueryCondition, table: PodTable): string {
    const colName = condition.column || (condition.left as any)?.column;
    if (!colName) return '';

    const variable = (colName === 'subject' || colName === '@id') ? '?subject' : `?${colName}`;
    const value = condition.value ?? condition.right?.value;
    
    // Handle IN / NOT IN
    if (condition.operator === 'IN' || condition.operator === 'NOT IN') {
      if (!Array.isArray(value) || value.length === 0) return condition.operator === 'IN' ? 'false' : 'true';
      
      // Get column definition to format values correctly (e.g. as URIs)
      const column = table.columns[colName];
      const isSubject = colName === 'subject' || colName === '@id';
      
      const formattedValues = value.map(v => {
         if (isSubject) {
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

    // Handle LIKE (simple conversion to REGEX)
    if (condition.operator === 'LIKE') {
      // Escape regex chars but allow % as .* and _ as . 
      let pattern = String(value)
        .replace(/[.+^${}()|[\\]/g, '\\$&')
        .replace(/%/g, '.*')
        .replace(/_/g, '.');
      return `REGEX(STR(${variable}), "^${pattern}$", "i")`;
    }

    // Basic operators
    const column = table.columns[colName];
    const isSubject = colName === 'subject' || colName === '@id';
    let formattedValue;
    
    if (isSubject) {
        const str = String(value);
        formattedValue = str.startsWith('<') ? str : `<${str}>`;
    } else {
        formattedValue = formatValue(value, column);
    }
    
    return `(${variable} ${condition.operator} ${formattedValue})`;
  }
}
