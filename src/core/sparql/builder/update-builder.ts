import * as sparqljs from 'sparqljs';
import { PodTable, PodColumnBase } from '../../pod-table';
import { SPARQLQuery } from '../types';
import { getPredicateForColumn, formatValue, generateSubjectUri } from '../helpers';
import { subjectResolver } from '../../subject';
import { QueryCondition } from '../../query-conditions';

export class UpdateBuilder {
  private generator: any;
  private prefixes: Record<string, string>;

  constructor(prefixes: Record<string, string>) {
    this.generator = new (sparqljs as any).Generator();
    this.prefixes = prefixes;
  }

  // 转换 INSERT 查询 - 使用 sparqljs
  convertInsert(valuesOrPlan: any[] | { table: PodTable; rows: any[] }, table?: PodTable): SPARQLQuery {
    if (!table && !valuesOrPlan) {
      throw new Error('INSERT operation requires a target table');
    }
    let rows: any[];
    let targetTable: PodTable;
    if (Array.isArray(valuesOrPlan)) {
      rows = valuesOrPlan;
      if (!table) {
        throw new Error('INSERT operation requires a target table');
      }
      targetTable = table;
    } else {
      rows = (valuesOrPlan as any).rows;
      targetTable = (valuesOrPlan as any).table;
    }

    const existingIds = new Set<string>();
    const duplicateIds: string[] = [];
    
    for (const record of rows) {
      if (record.id) {
        if (existingIds.has(record.id)) {
          duplicateIds.push(record.id);
        } else {
          existingIds.add(record.id);
        }
      }
    }
    
    if (duplicateIds.length > 0) {
      throw new Error(`Duplicate IDs found in insert data: ${duplicateIds.join(', ')}`);
    }
    
    const insertQuery: any = {
      type: 'update',
      prefixes: this.prefixes,
      updates: [{
        updateType: 'insert',
        insert: [{
          type: 'bgp',
          triples: this.buildInsertTriples(rows, targetTable)
        }]
      }]
    };

    return {
      type: 'INSERT',
      query: this.generator.stringify(insertQuery),
      prefixes: this.prefixes
    };
  }

