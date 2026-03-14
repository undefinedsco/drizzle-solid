import * as sparqljs from 'sparqljs';
import { PodTable, PodColumnBase } from '../../schema';
import { SPARQLQuery } from '../types';
import { getPredicateForColumn, formatValue, generateSubjectUri } from '../helpers';
import { QueryCondition } from '../../query-conditions';
import { TripleBuilderImpl } from '../../triple/builder';
import type { UriResolver } from '../../uri';
import { UriResolverImpl } from '../../uri';
import type { TableRegistryContext } from '../../ast-to-sparql';

// Helper to extract the base document URI from a resource URI
// e.g., 'http://example.com/pod/data/alice.ttl#me' -> 'http://example.com/pod/data/alice.ttl'
function getDocumentUriFromSubjectUri(subjectUri: string): string {
  const hashIndex = subjectUri.indexOf('#');
  if (hashIndex !== -1) {
    return subjectUri.substring(0, hashIndex);
  }
  return subjectUri;
}

export class UpdateBuilder {
  private generator: any;
  private prefixes: Record<string, string>;
  private tripleBuilder: TripleBuilderImpl;
  private uriResolver: UriResolver;
  private tableContext?: TableRegistryContext;

  constructor(prefixes: Record<string, string>, uriResolver: UriResolver = new UriResolverImpl()) {
    this.generator = new (sparqljs as any).Generator();
    this.prefixes = prefixes;
    this.uriResolver = uriResolver;
    this.tripleBuilder = new TripleBuilderImpl(uriResolver);
  }

  /**
   * Set table context for URI resolution and inline child handling
   */
  setTableContext(context: TableRegistryContext): void {
    this.tableContext = context;
    this.tripleBuilder.setTableRegistry(context.tableRegistry, context.tableNameRegistry);
    if (context.baseUri) {
      this.tripleBuilder.setBaseUri(context.baseUri);
    }
  }

  private getUriContext(): TableRegistryContext | undefined {
    return this.tableContext;
  }

  private resolveLinkTerm(value: any, column: PodColumnBase | any, table: PodTable): string {
    const raw = String(value ?? '').replace(/^<|>$/g, '');
    if (this.uriResolver.isAbsoluteUri(raw)) {
      return raw;
    }
    try {
      return this.uriResolver.resolveLink(raw, column, this.getUriContext());
    } catch (error) {
      const tableName = table.config?.name ?? 'unknown';
      const columnName = column?.name ?? 'unknown';
      throw new Error(`[UpdateBuilder] Failed to resolve URI for ${tableName}.${columnName}: ${error}`);
    }
  }

  private formatValueOrThrow(value: any, column: PodColumnBase | any, table: PodTable): string {
    try {
      return formatValue(value, column, this.uriResolver, this.getUriContext()) as string;
    } catch (error) {
      const tableName = table.config?.name ?? 'unknown';
      const columnName = column?.name ?? 'unknown';
      throw new Error(`[UpdateBuilder] Failed to resolve URI for ${tableName}.${columnName}: ${error}`);
    }
  }

