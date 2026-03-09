import { describe, expect, it } from 'vitest';
import { ASTToSPARQLConverter } from '@src/core/ast-to-sparql';
import { SelectQueryBuilder } from '@src/core/query-builders/select-query-builder';
import { podTable, string, exists, notExists } from '@src/index';

const Users = podTable('Users', {
  id: string('id').primaryKey().predicate('https://schema.org/identifier'),
  name: string('name').predicate('https://schema.org/name'),
  managerId: string('managerId').predicate('https://schema.org/manager'),
}, {
  base: 'https://pod.example/users.ttl',
  type: 'https://schema.org/Person',
  subjectTemplate: '#{id}',
});

describe('QueryBuilder exists()/notExists()', () => {
  const converter = new ASTToSPARQLConverter('https://pod.example/');
  const session: any = {
    getDialect: () => ({
      getSPARQLConverter: () => converter,
    }),
    execute: async () => [],
    executeSql: async () => [],
    select: () => ({ from: () => ({}) }),
  };

  it('should embed EXISTS graph patterns into generated SPARQL', () => {
    const query = new SelectQueryBuilder(session, {
      id: Users.id,
      name: Users.name,
    })
      .from(Users)
      .where(exists('?subject <https://schema.org/manager> ?manager .'))
      .toSPARQL();

    expect(query.query).toContain('EXISTS');
    expect(query.query).toContain('schema:manager');
  });

  it('should embed NOT EXISTS graph patterns into generated SPARQL', () => {
    const query = new SelectQueryBuilder(session, {
      id: Users.id,
      name: Users.name,
    })
      .from(Users)
      .where(notExists('?subject <https://schema.org/manager> ?manager .'))
      .toSPARQL();

    expect(query.query).toContain('EXISTS');
    expect(query.query).toContain('!');
    expect(query.query).toContain('schema:manager');
  });
});
