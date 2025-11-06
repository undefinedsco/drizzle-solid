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
});
