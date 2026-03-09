import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureSparqlEngine } from '../../../src/core/sparql-engine';
import { ComunicaSPARQLExecutor } from '../../../src/core/sparql-executor';

describe('SPARQL engine configuration', () => {
  afterEach(() => {
    configureSparqlEngine(null);
  });

  it('uses the globally configured query engine factory', async () => {
    const queryBindings = vi.fn().mockResolvedValue({
      toArray: vi.fn().mockResolvedValue([
        new Map([
          ['name', { termType: 'Literal', value: 'Alice' }],
        ])
      ])
    });

    configureSparqlEngine({
      createQueryEngine: async () => ({
        queryBindings,
        queryBoolean: vi.fn(),
      } as any)
    });

    const executor = new ComunicaSPARQLExecutor({
      sources: ['https://pod.example/profile/card']
    });

    const results = await executor.executeQuery({
      type: 'SELECT',
      query: 'SELECT ?name WHERE { ?subject ?predicate ?object }'
    });

    expect(queryBindings).toHaveBeenCalledTimes(1);
    expect(results).toEqual([{ name: 'Alice' }]);
  });

  it('prefers the executor-specific query engine factory', async () => {
    const globalQueryBindings = vi.fn().mockResolvedValue({
      toArray: vi.fn().mockResolvedValue([])
    });
    const localQueryBindings = vi.fn().mockResolvedValue({
      toArray: vi.fn().mockResolvedValue([
        new Map([
          ['subject', { termType: 'NamedNode', value: 'https://pod.example/profile/card#me' }],
        ])
      ])
    });

    configureSparqlEngine({
      createQueryEngine: async () => ({
        queryBindings: globalQueryBindings,
        queryBoolean: vi.fn(),
      } as any)
    });

    const executor = new ComunicaSPARQLExecutor({
      sources: ['https://pod.example/profile/card'],
      createQueryEngine: async () => ({
        queryBindings: localQueryBindings,
        queryBoolean: vi.fn(),
      } as any)
    });

    const results = await executor.executeQuery({
      type: 'SELECT',
      query: 'SELECT ?subject WHERE { ?subject ?predicate ?object }'
    });

    expect(localQueryBindings).toHaveBeenCalledTimes(1);
    expect(globalQueryBindings).not.toHaveBeenCalled();
    expect(results).toEqual([
      { subject: 'https://pod.example/profile/card#me' }
    ]);
  });
});