  private buildInsertTriples(rows: any[], table: PodTable): any[] {
    const triples: any[] = [];
    const rdfClass = table.config.type;

    for (const row of rows) {
      const subjectUri = generateSubjectUri(row, table);
      const subjectTerm = { termType: 'NamedNode', value: subjectUri };

      // rdf:type
      triples.push({
        subject: subjectTerm,
        predicate: { termType: 'NamedNode', value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' },
        object: { termType: 'NamedNode', value: rdfClass }
      });

      // subClassOf
      if (table.config.subClassOf) {
        const parents = Array.isArray(table.config.subClassOf) ? table.config.subClassOf : [table.config.subClassOf];
        parents.forEach(parent => {
          const parentUri = typeof parent === 'string' ? parent : (parent as any).value || String(parent);
          triples.push({
            subject: subjectTerm,
            predicate: { termType: 'NamedNode', value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' },
            object: { termType: 'NamedNode', value: parentUri }
          });
        });
      }

      Object.entries(row).forEach(([key, value]) => {
        if (key === 'id' || value === undefined || value === null) return;
        
        const column = table.columns[key];
        if (!column) return;

        // Inline object handling omitted for brevity in legacy SPARQL builder, 
        // assuming LdpExecutor handles complex cases. 
        // But for completeness we should probably handle basic values.
        
        const predicate = getPredicateForColumn(column, table);
        // Handle inverse
        if (column.options?.inverse) {
           // Inverse insert: object <predicate> subject
           // value is the subject of the inverse triple
           const values = Array.isArray(value) ? value : [value];
           values.forEach(v => {
             const valStr = String(v).replace(/^<|>$/g, ''); // strip <> if present
             triples.push({
               subject: { termType: 'NamedNode', value: valStr },
               predicate: { termType: 'NamedNode', value: predicate },
               object: subjectTerm
             });
           });
           return;
        }

        const formatted = formatValue(value, column);
        const objectTerm = this.parseTermString(formatted as string); // Simplified

        triples.push({
          subject: subjectTerm,
          predicate: { termType: 'NamedNode', value: predicate },
          object: objectTerm
        });
      });
    }
    return triples;
  }

  private parseTermString(str: string): any {
    if (str.startsWith('<')) return { termType: 'NamedNode', value: str.slice(1, -1) };
    if (str.startsWith('_:')) return { termType: 'BlankNode', value: str.slice(2) };
    if (str.startsWith('"')) {
       // Simple literal parsing
       const lastQuote = str.lastIndexOf('"');
       const value = str.slice(1, lastQuote);
       const suffix = str.slice(lastQuote + 1);
       let datatype = undefined;
       let language = undefined;
       if (suffix.startsWith('^^')) {
         datatype = { termType: 'NamedNode', value: suffix.slice(3, -1) };
       } else if (suffix.startsWith('@')) {
         language = suffix.slice(1);
       }
       return { termType: 'Literal', value, datatype, language };
    }
    return { termType: 'Literal', value: str };
  }

  // 转换 UPDATE 查询 - 使用 DELETE/INSERT 组合 (Legacy String Builder)
  convertUpdate(setData: any, whereConditions: any, table: PodTable): SPARQLQuery {
    const targetRecords = this.extractSubjectRecords(whereConditions);
    if (targetRecords.length === 0) {
      throw new Error('UPDATE operation requires an id or @id condition to target a specific resource');
    }

    const prefixLines = Object.entries(this.prefixes)
      .map(([prefix, uri]) => `PREFIX ${prefix}: <${uri}>`)
      .join('\n');

    const statements: string[] = [];

    for (const record of targetRecords) {
      const resourceUri = generateSubjectUri(record, table);
      const updateBlock = this.buildUpdateStatementsForRecord(resourceUri, setData, table);
      if (updateBlock) {
        statements.push(updateBlock);
      }
    }

    if (statements.length === 0) {
      throw new Error('No valid update statements generated for provided data');
    }

    const query = `${prefixLines}\n${statements.join(';\n')}`;

    return {
      type: 'UPDATE',
      query,
      prefixes: this.prefixes
    };
  }

  // 转换 DELETE 查询 - 使用正确的 SPARQL UPDATE 格式 (Legacy String Builder)
  convertDelete(whereConditions: any, table: PodTable): SPARQLQuery {
    const prefixLines = Object.entries(this.prefixes)
      .map(([prefix, uri]) => `PREFIX ${prefix}: <${uri}>`)
      .join('\n');

    let query: string;

    if (!whereConditions) {
      query = `${prefixLines}\nDELETE WHERE {
  ?subject rdf:type <${table.config.type}> .
  ?subject ?p ?o .
}`;
    } else {
      const targetRecords = this.extractSubjectRecords(whereConditions);
      if (targetRecords.length === 0) {
        throw new Error('DELETE operation requires an id or @id condition to target a specific resource');
      }

      const deleteBlocks = targetRecords.map((record) => {
        const resourceUri = generateSubjectUri(record, table);
        return `DELETE WHERE {\n  <${resourceUri}> ?p ?o .\n}`;
      });

      query = `${prefixLines}\n${deleteBlocks.join(';\n')}`;
    }

    return {
      type: 'DELETE',
      query,
      prefixes: this.prefixes
    };
  }

  private buildUpdateStatementsForRecord(resourceUri: string, setData: Record<string, any>, table: PodTable): string | null {
    const deleteTriples: string[] = [];
    const insertTriples: string[] = [];

    Object.entries(setData).forEach(([columnName, value], index) => {
      const column = table.columns[columnName];
      if (!column) return;

      const predicate = getPredicateForColumn(column, table);
      const variableName = `old_${columnName}_${index}`;
      
      if (column.options?.inverse) {
         deleteTriples.push(`?${variableName} <${predicate}> <${resourceUri}> .`);
         if (value !== null && value !== undefined) {
            const valStr = String(value).replace(/^<|>$/g, '');
            insertTriples.push(`<${valStr}> <${predicate}> <${resourceUri}> .`);
         }
      } else {
         deleteTriples.push(`<${resourceUri}> <${predicate}> ?${variableName} .`);
         if (value !== null && value !== undefined) {
            const formatted = formatValue(value, column);
            insertTriples.push(`<${resourceUri}> <${predicate}> ${formatted} .`);
         }
      }
    });

    if (deleteTriples.length === 0 && insertTriples.length === 0) return null;

    const deleteBlock = deleteTriples.length > 0 ? `DELETE { ${deleteTriples.join(' ')} }` : '';
    const insertBlock = insertTriples.length > 0 ? `INSERT { ${insertTriples.join(' ')} }` : '';
    const whereBlock = deleteTriples.length > 0 ? `WHERE { ${deleteTriples.map(t => `OPTIONAL { ${t} }`).join(' ')} }` : 'WHERE {}';

    return `${deleteBlock} ${insertBlock} ${whereBlock}`;
  }

  // Helpers for condition extraction
  private extractSubjectRecords(where: any): Record<string, any>[] {
    if (!where) return [];
    if (this.isQueryCondition(where)) {
      const idValue = this.findConditionValue(where, 'id');
      const iriValue = this.findConditionValue(where, '@id');
      const record: Record<string, any> = {};
      if (iriValue) record['@id'] = iriValue;
      if (idValue) record.id = idValue;
      return Object.keys(record).length > 0 ? [record] : [];
    }
    if (typeof where === 'object' && (where.id || where['@id'])) {
      return [where];
    }
    return [];
  }

  private isQueryCondition(value: any): value is QueryCondition {
    return value && typeof value === 'object' && 'type' in value;
  }

  private findConditionValue(condition: QueryCondition | any, column: string): any | undefined {
    // Direct property check (standard QueryCondition)
    if (condition.column === column && condition.value !== undefined) {
      return condition.value;
    }
    
    // Legacy/Raw Binary Expression check (left.column = column, right.value = value)
    if (condition.type === 'binary_expr' && condition.operator === '=') {
      const leftCol = condition.left?.column;
      const rightVal = condition.right?.value;
      if (leftCol === column && rightVal !== undefined) {
        return rightVal;
      }
    }

    if (condition.type === 'logical_expr' && condition.conditions) {
      for (const child of condition.conditions) {
        const found = this.findConditionValue(child, column);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  }
  
  private extractConditionValues(condition: QueryCondition): any[] {
     // Simplified extraction for IN clause
     if (condition.operator === 'IN' && Array.isArray(condition.value)) {
         return condition.value;
     }
     return [];
  }
}
