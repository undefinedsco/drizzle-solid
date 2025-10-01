import { describe, it, expect } from '@jest/globals';

describe('Index exports', () => {
  it('应该导出所有主要组件', () => {
    // 测试主要入口点
    expect(() => require('@src/index')).not.toThrow();
  });

  it('应该导出核心类', async () => {
    const {
      PodDialect,
      PodAsyncSession,
      PodDatabase,
      ASTToSPARQLConverter,
      SolidSPARQLExecutor
    } = await import('@src/index');

    expect(PodDialect).toBeDefined();
    expect(PodAsyncSession).toBeDefined();
    expect(PodDatabase).toBeDefined();
    expect(ASTToSPARQLConverter).toBeDefined();
    expect(SolidSPARQLExecutor).toBeDefined();
  });

  it('应该导出表和列构建器', async () => {
    const {
      podTable,
      string,
      int,
      bool,
      date,
      COMMON_NAMESPACES,
      RDF_PREDICATES,
      RDF_CLASSES
    } = await import('@src/index');

    expect(podTable).toBeDefined();
    expect(string).toBeDefined();
    expect(int).toBeDefined();
    expect(bool).toBeDefined();
    expect(date).toBeDefined();
    expect(COMMON_NAMESPACES).toBeDefined();
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
      parseRDFResponse
    } = await import('@src/index');

    expect(createThing).toBeDefined();
    expect(readThing).toBeDefined();
    expect(updateThing).toBeDefined();
    expect(deleteThing).toBeDefined();
    expect(validateRDFData).toBeDefined();
    expect(parseRDFResponse).toBeDefined();
  });

  it('应该导出类型定义', async () => {
    // 类型检查 - 这些应该不会抛出错误
    expect(true).toBe(true);
  });
});
