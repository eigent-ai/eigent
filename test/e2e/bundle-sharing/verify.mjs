// Run: node test/e2e/bundle-sharing/verify.mjs
// BEFORE_FIX=1 records the unfixed component without asserting the new contract.
// QUICK_PROBE=1 limits the theme sweep while iterating on layout/keyboard checks.
// Uses production React, CSS, theme engine, dialog and locales; only services are stubbed.
import { _electron, chromium, expect } from '@playwright/test';
import react from '@vitejs/plugin-react';
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const out = await mkdtemp(path.join(os.tmpdir(), 'eigent-bundle-sharing-'));
const before = process.env.BEFORE_FIX === '1';
const quick = process.env.QUICK_PROBE === '1';
const fixture = path.join(root, 'test/e2e/bundle-sharing/fixtures.ts');
const html = (await readFile(path.join(root, 'index.html'), 'utf8')).replace(
  '/src/main.tsx',
  '/test/e2e/bundle-sharing/renderer.tsx'
);
const vite = await createServer({
  configFile: false,
  root,
  envDir: out,
  cacheDir: path.join(out, 'vite-cache'),
  plugins: [
    react(),
    {
      name: 'bundle-sharing-probe',
      configureServer(server) {
        server.middlewares.use('/bundle-sharing-probe', async (_req, res) => {
          res.setHeader('Content-Type', 'text/html');
          res.end(
            await server.transformIndexHtml('/bundle-sharing-probe', html)
          );
        });
      },
    },
  ],
  resolve: {
    alias: {
      '@/service/workspaceConfigurationApi': fixture,
      '@/service/workspaceBundleAuthoringApi': fixture,
      '@': path.join(root, 'src'),
    },
  },
  optimizeDeps: { entries: ['test/e2e/bundle-sharing/renderer.tsx'] },
  server: {
    host: '127.0.0.1',
    port: 0,
    fs: { allow: [root, await realpath(path.join(root, 'node_modules'))] },
  },
});
const rows = [];
let browser;
let electron;
const checkFit = async (card) => {
  // Exercise the browser's focus scrolling. Playwright's pointer auto-scroll
  // only reveals the border box, so it cannot verify a keyboard focus ring.
  await card.evaluate((el) => {
    el.blur();
    el.closest('section').parentElement.scrollTop = 0;
  });
  await card.focus();
  const geometry = await card.evaluate((el) => {
    const text = el.lastElementChild;
    const rect = el.getBoundingClientRect();
    const scroller = el
      .closest('section')
      .parentElement.getBoundingClientRect();
    return {
      width: el.clientWidth,
      scrollWidth: el.scrollWidth,
      textHeight: text.clientHeight,
      textScrollHeight: text.scrollHeight,
      left: rect.left - 4,
      right: rect.right + 4,
      top: rect.top - 4,
      bottom: rect.bottom + 4,
      clipLeft: Math.max(0, scroller.left),
      clipRight: Math.min(innerWidth, scroller.right),
      clipTop: Math.max(0, scroller.top),
      clipBottom: Math.min(innerHeight, scroller.bottom),
      margin: getComputedStyle(el).scrollMargin,
      transform: getComputedStyle(el.closest('[role="dialog"]')).transform,
      scrollTop: el.closest('section').parentElement.scrollTop,
      scrollHeight: el.closest('section').parentElement.scrollHeight,
      clientHeight: el.closest('section').parentElement.clientHeight,
    };
  });
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
  expect(geometry.textScrollHeight).toBeLessThanOrEqual(
    geometry.textHeight + 1
  );
  expect(geometry.left).toBeGreaterThanOrEqual(geometry.clipLeft);
  expect(geometry.right).toBeLessThanOrEqual(geometry.clipRight);
  expect(geometry.top).toBeGreaterThanOrEqual(geometry.clipTop);
  if (geometry.bottom > geometry.clipBottom)
    throw new Error(JSON.stringify(geometry));
};
try {
  await vite.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1000 },
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(
    `http://127.0.0.1:${vite.httpServer.address().port}/bundle-sharing-probe`
  );
  await expect(page.getByText('Preparing a secret-free review…')).toBeVisible();
  await expect(page.getByRole('button', { name: /^private/i })).toHaveCount(0);
  await page.evaluate(() => window.bundleProbe.releaseReview());
  const sharing = page
    .getByRole('heading', { name: 'Sharing', exact: true })
    .locator('..');
  const cards = sharing.getByRole('button');
  await expect(cards).toHaveCount(2);
  await expect(page.getByRole('dialog')).toHaveCSS('opacity', '1');
  await page.evaluate(() => document.fonts.ready);

  const measure = async (context) => {
    const result = await cards.evaluateAll((buttons) => {
      const rgb = (color) => color.match(/[\d.]+/g).map(Number);
      const luminance = (color) =>
        rgb(color)
          .slice(0, 3)
          .map((v) => {
            v /= 255;
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          })
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      return buttons.map((button, i) => {
        let background;
        for (let node = button; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.opacity !== '1' || style.backgroundImage !== 'none')
            throw new Error(
              'Unexpected opacity/image: contrast needs compositing'
            );
          const fill = rgb(style.backgroundColor);
          if (fill.length === 3 || fill[3] === 1)
            background ??= style.backgroundColor;
          else if (fill[3] !== 0)
            throw new Error('Unexpected translucent fill');
        }
        if (!background) throw new Error('No opaque background found');
        return {
          option: ['private', 'public'][i],
          selected: button.getAttribute('aria-pressed'),
          disabled: button.disabled,
          background,
          texts: [...button.querySelectorAll(':scope > span')].map((span) => {
            const style = getComputedStyle(span);
            if (style.opacity !== '1')
              throw new Error('Unexpected text opacity');
            const fg = luminance(style.color),
              bg = luminance(background);
            return {
              color: style.color,
              size: style.fontSize,
              ratio: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05),
            };
          }),
        };
      });
    });
    for (const row of result) {
      rows.push({ ...context, ...row });
      if (!before)
        for (const text of row.texts)
          expect(
            text.ratio,
            JSON.stringify({ ...context, ...row })
          ).toBeGreaterThanOrEqual(4.5);
    }
  };

  const themes =
    before || quick
      ? ['eigent']
      : await page.evaluate(() => window.bundleProbe.themes);
  for (const mode of ['light', 'dark']) {
    for (const theme of themes) {
      for (const contrast of before || quick ? [43] : [0, 25, 43, 75, 100]) {
        await page.evaluate(
          ({ mode, theme, contrast }) =>
            window.bundleProbe.setTheme(mode, theme, contrast),
          { mode, theme, contrast }
        );
        for (let selected = 0; selected < 2; selected++) {
          await cards.nth(selected).click();
          await page.mouse.move(0, 0);
          await measure({
            mode,
            theme,
            contrast,
            selection: selected,
            state: 'default',
          });
          for (let target = 0; target < 2; target++) {
            await cards.nth(target).hover();
            await measure({
              mode,
              theme,
              contrast,
              selection: selected,
              target,
              state: 'hover',
            });
          }
          if (!before) {
            await cards.nth(0).focus();
            await page.keyboard.press('Tab');
            await expect(cards.nth(1)).toBeFocused();
            expect(
              await cards.nth(1).evaluate((el) => el.matches(':focus-visible'))
            ).toBe(true);
            expect(
              await cards
                .nth(1)
                .evaluate((el) => getComputedStyle(el).boxShadow)
            ).not.toBe('none');
            await measure({
              mode,
              theme,
              contrast,
              selection: selected,
              state: 'focus',
            });
            await page.keyboard.press('Shift+Tab');
            await expect(cards.nth(0)).toBeFocused();
            await measure({
              mode,
              theme,
              contrast,
              selection: selected,
              state: 'focus-private',
            });
          }
        }
      }
    }
    await page.evaluate((mode) => window.bundleProbe.setTheme(mode), mode);
    await cards.nth(0).click();
    await page.screenshot({ path: path.join(out, `${mode}.png`) });
  }

  if (!before) {
    await cards.nth(0).focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(cards.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Space');
    await expect(cards.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await expect(cards.nth(1)).toHaveAttribute('aria-pressed', 'false');
    await expect(cards.nth(0).locator('svg[aria-hidden="true"]')).toHaveCount(
      1
    );
    await expect(cards.nth(1).locator('svg')).toHaveCount(0);
    await page.addScriptTag({
      path: path.join(root, 'node_modules/axe-core/axe.min.js'),
    });
    const accessibility = await page.evaluate(() =>
      window.axe.run(
        document.querySelector('button[aria-pressed]').closest('section')
      )
    );
    await writeFile(
      path.join(out, 'accessibility.json'),
      JSON.stringify(accessibility.violations, null, 2)
    );
    expect(accessibility.violations).toEqual([]);

    // Both shipped French descriptions are longer than their English versions.
    for (const mode of ['light', 'dark']) {
      await page.evaluate((mode) => window.bundleProbe.setTheme(mode), mode);
      await page.evaluate(() => window.bundleProbe.setLanguage('fr'));
      const localizedCards = page.locator('button[aria-pressed]');
      for (const [name, width, height] of [
        ['narrow', 360, 740],
        ['short', 1000, 400],
      ]) {
        await page.setViewportSize({ width, height });
        expect(await page.evaluate(() => innerWidth)).toBe(width);
        for (let selected = 0; selected < 2; selected++) {
          const card = localizedCards.nth(selected);
          await card.click();
          await checkFit(card);
        }
        await page.screenshot({
          path: path.join(out, `${mode}-fr-${name}.png`),
        });
      }
      await page.evaluate(() => window.bundleProbe.setLanguage('en'));
    }
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.emulateMedia({
      reducedMotion: 'reduce',
      forcedColors: 'active',
    });
    await cards.nth(0).click();
    await expect(cards.nth(0).locator('svg')).toBeVisible();
    await expect(cards.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Tab');
    await expect(cards.nth(1)).toBeFocused();
    await expect(cards.nth(1)).toHaveCSS('outline-style', 'solid');
    await expect(cards.nth(1)).toHaveCSS('outline-width', '2px');
    await page.keyboard.press('Shift+Tab');
    await expect(cards.nth(0)).toBeFocused();
    await expect(cards.nth(0)).toHaveCSS('outline-style', 'solid');
    await expect(cards.nth(0)).toHaveCSS('outline-width', '2px');
    await page.screenshot({ path: path.join(out, 'forced-colors.png') });
    await page.emulateMedia({ forcedColors: 'none' });

    for (let selected = 0; selected < 2; selected++) {
      if (selected) {
        await page.reload();
        await expect(
          page.getByText('Preparing a secret-free review…')
        ).toBeVisible();
        await page.evaluate(() => window.bundleProbe.releaseReview());
        await expect(page.getByRole('dialog')).toHaveCSS('opacity', '1');
      }
      await cards.nth(selected).click();
      await page
        .getByRole('switch', { name: 'Confirm secret-free review' })
        .click();
      await page.getByRole('button', { name: 'Publish version' }).click();
      await expect(
        page.getByRole('button', { name: 'Publishing…' })
      ).toBeVisible();
      for (const state of ['publishing-disabled', 'published-disabled']) {
        if (state === 'published-disabled') {
          await page.evaluate(() => window.bundleProbe.releasePublish());
          await expect(
            page.getByText('Published', { exact: true })
          ).toBeVisible();
        }
        for (const mode of ['light', 'dark']) {
          await page.evaluate(
            (mode) => window.bundleProbe.setTheme(mode),
            mode
          );
          await expect(cards.nth(0)).toBeDisabled();
          await expect(cards.nth(1)).toBeDisabled();
          await measure({
            mode,
            theme: 'eigent',
            contrast: 43,
            selection: selected,
            state,
          });
        }
      }
    }

    // Exercise actual desktop 200% page zoom, not CSS zoom or device scale.
    const env = {
      ...process.env,
      BUNDLE_PROBE_PROFILE: path.join(out, 'profile'),
      BUNDLE_PROBE_URL: page.url(),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    electron = await _electron.launch({
      args: [path.join(root, 'test/e2e/bundle-sharing/main.cjs')],
      env,
    });
    const zoomPage = await electron.firstWindow();
    await expect(
      zoomPage.getByText('Preparing a secret-free review…')
    ).toBeVisible();
    await zoomPage.evaluate(() => window.bundleProbe.releaseReview());
    await expect(zoomPage.locator('button[aria-pressed]')).toHaveCount(2);
    await expect(zoomPage.getByRole('dialog')).toHaveCSS('opacity', '1');
    await zoomPage.evaluate(() => document.fonts.ready);
    await electron.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2)
    );
    await expect.poll(() => zoomPage.evaluate(() => innerWidth)).toBe(640);
    for (const mode of ['light', 'dark']) {
      await zoomPage.evaluate(
        (mode) => window.bundleProbe.setTheme(mode),
        mode
      );
      await zoomPage.evaluate(() => window.bundleProbe.setLanguage('fr'));
      for (let selected = 0; selected < 2; selected++) {
        const card = zoomPage.locator('button[aria-pressed]').nth(selected);
        await card.click();
        await checkFit(card);
        // Native capture avoids Playwright's clip scaling at Electron page zoom.
        const png = await electron.evaluate(async ({ BrowserWindow }) =>
          (await BrowserWindow.getAllWindows()[0].webContents.capturePage())
            .toPNG()
            .toString('base64')
        );
        await writeFile(
          path.join(out, `${mode}-fr-zoom-200-${selected}.png`),
          Buffer.from(png, 'base64')
        );
      }
    }
  }
  expect(errors).toEqual([]);
  await writeFile(
    path.join(out, 'contrast.json'),
    JSON.stringify(rows, null, 2)
  );
  console.log(
    JSON.stringify(
      {
        out,
        before,
        quick,
        measurements: rows.length,
        minimum: Math.min(
          ...rows.flatMap((row) => row.texts.map((text) => text.ratio))
        ),
        defaults: rows.filter(
          (row) =>
            row.theme === 'eigent' &&
            row.contrast === 43 &&
            row.state === 'default'
        ),
      },
      null,
      2
    )
  );
} finally {
  await electron?.close();
  await browser?.close();
  await vite.close();
}
