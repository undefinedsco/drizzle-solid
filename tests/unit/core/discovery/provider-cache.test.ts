/**
 * ProviderCache Unit Tests
 */

import { ProviderCache } from '../../../../src/core/discovery/provider-cache';

describe('ProviderCache', () => {
  const mockTurtleResponse = `
    @prefix solid: <http://www.w3.org/ns/solid/terms#> .
    @prefix interop: <http://www.w3.org/ns/solid/interop#> .
    
    <https://bob.solidcommunity.net/>
      solid:publicTypeIndex </settings/publicTypeIndex.ttl> ;
      solid:privateTypeIndex </settings/privateTypeIndex.ttl> ;
      interop:hasRegistrySet </registries/> ;
      solid:oidcIssuer <https://solidcommunity.net/> .
  `;

  describe('extractProvider', () => {
    it('should extract provider from pod URL', async () => {
      const cache = new ProviderCache({
        fetch: async () => new Response(mockTurtleResponse, {
          headers: { 'content-type': 'text/turtle' },
        }),
      });

      // 访问两个同供应商的 Pod
      const bob = await cache.getWellKnown('https://bob.solidcommunity.net/');
      const alice = await cache.getWellKnown('https://alice.solidcommunity.net/');

      // 应该都有值（alice 使用缓存）
      expect(bob.typeIndex).toBe('https://bob.solidcommunity.net/settings/publicTypeIndex.ttl');
      expect(alice.typeIndex).toBe('https://alice.solidcommunity.net/settings/publicTypeIndex.ttl');
    });
  });

  describe('getWellKnown', () => {
    it('should parse Turtle response correctly', async () => {
      const cache = new ProviderCache({
        fetch: async () => new Response(mockTurtleResponse, {
          headers: { 'content-type': 'text/turtle' },
        }),
      });

      const result = await cache.getWellKnown('https://bob.solidcommunity.net/');

      expect(result.typeIndex).toBe('https://bob.solidcommunity.net/settings/publicTypeIndex.ttl');
      expect(result.privateTypeIndex).toBe('https://bob.solidcommunity.net/settings/privateTypeIndex.ttl');
      expect(result.registrySet).toBe('https://bob.solidcommunity.net/registries/');
      expect(result.oidcIssuer).toBe('https://solidcommunity.net/');
    });

    it('should cache by provider and apply to different pods', async () => {
      let fetchCount = 0;
      const cache = new ProviderCache({
        fetch: async () => {
          fetchCount++;
          return new Response(mockTurtleResponse, {
            headers: { 'content-type': 'text/turtle' },
          });
        },
      });

      // 第一次请求
      await cache.getWellKnown('https://bob.solidcommunity.net/');
      expect(fetchCount).toBe(1);

      // 同供应商第二次请求，应该使用缓存
      const alice = await cache.getWellKnown('https://alice.solidcommunity.net/');
      expect(fetchCount).toBe(1); // 没有额外请求

      // 结果应该应用到 alice 的 pod
      expect(alice.typeIndex).toBe('https://alice.solidcommunity.net/settings/publicTypeIndex.ttl');
    });

    it('should fetch again for different provider', async () => {
      let fetchCount = 0;
      const cache = new ProviderCache({
        fetch: async () => {
          fetchCount++;
          return new Response(mockTurtleResponse, {
            headers: { 'content-type': 'text/turtle' },
          });
        },
      });

      await cache.getWellKnown('https://bob.solidcommunity.net/');
      expect(fetchCount).toBe(1);

      // 不同供应商，应该重新请求
      await cache.getWellKnown('https://dave.inrupt.net/');
      expect(fetchCount).toBe(2);
    });

    it('should handle missing .well-known gracefully', async () => {
      const cache = new ProviderCache({
        fetch: async () => new Response('Not Found', { status: 404 }),
      });

      const result = await cache.getWellKnown('https://bob.example.net/');

      expect(result.typeIndex).toBeUndefined();
      expect(result.registrySet).toBeUndefined();
    });

    it('should handle network errors gracefully', async () => {
      const cache = new ProviderCache({
        fetch: async () => { throw new Error('Network error'); },
      });

      const result = await cache.getWellKnown('https://bob.example.net/');

      expect(result.typeIndex).toBeUndefined();
      expect(result.registrySet).toBeUndefined();
    });
  });

  describe('cache expiration', () => {
    it('should refetch after TTL expires', async () => {
      let fetchCount = 0;
      const cache = new ProviderCache({
        ttl: 100, // 100ms TTL
        fetch: async () => {
          fetchCount++;
          return new Response(mockTurtleResponse, {
            headers: { 'content-type': 'text/turtle' },
          });
        },
      });

      await cache.getWellKnown('https://bob.solidcommunity.net/');
      expect(fetchCount).toBe(1);

      // 等待过期
      await new Promise(resolve => setTimeout(resolve, 150));

      await cache.getWellKnown('https://alice.solidcommunity.net/');
      expect(fetchCount).toBe(2); // 过期后重新请求
    });
  });

  describe('discover', () => {
    it('should try SAI first, then TypeIndex', async () => {
      const cache = new ProviderCache({
        fetch: async () => new Response(mockTurtleResponse, {
          headers: { 'content-type': 'text/turtle' },
        }),
      });

      const calls: string[] = [];
      
      const mockDiscoverSAI = async (registrySet: string, type: string) => {
        calls.push(`sai:${registrySet}`);
        return null; // SAI 没找到
      };

      const mockDiscoverTypeIndex = async (typeIndex: string, type: string) => {
        calls.push(`typeindex:${typeIndex}`);
        return 'https://bob.solidcommunity.net/data/posts/';
      };

      const result = await cache.discover(
        'https://bob.solidcommunity.net/',
        'https://schema.org/BlogPosting',
        mockDiscoverSAI,
        mockDiscoverTypeIndex
      );

      expect(calls).toHaveLength(2);
      expect(calls[0]).toContain('sai:');
      expect(calls[1]).toContain('typeindex:');
      expect(result).toBe('https://bob.solidcommunity.net/data/posts/');
    });

    it('should return SAI result if found', async () => {
      const cache = new ProviderCache({
        fetch: async () => new Response(mockTurtleResponse, {
          headers: { 'content-type': 'text/turtle' },
        }),
      });

      const calls: string[] = [];
      
      const mockDiscoverSAI = async () => {
        calls.push('sai');
        return 'https://bob.solidcommunity.net/data/posts-sai/';
      };

      const mockDiscoverTypeIndex = async () => {
        calls.push('typeindex');
        return 'https://bob.solidcommunity.net/data/posts-typeindex/';
      };

      const result = await cache.discover(
        'https://bob.solidcommunity.net/',
        'https://schema.org/BlogPosting',
        mockDiscoverSAI,
        mockDiscoverTypeIndex
      );

      // 只调用了 SAI
      expect(calls).toEqual(['sai']);
      expect(result).toBe('https://bob.solidcommunity.net/data/posts-sai/');
    });
  });

  describe('clear', () => {
    it('should clear all cache', async () => {
      let fetchCount = 0;
      const cache = new ProviderCache({
        fetch: async () => {
          fetchCount++;
          return new Response(mockTurtleResponse, {
            headers: { 'content-type': 'text/turtle' },
          });
        },
      });

      await cache.getWellKnown('https://bob.solidcommunity.net/');
      expect(fetchCount).toBe(1);

      cache.clear();

      await cache.getWellKnown('https://alice.solidcommunity.net/');
      expect(fetchCount).toBe(2); // 清除后重新请求
    });

    it('should clear specific provider', async () => {
      let fetchCount = 0;
      const cache = new ProviderCache({
        fetch: async () => {
          fetchCount++;
          return new Response(mockTurtleResponse, {
            headers: { 'content-type': 'text/turtle' },
          });
        },
      });

      await cache.getWellKnown('https://bob.solidcommunity.net/');
      await cache.getWellKnown('https://dave.inrupt.net/');
      expect(fetchCount).toBe(2);

      cache.clearProvider('solidcommunity.net');

      await cache.getWellKnown('https://alice.solidcommunity.net/');
      expect(fetchCount).toBe(3); // solidcommunity 重新请求

      await cache.getWellKnown('https://eve.inrupt.net/');
      expect(fetchCount).toBe(3); // inrupt 还在缓存
    });
  });

  describe('JSON-LD parsing', () => {
    it('should parse JSON-LD response', async () => {
      const jsonLdResponse = JSON.stringify({
        '@context': {
          'solid': 'http://www.w3.org/ns/solid/terms#',
          'interop': 'http://www.w3.org/ns/solid/interop#',
        },
        '@id': 'https://bob.solidcommunity.net/',
        'http://www.w3.org/ns/solid/terms#publicTypeIndex': {
          '@id': 'https://bob.solidcommunity.net/settings/publicTypeIndex.ttl',
        },
        'http://www.w3.org/ns/solid/interop#hasRegistrySet': {
          '@id': 'https://bob.solidcommunity.net/registries/',
        },
      });

      const cache = new ProviderCache({
        fetch: async () => new Response(jsonLdResponse, {
          headers: { 'content-type': 'application/ld+json' },
        }),
      });

      const result = await cache.getWellKnown('https://bob.solidcommunity.net/');

      expect(result.typeIndex).toBe('https://bob.solidcommunity.net/settings/publicTypeIndex.ttl');
      expect(result.registrySet).toBe('https://bob.solidcommunity.net/registries/');
    });
  });
});
