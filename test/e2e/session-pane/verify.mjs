// Production Session shells and composers, with offline execution/event sources.
// Run: node test/e2e/session-pane/verify.mjs
import { chromium, expect } from '@playwright/test';
import react from '@vitejs/plugin-react';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const out = await mkdtemp(path.join(os.tmpdir(), 'session-pane-'));
const stubs = {
  '/src/hooks/useSessionExecution.ts': `export const useSessionExecution = projectId => ({ scope: {projectId, accountKey: 'offline'}, state: {managed: false, route: {route: 'legacy', project_id: projectId}, error: null} });`,
  '/src/hooks/useModelConfigCheck.ts': `export const useModelConfigCheck = () => ({hasModel: true, isConfigLoaded: true, cloudUsageLimitReached: false});`,
  '/src/hooks/useProjectEventRuntime.tsx': `import {createContext,useContext} from 'react'; const Context=createContext({projectId:null,snapshot:null,hydration:{status:'idle',hasOlderHistory:false,eventsTruncated:false}}); export const useProjectEventRuntime=()=>useContext(Context); export const ProjectEventRuntimeProvider=({projectId,children})=><Context.Provider value={{projectId,snapshot:null,hydration:{status:'idle',hasOlderHistory:false,eventsTruncated:false}}}>{children}</Context.Provider>;`,
};
const vite = await createServer({
  configFile: false,
  root,
  envDir: out,
  cacheDir: path.join(out, 'cache'),
  plugins: [
    {
      name: 'offline-session-sources',
      enforce: 'pre',
      load(id) {
        for (const [suffix, source] of Object.entries(stubs))
          if (id.endsWith(suffix)) return source;
      },
      configureServer(server) {
        server.middlewares.use('/pane-fixture', async (_req, res) => {
          res.setHeader('Content-Type', 'text/html');
          res.end(
            await server.transformIndexHtml(
              '/pane-fixture',
              '<div id="root"></div><script type="module" src="/test/e2e/session-pane/renderer.tsx"></script>'
            )
          );
        });
      },
    },
    react(),
  ],
  resolve: { alias: { '@': path.join(root, 'src') } },
  server: { host: '127.0.0.1', port: 0 },
  optimizeDeps: { exclude: ['@stackframe/react'] },
});
let browser;
try {
  await vite.listen();
  browser = await chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL,
  });
  const page = await browser.newPage({
    viewport: { width: 1800, height: 1000 },
    reducedMotion: 'reduce',
  });
  const errors = [];
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.error('PAGE ERROR:', error.message);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('BROWSER:', message.text());
  });
  console.log('Browser started');
  await page.route('**/*', (route) => {
    if (['fetch', 'xhr'].includes(route.request().resourceType()))
      return route.fulfill({ contentType: 'application/json', body: '{}' });
    return route.continue();
  });
  console.log('Loading fixture');
  await page.goto(
    `http://127.0.0.1:${vite.httpServer.address().port}/pane-fixture`,
    { waitUntil: 'domcontentloaded', timeout: 30000 }
  );
  console.log('Fixture loaded');
  const a = page.locator('[data-session-pane="a"]');
  const b = page.locator('[data-session-pane="b"]');
  const inputA = a.getByRole('textbox').first();
  const inputB = b.getByRole('textbox').first();
  await expect(inputA)
    .toBeVisible({ timeout: 30000 })
    .catch(async (error) => {
      await page.screenshot({ path: path.join(out, 'failure.png') });
      console.error('DOM:', await page.locator('body').innerText());
      throw error;
    });
  console.log('Composers visible');
  await expect(inputB).toBeVisible();
  await inputA.fill('Draft for A');
  await inputB.fill('Draft for B');
  await expect
    .poll(() =>
      page.evaluate(() => window.paneTest.projects.getState().activeProjectId)
    )
    .toBe('b');
  await inputA.focus();
  await expect
    .poll(() =>
      page.evaluate(() => window.paneTest.projects.getState().activeProjectId)
    )
    .toBe('a');
  await inputB.focus();
  await page.evaluate(() =>
    window.paneTest.tabs.getState().requestToggleSessionSidePanel()
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => window.paneTest.tabs.getState().sessionSummaryOpenByProject.b
      )
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(window.paneTest.tabs.getState().sessionSummaryOpenByProject.a)
      )
    )
    .toBe(false);
  await page.evaluate(() =>
    window.paneTest.tabs.getState().requestToggleSessionSidePanel()
  );
  for (const mode of ['light', 'dark']) {
    await page.evaluate((mode) => window.paneTest.setMode(mode), mode);
    await a.getByRole('button', { name: 'Open preview', exact: true }).click();
    await expect(
      a.getByRole('button', { name: 'Close preview', exact: true })
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      b.getByRole('button', { name: 'Open preview', exact: true })
    ).toHaveAttribute('aria-pressed', 'false');
    await a.getByRole('button', { name: 'Close preview', exact: true }).click();
    await expect(inputA).toHaveText('Draft for A');
    await expect(inputB).toHaveText('Draft for B');
    await page.screenshot({ path: path.join(out, `${mode}.png`) });
  }
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  await expect(inputA).toBeVisible();
  await expect(inputB).toBeVisible();
  await page.screenshot({ path: path.join(out, 'zoom-200.png') });
  await page.evaluate(() => {
    document.documentElement.style.zoom = '';
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await a.getByRole('button', { name: 'Open preview', exact: true }).click();
  await expect(a.getByRole('tablist', { name: 'Preview tabs' })).toBeVisible();
  await a.getByRole('button', { name: 'Close preview', exact: true }).click();
  await page.setViewportSize({ width: 900, height: 600 });
  await expect(inputA).toBeVisible();
  await expect(inputB).toBeVisible();
  await inputB.focus();
  await page.keyboard.press('Tab');
  await expect
    .poll(() =>
      page.evaluate(() => window.paneTest.projects.getState().activeProjectId)
    )
    .toBe('b');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(
    `Session pane rendered checks passed (light, dark, 200% zoom, narrow, motion preferences, focused commands, keyboard focus, drafts, Preview). Screenshots: ${out}`
  );
} finally {
  await browser?.close();
  vite.httpServer?.closeAllConnections();
  await vite.close();
}
