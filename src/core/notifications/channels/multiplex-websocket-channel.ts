import type { NotificationEvent, SubscribeOptions } from '../types';

export const XPOD_NOTIFICATIONS_PROTOCOL = 'xpod.notifications.v1';

export type XpodResyncReason = 'gap' | 'overflow' | 'expired';

export interface XpodNotificationsDescriptor {
  protocol: typeof XPOD_NOTIFICATIONS_PROTOCOL;
  ticketEndpoint: string;
  webSocketEndpoint: string;
}

export type XpodServerFrame =
  | { type: 'ready'; connectionId: string; sequence: number }
  | { type: 'registered' | 'unregistered'; requestId: string; topics: string[] }
  | {
      type: 'event';
      sequence: number;
      eventId: string;
      topic: string;
      object?: string;
      operation: 'create' | 'update' | 'delete' | 'invalidate';
      emittedAt: string;
    }
  | { type: 'resync-required'; topics: string[]; reason: XpodResyncReason }
  | { type: 'error'; requestId?: string; code: string; message: string };

type TopicCallbacks = {
  onNotification: (event: NotificationEvent) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
  onResyncRequired?: (topic: string, reason: XpodResyncReason) => void;
};

type TopicState = {
  callbacks: Set<TopicCallbacks>;
  registered: boolean;
  pendingRegister?: Promise<void>;
};

type PendingRequest = {
  type: 'register' | 'unregister';
  topics: string[];
  resolve: () => void;
  reject: (error: Error) => void;
};

const getWebSocket = (): typeof WebSocket => {
  if (typeof WebSocket !== 'undefined') {
    return WebSocket;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ws = require('ws');
    return ws as typeof WebSocket;
  } catch {
    throw new Error('WebSocket is not available. Install "ws" package for Node.js support.');
  }
};

function toAbsoluteUrl(endpoint: string, origin: string): string {
  return new URL(endpoint, origin).toString();
}

function toWebSocketUrl(endpoint: string, origin: string): string {
  const url = new URL(endpoint, origin);
  if (url.protocol === 'https:') {
    url.protocol = 'wss:';
  } else if (url.protocol === 'http:') {
    url.protocol = 'ws:';
  }
  return url.toString();
}

function operationToType(operation: XpodServerFrame extends infer Frame
  ? Frame extends { operation: infer Operation } ? Operation : never
  : never): NotificationEvent['type'] {
  switch (operation) {
    case 'create':
      return 'Create';
    case 'delete':
      return 'Delete';
    case 'invalidate':
    case 'update':
    default:
      return 'Update';
  }
}

export interface MultiplexWebSocketChannelConfig {
  descriptor: XpodNotificationsDescriptor;
  origin: string;
  deviceSessionId: string;
  fetch: typeof globalThis.fetch;
  reconnectDelayMs?: number;
}

export class MultiplexWebSocketChannel {
  private ws: WebSocket | null = null;
  private topics: Map<string, TopicState> = new Map();
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private ready = false;
  private closed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private requestCounter = 0;
  private lastSequence: number | undefined;
  private connecting: Promise<void> | null = null;

  constructor(private readonly config: MultiplexWebSocketChannelConfig) {}

  get connected(): boolean {
    return Boolean(this.ws) && this.ready && !this.closed;
  }

