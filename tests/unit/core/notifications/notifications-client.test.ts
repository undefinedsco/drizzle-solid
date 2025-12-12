import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationsClient } from '../../../../src/core/notifications/notifications-client';

describe('NotificationsClient', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  describe('constructor', () => {
    it('should create a client with authenticated fetch', () => {
      const client = new NotificationsClient(mockFetch as any);
      expect(client).toBeInstanceOf(NotificationsClient);
    });
  });

  describe('unsubscribeAll', () => {
    it('should not throw when no subscriptions exist', () => {
      const client = new NotificationsClient(mockFetch as any);
      expect(() => client.unsubscribeAll()).not.toThrow();
    });
  });

  describe('discovery', () => {
    it('should discover storage root from resource URL', async () => {
      // Mock HEAD request for finding storage root
      mockFetch.mockResolvedValueOnce({
        headers: {
          get: () => null
        },
        ok: true
      });

      // Mock storage description fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: {
          get: () => 'text/turtle'
        },
        text: async () => `
          <http://pod.example/user/> <http://www.w3.org/ns/solid/notifications#subscription> 
            <http://pod.example/.notifications/WebSocketChannel2023/> .
          <http://pod.example/.notifications/WebSocketChannel2023/> 
            <http://www.w3.org/ns/solid/notifications#channelType> 
            <http://www.w3.org/ns/solid/notifications#WebSocketChannel2023> .
        `
      });

      // Mock subscription creation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          '@context': ['https://www.w3.org/ns/solid/notification/v1'],
          id: 'urn:uuid:subscription-1',
          type: 'http://www.w3.org/ns/solid/notifications#WebSocketChannel2023',
          topic: 'https://pod.example/user/resource',
          receiveFrom: 'wss://pod.example/.notifications/ws/123'
        })
      });

      const client = new NotificationsClient(mockFetch as any);
      
      try {
        await client.subscribe('https://pod.example/user/resource', {
          channel: 'websocket',
          onNotification: vi.fn()
        });
      } catch (e) {
        // Expected - WebSocket connection will fail in unit test
      }

      // Verify HEAD request was made for storage root discovery
      expect(mockFetch).toHaveBeenCalledWith('https://pod.example/user/resource', {
        method: 'HEAD'
      });
    });

    it('should fallback when storage description fails', async () => {
      // Mock HEAD request
      mockFetch.mockResolvedValueOnce({
        headers: { get: () => null },
        ok: true
      });

      // Mock well-known fetch failure
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404
      });

      // Mock subscription creation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          '@context': ['https://www.w3.org/ns/solid/notification/v1'],
          id: 'urn:uuid:subscription-2',
          type: 'http://www.w3.org/ns/solid/notifications#WebSocketChannel2023',
          topic: 'https://pod.example/resource',
          receiveFrom: 'wss://pod.example/.notifications/ws/456'
        })
      });

      const client = new NotificationsClient(mockFetch as any);
      
      try {
        await client.subscribe('https://pod.example/resource', {
          channel: 'websocket',
          onNotification: vi.fn()
        });
      } catch (e) {
        // Expected
      }

      // Should use fallback endpoint
      const subscriptionCall = mockFetch.mock.calls.find(
        call => call[1]?.method === 'POST'
      );
      expect(subscriptionCall).toBeDefined();
    });
  });

  describe('subscription creation', () => {
    it('should create WebSocket subscription when requested', async () => {
      // Mock HEAD request
      mockFetch.mockResolvedValueOnce({
        headers: { get: () => null },
        ok: true
      });

      // Mock well-known (fail to trigger fallback)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404
      });

      // Mock subscription creation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          '@context': ['https://www.w3.org/ns/solid/notification/v1'],
          id: 'urn:uuid:ws-sub',
          type: 'http://www.w3.org/ns/solid/notifications#WebSocketChannel2023',
          topic: 'https://pod.example/resource',
          receiveFrom: 'wss://pod.example/.notifications/ws/789'
        })
      });

      const client = new NotificationsClient(mockFetch as any);
      
      try {
        await client.subscribe('https://pod.example/resource', {
          channel: 'websocket',
          onNotification: vi.fn()
        });
      } catch (e) {
        // Expected - WebSocket connection will fail
      }

      // Find the subscription POST call
      const subscriptionCall = mockFetch.mock.calls.find(
        call => call[1]?.method === 'POST'
      );

      expect(subscriptionCall).toBeDefined();
      const body = JSON.parse(subscriptionCall![1].body);
      expect(body.type).toBe('http://www.w3.org/ns/solid/notifications#WebSocketChannel2023');
    });

    it('should include features when provided', async () => {
      // Mock HEAD request
      mockFetch.mockResolvedValueOnce({
        headers: { get: () => null },
        ok: true
      });

      // Mock well-known (fail to trigger fallback)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404
      });

      // Mock subscription creation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          '@context': ['https://www.w3.org/ns/solid/notification/v1'],
          id: 'urn:uuid:feature-sub',
          type: 'http://www.w3.org/ns/solid/notifications#WebSocketChannel2023',
          topic: 'https://pod.example/resource',
          receiveFrom: 'wss://pod.example/.notifications/ws/abc',
          features: ['state']
        })
      });

      const client = new NotificationsClient(mockFetch as any);
      
      try {
        await client.subscribe('https://pod.example/resource', {
          channel: 'websocket',
          features: ['state'],
          onNotification: vi.fn()
        });
      } catch (e) {
        // Expected
      }

      const subscriptionCall = mockFetch.mock.calls.find(
        call => call[1]?.method === 'POST'
      );

      expect(subscriptionCall).toBeDefined();
      const body = JSON.parse(subscriptionCall![1].body);
      expect(body.features).toEqual(['state']);
    });

    it('should throw on subscription creation failure', async () => {
      // Mock HEAD request
      mockFetch.mockResolvedValueOnce({
        headers: { get: () => null },
        ok: true
      });

      // Mock well-known (fail)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404
      });

      // Mock subscription creation failure
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => 'Access denied'
      });

      const client = new NotificationsClient(mockFetch as any);
      
      await expect(
        client.subscribe('https://pod.example/resource', {
          channel: 'websocket',
          onNotification: vi.fn()
        })
      ).rejects.toThrow('Failed to create subscription: 403 Forbidden');
    });
  });
});
