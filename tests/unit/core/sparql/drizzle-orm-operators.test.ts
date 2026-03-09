import { describe, it, expect } from 'vitest';
import { eq, and, or, gt, lt, gte, lte, inArray, isNull, isNotNull, ne } from '@src/core/query-conditions';
import { ExpressionBuilder } from '@src/core/sparql/builder/expression-builder';
import { podTable, string, int, id, uri } from '@src/index';

const table = podTable('users', {
  id: string('id').primaryKey().predicate('https://schema.org/identifier'),
  name: string('name').predicate('https://schema.org/name'),
  age: int('age').predicate('https://schema.org/age')
}, {
  base: '/users.ttl',
  type: 'https://schema.org/Person'
});

// Table with virtual id column (uses @id predicate)
const tableWithVirtualId = podTable('contacts', {
  id: id(),
  name: string('name').predicate('https://schema.org/name'),
}, {
  base: 'http://localhost:3000/test/data/contacts/',
  subjectTemplate: '{id}.ttl',
  type: 'https://schema.org/Person'
});

// Table with virtual id column in fragment mode
const tableWithFragmentId = podTable('notes', {
  id: id(),
  content: string('content').predicate('https://schema.org/text'),
}, {
  base: 'http://localhost:3000/test/data/notes.ttl',  // fragment mode: single file
  subjectTemplate: '#{id}', // Explicit fragment mode
  type: 'https://schema.org/Note'
});

// Users table for link target
const usersTable = podTable('users_ref', {
  id: id(),
  name: string('name').predicate('https://schema.org/name'),
}, {
  base: 'http://localhost:3000/test/data/users/',
  subjectTemplate: '{id}.ttl',
  type: 'https://schema.org/Person'
});

// Posts table with link column
const postsTable = podTable('posts', {
  id: id(),
  title: string('title').predicate('https://schema.org/headline'),
  authorId: uri('authorId').predicate('https://schema.org/author').link(usersTable),
}, {
  base: 'http://localhost:3000/test/data/posts/',
  subjectTemplate: '{id}.ttl',
  type: 'https://schema.org/BlogPosting'
});

const builder = new ExpressionBuilder();

describe('ExpressionBuilder with query operators', () => {
  it('handles eq() operator', () => {
    const condition = eq(table.name, 'John');
    const result = builder.buildWhereClause(condition, table);
    expect(result).toContain('?name');
    expect(result).toContain('=');
    expect(result).toContain('"John"');
  });

  it('handles ne() operator', () => {
    const condition = ne(table.name, 'John');
    const result = builder.buildWhereClause(condition, table);
    expect(result).toContain('?name');
    expect(result).toContain('!=');
    expect(result).toContain('"John"');
  });

  it('handles gt() operator', () => {
    const condition = gt(table.age, 18);
    const result = builder.buildWhereClause(condition, table);
    expect(result).toContain('?age');
    expect(result).toContain('>');
    expect(result).toContain('18');
  });

  it('handles lt() operator', () => {
    const condition = lt(table.age, 65);
    const result = builder.buildWhereClause(condition, table);
    expect(result).toContain('?age');
    expect(result).toContain('<');
    expect(result).toContain('65');
  });

  it('handles gte() operator', () => {
    const condition = gte(table.age, 21);
    const result = builder.buildWhereClause(condition, table);
    expect(result).toContain('?age');
    expect(result).toContain('>=');
  });

  it('handles lte() operator', () => {
    const condition = lte(table.age, 30);
    const result = builder.buildWhereClause(condition, table);
    expect(result).toContain('?age');
    expect(result).toContain('<=');
  });

  it('handles and() with multiple conditions', () => {
    const condition = and(
      eq(table.name, 'John'),
      gt(table.age, 18)
    );
    const result = builder.buildWhereClause(condition, table);
    expect(result).toContain('&&');
    expect(result).toContain('?name');
    expect(result).toContain('?age');
  });

  it('handles or() with multiple conditions', () => {
    const condition = or(
      eq(table.name, 'John'),
      eq(table.name, 'Jane')
    );
    const result = builder.buildWhereClause(condition, table);
    expect(result).toContain('||');
  });

  it('handles inArray() operator', () => {
    const condition = inArray(table.age, [18, 21, 25]);
    const result = builder.buildWhereClause(condition, table);
    expect(result).toContain('?age');
    expect(result).toContain('IN');
  });

  it('resolves link UUIDs for eq() on uri columns', () => {
    const uuid = '8f3c1b6a-2b4e-4b0a-9f2d-3c8f6dd9a111';
    const condition = eq(postsTable.authorId, uuid);
    const result = builder.buildWhereClause(condition, postsTable);

    expect(result).toContain('?authorId');
    expect(result).toContain(`<http://localhost:3000/test/data/users/${uuid}.ttl>`);
    expect(result).not.toContain(`<${uuid}>`);
  });

  it('resolves link UUIDs when already wrapped in angle brackets', () => {
    const uuid = '5d3f1c6b-1a2e-4c3b-9f2d-3c8f6dd9a222';
    const condition = eq(postsTable.authorId, `<${uuid}>`);
    const result = builder.buildWhereClause(condition, postsTable);

    expect(result).toContain('?authorId');
    expect(result).toContain(`<http://localhost:3000/test/data/users/${uuid}.ttl>`);
    expect(result).not.toContain(`<${uuid}>`);
  });

  it('handles isNull() operator', () => {
    const condition = isNull(table.name);
    const result = builder.buildWhereClause(condition, table);
    expect(result).toContain('BOUND');
    expect(result).toContain('?name');
  });

  it('handles isNotNull() operator', () => {
    const condition = isNotNull(table.age);
    const result = builder.buildWhereClause(condition, table);
    expect(result).toContain('BOUND');
    expect(result).toContain('?age');
  });
});

