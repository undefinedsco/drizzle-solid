import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PodDatabase } from '@src/core/pod-database';

describe('PodDatabase raw SPARQL execution', () => {
  let db: PodDatabase;
  let executeSPARQL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    executeSPARQL = vi.fn().mockResolvedValue([{ subject: 'https://pod.example/users#1' }]);
    db = new PodDatabase(
      { executeSPARQL } as any,
      {} as any,
      undefined,
    );
  });

  it('execute 应该委托到 dialect.executeSPARQL', async () => {
    const result = await db.execute('SELECT ?subject WHERE { ?subject ?p ?o }');

    expect(executeSPARQL).toHaveBeenCalledWith('SELECT ?subject WHERE { ?subject ?p ?o }');
    expect(result).toEqual([{ subject: 'https://pod.example/users#1' }]);
  });

  it('execute 应该沿用 SPARQL 主线，不承诺 raw SQL', async () => {
    executeSPARQL.mockRejectedValueOnce(
      new Error('executeSPARQL only accepts SPARQL text; raw SQL is not supported in Solid dialect')
    );

    await expect(db.execute('SELECT * FROM users')).rejects.toThrow(
      'executeSPARQL only accepts SPARQL text; raw SQL is not supported in Solid dialect',
    );
  });

  it('executeSPARQL 应该拒绝空查询', async () => {
    await expect(db.executeSPARQL('   ')).rejects.toThrow(
      'executeSPARQL requires a non-empty SPARQL query string',
    );
  });
});
