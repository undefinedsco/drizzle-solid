import * as sparqljs from 'sparqljs';
import { PodTable, PodColumnBase } from '../../pod-table';
import { SPARQLQuery } from '../types';
import { getPredicateForColumn, formatValue, generateSubjectUri } from '../helpers';
import { QueryCondition } from '../../query-conditions';
import { tripleBuilder } from '../../triple/builder';

export class UpdateBuilder {
  private generator: any;
  private prefixes: Record<string, string>;

  constructor(prefixes: Record<string, string>) {
    this.generator = new (sparqljs as any).Generator();
    this.prefixes = prefixes;
  }

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

      triples.push({
        subject: subjectTerm,
        predicate: { termType: 'NamedNode', value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' },
        object: { termType: 'NamedNode', value: rdfClass }
      });

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

        const predicate = getPredicateForColumn(column, table);
        const isInline =
          column.dataType === 'object' ||
          column.dataType === 'json' ||
          (column.dataType === 'array' && ((column as any).elementType === 'object' || column.options?.baseType === 'object'));

        if (isInline) {
          const result = tripleBuilder.buildInsert(subjectUri, column, value, table);
          triples.push(...result.triples.map(this.toSparqlJsTriple), ...(result.childTriples?.map(this.toSparqlJsTriple) ?? []));
          return;
        }

        if (column.options?.inverse) {
           const values = Array.isArray(value) ? value : [value];
           values.forEach(v => {
             const valStr = String(v).replace(/^<|>$/g, '');
             triples.push({
               subject: { termType: 'NamedNode', value: valStr },
               predicate: { termType: 'NamedNode', value: predicate },
               object: subjectTerm
             });
           });
           return;
        }

        const formatted = formatValue(value, column);
        const objectTerm = this.parseTermString(formatted as string);

        triples.push({
          subject: subjectTerm,
          predicate: { termType: 'NamedNode', value: predicate },
          object: objectTerm
        });
      });
    }
    return triples;
  }

  convertUpdate(setData: any, whereConditions: any, table: PodTable): SPARQLQuery {
    const targetRecords = this.extractSubjectRecords(whereConditions);
    if (targetRecords.length === 0) {
      throw new Error('UPDATE operation requires an id or @id condition to target a specific resource');
    }

    const updates: any[] = [];

    for (const record of targetRecords) {
      const resourceUri = generateSubjectUri(record, table);
      const updateBlock = this.buildUpdateBlockForRecord(resourceUri, setData, table);
      if (updateBlock) {
        updates.push(updateBlock);
      }
    }

    if (updates.length === 0) {
      throw new Error('No valid update statements generated for provided data');
    }

    const updateQuery: any = {
      type: 'update',
      prefixes: this.prefixes,
      updates
    };

    return {
      type: 'UPDATE',
      query: this.generator.stringify(updateQuery),
      prefixes: this.prefixes
    };
  }

  convertDelete(whereConditions: any, table: PodTable): SPARQLQuery {
    const updates: any[] = [];

    if (!whereConditions) {
      updates.push({
        updateType: 'deletewhere',
        delete: [{
          type: 'bgp',
          triples: [{
            subject: { termType: 'Variable', value: 'subject' },
            predicate: { termType: 'NamedNode', value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' },
            object: { termType: 'NamedNode', value: table.config.type }
          }, {
            subject: { termType: 'Variable', value: 'subject' },
            predicate: { termType: 'Variable', value: 'p' },
            object: { termType: 'Variable', value: 'o' }
          }]
        }]
      });
    } else {
      const targetRecords = this.extractSubjectRecords(whereConditions);
      if (targetRecords.length === 0) {
        throw new Error('DELETE operation requires an id or @id condition to target a specific resource');
      }

      for (const record of targetRecords) {
        const resourceUri = generateSubjectUri(record, table);
        updates.push({
          updateType: 'deletewhere',
          delete: [{
            type: 'bgp',
            triples: [{
              subject: { termType: 'NamedNode', value: resourceUri },
              predicate: { termType: 'Variable', value: 'p' },
              object: { termType: 'Variable', value: 'o' }
            }]
          }]
        });
      }
    }

    const deleteQuery: any = {
      type: 'update',
      prefixes: this.prefixes,
      updates
    };

    return {
      type: 'DELETE',
      query: this.generator.stringify(deleteQuery),
      prefixes: this.prefixes
    };
  }

  private buildUpdateBlockForRecord(resourceUri: string, setData: Record<string, any>, table: PodTable): any | null {
    const deleteTriples: any[] = [];
    const insertTriples: any[] = [];
    const wherePatterns: any[] = [];

    Object.entries(setData).forEach(([columnName, value], index) => {
      const column = table.columns[columnName];
      if (!column) return;

      const predicate = getPredicateForColumn(column, table);
      const variableName = `old_${columnName}_${index}`;
      const isInline =
        column.dataType === 'object' ||
        column.dataType === 'json' ||
        (column.dataType === 'array' && ((column as any).elementType === 'object' || column.options?.baseType === 'object'));
      
      const subjectTerm = { termType: 'NamedNode', value: resourceUri };
      const predicateTerm = { termType: 'NamedNode', value: predicate };
      const varTerm = { termType: 'Variable', value: variableName };

      if (isInline) {
        deleteTriples.push({ subject: subjectTerm, predicate: predicateTerm, object: varTerm });
        deleteTriples.push({
          subject: varTerm,
          predicate: { termType: 'Variable', value: `p_${variableName}` },
          object: { termType: 'Variable', value: `o_${variableName}` }
        });
        
        wherePatterns.push({
          type: 'optional',
          patterns: [{
            type: 'bgp',
            triples: [
              { subject: subjectTerm, predicate: predicateTerm, object: varTerm },
              {
                subject: varTerm,
                predicate: { termType: 'Variable', value: `p_${variableName}` },
                object: { termType: 'Variable', value: `o_${variableName}` }
              }
            ]
          }]
        });

        if (value !== null && value !== undefined) {
          const result = tripleBuilder.buildInsert(resourceUri, column, value, table);
          insertTriples.push(...result.triples.map(this.toSparqlJsTriple), ...(result.childTriples?.map(this.toSparqlJsTriple) ?? []));
        }
        return;
      }
      
      if (column.options?.inverse) {
         deleteTriples.push({ subject: varTerm, predicate: predicateTerm, object: subjectTerm });
         wherePatterns.push({
           type: 'optional',
           patterns: [{ type: 'bgp', triples: [{ subject: varTerm, predicate: predicateTerm, object: subjectTerm }] }]
         });

         if (value !== null && value !== undefined) {
            const valStr = String(value).replace(/^<|>$/g, '');
            insertTriples.push({
              subject: { termType: 'NamedNode', value: valStr },
              predicate: predicateTerm,
              object: subjectTerm
            });
         }
      } else {
         deleteTriples.push({ subject: subjectTerm, predicate: predicateTerm, object: varTerm });
         wherePatterns.push({
           type: 'optional',
           patterns: [{ type: 'bgp', triples: [{ subject: subjectTerm, predicate: predicateTerm, object: varTerm }] }]
         });

         if (value !== null && value !== undefined) {
            const formatted = formatValue(value, column);
            const objectTerm = this.parseTermString(formatted as string);
            insertTriples.push({ subject: subjectTerm, predicate: predicateTerm, object: objectTerm });
         }
      }
    });

    if (deleteTriples.length === 0 && insertTriples.length === 0) return null;

    // Use 'insertdelete' as the updateType key. 
    // Note: sparqljs might require 'delete' and 'insert' keys to be present.
    return {
      updateType: 'insertdelete', 
      delete: deleteTriples.length > 0 ? [{ type: 'bgp', triples: deleteTriples }] : [],
      insert: insertTriples.length > 0 ? [{ type: 'bgp', triples: insertTriples }] : [],
      where: wherePatterns
    };
  }

  private toSparqlJsTriple = (triple: any): any => {
    return triple;
  }

  private parseTermString(str: string): any {
    if (typeof str !== 'string') {
      return { termType: 'Literal', value: String(str) };
    }
    if (str.startsWith('<')) return { termType: 'NamedNode', value: str.slice(1, -1) };
    if (str.startsWith('_:')) return { termType: 'BlankNode', value: str.slice(2) };
    if (str.startsWith('"')) {
       const lastQuote = str.lastIndexOf('"');
       const value = str.slice(1, lastQuote);
       const suffix = str.slice(lastQuote + 1);
       let datatype = undefined;
       let language = undefined;
       if (suffix.startsWith('^^')) {
         const dtUri = suffix.slice(2); 
         const dtVal = dtUri.startsWith('<') ? dtUri.slice(1, -1) : dtUri;
         datatype = { termType: 'NamedNode', value: dtVal };
       } else if (suffix.startsWith('@')) {
         language = suffix.slice(1);
       }
       return { termType: 'Literal', value, datatype, language };
    }
    return { termType: 'Literal', value: str };
  }

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
    if (condition.column === column && condition.value !== undefined) {
      return condition.value;
    }
    
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
}