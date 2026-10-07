import { DataFactory } from 'n3';
import type { Quad, Term } from '@rdfjs/types';
import type { PodColumnBase, PodTable } from '../schema';
import { tripleBuilder } from '../triple/builder';
import type { RdfTerm } from '../triple/types';
import { exactDocument } from './snapshot';
import type { ConditionalPatch, ResourceSnapshot } from './types';
const { namedNode, literal, quad } = DataFactory;
const xsd = 'http://www.w3.org/2001/XMLSchema#';
const key = (term: Term): string => `${term.termType}:${term.value}`;
const same = (a: Term, b: Term): boolean => a.equals(b);
const outgoing = (facts: readonly Quad[], subject: Term): Quad[] => facts.filter(q => same(q.subject, subject));

function owned(snapshot: ResourceSnapshot, parent: Term, child: Term): void {
  if (child.termType !== 'NamedNode' && child.termType !== 'BlankNode') throw new Error('Inline object must be an RDF node');
  if (child.termType === 'NamedNode' && exactDocument(child.value) !== snapshot.documentIri) throw new Error('Cross-document inline ownership is unsupported');
  const incoming = snapshot.quads.filter(q => same(q.object, child));
  if (incoming.length !== 1 || !same(incoming[0].subject, parent)) throw new Error('Shared or ambiguous inline ownership is unsupported');
}
function closure(snapshot: ResourceSnapshot, parent: Term, child: Term, visited = new Set<string>()): Quad[] {
  owned(snapshot, parent, child);
  if (visited.has(key(child))) throw new Error('Cyclic inline ownership is unsupported');
  visited.add(key(child));
  const facts = outgoing(snapshot.quads, child);
  const result = [...facts];
  for (const fact of facts) {
    // A named link has no implicit ownership. Blank nodes have no independent resource identity.
    if (fact.object.termType === 'BlankNode') result.push(...closure(snapshot, child, fact.object, visited));
  }
  return result;
}
function rdfTerm(term: RdfTerm): Term {
  switch (term.termType) {
    case 'NamedNode': return namedNode(term.value);
    case 'Literal': return literal(term.value, term.language || namedNode(term.datatype?.value || `${xsd}string`));
    default: throw new Error('Property serializer produced an unsupported RDF term');
  }
}
function values(table: PodTable, subject: Term, predicate: string, column: Parameters<typeof tripleBuilder.buildInsert>[1], value: unknown): Quad[] {
  const built = tripleBuilder.buildInsert(subject.value, column, value, table);
  if (built.childTriples?.length) throw new Error('Unexpected inline serialization');
  if (built.triples.some(t => t.subject.termType !== subject.termType || t.subject.value !== subject.value || t.predicate.value !== predicate)) throw new Error('Conditional serializer must produce exact outgoing property assertions');
  return built.triples.map(t => quad(subject as Quad['subject'], namedNode(predicate), rdfTerm(t.object) as Quad['object']));
}
function mergeJson(previous: unknown, partial: unknown): unknown {
  if (!partial || typeof partial !== 'object' || Array.isArray(partial) || partial instanceof Date) return partial;
  if (!Object.values(partial).some(value => value !== undefined)) return previous;
  // JSON keys are owned data, including names that coincide with object prototype members.
  const result: Record<string, unknown> = Object.assign(Object.create(null), previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {});
  for (const [name, value] of Object.entries(partial)) {
    if (value === undefined) continue;
    if (value === null) delete result[name];
    else {
      const next = mergeJson(result[name], value);
      if (next !== undefined) result[name] = next;
    }
  }
  return Object.keys(result).length === 0 && previous === undefined ? undefined : result;
}
function inlineValue(value: unknown): Quad['object'] {
  if (typeof value === 'string') return /^https?:\/\//.test(value) ? namedNode(value) : literal(value);
  if (typeof value === 'boolean') return literal(String(value), namedNode(`${xsd}boolean`));
  if (typeof value === 'number') return literal(String(value), namedNode(`${xsd}${Number.isInteger(value) ? 'integer' : 'decimal'}`));
  if (value instanceof Date) return literal(value.toISOString(), namedNode(`${xsd}dateTime`));
  return literal(JSON.stringify(value), namedNode(`${xsd}json`));
}
function inlinePatch(snapshot: ResourceSnapshot, table: PodTable, subject: Term, partial: Record<string, unknown>, deletes: Quad[], inserts: Quad[]): void {
  for (const [name, value] of Object.entries(partial)) {
    if (value === undefined || (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && !Object.values(value).some(item => item !== undefined))) continue;
    if (name === 'id' || name === '@id') throw new Error('Conditional inline identity cannot be replaced');
    const predicate = /^https?:\/\//.test(name) ? name : `${table.config.namespace?.uri || ''}${name}`;
    if (!/^https?:\/\//.test(predicate)) throw new Error('Inline properties require an explicit namespace or predicate IRI');
    const old = outgoing(snapshot.quads, subject).filter(q => q.predicate.value === predicate);
    if (old.length === 1 && ['BlankNode', 'NamedNode'].includes(old[0].object.termType) && value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      owned(snapshot, subject, old[0].object);
      inlinePatch(snapshot, table, old[0].object, value as Record<string, unknown>, deletes, inserts);
      continue;
    }
    for (const fact of old) {
      if (fact.object.termType === 'BlankNode') deletes.push(...closure(snapshot, subject, fact.object));
    }
    if (value === null) { deletes.push(...old); continue; }
    let next: unknown = value;
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      if (old.length && !(old.length === 1 && old[0].object.termType === 'Literal' && old[0].object.datatype.value === `${xsd}json`)) throw new Error('Object partial requires a JSON literal or proven owned node');
      const previous = old.length === 1 && old[0].object.termType === 'Literal' && old[0].object.datatype.value === `${xsd}json` ? JSON.parse(old[0].object.value) : undefined;
      next = mergeJson(previous, value);
      if (next === undefined || JSON.stringify(next) === JSON.stringify(previous)) continue;
    }
    deletes.push(...old);
    inserts.push(quad(subject as Quad['subject'], namedNode(predicate), inlineValue(next)));
  }
}
export function compileProperties<TTable extends PodTable<any>>(snapshot: ResourceSnapshot<TTable>, table: TTable, properties: Record<string, unknown> | undefined): ConditionalPatch {
  const root = namedNode(snapshot.subjectIri);
  const deletes: Quad[] = [];
  const inserts: Quad[] = [];
  if (properties === undefined) {
    deletes.push(...outgoing(snapshot.quads, root));
    for (const column of Object.values(table.columns as Record<string, PodColumnBase>)) {
      if (!['object', 'json'].includes(column.dataType)) continue;
      const predicate = tripleBuilder.getPredicateUri(column, table);
      for (const fact of outgoing(snapshot.quads, root).filter(q => q.predicate.value === predicate)) deletes.push(...closure(snapshot, root, fact.object));
    }
    // Unknown blank-node properties are owned only when their incoming edge is unique.
    for (const fact of outgoing(snapshot.quads, root)) if (fact.object.termType === 'BlankNode' && !deletes.some(q => same(q.subject, fact.object))) deletes.push(...closure(snapshot, root, fact.object));
  } else {
    for (const [name, value] of Object.entries(properties)) {
      if (value === undefined) continue;
      const column = table.columns[name];
      if (!column || name === '@id') throw new Error(`Unknown conditional property: ${name}`);
      if (column.options.inverse) throw new Error('Conditional inverse properties are unsupported');
      const predicate = tripleBuilder.getPredicateUri(column, table);
      if (predicate === '@id' || column.options.primaryKey) throw new Error('Conditional subject identity cannot change');
      const old = outgoing(snapshot.quads, root).filter(q => q.predicate.value === predicate);
      if (['object', 'json'].includes(column.dataType) && value !== null) {
        if (Array.isArray(value) || typeof value !== 'object' || value instanceof Date) throw new Error('Conditional inline properties require a partial object');
        if (!Object.values(value).some(item => item !== undefined)) continue;
        if (old.length > 1) throw new Error('Ambiguous inline object is unsupported');
        const child = old[0]?.object || namedNode(`${snapshot.subjectIri}${snapshot.subjectIri.includes('#') ? '-' : '#'}${encodeURIComponent(name)}`);
        if (old.length) owned(snapshot, root, child);
        else {
          if (snapshot.quads.some(q => same(q.subject, child) || same(q.object, child))) throw new Error('Inline child identity already belongs to another resource');
        }
        inlinePatch(snapshot, table, child, value as Record<string, unknown>, deletes, inserts);
        if (!old.length && inserts.some(fact => same(fact.subject, child))) inserts.push(quad(root, namedNode(predicate), child as Quad['object']));
      } else {
        deletes.push(...old);
        if (['object', 'json'].includes(column.dataType)) for (const fact of old) deletes.push(...closure(snapshot, root, fact.object));
        if (value !== null) inserts.push(...values(table, root, predicate, column, value));
      }
    }
  }
  return compilePatch(snapshot, deletes, inserts);
}
function serialize(term: Term, variables: Map<string, string>): string {
  if (term.termType === 'BlankNode') {
    const variable = variables.get(term.value);
    if (!variable) throw new Error('Blank node is not proven by the snapshot');
    return variable;
  }
  if (term.termType === 'NamedNode') {
    if (/[<>"{}|^`\\\s]/.test(term.value)) throw new Error('IRI cannot be represented safely in an N3 patch');
    return `<${term.value}>`;
  }
  if (term.termType === 'Literal') return `${JSON.stringify(term.value)}${term.language ? `@${term.language}` : `^^<${term.datatype.value}>`}`;
  throw new Error('Unsupported RDF term in a conditional patch');
}
export function compilePatch(snapshot: ResourceSnapshot, deletes: readonly Quad[], inserts: readonly Quad[]): ConditionalPatch {
  const root = namedNode(snapshot.subjectIri);
  const where = [...outgoing(snapshot.quads, root)];
  const subjects = new Set([...deletes, ...inserts].map(q => key(q.subject)));
  for (const fact of snapshot.quads) if (subjects.has(key(fact.subject)) && !same(fact.subject, root)) where.push(fact);
  for (let index = 0; index < where.length; index++) {
    const fact = where[index];
    if (fact.object.termType === 'BlankNode') {
      owned(snapshot, fact.subject, fact.object);
      for (const child of outgoing(snapshot.quads, fact.object)) if (!where.includes(child)) where.push(child);
    }
  }
  const variables = new Map<string, string>();
  for (const fact of where) for (const term of [fact.subject, fact.object]) if (term.termType === 'BlankNode' && !variables.has(term.value)) variables.set(term.value, `?b${variables.size}`);
  const lines = (facts: readonly Quad[]): string => [...new Set(facts.map(q => {
    if (q.graph.termType !== 'DefaultGraph') throw new Error('Named graphs in an RDF document are unsupported');
    return `${serialize(q.subject, variables)} ${serialize(q.predicate, variables)} ${serialize(q.object, variables)} .`;
  }))].join('\n');
  // Exact root and owned-node anchors pin blank bindings without widening to neighbors.
  // A backend must reject multiple WHERE solutions atomically.
  const clauses = [
    ...(deletes.length ? [`solid:deletes {\n${lines(deletes)}\n}`] : []),
    ...(inserts.length ? [`solid:inserts {\n${lines(inserts)}\n}`] : []),
    `solid:where {\n${lines(where)}\n}`,
  ];
  return { documentIri: snapshot.documentIri, etag: snapshot.etag, body: `@prefix solid: <http://www.w3.org/ns/solid/terms#>.\n_:patch a solid:InsertDeletePatch;\n${clauses.join(';\n')}.` };
}
