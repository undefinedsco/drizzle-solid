import { resolvePodBase } from '../utils/pod-root';
import type { SolidAuthSession } from '../pod-dialect';

export class PodRuntime {
  private session: SolidAuthSession;
  private webId: string;
  private podUrl: string;
  private connected = false;

  constructor(options: { session: SolidAuthSession; webId: string; podUrl?: string }) {
    this.session = options.session;
    this.webId = options.webId;
    this.podUrl = resolvePodBase({ webId: this.webId, podUrl: options.podUrl });
  }

  getSession(): SolidAuthSession {
    return this.session;
  }

  getFetch(): typeof fetch {
    return this.session.fetch;
  }

  getWebId(): string {
    return this.webId;
  }

  getPodUrl(): string {
    return this.podUrl;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    try {
      console.log(`Connecting to Solid Pod: ${this.podUrl}`);
      console.log(`Using WebID: ${this.webId}`);

      // Probe pod root with HEAD; treat 500/timeout as failure, others as non-blocking.
      const requestId = `probe-${Date.now()}`;
      const response = await this.session.fetch(this.podUrl, {
        method: 'HEAD',
        headers: {
          'X-Request-ID': requestId,
        },
      });
      const status = response.status;
      if (status === 500) {
        console.error(`Pod probe failed, X-Request-ID: ${requestId}`);
        throw new Error(`Failed to connect to Pod: ${status} ${response.statusText}`);
      }
      if (response.ok) {
        console.log('Successfully connected to Solid Pod');
      } else if (status === 401 || status === 403) {
        console.warn(`Pod root returned ${status}, continuing (child resources may still be writable)`);
      } else {
        console.warn(`Pod root returned ${status}, continuing (child resources may still be writable)`);
      }

      this.connected = true;
    } catch (error) {
      console.error('Failed to connect to Pod:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    console.log('Disconnected from Solid Pod');
  }
}
