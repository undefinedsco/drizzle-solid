import { describe, it, expect, vi } from 'vitest';
import { PodDialect } from '@src/core/pod-dialect';
import { podTable, string } from '@src/index';
import type { SelectQueryPlan } from '@src/core/select-plan';

const createSession = () => ({
  info: {
    isLoggedIn: true,
    webId: 'https://example.com/profile/card#me'
  },
  fetch: vi.fn(),
  login: vi.fn(),
  logout: vi.fn()
});

describe('PodDialect resolveTableUrls source selection', () => {
  it('uses direct resource URL when containerPath points to absolute file', () => {
    const dialect = new PodDialect({ session: createSession() });

    const usersTable = podTable('users', {
      id: string('id').primaryKey().predicate('https://schema.org/identifier')
    }, {
      base: 'https://pod.example.com/data/users.ttl',
      rdfClass: 'https://schema.org/Person',
      namespace: { prefix: 'schema', uri: 'https://schema.org/' }
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
      id: string('id').primaryKey().predicate('https://schema.org/identifier')
    }, {
      base: 'shared/posts.ttl',
      rdfClass: 'https://schema.org/CreativeWork',
      namespace: { prefix: 'schema', uri: 'https://schema.org/' }
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

  it('derives resource path from container-style base values', () => {
    const dialect = new PodDialect({ session: createSession() });

    const logTable = podTable('logs', {
      id: string('id').primaryKey().predicate('https://schema.org/identifier')
    }, {
      base: 'logs/',
      rdfClass: 'https://schema.org/Message',
      namespace: { prefix: 'schema', uri: 'https://schema.org/' }
    });

    const resource = (dialect as any).resolveTableResource(logTable);
    expect(resource).toEqual({
      mode: 'ldp',
      containerUrl: 'https://example.com/profile/logs/',
      resourceUrl: 'https://example.com/profile/logs/logs.ttl'
    });

    const plan = {
      baseTable: logTable,
      baseAlias: 'logs',
      aliasToTable: new Map([[ 'logs', logTable ]]),
      tableToAlias: new Map([[ logTable, 'logs' ]])
    } as unknown as SelectQueryPlan;

    const sources = (dialect as any).collectSelectSources(plan);
    expect(sources).toEqual(['https://example.com/profile/logs/logs.ttl']);
  });
});
