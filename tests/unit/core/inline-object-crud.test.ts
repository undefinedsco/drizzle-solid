import { describe, expect, it, beforeEach } from 'vitest';
import { ASTToSPARQLConverter } from '../../../src/core/ast-to-sparql';
import { podTable, string, object } from '../../../src/core/pod-table';
import { subjectResolver } from '../../../src/core/subject';

const schemaNamespace = { uri: 'https://schema.org/', prefix: 'schema' };

describe('inline object CRUD SPARQL generation', () => {
  beforeEach(() => {
    subjectResolver.setPodUrl('https://pod.example');
  });

  const converter = new ASTToSPARQLConverter('https://pod.example/');
  const threadsTable = podTable('threads', {
    id: string('id').primaryKey(),
    title: string('title').predicate('https://schema.org/headline'),
    participants: object('participants').array().predicate('https://schema.org/hasPart')
  }, {
    base: '/threads.ttl',
    type: 'https://schema.org/Conversation',
    namespace: schemaNamespace
  });

  it('generates inline child triples on insert with generated ids', () => {
    const query = converter.convertInsert([{
      id: 'thread-1',
      title: 'Inline demo',
      participants: [
        { name: 'Alice', role: 'owner' },
        { id: '#custom-participant', name: 'Bob', role: 'member' }
      ]
    }], threadsTable);

    expect(query.query).toContain('schema:hasPart <https://pod.example/threads.ttl#participants-1>');
    expect(query.query).toContain('<https://pod.example/threads.ttl#participants-1> schema:name "Alice"');
    expect(query.query).toContain('schema:role "owner"');
    expect(query.query).toContain('<#custom-participant>');
    expect(query.query).toContain('schema:name "Bob"');
  });

  it('cascades inline children on update by deleting old and inserting new', () => {
    const query = converter.convertUpdate({
      participants: [
        { id: '#participants-1', name: 'Alice Updated' },
        { name: 'Carol' }
      ]
    }, { left: '@id', operator: '=', right: 'threads.ttl#thread-1', type: 'binary_expr' }, threadsTable);

    expect(query.query).toContain('DELETE {');
    expect(query.query).toContain('<https://pod.example/threads.ttl#thread-1>');
    expect(query.query).toContain('INSERT DATA {');
    expect(query.query).toContain('participants-1');
    expect(query.query).toContain('participants-2');
  });
});