  convertInsert(valuesOrPlan: any[] | { table: PodTable; rows: any[] }, table?: PodTable, targetGraph?: string): SPARQLQuery {
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
    
    const allTriples = this.buildInsertTriples(rows, targetTable);
    const updates: any[] = [];

    if (targetGraph) {
      // targetGraph is provided:
      // - Fragment Mode: base file (e.g., /data/tags.ttl)
      // - Document Mode: base container (e.g., /data/users/)
      // All triples go into this graph.
      const insertBlock: any = { type: 'bgp', triples: allTriples };
      updates.push({
        updateType: 'insert',
        insert: [{
          type: 'graph',
          name: { termType: 'NamedNode', value: targetGraph },
          patterns: [insertBlock]
        }]
      });
    } else {
      // Fallback: If no targetGraph, group triples by their document URI.
      // Each document gets its own GRAPH block.
      const triplesByDocumentUri: Record<string, any[]> = {};
      for (const triple of allTriples) {
        if (triple.subject && triple.subject.termType === 'NamedNode') {
          const docUri = getDocumentUriFromSubjectUri(triple.subject.value);
          if (!triplesByDocumentUri[docUri]) {
            triplesByDocumentUri[docUri] = [];
          }
          triplesByDocumentUri[docUri].push(triple);
        } else {
          // Fallback for triples without a clear NamedNode subject (e.g. blank nodes not linked yet)
          // Put them in a default bucket.
          if (!triplesByDocumentUri['__default__']) {
            triplesByDocumentUri['__default__'] = [];
          }
          triplesByDocumentUri['__default__'].push(triple);
        }
      }

      for (const docUri in triplesByDocumentUri) {
        const triplesForDoc = triplesByDocumentUri[docUri];
        const insertBlock: any = { type: 'bgp', triples: triplesForDoc };

        if (docUri === '__default__') {
           updates.push({ updateType: 'insert', insert: [insertBlock] });
        } else {
          updates.push({
            updateType: 'insert',
            insert: [{
              type: 'graph',
              name: { termType: 'NamedNode', value: docUri },
              patterns: [insertBlock]
            }]
          });
        }
      }
    }

    if (updates.length === 0) {
      throw new Error('No valid insert statements generated');
    }

    const insertQuery: any = {
      type: 'update',
      prefixes: this.prefixes,
      updates
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
      const subjectUri = generateSubjectUri(row, table, this.uriResolver);
      const subjectTerm = { termType: 'NamedNode', value: subjectUri };

      triples.push({
        subject: subjectTerm,
        predicate: { termType: 'NamedNode', value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' },
        object: { termType: 'NamedNode', value: rdfClass }
      });

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
          const result = this.tripleBuilder.buildInsert(subjectUri, column, value, table);
          triples.push(...result.triples.map(this.toSparqlJsTriple), ...(result.childTriples?.map(this.toSparqlJsTriple) ?? []));
          return;
        }

        if (column.options?.inverse) {
           const values = Array.isArray(value) ? value : [value];
           values.forEach(v => {
             const valStr = this.resolveLinkTerm(v, column, table);
             triples.push({
               subject: { termType: 'NamedNode', value: valStr },
               predicate: { termType: 'NamedNode', value: predicate },
               object: subjectTerm
             });
           });
           return;
        }

        const formatted = this.formatValueOrThrow(value, column, table);
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

  convertUpdate(setData: any, whereConditions: any, table: PodTable, targetGraph?: string): SPARQLQuery {
    const targetRecords = this.extractSubjectRecords(whereConditions);
    if (targetRecords.length === 0) {
      throw new Error('UPDATE operation requires an id or @id condition to target a specific resource');
    }

    const updates: any[] = [];

    for (const record of targetRecords) {
      const resourceUri = generateSubjectUri(record, table, this.uriResolver);
      const docGraph = targetGraph || getDocumentUriFromSubjectUri(resourceUri);
      const graphTerm = { termType: 'NamedNode', value: docGraph };

      const { deleteTriples, insertTriples, whereTriples } = this.buildUpdatePartsForRecord(resourceUri, setData, table);

      const deleteBgp = { type: 'bgp', triples: deleteTriples };
      const whereBgp = { type: 'bgp', triples: whereTriples.length > 0 ? whereTriples : deleteTriples };

      // DELETE FROM GRAPH
      if (deleteTriples.length > 0) {
        updates.push({
          updateType: 'insertdelete',
          delete: [{ type: 'graph', name: graphTerm, patterns: [deleteBgp] }],
          insert: [],
          where: [{ type: 'graph', name: graphTerm, patterns: [whereBgp] }]
        });
      }

      // INSERT INTO GRAPH
      if (insertTriples.length > 0) {
        const insertBlock: any = { type: 'bgp', triples: insertTriples };
        updates.push({
          updateType: 'insert',
          insert: [{ type: 'graph', name: graphTerm, patterns: [insertBlock] }]
        });
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

  convertDelete(whereConditions: any, table: PodTable, targetGraph?: string): SPARQLQuery {
    const updates: any[] = [];
    let deletePatterns: any[] = [];
    let wherePatterns: any[] = [];

    const targetRecords = this.extractSubjectRecords(whereConditions);
    if (targetRecords.length === 0) {
      // If no specific records targeted by whereConditions,
      // and targetGraph is provided (Fragment Mode), delete all of table.config.type in that graph.
      if (targetGraph) {
        const graphTerm = { termType: 'NamedNode', value: targetGraph };
        deletePatterns.push({
          subject: { termType: 'Variable', value: 's' },
          predicate: { termType: 'Variable', value: 'p' },
          object: { termType: 'Variable', value: 'o' }
        });
        wherePatterns.push({
          subject: { termType: 'Variable', value: 's' },
          predicate: { termType: 'NamedNode', value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' },
          object: { termType: 'NamedNode', value: table.config.type }
        });
        const updateOp: any = {
            updateType: 'insertdelete',
            delete: [{ type: 'graph', name: graphTerm, patterns: [{ type: 'bgp', triples: deletePatterns }] }],
            insert: [],
            where: [{ type: 'graph', name: graphTerm, patterns: [{ type: 'bgp', triples: wherePatterns }] }]
        };
        updates.push(updateOp);

      } else {
          // If no target records AND no targetGraph (Document Mode, or generic delete),
          // this is an ambiguous operation for Document Mode. Throw an error.
          throw new Error('DELETE operation in Document Mode requires specific resource IDs or an explicit target graph.');
      }
    } else {
      for (const record of targetRecords) {
        const resourceUri = generateSubjectUri(record, table, this.uriResolver);
        const docGraph = targetGraph || getDocumentUriFromSubjectUri(resourceUri);
        const graphTerm = { termType: 'NamedNode', value: docGraph };

        // DELETE { GRAPH <resourceUri> { <resourceUri> ?p ?o } }
        const delPats = [{
          subject: { termType: 'NamedNode', value: resourceUri },
          predicate: { termType: 'Variable', value: 'p' },
          object: { termType: 'Variable', value: 'o' }
        }];
        // WHERE { GRAPH <resourceUri> { <resourceUri> ?p ?o } }
        const wherePats = [{
          subject: { termType: 'NamedNode', value: resourceUri },
          predicate: { termType: 'Variable', value: 'p' },
          object: { termType: 'Variable', value: 'o' }
        }];

        const deleteBlock: any = { type: 'bgp', triples: delPats };
        const whereBlock: any = { type: 'bgp', triples: wherePats };

        const updateOp: any = {
            updateType: 'insertdelete',
            delete: [{ type: 'graph', name: graphTerm, patterns: [deleteBlock] }],
            insert: [],
            where: [{ type: 'graph', name: graphTerm, patterns: [whereBlock] }]
        };
        updates.push(updateOp);
      }
    }

    if (updates.length === 0) {
      throw new Error('No valid delete statements generated');
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

  private buildUpdatePartsForRecord(resourceUri: string, setData: Record<string, any>, table: PodTable): {
    deleteTriples: any[];
    insertTriples: any[];
    whereTriples: any[];
  } {
    const deleteTriples: any[] = [];
    const insertTriples: any[] = [];
    const whereTriples: any[] = [];

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
        const childVarPredicate = { termType: 'Variable', value: `p_${variableName}` };
        const childVarObject = { termType: 'Variable', value: `o_${variableName}` };

        const linkTriple = { subject: subjectTerm, predicate: predicateTerm, object: varTerm };
        const childTriple = { subject: varTerm, predicate: childVarPredicate, object: childVarObject };

        deleteTriples.push(linkTriple, childTriple);
        whereTriples.push(linkTriple, childTriple);

        if (value !== null && value !== undefined) {
          const result = this.tripleBuilder.buildInsert(resourceUri, column, value, table);
          insertTriples.push(...result.triples.map(this.toSparqlJsTriple), ...(result.childTriples?.map(this.toSparqlJsTriple) ?? []));
        }
        return;
      }
      
      if (column.options?.inverse) {
        const inverseTriple = { subject: varTerm, predicate: predicateTerm, object: subjectTerm };
        deleteTriples.push(inverseTriple);
        whereTriples.push(inverseTriple);

        if (value !== null && value !== undefined) {
          const valStr = this.resolveLinkTerm(value, column, table);
          insertTriples.push({
            subject: { termType: 'NamedNode', value: valStr },
            predicate: predicateTerm,
            object: subjectTerm
          });
        }
      } else {
        const deleteTriple = { subject: subjectTerm, predicate: predicateTerm, object: varTerm };
        deleteTriples.push(deleteTriple);
        whereTriples.push(deleteTriple);

        if (value !== null && value !== undefined) {
          const formatted = this.formatValueOrThrow(value, column, table);
          const objectTerm = this.parseTermString(formatted as string);
          insertTriples.push({ subject: subjectTerm, predicate: predicateTerm, object: objectTerm });
        }
      }
    });

    return { deleteTriples, insertTriples, whereTriples };
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
    // Support new BinaryExpression format: { left, operator, right }
    if (condition.type === 'binary_expr' && condition.operator === '=') {
      const left = condition.left;
      const right = condition.right;

      // New format: left is string or object with 'name' property
      let colName: string | undefined;
      if (typeof left === 'string') {
        colName = left.includes('.') ? left.split('.')[1] : left;
      } else if (left && typeof left === 'object' && 'name' in left) {
        colName = left.name;
      } else if (left && typeof left === 'object' && 'column' in left) {
        // Legacy format support
        colName = left.column;
      }

      if (colName === column) {
        // New format: right is the value directly
        if (right !== undefined && right !== null) {
          // Check if it's legacy format with { value: ... }
          if (typeof right === 'object' && 'value' in right) {
            return right.value;
          }
          return right;
        }
      }
    }

    // Support LogicalExpression with 'expressions' property (new format)
    if (condition.type === 'logical_expr') {
      const children = condition.expressions || condition.conditions || [];
      for (const child of children) {
        const found = this.findConditionValue(child, column);
        if (found !== undefined) return found;
      }
    }

    return undefined;
  }
}