  async subscribe(topic: string, options: SubscribeOptions): Promise<() => void> {
    this.closed = false;
    let state = this.topics.get(topic);
    if (!state) {
      state = {
        callbacks: new Set(),
        registered: false,
      };
      this.topics.set(topic, state);
    }

    const callbacks: TopicCallbacks = {
      onNotification: options.onNotification,
      onError: options.onError,
      onClose: options.onClose,
      onResyncRequired: options.onResyncRequired,
    };
    state.callbacks.add(callbacks);

    await this.ensureConnected();
    if (!state.registered && !state.pendingRegister) {
      state.pendingRegister = this.sendControl('register', [topic])
        .then(() => {
          state.registered = true;
        })
        .finally(() => {
          if (state) {
            state.pendingRegister = undefined;
          }
        });
    }
    await state.pendingRegister;

    return () => {
      this.unsubscribe(topic, callbacks);
    };
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const request of this.pendingRequests.values()) {
      request.reject(new Error('xpod multiplex channel closed'));
    }
    this.pendingRequests.clear();
    this.topics.clear();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.ready = false;
  }

  private unsubscribe(topic: string, callbacks: TopicCallbacks): void {
    const state = this.topics.get(topic);
    if (!state) {
      return;
    }
    state.callbacks.delete(callbacks);
    if (state.callbacks.size > 0) {
      return;
    }
    this.topics.delete(topic);
    if (state.registered && this.ws && !this.closed) {
      this.sendControl('unregister', [topic]).catch((error) => {
        callbacks.onError?.(error);
      });
    }
    if (this.topics.size === 0) {
      this.close();
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) {
      return;
    }
    if (!this.connecting) {
      this.connecting = this.connect().finally(() => {
        this.connecting = null;
      });
    }
    return this.connecting;
  }

  private async connect(): Promise<void> {
    const ticket = await this.mintTicket();
    const WebSocketImpl = getWebSocket();
    const ws = new WebSocketImpl(
      toWebSocketUrl(this.config.descriptor.webSocketEndpoint, this.config.origin),
      [XPOD_NOTIFICATIONS_PROTOCOL, ticket]
    ) as WebSocket;
    this.ws = ws;
    this.ready = false;

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => {
        this.sendRaw({
          type: 'hello',
          protocol: XPOD_NOTIFICATIONS_PROTOCOL,
          ...(this.lastSequence !== undefined ? { resumeFrom: this.lastSequence } : {}),
        });
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          this.handleFrame(JSON.parse(String(event.data)) as XpodServerFrame);
          if (this.ready) {
            resolve();
          }
        } catch (error) {
          reject(error);
        }
      };

      ws.onerror = () => {
        const error = new Error('xpod multiplex WebSocket error');
        this.notifyError(error);
        if (!this.ready) {
          reject(error);
        }
      };

      ws.onclose = (event: CloseEvent) => {
        const shouldReconnect = !this.closed && this.topics.size > 0 && !event.wasClean;
        this.ready = false;
        this.ws = null;
        if (shouldReconnect) {
          this.scheduleReconnect();
        } else if (!this.closed) {
          this.notifyClose();
        }
      };
    });
  }

  private async mintTicket(): Promise<string> {
    const response = await this.config.fetch(
      toAbsoluteUrl(this.config.descriptor.ticketEndpoint, this.config.origin),
      {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          protocol: XPOD_NOTIFICATIONS_PROTOCOL,
          deviceSessionId: this.config.deviceSessionId,
          origin: this.config.origin,
        }),
      }
    );
    if (!response.ok) {
      throw new Error(`Failed to mint xpod notification ticket: ${response.status} ${response.statusText}`);
    }
    const body = await response.json() as { ticket?: unknown };
    if (typeof body.ticket !== 'string' || !body.ticket) {
      throw new Error('Failed to mint xpod notification ticket: missing ticket');
    }
    return body.ticket;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closed) {
      return;
    }
    this.reconnectAttempts++;
    const baseDelay = this.config.reconnectDelayMs ?? 1000;
    const cap = Math.min(baseDelay * 2 ** (this.reconnectAttempts - 1), 30_000);
    const delay = Math.max(1, Math.floor(Math.random() * cap));
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      for (const state of this.topics.values()) {
        state.registered = false;
        state.pendingRegister = undefined;
      }
      try {
        await this.ensureConnected();
        const topics = Array.from(this.topics.keys());
        if (topics.length > 0) {
          await this.sendControl('register', topics);
          for (const topic of topics) {
            const state = this.topics.get(topic);
            if (state) {
              state.registered = true;
            }
          }
        }
        this.reconnectAttempts = 0;
      } catch (error) {
        this.notifyError(error as Error);
        this.scheduleReconnect();
      }
    }, delay);
  }

  private handleFrame(frame: XpodServerFrame): void {
    switch (frame.type) {
      case 'ready':
        this.ready = true;
        this.lastSequence = frame.sequence;
        return;
      case 'registered':
      case 'unregistered':
        this.completeRequest(frame.requestId);
        return;
      case 'event':
        this.lastSequence = frame.sequence;
        this.dispatchEvent(frame);
        return;
      case 'resync-required':
        for (const topic of frame.topics) {
          const state = this.topics.get(topic);
          if (!state) {
            continue;
          }
          for (const callbacks of state.callbacks) {
            callbacks.onResyncRequired?.(topic, frame.reason);
          }
        }
        return;
      case 'error':
        this.failRequest(frame.requestId, new Error(frame.message));
        return;
    }
  }

  private dispatchEvent(frame: Extract<XpodServerFrame, { type: 'event' }>): void {
    const state = this.topics.get(frame.topic);
    if (!state) {
      return;
    }
    const event: NotificationEvent = {
      id: frame.eventId,
      type: operationToType(frame.operation),
      object: frame.object ?? frame.topic,
      published: frame.emittedAt,
    };
    this.sendRaw({ type: 'ack', sequence: frame.sequence });
    for (const callbacks of state.callbacks) {
      callbacks.onNotification(event);
    }
  }

  private sendControl(type: 'register' | 'unregister', topics: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const requestId = `xpod-${++this.requestCounter}`;
      this.pendingRequests.set(requestId, { type, topics, resolve, reject });
      const send = () => this.sendRaw({ type, requestId, topics });
      if (this.ready) {
        send();
      } else {
        this.ensureConnected().then(send, reject);
      }
    });
  }

  private completeRequest(requestId: string): void {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      return;
    }
    this.pendingRequests.delete(requestId);
    request.resolve();
  }

  private failRequest(requestId: string | undefined, error: Error): void {
    if (!requestId) {
      this.notifyError(error);
      return;
    }
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      this.notifyError(error);
      return;
    }
    this.pendingRequests.delete(requestId);
    request.reject(error);
  }

  private sendRaw(frame: Record<string, unknown>): void {
    this.ws?.send(JSON.stringify(frame));
  }

  private notifyError(error: Error): void {
    for (const state of this.topics.values()) {
      for (const callbacks of state.callbacks) {
        callbacks.onError?.(error);
      }
    }
  }

  private notifyClose(): void {
    for (const state of this.topics.values()) {
      for (const callbacks of state.callbacks) {
        callbacks.onClose?.();
      }
    }
  }
}
