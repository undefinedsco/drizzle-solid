import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  createThing,
  readThing,
  updateThing,
  deleteThing,
  ThingData
} from '@src/utils/thing-operations';

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('Thing Operations', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  describe('createThing', () => {
    it('应该成功创建 Thing', async () => {
      const containerUrl = 'https://example.com/container/';
      const thingUrl = 'https://example.com/container/thing1';
      const data: ThingData = {
        name: 'John Doe',
        email: 'john@example.com'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        statusText: 'Created'
      });

      const result = await createThing(containerUrl, thingUrl, data, mockFetch);

      expect(result).toBe(thingUrl);
      expect(mockFetch).toHaveBeenCalledWith(containerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/turtle',
          'Link': '<http://www.w3.org/ns/ldp#Resource>; rel="type"'
        },
        body: expect.stringContaining('John Doe')
      });
    });

    it('应该处理创建失败的情况', async () => {
      const containerUrl = 'https://example.com/container/';
      const thingUrl = 'https://example.com/container/thing1';
      const data: ThingData = {
        name: 'John Doe'
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: 'Conflict'
      });

      await expect(createThing(containerUrl, thingUrl, data, mockFetch))
        .rejects.toThrow('Failed to create Thing: Conflict');
    });

    it('应该处理网络错误', async () => {
      const containerUrl = 'https://example.com/container/';
      const thingUrl = 'https://example.com/container/thing1';
      const data: ThingData = {
        name: 'John Doe'
      };

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(createThing(containerUrl, thingUrl, data, mockFetch))
        .rejects.toThrow('Network error');
    });
  });

  describe('readThing', () => {
    it('应该成功读取 Thing', async () => {
      const resourceUrl = 'https://example.com/container/';
      const thingUrl = 'https://example.com/container/thing1';
      const turtleData = `
        @prefix ex: <http://example.com/> .
        
        <https://example.com/container/thing1> ex:name "John Doe" .
        <https://example.com/container/thing1> ex:email "john@example.com" .
      `;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(turtleData)
      });

      const result = await readThing(resourceUrl, thingUrl, mockFetch);

      expect(result).toBeDefined();
      expect(mockFetch).toHaveBeenCalledWith(resourceUrl, {
        headers: {
          'Accept': 'text/turtle, application/ld+json'
        }
      });
    });

    it('应该处理 Thing 不存在的情况', async () => {
      const resourceUrl = 'https://example.com/container/';
      const thingUrl = 'https://example.com/container/thing1';

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404
      });

      const result = await readThing(resourceUrl, thingUrl, mockFetch);

      expect(result).toBeNull();
    });

    it('应该处理网络错误', async () => {
      const resourceUrl = 'https://example.com/container/';
      const thingUrl = 'https://example.com/container/thing1';

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await readThing(resourceUrl, thingUrl, mockFetch);

      expect(result).toBeNull();
    });
  });

  describe('updateThing', () => {
    it('应该成功更新 Thing', async () => {
      const resourceUrl = 'https://example.com/container/';
      const thingUrl = 'https://example.com/container/thing1';
      const data: ThingData = {
        name: 'Jane Doe',
        email: 'jane@example.com'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK'
      });

      const result = await updateThing(resourceUrl, thingUrl, data, mockFetch);

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(resourceUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/turtle'
        },
        body: expect.stringContaining('Jane Doe')
      });
    });

    it('应该处理更新失败的情况', async () => {
      const resourceUrl = 'https://example.com/container/';
      const thingUrl = 'https://example.com/container/thing1';
      const data: ThingData = {
        name: 'Jane Doe'
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });

      const result = await updateThing(resourceUrl, thingUrl, data, mockFetch);

      expect(result).toBe(false);
    });
  });

  describe('deleteThing', () => {
    it('应该成功删除 Thing', async () => {
      const resourceUrl = 'https://example.com/container/';
      const thingUrl = 'https://example.com/container/thing1';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        statusText: 'No Content'
      });

      const result = await deleteThing(resourceUrl, thingUrl, mockFetch);

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(resourceUrl, {
        method: 'DELETE'
      });
    });

    it('应该处理删除失败的情况', async () => {
      const resourceUrl = 'https://example.com/container/';
      const thingUrl = 'https://example.com/container/thing1';

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });

      const result = await deleteThing(resourceUrl, thingUrl, mockFetch);

      expect(result).toBe(false);
    });
  });

  describe('数据转换测试', () => {
    it('应该正确处理基本数据类型', async () => {
      const containerUrl = 'https://example.com/container/';
      const thingUrl = 'https://example.com/container/thing1';
      const data: ThingData = {
        name: 'John Doe',
        age: 30,
        isActive: true
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201
      });

      await createThing(containerUrl, thingUrl, data, mockFetch);

      const callArgs = mockFetch.mock.calls[0];
      const turtleBody = callArgs[1].body;

      expect(turtleBody).toContain('John Doe');
      expect(turtleBody).toContain('30');
    });
  });
});
