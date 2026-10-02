// macOS only: the fixture spawns /bin/zsh, relies on zsh brace expansion and
// Meta shortcuts, and needs node-pty rebuilt for Electron.
// Run with: npm run test:terminal-scrollback
import { _electron, expect } from '@playwright/test';
import react from '@vitejs/plugin-react';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const out = await mkdtemp(
  path.join(os.tmpdir(), 'eigent-terminal-scrollback-')
);
await mkdir(path.join(out, 'profile'));
const html = (await readFile(path.join(root, 'index.html'), 'utf8')).replace(
  '/src/main.tsx',
  '/test/e2e/terminal-scrollback/renderer.tsx'
);
const vite = await createServer({
  configFile: false,
  root,
  envDir: out,
  cacheDir: path.join(out, 'vite-cache'),
  plugins: [
    react(),
    {
      name: 'terminal-fixture',
      configureServer(server) {
        server.middlewares.use('/terminal-fixture', async (_req, res) => {
          res.setHeader('Content-Type', 'text/html');
          res.end(await server.transformIndexHtml('/terminal-fixture', html));
        });
      },
    },
  ],
  resolve: { alias: { '@': path.join(root, 'src') } },
  server: { host: '127.0.0.1', port: 0 },
});
let electron;
let page;
try {
  await vite.listen();
  const env = {
    ...process.env,
    TERMINAL_TEST_URL: `http://127.0.0.1:${vite.httpServer.address().port}/terminal-fixture`,
    TERMINAL_TEST_PROFILE: path.join(out, 'profile'),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  electron = await _electron.launch({
    args: [path.join(root, 'test/e2e/terminal-scrollback/main.cjs')],
    env,
  });
  page = await electron.firstWindow();
  page.on('pageerror', (error) => console.error('Renderer:', error));
  await expect(
    page.getByRole('button', { name: 'Session A', exact: true })
  ).toBeVisible({ timeout: 60000 });
  const snapshot = async () =>
    page.evaluate(async () => {
      await window.terminalTest.flush();
      return window.terminalTest.snapshot(0);
    });
  const waitForEntrance = () =>
    expect(page.locator('[data-settled]')).toHaveAttribute(
      'data-settled',
      'true'
    );
  await waitForEntrance();
  await expect
    .poll(async () => (await snapshot())?.lines.join('\n'))
    .toContain('fixture>');
  const windowBounds = () =>
    electron.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getBounds()
    );
  const originalBounds = await windowBounds();
  await page.evaluate(() =>
    window.terminalTest.command(
      'session-a',
      "for i in {1..150}; do printf 'LINE-%04d abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789\\n' $i; done"
    )
  );
  const numberedLines = Array.from(
    { length: 150 },
    (_, i) =>
      `LINE-${String(i + 1).padStart(4, '0')} abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789`
  );
  await expect
    .poll(async () =>
      (await snapshot()).lines.filter((line) => line.startsWith('LINE-'))
    )
    .toEqual(numberedLines);
  await expect
    .poll(async () => (await snapshot()).lines.filter(Boolean).at(-1))
    .toContain('fixture>');
  await page.evaluate(() => window.terminalTest.scroll(10));
  const before = await snapshot();
  await page.screenshot({ path: path.join(out, 'before.png') });
  const states = [before];
  const transientSizes = [];
  const switchTo = async (session) => {
    await page
      .getByRole('button', { name: `Session ${session}`, exact: true })
      .click();
    await waitForEntrance();
    await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
  };
  for (let i = 0; i < 5; i++) {
    await switchTo('B');
    await page.getByRole('button', { name: 'Session A', exact: true }).click();
    // Observe the initial entrance frame separately from the settled buffer.
    transientSizes.push(await snapshot());
    await waitForEntrance();
    await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
    states.push(await snapshot());
    expect(await windowBounds()).toEqual(originalBounds);
  }
  await page.screenshot({ path: path.join(out, 'after-five-switches.png') });
  const evidence = {
    states,
    transientSizes,
    windowBounds: originalBounds,
    resizes: await page.evaluate(() => window.terminalTest.resizes),
  };
  await writeFile(
    path.join(out, 'buffers.json'),
    JSON.stringify(evidence, null, 2)
  );
  console.log('Evidence:', out);
  console.log(
    JSON.stringify(
      states.map((s) => ({
        rows: s.rows,
        cols: s.cols,
        baseY: s.baseY,
        viewportY: s.viewportY,
        numberedLines: s.lines.filter((x) => /^LINE-\d{4} /.test(x)).length,
      })),
      null,
      2
    )
  );
  for (const state of states) {
    expect(state.lines.filter((line) => line.startsWith('LINE-'))).toEqual(
      numberedLines
    );
    expect(state).toEqual(before);
  }
  expect(await page.evaluate(() => window.terminalTest.count())).toBe(2);
  expect(await page.evaluate(() => window.terminalTest.calls.creates)).toEqual([
    'session-a',
    'session-b',
  ]);
  expect(await page.evaluate(() => window.terminalTest.calls.disposes)).toEqual(
    []
  );
  expect(evidence.resizes.filter((size) => size.index === 0)).toEqual([
    { index: 0, cols: before.cols, rows: before.rows },
  ]);

  // The user can move focus while waiting for an entrance to finish.
  await switchTo('B');
  await page.getByRole('button', { name: 'Session A', exact: true }).click();
  await page.getByRole('textbox', { name: 'Other input' }).click();
  await waitForEntrance();
  await page.waitForTimeout(50);
  await expect(
    page.getByRole('textbox', { name: 'Other input' })
  ).toBeFocused();
  expect(await snapshot()).toEqual(before);

  // Switching with no entrance animation follows the same cached lifecycle.
  await page.getByRole('checkbox', { name: 'Animate display' }).uncheck();
  for (let i = 0; i < 3; i++) {
    await switchTo('B');
    await switchTo('A');
    expect(await snapshot()).toEqual(before);
  }
  await page.getByRole('textbox', { name: 'Other input' }).click();
  await page.waitForTimeout(100);
  await expect(
    page.getByRole('textbox', { name: 'Other input' })
  ).toBeFocused();
  await switchTo('B');
  await switchTo('A');

  await page.evaluate(
    (text) => window.terminalTest.copyLine(text),
    numberedLines[49]
  );
  await page.keyboard.press('Meta+c');
  await expect
    .poll(() => page.evaluate(() => window.terminalTest.copied()))
    .toBe(numberedLines[49]);
  expect(
    await page.evaluate(() => window.terminalTest.calls.inputs)
  ).not.toContain('\x03');

  // Pending keyboard input and shell ownership survive a round trip.
  await page.keyboard.type("printf 'KEYBOARD-OK\\n'");
  await switchTo('B');
  await switchTo('A');
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await snapshot()).lines)
    .toContain('KEYBOARD-OK');

  // A split CSI sequence must complete on the same parser while inactive.
  await page.evaluate(() =>
    window.terminalTest.emit('session-a', '\r\nANSI-\x1b[')
  );
  await snapshot();
  await switchTo('B');
  await page.evaluate(() =>
    window.terminalTest.emit('session-a', '32m100%\x1b[0m\r\n')
  );
  await expect
    .poll(async () => (await snapshot()).lines)
    .toContain('ANSI-100%');
  expect(await page.evaluate(() => window.terminalTest.ansiColor())).toBe(2);
  const inactive = await snapshot();
  await switchTo('A');
  expect((await snapshot()).lines).toEqual(inactive.lines);
  expect(await windowBounds()).toEqual(originalBounds);
  console.log(
    'Passed: exact numbered buffer and viewport, repeated animated/unanimated Session switches, cached parser, inactive ANSI/percentage output, focus, selection copy, pending keyboard input, PTY ownership.'
  );
} finally {
  await electron?.close();
  await vite.close();
}
