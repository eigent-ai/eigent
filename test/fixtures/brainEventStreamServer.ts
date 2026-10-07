// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

/**
 * A stand-in for the Brain's event stream routes, listening on 127.0.0.1
 * like the real one. Every open stream counts as one live subscriber until
 * its client disconnects, mirroring how the Brain detaches a subscriber when
 * the HTTP connection closes.
 */

export interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export interface StreamExchange {
  request: RecordedRequest;
  response: http.ServerResponse;
  socket: Socket;
  /** Resolves when the client side of this exchange is gone. */
  disconnected: Promise<void>;
  isDisconnected(): boolean;
}

export type ExchangeHandler = (exchange: StreamExchange) => void;

export const SSE_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache',
  'x-session-id': 'session-from-brain',
  'set-cookie': 'brain-session=secret; HttpOnly',
};

/** Default: open the stream and keep it open, like a running Run. */
export const openEventStream: ExchangeHandler = ({ response }) => {
  response.writeHead(200, 'OK', SSE_HEADERS);
  response.flushHeaders();
};

export interface BrainEventStreamServer {
  readonly port: number;
  readonly origin: string;
  handler: ExchangeHandler;
  readonly exchanges: StreamExchange[];
  subscriberCount(): number;
  openConnectionCount(): number;
  /** Resolves with the n-th (0-based) stream exchange once it arrives. */
  exchange(index: number): Promise<StreamExchange>;
  close(): Promise<void>;
}

export async function startBrainEventStreamServer(): Promise<BrainEventStreamServer> {
  const exchanges: StreamExchange[] = [];
  const waiters = new Map<number, Array<(exchange: StreamExchange) => void>>();
  const sockets = new Set<Socket>();
  let subscribers = 0;

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (req.method === 'GET' && url === '/status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ subscriber_count: subscribers }));
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      let disconnected = false;
      let markDisconnected!: () => void;
      const disconnectedPromise = new Promise<void>((resolve) => {
        markDisconnected = () => {
          if (disconnected) return;
          disconnected = true;
          resolve();
        };
      });
      subscribers += 1;
      // Writes after a client disconnect are expected and harmless here.
      res.on('error', () => undefined);
      res.on('close', () => {
        subscribers -= 1;
        markDisconnected();
      });
      const exchange: StreamExchange = {
        request: {
          method: req.method ?? '',
          url,
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        },
        response: res,
        socket: req.socket,
        disconnected: disconnectedPromise,
        isDisconnected: () => disconnected,
      };
      const index = exchanges.push(exchange) - 1;
      for (const resolve of waiters.get(index) ?? []) resolve(exchange);
      waiters.delete(index);
      api.handler(exchange);
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve())
  );
  const port = (server.address() as AddressInfo).port;

  const api: BrainEventStreamServer = {
    port,
    origin: `http://localhost:${port}`,
    handler: openEventStream,
    exchanges,
    subscriberCount: () => subscribers,
    openConnectionCount: () => sockets.size,
    exchange(index) {
      const existing = exchanges[index];
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve) => {
        waiters.set(index, [...(waiters.get(index) ?? []), resolve]);
      });
    },
    close() {
      for (const socket of sockets) socket.destroy();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
  return api;
}

/** Poll until `predicate` holds, failing after `timeoutMs`. */
export async function eventually(
  predicate: () => boolean,
  timeoutMs = 5000
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('Condition was not met in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
