import { describe, it, expect, jest } from '@jest/globals';
import { PodDialect } from '@src/core/pod-dialect';
import { podTable, string } from '@src/index';
import type { SelectQueryPlan } from '@src/core/select-plan';

const createSession = () => ({
  info: {
    isLoggedIn: true,
    webId: 'https://example.com/profile/card#me'
  },
  fetch: jest.fn(),
  login: jest.fn(),
  logout: jest.fn()
});

describe('PodDialect resolveTableUrls source selection', () => {
  it('uses direct resource URL when containerPath points to absolute file', () => {
    const dialect = new PodDialect({ session: createSession() });

    const usersTable = podTable('users', {
      id: string('id').primaryKey()
    }, {
      containerPath: 'https://pod.example.com/data/users.ttl',
      rdfClass: 'https://schema.org/Person',
      autoRegister: false
    });

    const resource = (dialect as any).resolveTableResource(usersTable);
    expect(resource).toEqual({
      mode: 'ldp',
      containerUrl: 'https://pod.example.com/data/',
      resourceUrl: 'https://pod.example.com/data/users.ttl'
    });

    const plan = {
      baseTable: usersTable,
      baseAlias: 'users',
      aliasToTable: new Map([[ 'users', usersTable ]]),
      tableToAlias: new Map([[ usersTable, 'users' ]])
    } as unknown as SelectQueryPlan;

    const sources = (dialect as any).collectSelectSources(plan);
    expect(sources).toEqual(['https://pod.example.com/data/users.ttl']);
  });

  it('resolves relative resource paths against pod base', () => {
    const dialect = new PodDialect({ session: createSession() });

    const postsTable = podTable('posts', {
      id: string('id').primaryKey()
    }, {
      containerPath: 'shared/posts.ttl',
      rdfClass: 'https://schema.org/CreativeWork',
      autoRegister: false
    });

    const resource = (dialect as any).resolveTableResource(postsTable);
    expect(resource).toEqual({
      mode: 'ldp',
      containerUrl: 'https://example.com/profile/shared/',
      resourceUrl: 'https://example.com/profile/shared/posts.ttl'
    });

    const plan = {
      baseTable: postsTable,
      baseAlias: 'posts',
      aliasToTable: new Map([[ 'posts', postsTable ]]),
      tableToAlias: new Map([[ postsTable, 'posts' ]])
    } as unknown as SelectQueryPlan;

    const sources = (dialect as any).collectSelectSources(plan);
    expect(sources).toEqual(['https://example.com/profile/shared/posts.ttl']);
  });

  it('returns SPARQL source objects for endpoint-backed tables', () => {
    const dialect = new PodDialect({ session: createSession() });

    const logTable = podTable('logs', {
      id: string('id').primaryKey()
    }, {
      containerPath: 'https://pod.example.com/sparql',
      rdfClass: 'https://schema.org/Message',
      autoRegister: false,
      resourceMode: 'sparql'
    });

    const resource = (dialect as any).resolveTableResource(logTable);
    expect(resource).toEqual({
      mode: 'sparql',
      endpoint: 'https://pod.example.com/sparql'
    });

    const plan = {
      baseTable: logTable,
      baseAlias: 'logs',
      aliasToTable: new Map([[ 'logs', logTable ]]),
      tableToAlias: new Map([[ logTable, 'logs' ]])
    } as unknown as SelectQueryPlan;

    const sources = (dialect as any).collectSelectSources(plan);
    expect(sources).toEqual([{ type: 'sparql', value: 'https://pod.example.com/sparql' }]);
  });
});
