import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { PodAsyncSession } from '@src/core/pod-session';
import { PodTable } from '@src/core/pod-table';
import { PodStringColumn, PodIntegerColumn } from '@src/core/pod-table';
// import { SQL } from 'drizzle-orm'; // Not used in tests

// Mock PodDialect
const mockDialect = {
  query: jest.fn(),
  executeSql: jest.fn(),
  connect: jest.fn(),
  disconnect: jest.fn(),
  isConnected: jest.fn().mockReturnValue(false)
} as any; // Mock object for testing, intentionally using any for simplicity

// Mock PodTable
const mockTable = new PodTable('users', {
  id: new PodIntegerColumn('id', { primaryKey: true }),
  name: new PodStringColumn('name', { required: true })
}, {
  containerPath: '/users/',
  rdfClass: 'https://schema.org/Person'
});

describe('PodAsyncSession', () => {
  let session: PodAsyncSession;

  beforeEach(() => {
    jest.clearAllMocks();
    session = new PodAsyncSession(mockDialect);
  });

  describe('构造函数', () => {
    it('应该正确初始化会话', () => {
      expect(session).toBeDefined();
    });

    it('应该接受可选的选项参数', () => {
      const sessionWithOptions = new PodAsyncSession(mockDialect, undefined, { logger: true });
      expect(sessionWithOptions).toBeDefined();
    });
  });

  describe('execute', () => {
    it('应该执行操作', async () => {
      const mockResult = [{ id: 1, name: 'John' }];
      mockDialect.query.mockResolvedValue(mockResult);

      const operation = {
        type: 'select' as const,
        table: mockTable,
        where: { name: 'John' }
      };

      const result = await session.execute(operation);

      expect(mockDialect.query).toHaveBeenCalledWith(operation);
      expect(result).toEqual(mockResult);
    });

    it('应该在启用日志时记录操作', async () => {
      const sessionWithLogger = new PodAsyncSession(mockDialect, undefined, { logger: true });
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const operation = {
        type: 'select' as const,
        table: mockTable,
        where: { name: 'John' }
      };

      mockDialect.query.mockResolvedValue([]);
      await sessionWithLogger.execute(operation);

      expect(consoleSpy).toHaveBeenCalledWith('Executing operation:', operation);
      consoleSpy.mockRestore();
    });
  });

  describe('executeSql', () => {
    it('应该执行 SQL', async () => {
      const mockResult = [{ id: 1, name: 'John' }];
      mockDialect.executeSql.mockResolvedValue(mockResult);

      const sql = { queryChunks: ['SELECT * FROM users'] } as any;
      const result = await session.executeSql(sql, mockTable);

      expect(mockDialect.executeSql).toHaveBeenCalledWith(sql, mockTable);
      expect(result).toEqual(mockResult);
    });

    it('应该在启用日志时记录 SQL', async () => {
      const sessionWithLogger = new PodAsyncSession(mockDialect, undefined, { logger: true });
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const sql = { queryChunks: ['SELECT * FROM users'] } as any;
      mockDialect.executeSql.mockResolvedValue([]);
      await sessionWithLogger.executeSql(sql, mockTable);

      expect(consoleSpy).toHaveBeenCalledWith('Executing SQL AST:', sql);
      consoleSpy.mockRestore();
    });
  });

  describe('select', () => {
    it('应该返回 SelectQueryBuilder', () => {
      const builder = session.select();
      expect(builder).toBeDefined();
      expect(builder.constructor.name).toBe('SelectQueryBuilder');
    });
  });

  describe('insert', () => {
    it('应该返回 InsertQueryBuilder', () => {
      const builder = session.insert(mockTable);
      expect(builder).toBeDefined();
      expect(builder.constructor.name).toBe('InsertQueryBuilder');
    });
  });

  describe('update', () => {
    it('应该返回 UpdateQueryBuilder', () => {
      const builder = session.update(mockTable);
      expect(builder).toBeDefined();
      expect(builder.constructor.name).toBe('UpdateQueryBuilder');
    });
  });

  describe('delete', () => {
    it('应该返回 DeleteQueryBuilder', () => {
      const builder = session.delete(mockTable);
      expect(builder).toBeDefined();
      expect(builder.constructor.name).toBe('DeleteQueryBuilder');
    });
  });

  describe('transaction', () => {
    it('应该执行事务', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      
      const transactionFn = jest.fn() as any; // Test mock, using any for simplicity
      transactionFn.mockResolvedValue('success');
      const result = await session.transaction(transactionFn);

      expect(transactionFn).toHaveBeenCalledWith(session);
      expect(result).toBe('success');
      expect(consoleSpy).toHaveBeenCalledWith('Starting transaction');
      expect(consoleSpy).toHaveBeenCalledWith('Transaction completed successfully');
      
      consoleSpy.mockRestore();
    });

    it('应该处理事务失败', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      const error = new Error('Transaction failed');
      const transactionFn = jest.fn() as any; // Test mock, using any for simplicity
      transactionFn.mockRejectedValue(error);

      await expect(session.transaction(transactionFn)).rejects.toThrow('Transaction failed');
      
      expect(consoleSpy).toHaveBeenCalledWith('Starting transaction');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Transaction failed:', error);
      
      consoleSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });
  });
});

