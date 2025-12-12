import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseActivityStreamsMessage } from '../../../../src/core/notifications/channels/base-channel';
import { SSEChannel } from '../../../../src/core/notifications/channels/sse-channel';
import { WebSocketChannel } from '../../../../src/core/notifications/channels/websocket-channel';
import type { NotificationEvent, ChannelConfig } from '../../../../src/core/notifications/types';

describe('Notifications', () => {
  describe('parseActivityStreamsMessage', () => {
    it('should parse a standard Activity Streams notification', () => {
      const message = JSON.stringify({
        '@context': ['https://www.w3.org/ns/activitystreams'],
        id: 'urn:uuid:123',
        type: 'Update',
        object: 'https://pod.example/resource',
        published: '2024-01-15T10:30:00Z'
      });

      const event = parseActivityStreamsMessage(message);

      expect(event.id).toBe('urn:uuid:123');
      expect(event.type).toBe('Update');
      expect(event.object).toBe('https://pod.example/resource');
      expect(event.published).toBe('2024-01-15T10:30:00Z');
    });

    it('should handle @id instead of id', () => {
      const message = JSON.stringify({
        '@id': 'urn:uuid:456',
        type: 'Create',
        object: 'https://pod.example/new-resource',
        published: '2024-01-15T11:00:00Z'
      });

      const event = parseActivityStreamsMessage(message);
      expect(event.id).toBe('urn:uuid:456');
    });

    it('should handle object as an object with id', () => {
      const message = JSON.stringify({
        id: 'urn:uuid:789',
        type: 'Delete',
        object: {
          id: 'https://pod.example/deleted-resource',
          type: 'Document'
        },
        published: '2024-01-15T12:00:00Z'
      });

      const event = parseActivityStreamsMessage(message);
      expect(event.object).toBe('https://pod.example/deleted-resource');
    });

    it('should include state when present', () => {
      const message = JSON.stringify({
        id: 'urn:uuid:abc',
        type: 'Update',
        object: 'https://pod.example/resource',
        published: '2024-01-15T13:00:00Z',
        state: '<https://pod.example/resource> a <http://schema.org/Person> .'
      });

      const event = parseActivityStreamsMessage(message);
      expect(event.state).toBe('<https://pod.example/resource> a <http://schema.org/Person> .');
    });

    it('should provide default published timestamp if missing', () => {
      const message = JSON.stringify({
        id: 'urn:uuid:def',
        type: 'Add',
        object: 'https://pod.example/new-member'
      });

      const event = parseActivityStreamsMessage(message);
      expect(event.published).toBeDefined();
      // Should be a valid ISO date string
      expect(new Date(event.published).toISOString()).toBe(event.published);
    });

    it('should handle all notification types', () => {
      const types = ['Create', 'Update', 'Delete', 'Add', 'Remove'];
      
      for (const type of types) {
        const message = JSON.stringify({
          id: `urn:uuid:${type.toLowerCase()}`,
          type,
          object: 'https://pod.example/resource',
          published: '2024-01-15T14:00:00Z'
        });

        const event = parseActivityStreamsMessage(message);
        expect(event.type).toBe(type);
      }
    });
  });

  describe('SSEChannel', () => {
    it('should create channel with correct config', () => {
      const onNotification = vi.fn();
      const config: ChannelConfig = {
        receiveFrom: 'https://pod.example/.notifications/stream',
        onNotification,
        fetch: vi.fn()
      };

      const channel = new SSEChannel(config);
      expect(channel.connected).toBe(false);
    });

    it('should disconnect cleanly when not connected', () => {
      const onNotification = vi.fn();
      const config: ChannelConfig = {
        receiveFrom: 'https://pod.example/.notifications/stream',
        onNotification
      };

      const channel = new SSEChannel(config);
      // Should not throw
      channel.disconnect();
      expect(channel.connected).toBe(false);
    });
  });

  describe('WebSocketChannel', () => {
    it('should create channel with correct config', () => {
      const onNotification = vi.fn();
      const config: ChannelConfig = {
        receiveFrom: 'wss://pod.example/.notifications/ws',
        onNotification
      };

      const channel = new WebSocketChannel(config);
      expect(channel.connected).toBe(false);
    });

    it('should disconnect cleanly when not connected', () => {
      const onNotification = vi.fn();
      const config: ChannelConfig = {
        receiveFrom: 'wss://pod.example/.notifications/ws',
        onNotification
      };

      const channel = new WebSocketChannel(config);
      // Should not throw
      channel.disconnect();
      expect(channel.connected).toBe(false);
    });
  });
});

describe('Notification Types', () => {
  it('should have correct type structure for NotificationEvent', () => {
    const event: NotificationEvent = {
      id: 'test-id',
      type: 'Update',
      object: 'https://example.com/resource',
      published: new Date().toISOString()
    };

    expect(event).toHaveProperty('id');
    expect(event).toHaveProperty('type');
    expect(event).toHaveProperty('object');
    expect(event).toHaveProperty('published');
  });

  it('should allow optional state property', () => {
    const event: NotificationEvent = {
      id: 'test-id',
      type: 'Update',
      object: 'https://example.com/resource',
      published: new Date().toISOString(),
      state: '<subject> <predicate> <object> .'
    };

    expect(event.state).toBeDefined();
  });
});
