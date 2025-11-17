import { vi } from 'vitest';
import { PodTable } from '../../../src/core/pod-table';
import { PodDialect } from '../../../src/core/pod-dialect';

const queryContainerMock = vi.fn().mockResolvedValue([]);

vi.mock('../../../src/core/typeindex-manager', () => ({
  TypeIndexManager: vi.fn().mockImplementation(() => ({
    getConfig: vi.fn(() => ({})),
    updateConfig: vi.fn()
  }))
}));

vi.mock('../../../src/core/sparql-executor', () => {
  const executorFactory = vi.fn().mockImplementation(() => ({
    queryContainer: queryContainerMock,
    addSource: vi.fn(),
    removeSource: vi.fn()
  }));

  return {
    ComunicaSPARQLExecutor: executorFactory,
    SolidSPARQLExecutor: executorFactory
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
const table = new PodTable('profile', {}, {
  containerPath: '/profile/',
  base: 'idp:///profile/card',
  rdfClass: 'http://xmlns.com/foaf/0.1/Person'
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
});
