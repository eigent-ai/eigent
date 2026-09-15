// Run with: node test/e2e/preview-browser/verify.mjs
// Real Electron guests + production preview components; no account, model, or backend needed.
import { _electron, expect } from '@playwright/test';
import react from '@vitejs/plugin-react';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
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
  await new Promise((resolve) => siteServer.listen(port, '127.0.0.1', resolve));
  return siteServer.address().port;
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
try {
  await vite.listen();
  const url = `http://127.0.0.1:${vite.httpServer.address().port}/preview-fixture?${new URLSearchParams({ site, file: path.join(assets, 'index.html') })}`;
  const env = {
    ...process.env,
    PREVIEW_TEST_URL: url,
    PREVIEW_TEST_ASSETS: assets,
    PREVIEW_TEST_PROFILE: path.join(out, 'profile'),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  electron = await _electron.launch({
    args: [path.join(root, 'test/e2e/preview-browser/main.cjs')],
    env,
    timeout: 30000,
  });
  page = await electron.firstWindow();
  page.on('pageerror', (error) => console.error('Renderer:', error.message));
  await expect(
    page.getByRole('heading', { name: 'Browser preview verification' })
  ).toBeVisible({ timeout: 60000 });
  // The agent's local navigation reveals the user's separate guest once.
  await page.evaluate((site) => window.previewTest.visit(site), site);
  await expect(page.locator('webview')).toHaveCount(1);
  const guestText = () =>
    electron.evaluate(({ webContents }) =>
      webContents
        .getAllWebContents()
        .find((w) => w.getType() === 'webview')
        ?.executeJavaScript('document.body.innerText')
    );
  await expect.poll(guestText).toContain('Preview survives delivery');
  await expect
    .poll(() =>
      page
        .locator('[data-preview-webview-id]')
        .evaluate((el) => getComputedStyle(el).opacity)
    )
    .toBe('1');
  await page.screenshot({ path: path.join(out, '01-live.png') });
  await page.getByRole('button', { name: 'Close panel', exact: true }).click();
  await page.evaluate((site) => window.previewTest.visit(site), site);
  await expect(page.getByRole('textbox', { name: 'Enter a URL' })).toHaveCount(
    0
  );
  // A user link always reveals and reuses the tab.
  await page.getByRole('link', { name: 'Open live site', exact: true }).click();
  await expect(
    page.getByRole('textbox', { name: 'Enter a URL' })
  ).toBeVisible();
  await expect(page.locator('webview')).toHaveCount(1);
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
  await new Promise((resolve) => siteServer.close(resolve));
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Page unavailable');
  await expect(page.getByRole('alert')).toContainText(
    'local server may have stopped'
  );
  await expect(page.locator('[data-preview-webview-id]')).toBeHidden();
  await page.screenshot({ path: path.join(out, '02-stopped-light.png') });
  await page.evaluate(() => window.previewTest.setMode('dark'));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: path.join(out, '03-stopped-dark.png') });
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
  await electron.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.webContents.setZoomFactor(1);
    w.setSize(1200, 800);
  });
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1200);
  await page.evaluate(() => window.previewTest.setMode('light'));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await serveSite(port);
  await page.getByRole('button', { name: 'Retry', exact: true }).focus();
  await expect(
    page.getByRole('button', { name: 'Retry', exact: true })
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect.poll(guestText).toContain('Preview survives delivery');
  await new Promise((resolve) => siteServer.close(resolve));
  await page
    .getByRole('link', { name: 'Open delivered HTML', exact: true })
    .click();
  const frame = page.frameLocator('iframe[title="index.html"]');
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
          'light/dark',
          'narrow window at 200% zoom',
          'keyboard retry after restart',
          'offline HTML with relative CSS/image/script',
        ],
      },
      null,
      2
    )
  );
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(out, 'failure.png') });
    console.error('Fixture state:', await page.locator('body').innerText());
    console.error('Evidence:', out);
  }
  throw error;
} finally {
  await electron?.close();
  await vite.close();
  if (siteServer.listening)
    await new Promise((resolve) => siteServer.close(resolve));
}