describe('SelectQueryBuilder', () => {
  let session: PodAsyncSession;
  let builder: any; // Test builder, using any for simplicity

  beforeEach(() => {
    session = new PodAsyncSession(mockDialect);
    builder = session.select();
  });

  it('应该支持 from 方法', () => {
    const result = builder.from(mockTable);
    expect(result).toBe(builder); // 应该返回自身以支持链式调用
  });

  it('应该支持 where 方法', () => {
    const result = builder.where({ name: 'John' });
    expect(result).toBe(builder);
  });

  it('应该支持 limit 方法', () => {
    const result = builder.limit(10);
    expect(result).toBe(builder);
  });

  it('limit 应该拒绝负数', () => {
    expect(() => builder.limit(-1)).toThrow('LIMIT must be a non-negative integer');
  });

  it('offset 应该拒绝负数', () => {
    expect(() => builder.offset(-1)).toThrow('OFFSET must be a non-negative integer');
  });

  it('应该支持 offset 方法', () => {
    const result = builder.offset(5);
    expect(result).toBe(builder);
  });

  it('应该支持 orderBy 方法', () => {
    const result = builder.orderBy('name');
    expect(result).toBe(builder);
  });

  it('应该支持 distinct 方法', () => {
    const result = builder.distinct();
    expect(result).toBe(builder);
  });
});

describe('InsertQueryBuilder', () => {
  let session: PodAsyncSession;
  let builder: any; // Test builder, using any for simplicity

  beforeEach(() => {
    session = new PodAsyncSession(mockDialect);
    builder = session.insert(mockTable);
  });

  it('应该支持 values 方法', () => {
    const result = builder.values({ name: 'John' });
    expect(result).toBe(builder);
  });
});

describe('UpdateQueryBuilder', () => {
  let session: PodAsyncSession;
  let builder: any; // Test builder, using any for simplicity

  beforeEach(() => {
    session = new PodAsyncSession(mockDialect);
    builder = session.update(mockTable);
  });

  it('应该支持 set 方法', () => {
    const result = builder.set({ name: 'Jane' });
    expect(result).toBe(builder);
  });

  it('应该支持 where 方法', () => {
    const result = builder.where({ id: 1 });
    expect(result).toBe(builder);
  });
});

describe('DeleteQueryBuilder', () => {
  let session: PodAsyncSession;
  let builder: any; // Test builder, using any for simplicity

  beforeEach(() => {
    session = new PodAsyncSession(mockDialect);
    builder = session.delete(mockTable);
  });

  it('应该支持 where 方法', () => {
    const result = builder.where({ id: 1 });
    expect(result).toBe(builder);
  });
});

