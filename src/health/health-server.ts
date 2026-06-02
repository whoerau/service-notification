import { createServer, type Server } from 'node:http';
import type { Logger } from 'pino';

export class HealthServer {
  private server: Server | null = null;

  constructor(
    private readonly port: number,
    private readonly logger: Logger,
    private readonly isReady: () => boolean
  ) {}

  start(): Promise<void> {
    this.server = createServer((request, response) => {
      if (request.url === '/healthz') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      if (request.url === '/readyz') {
        const ready = this.isReady();
        response.writeHead(ready ? 200 : 503, {
          'Content-Type': 'application/json'
        });
        response.end(JSON.stringify({ status: ready ? 'ready' : 'not_ready' }));
        return;
      }

      response.writeHead(404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'not_found' }));
    });

    return new Promise((resolve) => {
      this.server?.listen(this.port, () => {
        this.logger.info({ port: this.port }, 'health server started');
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        this.server = null;
        resolve();
      });
    });
  }
}