describe('ExpressionBuilder with virtual id() column', () => {
  it('generates full URI for eq() with id column in document mode', () => {
    const condition = eq(tableWithVirtualId.id, 'b0ab3c06-9b8e-4b4b-a664-8362aabe938d');
    const result = builder.buildWhereClause(condition, tableWithVirtualId);
    
    // Should use ?subject variable
    expect(result).toContain('?subject');
    // Should contain full URI, not just the UUID
    expect(result).toContain('<http://localhost:3000/test/data/contacts/b0ab3c06-9b8e-4b4b-a664-8362aabe938d.ttl>');
    // Should NOT contain bare UUID in angle brackets
    expect(result).not.toContain('<b0ab3c06-9b8e-4b4b-a664-8362aabe938d>');
  });

  it('generates full URI for eq() with id column in fragment mode', () => {
    const condition = eq(tableWithFragmentId.id, 'note-123');
    const result = builder.buildWhereClause(condition, tableWithFragmentId);
    
    // Should use ?subject variable
    expect(result).toContain('?subject');
    // Should contain full URI with fragment
    expect(result).toContain('<http://localhost:3000/test/data/notes.ttl#note-123>');
    // Should NOT contain bare id
    expect(result).not.toContain('<note-123>');
  });

  it('generates full URIs for inArray() with id column', () => {
    const condition = inArray(tableWithVirtualId.id, ['id-1', 'id-2', 'id-3']);
    const result = builder.buildWhereClause(condition, tableWithVirtualId);
    
    // Should use ?subject variable
    expect(result).toContain('?subject');
    expect(result).toContain('IN');
    // Should contain full URIs
    expect(result).toContain('<http://localhost:3000/test/data/contacts/id-1.ttl>');
    expect(result).toContain('<http://localhost:3000/test/data/contacts/id-2.ttl>');
    expect(result).toContain('<http://localhost:3000/test/data/contacts/id-3.ttl>');
  });

  it('uses ?subject for isNull() with virtual id column', () => {
    const condition = isNull(tableWithVirtualId.id);
    const result = builder.buildWhereClause(condition, tableWithVirtualId);
    
    // Should use ?subject variable (not ?id)
    expect(result).toContain('?subject');
    expect(result).not.toContain('?id');
    expect(result).toContain('BOUND');
  });

  it('uses ?subject for isNotNull() with virtual id column', () => {
    const condition = isNotNull(tableWithVirtualId.id);
    const result = builder.buildWhereClause(condition, tableWithVirtualId);
    
    // Should use ?subject variable (not ?id)
    expect(result).toContain('?subject');
    expect(result).not.toContain('?id');
    expect(result).toContain('BOUND');
  });
});
