import { vi } from 'vitest';
import { PodTable, PodStringColumn } from '../../../src/core/schema';
import { PodDialect } from '../../../src/core/pod-dialect';

const queryContainerMock = vi.fn().mockResolvedValue([]);

vi.mock('../../../src/core/typeindex-manager', () => {
  class MockTypeIndexManager {
    getConfig = vi.fn(() => ({}));
    updateConfig = vi.fn();

    constructor() {
      // no-op
    }
  }

  return { TypeIndexManager: MockTypeIndexManager };
});

vi.mock('../../../src/core/sparql-executor', () => {
  class MockExecutor {
    sources: string[];

    constructor(config: { sources?: string[] } = {}) {
      this.sources = [...(config.sources || [])];
    }

    queryContainer(resourceUrl: string, sparqlQuery: any) {
      return queryContainerMock(resourceUrl, sparqlQuery);
    }

    addSource = vi.fn((source: string) => {
      if (!this.sources.includes(source)) {
        this.sources.push(source);
      }
    });

    removeSource = vi.fn((source: string) => {
      this.sources = this.sources.filter((item) => item !== source);
    });

    executeQuery = vi.fn();

    getSources = vi.fn(() => [...this.sources]);
  }

  return {
    ComunicaSPARQLExecutor: MockExecutor,
    SolidSPARQLExecutor: MockExecutor
  };
});

const createDialect = (fetchImpl: typeof fetch) => {
  return new PodDialect({
    session: {
      info: {
        isLoggedIn: true,
        webId: 'https://pod.example/ganbb/profile/card#me'
      },
      fetch: fetchImpl,
      login: vi.fn(),
      logout: vi.fn()
    } as any
  });
};

describe('PodDialect resource URL normalization', () => {
  const fetchMock = vi.fn() as vi.MockedFunction<typeof fetch>;
const table = new PodTable('profile', {
  id: new PodStringColumn('id', { primaryKey: true, predicate: '@id' })
}, {
  containerPath: '/profile/',
  base: 'idp:///profile/card',
  type: 'http://xmlns.com/foaf/0.1/Person'
  });

  beforeEach(() => {
    fetchMock.mockReset();
    queryContainerMock.mockClear();
  });

  it('strips trailing slashes before calling fetch in ensureResourceExists', async () => {
    const dialect = createDialect(fetchMock);

    // HEAD request succeeds -> no creation
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });

    await (dialect as any).ensureResourceExists('https://pod.example/ganbb/profile/card/', {
      createIfMissing: false
    });

    expect(fetchMock).toHaveBeenCalledWith('https://pod.example/ganbb/profile/card', {
      method: 'HEAD'
    });
  });

  it('passes normalized resource URLs into the SPARQL executor', async () => {
    const dialect = createDialect(fetchMock);

    await (dialect as any).executeOnResource(
      'https://pod.example/ganbb/profile/card/',
      { type: 'SELECT', query: 'SELECT * WHERE {}' }
    );

    expect(queryContainerMock).toHaveBeenCalledWith(
      'https://pod.example/ganbb/profile/card',
      expect.objectContaining({ type: 'SELECT' })
    );
  });

  it('uses OPTIONS when probing a conventional SPARQL sidecar endpoint', async () => {
    const dialect = createDialect(fetchMock);
    const discoverTable = new PodTable('items', {
      id: new PodStringColumn('id', { primaryKey: true, predicate: '@id' })
    }, {
      containerPath: '/items/',
      base: '/items/',
      type: 'http://schema.org/Thing'
    });

    fetchMock.mockResolvedValueOnce({ ok: true, status: 204 } as Response);

    await (dialect as any).tryDiscoverSparqlEndpoint(discoverTable, 'https://pod.example/ganbb/items/');

    expect(fetchMock).toHaveBeenCalledWith('https://pod.example/ganbb/items/-/sparql', {
      method: 'OPTIONS'
    });
    expect(discoverTable.getSparqlEndpoint()).toBe('https://pod.example/ganbb/items/-/sparql');
  });
});
