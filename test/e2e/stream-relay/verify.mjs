// Run with: node test/e2e/stream-relay/verify.mjs
// Real Electron + Chromium, the production relay, preload and sseTransport,
// and a stand-in Brain. No account, model, or backend needed.
//
// 1. With the relay, eight open event streams leave the renderer's
//    connection pool free: an ordinary request to the same host is answered
//    at once, chunks cross the context bridge, and aborting or reloading
//    disconnects the Brain subscribers.
// 2. With EIGENT_DISABLE_STREAM_RELAY=1, Chromium opens only six of the
//    streams and the ordinary request stalls: the failure the relay removes.
import { _electron, expect } from '@playwright/test';
import react from '@vitejs/plugin-react';
import { build } from 'esbuild';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const out = await mkdtemp(path.join(os.tmpdir(), 'eigent-stream-relay-'));
const STREAMS = 8;

// The production main-process relay and preload, bundled as-is.
const relayModule = path.join(out, 'relay.cjs');
const preload = path.join(out, 'preload.cjs');
await build({
  entryPoints: { relay: path.join(root, 'electron/main/brainStreamRelay.ts') },
  outdir: out,
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  logLevel: 'error',
});
await build({
  entryPoints: { preload: path.join(root, 'electron/preload/index.ts') },
  outdir: out,
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  logLevel: 'error',
});

// Stand-in Brain: event streams stay open like running Runs.
const streams = [];
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers':
    'accept, accept-language, authorization, content-type, last-event-id, x-channel, x-eigent-local-capability, x-session-id, x-user-id',
  'access-control-expose-headers': 'x-session-id',
  'access-control-max-age': '600',
};
const liveStreams = () => streams.filter((stream) => !stream.closed);
const brain = createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors).end();
    return;
  }
  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    res.end(JSON.stringify({ subscriber_count: liveStreams().length }));
    return;
  }
  const match = /^\/runs\/run-(\d+)\/stream\?after_sequence=0$/.exec(
    req.url ?? ''
  );
  if (req.method === 'GET' && match) {
    const stream = {
      index: Number(match[1]),
      headers: req.headers,
      response: res,
      closed: false,
    };
    streams.push(stream);
    res.on('close', () => {
      stream.closed = true;
    });
    res.writeHead(200, {
      ...cors,
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'x-session-id': 'stand-in-session',
    });
    res.flushHeaders();
    return;
  }
  res.writeHead(404, cors).end();
});
await new Promise((resolve) => brain.listen(0, '127.0.0.1', resolve));
const brainPort = brain.address().port;
const brainOrigin = `http://localhost:${brainPort}`;

const vite = await createViteServer({
  configFile: false,
  root,
  envDir: out,
  cacheDir: path.join(out, 'vite-cache'),
  plugins: [
    react(),
    {
      name: 'stream-relay-fixture',
      configureServer(server) {
        server.middlewares.use('/stream-relay-fixture', async (req, res) => {
          res.setHeader('Content-Type', 'text/html');
          res.end(
            await server.transformIndexHtml(
              '/stream-relay-fixture',
              '<!doctype html><html><head><title>Stream relay</title></head><body><script type="module" src="/test/e2e/stream-relay/renderer.ts"></script></body></html>'
            )
          );
        });
      },
    },
  ],
  resolve: { alias: { '@': path.join(root, 'src') } },
  server: { host: '127.0.0.1', port: 0 },
  optimizeDeps: { exclude: ['@stackframe/react'] },
});
await vite.listen();

