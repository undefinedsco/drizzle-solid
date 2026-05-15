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

    invalidateHttpCache = vi.fn();

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

  it('exposes resource preparation mode from dialect config', () => {
    const dialect = new PodDialect({
      session: {
        info: {
          isLoggedIn: true,
          webId: 'https://pod.example/ganbb/profile/card#me'
        },
        fetch: fetchMock,
      } as any,
      resourcePreparation: 'off',
    });

    expect(dialect.getResourcePreparationMode()).toBe('off');
    expect(dialect.shouldSkipResourcePreparation()).toBe(true);
  });

  it('treats the Pod storage root as the container preparation boundary', async () => {
    const dialect = new PodDialect({
      session: {
        info: {
          isLoggedIn: true,
          webId: 'https://id.example/ganbb/profile/card#me',
          podUrl: 'https://id.example/ganbb/',
        },
        fetch: fetchMock,
      } as any,
      podUrl: 'https://id.example/ganbb/',
    });

    await (dialect as any).ensureContainerExists('https://id.example/ganbb/');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not print container preparation failures unless debug logging is enabled', async () => {
    const previousDebug = process.env.LINX_DEBUG;
    delete process.env.LINX_DEBUG;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const dialect = new PodDialect({
        session: {
          info: {
            isLoggedIn: true,
            webId: 'https://pod.example/ganbb/profile/card#me',
            podUrl: 'https://pod.example/ganbb/',
          },
          fetch: fetchMock,
        } as any,
        podUrl: 'https://pod.example/ganbb/',
        resourcePreparation: 'best-effort',
      });
      (dialect as any).sleep = vi.fn().mockResolvedValue(undefined);

      const responseBody = '{"errorCode":"H500","message":"container create failed"}';
      fetchMock
        .mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' } as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: vi.fn().mockResolvedValue(responseBody),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: vi.fn().mockResolvedValue(responseBody),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: vi.fn().mockResolvedValue(responseBody),
        } as unknown as Response);

      await expect((dialect as any).ensureContainerExists('https://pod.example/ganbb/items/'))
        .rejects
        .toThrow(
          `Failed to create container: 500 Internal Server Error (https://pod.example/ganbb/items/) - ${responseBody}`,
        );

      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
      if (previousDebug === undefined) {
        delete process.env.LINX_DEBUG;
      } else {
        process.env.LINX_DEBUG = previousDebug;
      }
    }
  });

  it('retries transient container creation failures before succeeding', async () => {
    const previousDebug = process.env.LINX_DEBUG;
    delete process.env.LINX_DEBUG;
    const dialect = new PodDialect({
      session: {
        info: {
          isLoggedIn: true,
          webId: 'https://pod.example/ganbb/profile/card#me',
          podUrl: 'https://pod.example/ganbb/',
        },
        fetch: fetchMock,
      } as any,
      podUrl: 'https://pod.example/ganbb/',
      resourcePreparation: 'strict',
    });
    (dialect as any).sleep = vi.fn().mockResolvedValue(undefined);

    try {
      fetchMock
        .mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' } as Response)
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' } as Response)
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' } as Response)
        .mockResolvedValueOnce({ ok: true, status: 201, statusText: 'Created' } as Response);

      await expect((dialect as any).ensureContainerExists('https://pod.example/ganbb/items/'))
        .resolves
        .toBeUndefined();

      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://pod.example/ganbb/items/', {
        method: 'HEAD',
      });
      expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://pod.example/ganbb/items/', {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/turtle',
          'Link': '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
        },
      });
      expect(fetchMock).toHaveBeenNthCalledWith(3, 'https://pod.example/ganbb/items/', {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/turtle',
          'Link': '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
        },
      });
      expect(fetchMock).toHaveBeenNthCalledWith(4, 'https://pod.example/ganbb/items/', {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/turtle',
          'Link': '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
        },
      });
    } finally {
      if (previousDebug === undefined) {
        delete process.env.LINX_DEBUG;
      } else {
        process.env.LINX_DEBUG = previousDebug;
      }
    }
  });

  it('prints container preparation failures when LINX_DEBUG=1', async () => {
    const previousDebug = process.env.LINX_DEBUG;
    process.env.LINX_DEBUG = '1';
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const dialect = new PodDialect({
        session: {
          info: {
            isLoggedIn: true,
            webId: 'https://pod.example/ganbb/profile/card#me',
            podUrl: 'https://pod.example/ganbb/',
          },
          fetch: fetchMock,
        } as any,
        podUrl: 'https://pod.example/ganbb/',
        resourcePreparation: 'best-effort',
      });
      (dialect as any).sleep = vi.fn().mockResolvedValue(undefined);

      fetchMock
        .mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' } as Response)
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' } as Response)
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' } as Response)
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' } as Response);

      await expect((dialect as any).ensureContainerExists('https://pod.example/ganbb/items/'))
        .rejects
        .toThrow('Failed to create container: 500 Internal Server Error');

      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('[Container] 确保容器存在时出错:'),
        expect.any(Error),
      );
    } finally {
      consoleError.mockRestore();
      consoleLog.mockRestore();
      if (previousDebug === undefined) {
        delete process.env.LINX_DEBUG;
      } else {
        process.env.LINX_DEBUG = previousDebug;
      }
    }
  });

  it('keeps registerTable resource-preparation failures quiet in best-effort mode', async () => {
    const previousDebug = process.env.LINX_DEBUG;
    delete process.env.LINX_DEBUG;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const dialect = new PodDialect({
      session: {
        info: {
          isLoggedIn: true,
          webId: 'https://pod.example/ganbb/profile/card#me',
          podUrl: 'https://pod.example/ganbb/',
        },
        fetch: fetchMock,
      } as any,
      podUrl: 'https://pod.example/ganbb/',
      resourcePreparation: 'best-effort',
    });
    (dialect as any).sleep = vi.fn().mockResolvedValue(undefined);
    const noisyTable = new PodTable('quiet_items', {
      id: new PodStringColumn('id', { primaryKey: true, predicate: '@id' }),
    }, {
      base: '/items/messages.ttl',
      type: 'http://schema.org/Thing',
    });

    try {
      fetchMock
        .mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' } as Response)
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' } as Response)
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' } as Response)
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' } as Response);

      await expect(dialect.registerTable(noisyTable)).resolves.toBeUndefined();

      expect(consoleError).not.toHaveBeenCalled();
      expect(consoleWarn).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
      consoleWarn.mockRestore();
      if (previousDebug === undefined) {
        delete process.env.LINX_DEBUG;
      } else {
        process.env.LINX_DEBUG = previousDebug;
      }
    }
  });
});
