import type { SubscribeOptions, Subscription } from './types';
import {
  MultiplexWebSocketChannel,
  XPOD_NOTIFICATIONS_PROTOCOL,
  type XpodNotificationsDescriptor,
} from './channels/multiplex-websocket-channel';

export interface MultiplexNotificationsClientConfig {
  sessionId?: string;
  webId?: string;
  reconnectDelayMs?: number;
}

export type XpodDiscovery = {
  descriptor: XpodNotificationsDescriptor;
  origin: string;
};

class MultiplexSubscription implements Subscription {
  private _active = true;

  constructor(
    readonly topic: string,
    private readonly release: () => void
  ) {}

  get active(): boolean {
    return this._active;
  }

  get channel(): 'websocket' {
    return 'websocket';
  }

  unsubscribe(): void {
    if (!this._active) {
      return;
    }
    this._active = false;
    this.release();
  }
}

export class MultiplexNotificationsClient {
  private readonly channels = new Map<string, MultiplexWebSocketChannel>();
  private readonly deviceSessionId: string;

  constructor(
    private readonly authenticatedFetch: typeof globalThis.fetch,
    private readonly config: MultiplexNotificationsClientConfig = {}
  ) {
    this.deviceSessionId = config.sessionId ?? createDeviceSessionId();
  }

  async subscribe(topic: string, discovery: XpodDiscovery, options: SubscribeOptions): Promise<Subscription> {
    const key = this.getChannelKey(discovery);
    let channel = this.channels.get(key);
    if (!channel) {
      channel = new MultiplexWebSocketChannel({
        descriptor: discovery.descriptor,
        origin: discovery.origin,
        deviceSessionId: this.deviceSessionId,
        fetch: this.authenticatedFetch,
        reconnectDelayMs: options.reconnectDelayMs ?? this.config.reconnectDelayMs,
      });
      this.channels.set(key, channel);
    }

    const release = await channel.subscribe(topic, options);
    return new MultiplexSubscription(topic, () => {
      release();
      if (!channel?.connected) {
        this.channels.delete(key);
      }
    });
  }

  close(): void {
    for (const channel of this.channels.values()) {
      channel.close();
    }
    this.channels.clear();
  }

  private getChannelKey(discovery: XpodDiscovery): string {
    return [
      this.config.webId ?? 'anonymous',
      this.config.sessionId ?? 'session',
      discovery.origin,
      discovery.descriptor.webSocketEndpoint,
    ].join('|');
  }
}

function createDeviceSessionId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function parseXpodDescriptor(value: string | null, origin: string): XpodDiscovery | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as Partial<XpodNotificationsDescriptor>;
    if (
      parsed.protocol !== XPOD_NOTIFICATIONS_PROTOCOL ||
      typeof parsed.ticketEndpoint !== 'string' ||
      typeof parsed.webSocketEndpoint !== 'string'
    ) {
      return null;
    }
    return {
      origin,
      descriptor: {
        protocol: XPOD_NOTIFICATIONS_PROTOCOL,
        ticketEndpoint: parsed.ticketEndpoint,
        webSocketEndpoint: parsed.webSocketEndpoint,
      },
    };
  } catch {
    return null;
  }
}

export function parseXpodDescriptorLink(linkHeader: string | null, origin: string): XpodDiscovery | null {
  if (!linkHeader) {
    return null;
  }
  const descriptorMatch = linkHeader.match(/<([^>]+)>;\s*rel="?urn:xpod:notifications:v1"?/);
  if (!descriptorMatch) {
    return null;
  }
  return {
    origin,
    descriptor: {
      protocol: XPOD_NOTIFICATIONS_PROTOCOL,
      ticketEndpoint: '/v1/notifications/tickets',
      webSocketEndpoint: descriptorMatch[1],
    },
  };
}