async function launch(name, extraEnv) {
  const env = {
    ...process.env,
    ...extraEnv,
    STREAM_RELAY_TEST_URL: `http://127.0.0.1:${vite.httpServer.address().port}/stream-relay-fixture?brain=${encodeURIComponent(brainOrigin)}`,
    STREAM_RELAY_MODULE: relayModule,
    STREAM_RELAY_PRELOAD: preload,
    STREAM_RELAY_BRAIN_PORT: String(brainPort),
    STREAM_RELAY_PROFILE: path.join(out, `profile-${name}`),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  if (!extraEnv.EIGENT_DISABLE_STREAM_RELAY) {
    delete env.EIGENT_DISABLE_STREAM_RELAY;
  }
  const electron = await _electron.launch({
    args: [path.join(root, 'test/e2e/stream-relay/main.cjs')],
    env,
    timeout: 30000,
  });
  const page = await electron.firstWindow();
  page.on('pageerror', (error) => console.error('Renderer:', error.message));
  await expect(page.locator('body[data-ready="true"]')).toHaveCount(1, {
    timeout: 60000,
  });
  return { electron, page };
}

const evidence = {};
let current;
try {
  // ---- 1. Relay on (default) ----
  streams.length = 0;
  current = await launch('relay', {});
  let { page } = current;
  expect(await page.evaluate(() => window.relayTest.hasRelayBridge())).toBe(
    true
  );
  await page.evaluate((count) => window.relayTest.open(count), STREAMS);
  await expect.poll(() => liveStreams().length).toBe(STREAMS);
  // Opened by the main process: Chromium would have sent Origin.
  expect(streams.every((stream) => !stream.headers.origin)).toBe(true);
  const relayStatus = await page.evaluate(() => window.relayTest.status(3000));
  expect(relayStatus).toMatchObject({ ok: true, subscribers: STREAMS });
  expect(relayStatus.ms).toBeLessThan(2000);
  for (const stream of streams) {
    stream.response.write(`data: event-for-${stream.index}\n\n`);
  }
  await expect
    .poll(() => page.evaluate(() => window.relayTest.events()))
    .toEqual(
      Object.fromEntries(
        Array.from({ length: STREAMS }, (_, index) => [
          String(index),
          [`event-for-${index}`],
        ])
      )
    );
  await page.evaluate(() => window.relayTest.abort(0));
  await expect
    .poll(() => streams.find((stream) => stream.index === 0).closed)
    .toBe(true);
  expect(liveStreams()).toHaveLength(STREAMS - 1);
  await page.reload();
  await expect.poll(() => liveStreams().length).toBe(0);
  evidence.relay = {
    streamsOpened: STREAMS,
    statusRequestMs: relayStatus.ms,
    eventsDelivered: STREAMS,
    abortDisconnects: true,
    reloadDisconnects: true,
  };
  await current.electron.close();
  current = undefined;

  // ---- 2. Relay off: the original stall ----
  streams.length = 0;
  current = await launch('disabled', { EIGENT_DISABLE_STREAM_RELAY: '1' });
  ({ page } = current);
  await page.evaluate((count) => window.relayTest.open(count), STREAMS);
  await expect.poll(() => liveStreams().length).toBe(6);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  expect(liveStreams()).toHaveLength(6);
  expect(streams.every((stream) => Boolean(stream.headers.origin))).toBe(true);
  const stalledStatus = await page.evaluate(() =>
    window.relayTest.status(3000)
  );
  expect(stalledStatus.ok).toBe(false);
  evidence.disabled = {
    streamsRequested: STREAMS,
    streamsOpened: liveStreams().length,
    statusRequest: `no response after ${stalledStatus.ms} ms`,
  };
  await current.electron.close();
  current = undefined;

  console.log(JSON.stringify({ evidence }, null, 2));
} catch (error) {
  if (current?.page && !current.page.isClosed()) {
    console.error(
      'Fixture state:',
      await current.page
        .evaluate(() => ({
          events: window.relayTest?.events(),
          errors: window.relayTest?.errors(),
        }))
        .catch(() => null)
    );
  }
  console.error(
    'Stand-in Brain streams:',
    streams.map((stream) => ({
      index: stream.index,
      closed: stream.closed,
      origin: stream.headers.origin ?? null,
    }))
  );
  throw error;
} finally {
  await current?.electron.close();
  await vite.close();
  for (const stream of streams) stream.response.destroy();
  brain.closeAllConnections();
  await new Promise((resolve) => brain.close(resolve));
}
