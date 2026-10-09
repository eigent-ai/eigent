// Run with: node test/e2e/preview-browser/verify.mjs
// Real Electron guests + production preview components; no account, model, or backend needed.
import { _electron, expect } from '@playwright/test';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
const startedAt = Date.now();
const log = (message) =>
  console.error(
    `[preview-browser ${((Date.now() - startedAt) / 1000).toFixed(1)}s] ${message}`
  );
const withTimeout = (promise, ms, label) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} did not finish within ${ms / 1000}s`)),
        ms
      );
    }),
  ]).finally(() => clearTimeout(timer));
};
// Playwright has no timeout for evaluate, keyboard input, or Electron close,
// so every phase is bounded: a stall fails with the phase name and process
// state instead of running until CI cancels the job.
let currentPhase = 'setup';
const phase = (name, run, ms = 45000) => {
  currentPhase = name;
  log(name);
  return withTimeout(run(), ms, `Phase "${name}"`);
};
const recentOutput = [];
const remember = (source, text) => {
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    recentOutput.push(`${source}: ${line}`);
    if (recentOutput.length > 150) recentOutput.shift();
  }
};
// This process and everything it spawned: Electron's helpers and esbuild.
const processTree = () => {
  try {
    const rows = execFileSync(
      'ps',
      ['-A', '-o', 'pid=,ppid=,stat=,etime=,args='],
      { encoding: 'utf8' }
    )
      .trim()
      .split('\n')
      .map((line) => {
        const [pid, ppid] = line.trim().split(/\s+/, 2).map(Number);
        return { pid, ppid, text: line.trim().slice(0, 160) };
      });
    const ours = new Set([process.pid]);
    for (let grew = true; grew;) {
      grew = false;
      for (const row of rows) {
        if (ours.has(row.pid) || !ours.has(row.ppid)) continue;
        ours.add(row.pid);
        grew = true;
      }
    }
    return rows
      .filter((row) => ours.has(row.pid))
      .map((row) => {
        let waiting = '';
        try {
          waiting = ` [${readFileSync(`/proc/${row.pid}/wchan`, 'utf8')}]`;
        } catch {
          // Wait channels are Linux-only.
        }
        return `  ${row.text}${waiting}`;
      })
      .join('\n');
  } catch (error) {
    return `  unavailable: ${error.message}`;
  }
};
const probe = async (label, run) => {
  try {
    log(`${label}: ${JSON.stringify(await withTimeout(run(), 5000, label))}`);
  } catch (error) {
    log(`${label}: ${error.message}`);
  }
};
const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const out = await mkdtemp(path.join(os.tmpdir(), 'eigent-preview-1939-'));
const assets = path.join(out, 'site');
await mkdir(assets);
await writeFile(
  path.join(assets, 'index.html'),
  '<!doctype html><html><head><link rel="stylesheet" href="site.css"></head><body><h1>Preview survives delivery</h1><img alt="Fixture icon" src="icon.svg"><button id="count">Count: 0</button><script src="site.js"></script></body></html>'
);
await writeFile(
  path.join(assets, 'site.css'),
  'body { background: #edf6ff; font: 20px system-ui; padding: 30px } h1 { color: rgb(15, 90, 160) } img { width: 80px; display: block; margin: 20px 0 }'
);
await writeFile(
  path.join(assets, 'site.js'),
  'let count=0; document.getElementById("count").onclick=()=>document.getElementById("count").textContent="Count: "+(++count);'
);
await writeFile(
  path.join(assets, 'icon.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><circle cx="40" cy="40" r="35" fill="#0f5aa0"/></svg>'
);
let siteServer;
const siteSockets = new Set();
const serveSite = async (port = 0) => {
  siteServer = createServer(async (req, res) => {
    const name =
      new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (!['index.html', 'site.css', 'site.js', 'icon.svg'].includes(name)) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader(
      'Content-Type',
      {
        html: 'text/html',
        css: 'text/css',
        js: 'application/javascript',
        svg: 'image/svg+xml',
      }[name.split('.').pop()]
    );
    res.end(await readFile(path.join(assets, name)));
  });
  siteServer.on('connection', (socket) => {
    siteSockets.add(socket);
    socket.on('close', () => siteSockets.delete(socket));
  });
  await new Promise((resolve) => siteServer.listen(port, '127.0.0.1', resolve));
  return siteServer.address().port;
};
// close() waits for every open socket, and Node counts one that has not sent
// a request yet as busy. Chromium sometimes preconnects a socket it never
// uses, so drop those; requests in flight still finish as before.
const stopSite = async () => {
  const closed = new Promise((resolve) => siteServer.close(resolve));
  for (const socket of siteSockets) if (!socket.bytesRead) socket.destroy();
  await closed;
};
const port = await serveSite();
const site = `http://127.0.0.1:${port}/index.html`;
const originalHtml = await readFile(path.join(root, 'index.html'), 'utf8');
const fixtureHtml = originalHtml.replace(
  '/src/main.tsx',
  '/test/e2e/preview-browser/renderer.tsx'
);
const vite = await createViteServer({
  configFile: false,
  root,
  envDir: out,
  cacheDir: path.join(out, 'vite-cache'),
  plugins: [
    react(),
    {
      name: 'preview-fixture',
      configureServer(server) {
        server.middlewares.use('/preview-fixture', async (req, res) => {
          res.setHeader('Content-Type', 'text/html');
          res.end(
            await server.transformIndexHtml('/preview-fixture', fixtureHtml)
          );
        });
      },
    },
  ],
  resolve: { alias: { '@': path.join(root, 'src') } },
  server: { host: '127.0.0.1', port: 0 },
  optimizeDeps: { exclude: ['@stackframe/react'] },
});
let electron;
let page;
let failure;
try {
  await phase('start Vite', () => vite.listen());
  const url = `http://127.0.0.1:${vite.httpServer.address().port}/preview-fixture?${new URLSearchParams({ site, file: path.join(assets, 'index.html') })}`;
  const env = {
    ...process.env,
    PREVIEW_TEST_URL: url,
    PREVIEW_TEST_ASSETS: assets,
    PREVIEW_TEST_PROFILE: path.join(out, 'profile'),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  await phase(
    'launch Electron',
    async () => {
      electron = await _electron.launch({
        args: [path.join(root, 'test/e2e/preview-browser/main.cjs')],
        env,
        timeout: 30000,
      });
      electron
        .process()
        .stdout.on('data', (data) => remember('electron', data));
      electron
        .process()
        .stderr.on('data', (data) => remember('electron', data));
      electron.on('close', () => log('Electron exited'));
      page = await electron.firstWindow();
    },
    75000
  );
  page.on('pageerror', (error) => console.error('Renderer:', error.message));
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type()))
      remember('renderer', message.text());
  });
  page.on('crash', () => log('Renderer crashed'));
  await phase(
    'render the fixture',
    () =>
      expect(
        page.getByRole('heading', { name: 'Browser preview verification' })
      ).toBeVisible({ timeout: 60000 }),
    90000
  );
  const guestText = () =>
    electron.evaluate(({ webContents }) =>
      webContents
        .getAllWebContents()
        .find((w) => w.getType() === 'webview')
        ?.executeJavaScript('document.body.innerText')
    );
  // The agent's local navigation reveals the user's separate guest once.
  await phase('agent handoff', async () => {
    await page.evaluate((site) => window.previewTest.visit(site), site);
    await expect(page.locator('webview')).toHaveCount(1);
    await expect.poll(guestText).toContain('Preview survives delivery');
    await expect
      .poll(() =>
        page
          .locator('[data-preview-webview-id]')
          .evaluate((el) => getComputedStyle(el).opacity)
      )
      .toBe('1');
    await page.screenshot({ path: path.join(out, '01-live.png') });
  });
  await phase('no repeated focus', async () => {
    await page
      .getByRole('button', { name: 'Close panel', exact: true })
      .click();
    await page.evaluate((site) => window.previewTest.visit(site), site);
    await expect(
      page.getByRole('textbox', { name: 'Enter a URL' })
    ).toHaveCount(0);
  });
  // A user link always reveals and reuses the tab.
  await phase('Markdown link reuse', async () => {
    await page
      .getByRole('link', { name: 'Open live site', exact: true })
      .click();
    await expect(
      page.getByRole('textbox', { name: 'Enter a URL' })
    ).toBeVisible();
    await expect(page.locator('webview')).toHaveCount(1);
  });
  await phase('Session switching', async () => {
    await page.getByRole('button', { name: 'Session B', exact: true }).click();
    await expect
      .poll(() =>
        page
          .locator('[data-preview-webview-id]')
          .evaluate((el) => getComputedStyle(el).visibility)
      )
      .toBe('hidden');
    await page.getByRole('button', { name: 'Session A', exact: true }).click();
    await expect
      .poll(() =>
        page
          .locator('[data-preview-webview-id]')
          .evaluate((el) => getComputedStyle(el).opacity)
      )
      .toBe('1');
  });
  await phase('server exit and visible error', async () => {
    await stopSite();
    await page.getByRole('button', { name: 'Reload', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Page unavailable');
    await expect(page.getByRole('alert')).toContainText(
      'local server may have stopped'
    );
    await expect(page.locator('[data-preview-webview-id]')).toBeHidden();
  });
  await phase('retry while server remains down', async () => {
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Page unavailable');
    await expect(page.locator('[data-preview-webview-id]')).toBeHidden();
    await expect(page.getByText(/ERR_CONNECTION_REFUSED/)).toHaveCount(0);
    await page.screenshot({ path: path.join(out, '02-stopped-light.png') });
  });
  await phase('light/dark', async () => {
    await page.evaluate(() => window.previewTest.setMode('dark'));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: path.join(out, '03-stopped-dark.png') });
  });
  await phase('narrow window at 200% zoom', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await electron.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.setSize(800, 600);
      w.webContents.setZoomFactor(2);
    });
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(400);
    await expect(
      page.getByRole('button', { name: 'Retry', exact: true })
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Retry', exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole('button', { name: 'Retry', exact: true })
    ).toBeInViewport();
    const nativeZoomScreenshot = await electron.evaluate(
      async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0].capturePage())
          .toPNG()
          .toString('base64')
    );
    await writeFile(
      path.join(out, '04-narrow-zoom.png'),
      Buffer.from(nativeZoomScreenshot, 'base64')
    );
  });
  await phase('RTL keyboard retry at narrow 200% zoom', async () => {
    await page.evaluate(() =>
      document.documentElement.setAttribute('dir', 'rtl')
    );
    const retry = page.getByRole('button', { name: 'Retry', exact: true });
    await retry.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(retry).toBeFocused();
    await expect(retry).toBeInViewport();
    expect(
      await retry.evaluate((element) => getComputedStyle(element).boxShadow)
    ).not.toBe('none');
    const rtlZoomScreenshot = await electron.evaluate(
      async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0].capturePage())
          .toPNG()
          .toString('base64')
    );
    await writeFile(
      path.join(out, '04-narrow-zoom-rtl-focus.png'),
      Buffer.from(rtlZoomScreenshot, 'base64')
    );
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert')).toContainText('Page unavailable');
  });
  await phase('restore window size and light mode', async () => {
    await page.evaluate(() => document.documentElement.removeAttribute('dir'));
    await electron.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.webContents.setZoomFactor(1);
      w.setSize(1200, 800);
    });
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1200);
    await page.evaluate(() => window.previewTest.setMode('light'));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });
  await phase('toolbar reload clears retry errors', async () => {
    await serveSite(port);
    await page.getByRole('button', { name: 'Reload', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect.poll(guestText).toContain('Preview survives delivery');
    await expect(page.getByText(/ERR_CONNECTION_REFUSED/)).toHaveCount(0);
  });
  await phase('same-link retry after server restart', async () => {
    await stopSite();
    await page.getByRole('button', { name: 'Reload', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Page unavailable');
    await serveSite(port);
    await page
      .getByRole('button', { name: 'Reopen preview', exact: true })
      .click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect.poll(guestText).toContain('Preview survives delivery');
  });
  await phase('keyboard retry after restart', async () => {
    await stopSite();
    await page.getByRole('button', { name: 'Reload', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Page unavailable');
    await serveSite(port);
    await page.getByRole('button', { name: 'Retry', exact: true }).focus();
    await expect(
      page.getByRole('button', { name: 'Retry', exact: true })
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect.poll(guestText).toContain('Preview survives delivery');
  });
  const frame = page.frameLocator('iframe[title="index.html"]');
  await phase('offline HTML with relative CSS/image/script', async () => {
    await stopSite();
    await page
      .getByRole('link', { name: 'Open delivered HTML', exact: true })
      .click();
    await expect(
      frame.getByRole('heading', { name: 'Preview survives delivery' })
    ).toBeVisible({ timeout: 15000 });
    await expect(frame.getByRole('heading')).toHaveCSS(
      'color',
      'rgb(15, 90, 160)'
    );
    await expect
      .poll(() =>
        frame.getByAltText('Fixture icon').evaluate((img) => img.naturalWidth)
      )
      .toBe(80);
    await expect
      .poll(() =>
        frame
          .getByRole('button', { name: 'Count: 0' })
          .evaluate((el) => typeof el.onclick)
      )
      .toBe('function');
    await frame.getByRole('button', { name: 'Count: 0' }).focus();
    await page.keyboard.press('Enter');
    await expect(frame.getByRole('button', { name: 'Count: 1' })).toBeVisible();
    await page.screenshot({ path: path.join(out, '05-offline-artifact.png') });
  });
  await phase('initial-load failure and Files recovery callback', async () => {
    await page.evaluate(
      (site) =>
        window.previewTest.store
          .getState()
          .openBrowserPreview(site + '?initial-failure=1'),
      site
    );
    await expect(page.getByRole('alert')).toContainText('Page unavailable');
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    await expect(
      frame.getByRole('heading', { name: 'Preview survives delivery' })
    ).toBeVisible();
  });
  console.log(
    JSON.stringify(
      {
        result: 'passed',
        out,
        checks: [
          'agent handoff',
          'no repeated focus',
          'Markdown link reuse',
          'Session switching',
          'initial-load failure and Files recovery callback',
          'server exit and visible error',
          'retry while server remains down',
          'toolbar reload clears retry errors',
          'same-link retry after server restart',
          'light/dark',
          'narrow window at 200% zoom',
          'RTL keyboard retry at narrow 200% zoom',
          'keyboard retry after restart',
          'offline HTML with relative CSS/image/script',
        ],
      },
      null,
      2
    )
  );
} catch (error) {
  failure = error;
  log(`failed during "${currentPhase}": ${error.message.split('\n')[0]}`);
  const child = electron?.process();
  const running = child?.exitCode === null && child.signalCode === null;
  if (child)
    log(
      `Electron pid ${child.pid}: ${running ? 'running' : `exited (code ${child.exitCode}, signal ${child.signalCode})`}`
    );
  log(`processes:\n${processTree()}`);
  if (running)
    await probe('Electron web contents', () =>
      electron.evaluate(({ webContents }) =>
        webContents.getAllWebContents().map((contents) => ({
          type: contents.getType(),
          url: contents.getURL(),
          loading: contents.isLoading(),
          crashed: contents.isCrashed(),
        }))
      )
    );
  if (page && !page.isClosed()) {
    await probe('Fixture document', () =>
      page.evaluate(() => ({
        readyState: document.readyState,
        focused: document.activeElement?.outerHTML.slice(0, 120),
      }))
    );
    await page
      .screenshot({ path: path.join(out, 'failure.png'), timeout: 10000 })
      .catch((error) => log(`failure screenshot: ${error.message}`));
    console.error(
      'Fixture state:',
      await page
        .locator('body')
        .innerText({ timeout: 10000 })
        .catch((error) => error.message)
    );
  }
  console.error('Evidence:', out);
  if (recentOutput.length)
    log(`recent Electron and renderer output:\n${recentOutput.join('\n')}`);
} finally {
  log('teardown');
  await withTimeout(electron?.close(), 15000, 'Electron close').catch((error) =>
    log(error.message)
  );
  await withTimeout(vite.close(), 15000, 'Vite close').catch((error) =>
    log(error.message)
  );
  if (siteServer.listening)
    await withTimeout(stopSite(), 15000, 'Site server close').catch((error) =>
      log(error.message)
    );
}
if (failure) {
  console.error(failure);
  process.exitCode = 1;
}
// Exit normally so Playwright can remove its temporary folders, but do not let
// a handle left by a stalled call keep the job alive. Playwright's exit hook
// kills any Electron process that did not close.
setTimeout(() => {
  log(`open handles: ${process.getActiveResourcesInfo?.().join(', ')}`);
  process.exit();
}, 10000).unref();
