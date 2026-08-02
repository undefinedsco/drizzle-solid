import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsClient } from '../../../../src/core/notifications/notifications-client';

type SentFrame = Record<string, unknown>;

class FakeHeaders {
  constructor(private readonly values: Record<string, string | null> = {}) {}

  get(name: string): string | null {
    const key = Object.keys(this.values).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    return key ? this.values[key] ?? null : null;
  }
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { wasClean: boolean }) => void) | null = null;
  sent: string[] = [];
  closed = false;

  constructor(
    public readonly url: string,
    public readonly protocols?: string | string[]
  ) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.onclose?.({ wasClean: true });
  }

  open(): void {
    this.onopen?.();
  }

  receive(frame: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  drop(): void {
    this.onclose?.({ wasClean: false });
  }
}

function frames(socket: FakeWebSocket): SentFrame[] {
  return socket.sent.map((frame) => JSON.parse(frame) as SentFrame);
}

async function waitForSocket(index = 0): Promise<FakeWebSocket> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const socket = FakeWebSocket.instances[index];
    if (socket) {
      return socket;
    }
    await Promise.resolve();
  }
  throw new Error(`FakeWebSocket ${index} was not created`);
}

async function waitForFrame(
  socket: FakeWebSocket,
  predicate: (frame: SentFrame) => boolean
): Promise<SentFrame> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const frame = frames(socket).find(predicate);
    if (frame) {
      return frame;
    }
    await Promise.resolve();
  }
  throw new Error(`Expected frame was not sent. Sent: ${socket.sent.join('\n')}`);
}

function createXpodFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'HEAD') {
      return {
        ok: true,
        headers: new FakeHeaders({
          'X-Xpod-Notifications': JSON.stringify({
            protocol: 'xpod.notifications.v1',
            ticketEndpoint: '/v1/notifications/tickets',
            webSocketEndpoint: '/v1/notifications/ws',
          }),
        }),
      } as Response;
    }
    if (url === 'https://pod.example/v1/notifications/tickets' && init?.method === 'POST') {
      return {
        ok: true,
        json: async () => ({ ticket: `ticket-${Date.now()}` }),
      } as Response;
    }
    throw new Error(`Unexpected fetch ${init?.method ?? 'GET'} ${url}`);
  });
}

async function subscribeXpod(
  client: NotificationsClient,
  topic: string,
  onNotification = vi.fn(),
  onResyncRequired = vi.fn()
) {
  const socketIndex = FakeWebSocket.instances.length;
  const promise = client.subscribe(topic, { onNotification, onResyncRequired });
  const socket = await waitForSocket(socketIndex);
  socket.open();
  socket.receive({ type: 'ready', connectionId: 'conn-1', sequence: 7 });
  const { requestId } = await waitForFrame(socket, (frame) => frame.type === 'register');
  socket.receive({ type: 'registered', requestId, topics: [topic] });
  return {
    subscription: await promise,
    socket,
    onNotification,
    onResyncRequired,
  };
}