describe('PodAsyncSession 增强测试', () => {
  let session: PodAsyncSession;

  beforeEach(() => {
    jest.clearAllMocks();
    session = new PodAsyncSession(mockDialect);
  });

  describe('错误处理增强', () => {
    it('应该处理无效的操作类型', async () => {
      const invalidOperation = {
        type: 'invalid' as any, // Test mock, using any for simplicity
        table: mockTable
      };

      await expect(session.execute(invalidOperation)).rejects.toThrow();
    });

    it('应该处理空表定义', async () => {
      const operation = {
        type: 'select' as const,
        table: null as any, // Test mock, using any for simplicity
        columns: ['id', 'name']
      };

      await expect(session.execute(operation)).rejects.toThrow();
    });
  });

  describe('查询构建器增强测试', () => {
    it('应该支持复杂的 WHERE 条件', async () => {
      const mockResult = [{ id: 1, name: 'John' }];
      mockDialect.query.mockResolvedValue(mockResult);

      const operation = {
        type: 'select' as const,
        table: mockTable,
        columns: ['id', 'name'],
        where: {
          id: { gt: 0 },
          name: { like: 'John%' }
        }
      };

      const result = await session.execute(operation);
      expect(result).toEqual(mockResult);
    });

    it('应该支持 ORDER BY 子句', async () => {
      const mockResult = [{ id: 1, name: 'John' }, { id: 2, name: 'Jane' }];
      mockDialect.query.mockResolvedValue(mockResult);

      const operation = {
        type: 'select' as const,
        table: mockTable,
        columns: ['id', 'name'],
        orderBy: [{ column: 'name', direction: 'asc' as const }]
      };

      const result = await session.execute(operation);
      expect(result).toEqual(mockResult);
    });

    it('应该支持 LIMIT 和 OFFSET', async () => {
      const mockResult = [{ id: 1, name: 'John' }];
      mockDialect.query.mockResolvedValue(mockResult);

      const operation = {
        type: 'select' as const,
        table: mockTable,
        columns: ['id', 'name'],
        limit: 10,
        offset: 5
      };

      const result = await session.execute(operation);
      expect(result).toEqual(mockResult);
    });

    it('应该支持 DISTINCT', async () => {
      const mockResult = [{ id: 1, name: 'John' }];
      mockDialect.query.mockResolvedValue(mockResult);

      const builder = session.select().from(mockTable).distinct();
      const result = await builder.execute();

      expect(result).toEqual(mockResult);
      expect(mockDialect.query).toHaveBeenCalledWith(expect.objectContaining({ distinct: true }));
    });
  });

  describe('事务处理增强测试', () => {
    it('应该支持嵌套事务', async () => {
      const mockResult = [{ id: 1, name: 'John' }];
      mockDialect.query.mockResolvedValue(mockResult);

      const operation = {
        type: 'select' as const,
        table: mockTable,
        columns: ['id', 'name']
      };

      // 模拟嵌套事务
      const nestedTransaction = await session.transaction(async (tx) => {
        const result1 = await tx.execute(operation);
        const result2 = await tx.execute(operation);
        return { result1, result2 };
      });

      expect(nestedTransaction.result1).toEqual(mockResult);
      expect(nestedTransaction.result2).toEqual(mockResult);
    });

    it('应该处理事务回滚', async () => {
      // 不设置 mockDialect.query 的 reject，让事务正常执行但内部抛出错误
      mockDialect.query.mockResolvedValue([]);

      const operation = {
        type: 'insert' as const,
        table: mockTable,
        values: { name: 'John' }
      };

      await expect(session.transaction(async (tx) => {
        await tx.execute(operation);
        throw new Error('Rollback');
      })).rejects.toThrow('Rollback');
    });
  });

  describe('性能测试', () => {
    it('应该能够快速执行多个查询', async () => {
      const mockResult = [{ id: 1, name: 'John' }];
      mockDialect.query.mockResolvedValue(mockResult);

      const operation = {
        type: 'select' as const,
        table: mockTable,
        columns: ['id', 'name']
      };

      const start = Date.now();
      
      for (let i = 0; i < 100; i++) {
        await session.execute(operation);
      }
      
      const end = Date.now();
      const duration = end - start;
      
      // 应该在合理时间内完成
      expect(duration).toBeLessThan(1000);
    });

    it('应该能够处理大量数据', async () => {
      const largeResult = Array.from({ length: 1000 }, (_, i) => ({ id: i, name: `User${i}` }));
      mockDialect.query.mockResolvedValue(largeResult);

      const operation = {
        type: 'select' as const,
        table: mockTable,
        columns: ['id', 'name']
      };

      const result = await session.execute(operation);
      expect(result).toHaveLength(1000);
    });
  });

  describe('连接管理', () => {
    it('应该能够检查连接状态', () => {
      expect(session.isConnected()).toBe(false);
    });

    it('应该能够获取方言实例', () => {
      const dialect = session.getDialect();
      expect(dialect).toBe(mockDialect);
    });

    it('应该能够获取会话选项', () => {
      const options = session.getOptions();
      expect(options).toBeDefined();
    });
  });
});
