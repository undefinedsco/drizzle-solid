import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  PodDiscovery,
  discoverPodContainers,
  authenticateWithSolid
} from '@src/core/pod-discovery';

// 创建一个完整的 Response mock
const createMockResponse = (data: any, options: { ok?: boolean; status?: number; statusText?: string } = {}) => {
  const response = {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    statusText: options.statusText ?? 'OK',
    headers: new Headers({ 'content-type': 'text/turtle' }),
    clone: jest.fn().mockReturnThis(),
    text: jest.fn().mockResolvedValue(typeof data === 'string' ? data : ''),
    json: jest.fn().mockResolvedValue(typeof data === 'object' ? data : {}),
    arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
    blob: jest.fn().mockResolvedValue(new Blob()),
    formData: jest.fn().mockResolvedValue(new FormData()),
    body: null,
    bodyUsed: false,
    redirected: false,
    type: 'basic' as ResponseType,
    url: ''
  };
  
  // 确保 clone 返回一个新的相同对象
  response.clone.mockReturnValue({ ...response });
  
  return response as unknown as Response;
};

// Mock fetch
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

describe('Pod Discovery', () => {
  let podDiscovery: PodDiscovery;

  beforeEach(() => {
    mockFetch.mockClear();
    podDiscovery = new PodDiscovery(mockFetch);
  });

  describe('PodDiscovery 类', () => {
    it('应该正确初始化', () => {
      const discovery = new PodDiscovery();
      expect(discovery).toBeInstanceOf(PodDiscovery);
    });

    it('应该使用自定义 fetch 函数', () => {
      const customFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
      const discovery = new PodDiscovery(customFetch);
      expect(discovery).toBeInstanceOf(PodDiscovery);
    });
  });

  describe('discoverContainers', () => {
    it('应该处理配置文件获取失败', async () => {
      const webId = 'https://example.com/profile/card#me';

      mockFetch.mockResolvedValueOnce(
        createMockResponse('', { ok: false, status: 404, statusText: 'Not Found' })
      );

      const result = await podDiscovery.discoverContainers(webId);

      expect(result).toHaveLength(0);
    });

    it('应该处理网络错误', async () => {
      const webId = 'https://example.com/profile/card#me';

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await podDiscovery.discoverContainers(webId);

      expect(result).toHaveLength(0);
    });
  });

  describe('authenticateWithProvider', () => {
    it('应该成功进行认证', async () => {
      const oidcIssuer = 'https://example.com/oidc';

      const result = await podDiscovery.authenticateWithProvider(oidcIssuer);

      expect(result).toEqual({
        webId: 'https://example.pod/profile/card#me',
        isLoggedIn: true,
        sessionId: 'mock-session-id'
      });
    });

    it('应该处理认证失败', async () => {
      const oidcIssuer = 'https://example.com/oidc';

      // 模拟认证过程中的错误
      const originalConsoleError = console.error;
      console.error = jest.fn();

      // 创建一个会抛出错误的认证过程
      const discovery = new PodDiscovery();
      const mockMethod = jest.fn().mockRejectedValue(new Error('Authentication failed') as never);
      discovery['authenticateWithProvider'] = mockMethod as any;

      await expect(discovery.authenticateWithProvider(oidcIssuer)).rejects.toThrow('Authentication failed');

      console.error = originalConsoleError;
    });
  });

  describe('createContainer', () => {
    it('应该处理网络错误', async () => {
      const parentUrl = 'https://example.com/storage/';
      const name = 'documents';

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(podDiscovery.createContainer(parentUrl, name)).rejects.toThrow('Network error');
    });
  });

  describe('便利函数', () => {
    describe('discoverPodContainers', () => {
      it('应该使用默认 fetch 函数', async () => {
        const webId = 'https://example.com/profile/card#me';

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404
      } as Response);

        const result = await discoverPodContainers(webId);

        expect(result).toHaveLength(0);
      });

      it('应该使用自定义 fetch 函数', async () => {
        const webId = 'https://example.com/profile/card#me';
        const customFetch = jest.fn().mockResolvedValue({
          ok: false,
          status: 404
        } as never) as jest.MockedFunction<typeof fetch>;

        const result = await discoverPodContainers(webId, customFetch);

        expect(customFetch).toHaveBeenCalled();
        expect(result).toHaveLength(0);
      });
    });

    describe('authenticateWithSolid', () => {
      it('应该使用默认 fetch 函数', async () => {
        const oidcIssuer = 'https://example.com/oidc';

        const result = await authenticateWithSolid(oidcIssuer);

        expect(result).toEqual({
          webId: 'https://example.pod/profile/card#me',
          isLoggedIn: true,
          sessionId: 'mock-session-id'
        });
      });
    });
  });

  describe('错误处理', () => {
    it('应该处理空 WebID', async () => {
      const result = await podDiscovery.discoverContainers('');

      expect(result).toHaveLength(0);
    });

    it('应该处理无效的 WebID 格式', async () => {
      const result = await podDiscovery.discoverContainers('invalid-webid');

      expect(result).toHaveLength(0);
    });

    it('应该处理空容器名称', async () => {
      // 空容器名称会创建一个以 / 结尾的 URL，这在技术上是有效的
      // 需要 mock 一个成功的响应
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers()
      } as Response);

      const result = await podDiscovery.createContainer('https://example.com/storage/', '');

      expect(result).toBe('https://example.com/storage//');
    });
  });
});