describe('NotificationsClient xpod multiplex transport', () => {
  let originalWebSocket: unknown;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    (globalThis as unknown as { WebSocket: typeof FakeWebSocket }).WebSocket = FakeWebSocket;
    FakeWebSocket.instances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = originalWebSocket;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('uses one xpod WebSocket for 36 discovered topics', async () => {
    const fetch = createXpodFetch();
    const client = new NotificationsClient(fetch as typeof globalThis.fetch, {
      sessionId: 'session-a',
      webId: 'https://pod.example/profile/card#me',
    });

    const subscriptions = [];
    for (let index = 0; index < 36; index++) {
      const promise = client.subscribe(`https://pod.example/data/topic-${index}.ttl`, {
        onNotification: vi.fn(),
      });
      const socket = await waitForSocket(0);
      if (index === 0) {
        socket.open();
        socket.receive({ type: 'ready', connectionId: 'conn-1', sequence: 0 });
      }
      const register = await waitForFrame(
        socket,
        (frame) => frame.type === 'register' && (frame.topics as string[])[0]?.endsWith(`topic-${index}.ttl`)
      );
      socket.receive({ type: 'registered', requestId: register.requestId, topics: register.topics });
      subscriptions.push(await promise);
    }

    expect(FakeWebSocket.instances).toHaveLength(1);
    const ticketRequest = fetch.mock.calls.find(([input, init]) =>
      String(input).endsWith('/v1/notifications/tickets') && init?.method === 'POST');
    expect(JSON.parse(String(ticketRequest?.[1]?.body))).toEqual({
      protocol: 'xpod.notifications.v1',
      deviceSessionId: 'session-a',
      origin: 'https://pod.example',
    });
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'HEAD')).toHaveLength(1);
    expect(frames(FakeWebSocket.instances[0]).filter((frame) => frame.type === 'hello')).toHaveLength(1);
    expect(frames(FakeWebSocket.instances[0]).filter((frame) => frame.type === 'register')).toHaveLength(36);

    subscriptions.forEach((subscription) => subscription.unsubscribe());
  });

  it('shares same-topic consumers and unregisters on last release', async () => {
    const fetch = createXpodFetch();
    const client = new NotificationsClient(fetch as typeof globalThis.fetch);
    const topic = 'https://pod.example/data/shared.ttl';

    const first = await subscribeXpod(client, topic);
    const secondPromise = client.subscribe(topic, { onNotification: vi.fn() });
    const second = await secondPromise;

    expect(frames(first.socket).filter((frame) => frame.type === 'register')).toHaveLength(1);

    first.subscription.unsubscribe();
    expect(frames(first.socket).filter((frame) => frame.type === 'unregister')).toHaveLength(0);

    second.unsubscribe();
    const unregister = frames(first.socket).find((frame) => frame.type === 'unregister');
    expect(unregister?.topics).toEqual([topic]);
  });

  it('reconnects with resume and current memberships', async () => {
    const fetch = createXpodFetch();
    const client = new NotificationsClient(fetch as typeof globalThis.fetch, {
      reconnectDelayMs: 10,
    });
    const topic = 'https://pod.example/data/reconnect.ttl';
    const { socket } = await subscribeXpod(client, topic);

    socket.receive({
      type: 'event',
      sequence: 12,
      eventId: 'event-12',
      topic,
      object: topic,
      operation: 'update',
      emittedAt: '2026-08-02T00:00:00.000Z',
    });
    socket.drop();

    await vi.advanceTimersByTimeAsync(10);
    const reconnectSocket = await waitForSocket(1);
    reconnectSocket.open();

    const hello = await waitForFrame(reconnectSocket, (frame) => frame.type === 'hello');
    expect(hello).toMatchObject({ type: 'hello', resumeFrom: 12 });

    reconnectSocket.receive({ type: 'ready', connectionId: 'conn-2', sequence: 12 });
    const register = await waitForFrame(reconnectSocket, (frame) => frame.type === 'register');
    expect(register?.topics).toEqual([topic]);
  });

  it('resync invalidates only active topics', async () => {
    const fetch = createXpodFetch();
    const client = new NotificationsClient(fetch as typeof globalThis.fetch);
    const activeTopic = 'https://pod.example/data/active.ttl';
    const inactiveTopic = 'https://pod.example/data/inactive.ttl';
    const onActiveResync = vi.fn();
    const { socket } = await subscribeXpod(client, activeTopic, vi.fn(), onActiveResync);

    socket.receive({ type: 'resync-required', topics: [activeTopic, inactiveTopic], reason: 'gap' });

    expect(onActiveResync).toHaveBeenCalledWith(activeTopic, 'gap');
  });

  it('closes the xpod socket when the client session is closed', async () => {
    const fetch = createXpodFetch();
    const client = new NotificationsClient(fetch as typeof globalThis.fetch);
    const { socket } = await subscribeXpod(client, 'https://pod.example/data/close.ttl');

    client.unsubscribeAll();

    expect(socket.closed).toBe(true);

    await subscribeXpod(client, 'https://pod.example/data/after-close.ttl');

    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'HEAD')).toHaveLength(2);
  });

  it('retains standard Solid WebSocket/SSE fallback when xpod is not explicitly advertised', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'HEAD') {
        return { ok: true, headers: new FakeHeaders() } as Response;
      }
      return { ok: false, status: 404, text: async () => '' } as Response;
    });
    const client = new NotificationsClient(fetch as typeof globalThis.fetch);

    await expect(
      client.subscribe('https://pod.example/data/no-xpod.ttl', {
        channel: 'websocket',
        onNotification: vi.fn(),
      })
    ).rejects.toThrow();

    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true);
  });
});
