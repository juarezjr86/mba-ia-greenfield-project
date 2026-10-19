import {
  createServer,
  request,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ProxyRequestRecord {
  range: string | undefined;
  status: number;
  bytes: number;
}

/**
 * A small HTTP proxy in front of the storage that counts how many bytes it
 * served. A presigned URL signed for the storage address keeps working because
 * the proxy forwards the original `Host`, which SigV4 signs.
 *
 * It listens on the loopback of the test process container, on purpose: the
 * media tools run in that same container (it is not a Compose service address).
 */
export class RangeCountingProxy {
  readonly requests: ProxyRequestRecord[] = [];
  private server?: Server;
  private origin = '';

  constructor(private readonly targetOrigin: string) {}

  get bytesServed(): number {
    return this.requests.reduce((sum, record) => sum + record.bytes, 0);
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => this.forward(req, res));
    await new Promise<void>((resolve) => {
      this.server!.listen(0, '127.0.0.1', resolve);
    });
    const { port } = this.server.address() as AddressInfo;
    this.origin = `http://127.0.0.1:${port}`;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  reset(): void {
    this.requests.length = 0;
  }

  /** Rewrites a storage URL so that it goes through this proxy. */
  proxiedUrl(storageUrl: string): string {
    const url = new URL(storageUrl);
    return `${this.origin}${url.pathname}${url.search}`;
  }

  private forward(req: IncomingMessage, res: ServerResponse): void {
    const target = new URL(this.targetOrigin);
    const upstream = request(
      {
        hostname: target.hostname,
        port: target.port,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, host: target.host },
      },
      (upstreamRes) => {
        const record: ProxyRequestRecord = {
          range: req.headers.range,
          status: upstreamRes.statusCode ?? 0,
          bytes: 0,
        };
        this.requests.push(record);
        upstreamRes.on('data', (chunk: Buffer) => {
          record.bytes += chunk.length;
        });
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );
    upstream.on('error', () => {
      res.destroy();
    });
    // The tool may close its connection once it has the bytes it wants.
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  }
}
