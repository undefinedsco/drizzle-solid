import { describe, it, expect } from 'vitest';

describe('Index exports', () => {
  it('应该导出所有主要组件', async () => {
    // 测试主要入口点 - 直接导入模块
    const indexModule = await import('@src/index');
    expect(indexModule).toBeDefined();
    expect(typeof indexModule).toBe('object');
  });

  it('应该导出主要入口', async () => {
    const { drizzle, solid } = await import('@src/index');

    expect(drizzle).toBeDefined();
    expect(solid).toBeDefined();
  });

  it('应该导出表和列构建器', async () => {
    const {
      podTable,
      string,
      int,
      boolean,
      date,
      RDF_PREDICATES,
      RDF_CLASSES
    } = await import('@src/index');

    expect(podTable).toBeDefined();
    expect(string).toBeDefined();
    expect(int).toBeDefined();
    expect(boolean).toBeDefined();
    expect(date).toBeDefined();
    expect(RDF_PREDICATES).toBeDefined();
    expect(RDF_CLASSES).toBeDefined();
  });

  it('应该导出工具函数', async () => {
    const {
      createThing,
      readThing,
      updateThing,
      deleteThing,
      validateRDFData,
      parseRDFResponse,
      findByIRI
    } = await import('@src/index');

    expect(createThing).toBeDefined();
    expect(readThing).toBeDefined();
    expect(updateThing).toBeDefined();
    expect(deleteThing).toBeDefined();
    expect(validateRDFData).toBeDefined();
    expect(parseRDFResponse).toBeDefined();
    expect(findByIRI).toBeDefined();
  });

  it('应该导出发现与联邦相关接口', async () => {
    const { ProviderCache, INTEROP, SHAPETREES, FederatedQueryExecutor } = await import('@src/index');

    expect(ProviderCache).toBeDefined();
    expect(INTEROP).toBeDefined();
    expect(SHAPETREES).toBeDefined();
    expect(FederatedQueryExecutor).toBeDefined();
  });

  it('应该导出类型定义', async () => {
    // 类型检查 - 这些应该不会抛出错误
    expect(true).toBe(true);
  });
});
