import { vi } from 'vitest';
import { ComunicaSPARQLExecutor } from '../../../src/core/sparql-executor';

type MockBinding = {
  entries?: () => Iterable<[unknown, unknown]>;
  forEach?: (callback: (value: unknown, key: unknown) => void) => void;
  keys?: () => Iterable<unknown>;
  get?: (key: unknown) => unknown;
  [key: string]: unknown;
};

const createExecutor = (binding: MockBinding) => {
  const executor: any = new ComunicaSPARQLExecutor({
    sources: ['https://pod.example/profile/card']
  });

  const bindingsStream = {
    toArray: vi.fn().mockResolvedValue([binding])
  };

  const engine = {
    queryBindings: vi.fn().mockResolvedValue(bindingsStream)
  };

  executor.initEngine = vi.fn().mockResolvedValue(engine);

  return executor as ComunicaSPARQLExecutor;
};

describe('ComunicaSPARQLExecutor binding normalization', () => {
  it('converts entries-based bindings into string-keyed objects', async () => {
    const variableSubject = { termType: 'Variable', value: 'subject' };
    const variableName = { termType: 'Variable', value: 'name' };

    const binding: MockBinding = {
      entries: () => {
        const pairs: Array<[unknown, unknown]> = [
          [
            variableSubject,
            { termType: 'NamedNode', value: 'https://pod.example/profile/card#me' }
          ],
          [variableName, { termType: 'Literal', value: 'Alice' }]
        ];

        return pairs[Symbol.iterator]();
      }
    };

    const executor = createExecutor(binding);
    const results = await executor.executeQueryWithSource(
      { type: 'SELECT', query: 'SELECT ?subject ?name WHERE { ?subject ?p ?o }' },
      'https://pod.example/profile/card'
    );

    expect(results).toEqual([
      {
        subject: 'https://pod.example/profile/card#me',
        name: 'Alice'
      }
    ]);
  });

  it('converts keys/get bindings into string-keyed objects', async () => {
    const variableSubject = { termType: 'Variable', value: 'subject' };

    const binding: MockBinding = {
      keys: function* () {
        yield variableSubject;
      },
      get: (key: unknown) => {
        if (key === variableSubject) {
          return { termType: 'NamedNode', value: 'https://pod.example/profile/card#me' };
        }
        return undefined;
      }
    };

    const executor = createExecutor(binding);
    const results = await executor.executeQueryWithSource(
      { type: 'SELECT', query: 'SELECT ?subject WHERE { ?subject ?predicate ?object }' },
      'https://pod.example/profile/card'
    );

    expect(results).toEqual([
      {
        subject: 'https://pod.example/profile/card#me'
      }
    ]);
  });

  it('executes SELECT directly against explicit SPARQL endpoints', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      head: { vars: ['subject', 'name'] },
      results: {
        bindings: [{
          subject: { type: 'uri', value: 'https://pod.example/profile/card#me' },
          name: {
            type: 'literal',
            value: 'Alice',
            datatype: 'http://www.w3.org/2001/XMLSchema#string',
          },
        }],
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/sparql-results+json' },
    }));
    const createQueryEngine = vi.fn();
    const executor = new ComunicaSPARQLExecutor({
      sources: ['https://pod.example/profile/card'],
      fetch: fetchMock,
      createQueryEngine,
    });

    const results = await executor.executeQueryWithSource(
      { type: 'SELECT', query: 'SELECT * WHERE { ?s ?p ?o }' },
      'https://pod.example/-/sparql',
      'sparql'
    );

    expect(createQueryEngine).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [requestUrl, requestInit] = fetchMock.mock.calls[0];
    expect(new URL(String(requestUrl)).searchParams.get('query')).toBe('SELECT * WHERE { ?s ?p ?o }');
    expect(requestInit).toEqual({
      headers: { Accept: 'application/sparql-results+json' },
    });
    expect(results).toEqual([{
      subject: 'https://pod.example/profile/card#me',
      name: 'Alice',
    }]);
  });

  it('executes ASK directly against explicit SPARQL endpoints', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      head: {},
      boolean: true,
    }), {
      status: 200,
      headers: { 'content-type': 'application/sparql-results+json' },
    }));
    const createQueryEngine = vi.fn();
    const executor = new ComunicaSPARQLExecutor({
      sources: ['https://pod.example/profile/card'],
      fetch: fetchMock,
      createQueryEngine,
    });

    const results = await executor.executeQueryWithSource(
      { type: 'ASK', query: 'ASK { ?s ?p ?o }' },
      'https://pod.example/-/sparql',
      'sparql'
    );

    expect(createQueryEngine).not.toHaveBeenCalled();
    expect(results).toEqual([{ result: true }]);
  });

  it('includes endpoint response details in direct SPARQL errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('Invalid cursor filter', {
      status: 400,
    }));
    const executor = new ComunicaSPARQLExecutor({
      sources: ['https://pod.example/profile/card'],
      fetch: fetchMock,
      createQueryEngine: vi.fn(),
    });

    await expect(executor.executeQueryWithSource(
      { type: 'SELECT', query: 'SELECT * WHERE { ?s ?p ?o }' },
      'https://pod.example/-/sparql',
      'sparql'
    )).rejects.toThrow('SPARQL endpoint returned HTTP 400: Invalid cursor filter');
  });

  it('keeps update queries on the Comunica execution path', async () => {
    const engine = { invalidateHttpCache: vi.fn().mockResolvedValue(undefined) };
    const createQueryEngine = vi.fn().mockResolvedValue(engine);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { etag: '"v1"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const executor = new ComunicaSPARQLExecutor({
      sources: ['https://pod.example/profile/card'],
      fetch: fetchMock,
      createQueryEngine,
    });

    await executor.executeQueryWithSource(
      { type: 'UPDATE', query: 'INSERT DATA { <urn:s> <urn:p> <urn:o> }' },
      'https://pod.example/-/sparql',
      'sparql'
    );

    expect(createQueryEngine).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({
      method: 'PATCH',
      body: 'INSERT DATA { <urn:s> <urn:p> <urn:o> }',
    }));
  });
});
