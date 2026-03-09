import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeQueryMock = vi.fn();

vi.mock('../../../src/core/sparql-executor', () => {
  class MockExecutor {
    constructor() {
      // noop
    }

    executeQuery = executeQueryMock;
    addSource = vi.fn();
    removeSource = vi.fn();
    getSources = vi.fn(() => []);
  }

  return {
    ComunicaSPARQLExecutor: MockExecutor,
    SolidSPARQLExecutor: MockExecutor,
  };
});

import { PodDialect } from '../../../src/core/pod-dialect';

const createSession = () => ({
  info: {
    isLoggedIn: true,
    webId: 'https://example.com/profile/card#me',
  },
  fetch: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
});

describe('PodDialect executeSPARQL', () => {
  beforeEach(() => {
    executeQueryMock.mockReset();
    executeQueryMock.mockResolvedValue([]);
  });

  it('infers SELECT after PREFIX prolog', async () => {
    const dialect = new PodDialect({ session: createSession() as any });
    (dialect as any).runtime.isConnected = () => true;

    await dialect.executeSPARQL(`
      PREFIX schema: <http://schema.org/>
      SELECT ?subject WHERE { ?subject a schema:Person }
    `);

    expect(executeQueryMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'SELECT',
    }));
  });

  it('infers ASK queries', async () => {
    const dialect = new PodDialect({ session: createSession() as any });
    (dialect as any).runtime.isConnected = () => true;

    await dialect.executeSPARQL('ASK { ?subject ?predicate ?object }');

    expect(executeQueryMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ASK',
    }));
  });

  it('rejects obvious raw SQL text', async () => {
    const dialect = new PodDialect({ session: createSession() as any });
    (dialect as any).runtime.isConnected = () => true;

    await expect(
      dialect.executeSPARQL('SELECT * FROM users')
    ).rejects.toThrow('executeSPARQL only accepts SPARQL text; raw SQL is not supported in Solid dialect');
  });

  it('infers SPARQL update queries', async () => {
    const dialect = new PodDialect({ session: createSession() as any });
    (dialect as any).runtime.isConnected = () => true;

    await dialect.executeSPARQL('INSERT DATA { <https://example.com/s> <https://example.com/p> "o" }');

    expect(executeQueryMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'INSERT',
    }));
  });
});
