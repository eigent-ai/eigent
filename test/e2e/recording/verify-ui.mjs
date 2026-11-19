import { chromium } from '@playwright/test';
import react from '@vitejs/plugin-react';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..'
);
const output = await fs.mkdtemp(path.join(os.tmpdir(), 'eigent-recording-ui-'));
const server = await createServer({
  configFile: false,
  root,
  plugins: [react()],
  optimizeDeps: { entries: ['test/e2e/recording/ui.html'] },
  resolve: { alias: { '@': path.join(root, 'src') } },
  server: { host: '127.0.0.1', port: 0 },
});
await server.listen();
const port = server.httpServer.address().port;
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
const cases = [];
try {
  for (const theme of ['light', 'dark']) {
    for (const state of [
      'starting',
      'recording',
      'stopping',
      'finalizing',
      'completed',
      'denied',
      'interrupted',
    ]) {
      await page.setViewportSize({ width: 800, height: 440 });
      await page.goto(
        `http://127.0.0.1:${port}/test/e2e/recording/ui.html?theme=${theme}&state=${state}`
      );
      if (['starting', 'recording', 'stopping', 'finalizing'].includes(state))
        await page.getByLabel('Recordings').waitFor();
      await page.screenshot({
        path: path.join(output, `${theme}-${state}.png`),
      });
      cases.push({ theme, state });
    }
    await page.setViewportSize({ width: 360, height: 240 });
    await page.goto(
      `http://127.0.0.1:${port}/test/e2e/recording/ui.html?theme=${theme}&state=recording&compact`
    );
    await page
      .getByRole('button', { name: 'Stop recording', exact: true })
      .waitFor();
    await page.keyboard.press('Tab');
    await page.screenshot({
      path: path.join(output, `${theme}-narrow-keyboard.png`),
    });
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    await page.screenshot({
      path: path.join(output, `${theme}-200-percent.png`),
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth
    );
    if (overflow) throw Error(`Recording controls overflow at 200%: ${theme}`);
  }
  if (errors.length) throw Error(errors.join('\n'));
  await fs.writeFile(
    path.join(output, 'report.json'),
    JSON.stringify(
      {
        cases,
        narrow: '360×240',
        zoom: '200%',
        reducedMotion: true,
        pageErrors: errors,
      },
      null,
      2
    )
  );
  console.log(`Recording UI fixture passed. Evidence: ${output}`);
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') });
  console.error({
    output,
    errors,
    body: (await page.locator('body').innerText()).slice(0, 1500),
  });
  throw error;
} finally {
  await browser.close();
  await server.close();
}
