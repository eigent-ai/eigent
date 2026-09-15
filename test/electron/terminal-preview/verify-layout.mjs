import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect } from 'playwright/test';

const artifacts = path.resolve('test/electron/terminal-preview/.artifacts');
await mkdir(artifacts, { recursive: true });
const app = await electron.launch({
  args: [path.resolve('test/electron/terminal-preview/.build/main.cjs')],
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '',
    EIGENT_SMOKE_PROFILE: await mkdtemp(
      path.join(os.tmpdir(), 'eigent-layout-')
    ),
    EIGENT_SMOKE_URL:
      'http://127.0.0.1:18740/test/electron/terminal-preview/index.html',
  },
});
const page = await app.firstWindow();
const checks = [];
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const capture = async (name) => {
  await page.waitForTimeout(350);
  const png = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage())
      .toPNG()
      .toString('base64')
  );
  await writeFile(
    path.join(artifacts, `${name}.png`),
    Buffer.from(png, 'base64')
  );
};
try {
  await expect(
    page.getByRole('button', { name: 'Stop Terminal', exact: true })
  ).toBeVisible({ timeout: 60000 });
  const longName =
    'Local terminal with a very long descriptive name for a background development server';
  await page.evaluate(async (title) => {
    const { usePageTabStore } = await import('/src/store/pageTabStore.ts');
    usePageTabStore.setState((state) => ({
      sessionPreviewByProject: Object.fromEntries(
        Object.entries(state.sessionPreviewByProject).map(([id, slice]) => [
          id,
          {
            ...slice,
            tabs: slice.tabs.map((tab) =>
              tab.shellId ? { ...tab, title } : tab
            ),
          },
        ])
      ),
    }));
  }, longName);
  const stop = page.getByRole('button', {
    name: `Stop ${longName}`,
    exact: true,
  });
  const row = page.getByRole('button', {
    name: `${longName} Running`,
    exact: true,
  });
  await row.focus();
  await page.keyboard.press('Tab');
  await expect(stop).toBeFocused();
  await expect(stop).toBeInViewport();
  await capture('long-name-keyboard-focus');
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: `${longName} Stopped`, exact: true })
  ).toBeVisible();
  checks.push(
    'Long label truncates without hiding Stop; keyboard Tab reaches Stop and Enter stops the shell'
  );
  await page
    .getByRole('button', { name: 'Switch Session', exact: true })
    .click();
  await expect(page.locator('[data-terminal-process]')).toHaveCount(0);
  checks.push('An empty Session has no process rows');
  await page
    .getByRole('button', { name: 'Switch Session', exact: true })
    .click();
  await page.getByRole('button', { name: 'New view', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1000, 600)
  );
  await expect(page.getByText('Open a new view', { exact: true })).toHaveCount(
    0
  );
  await expect(
    page.getByRole('button', { name: /^Terminal Open/ })
  ).toBeInViewport();
  const browserRow = page.getByRole('button', { name: /^Browser Open/ });
  const backgroundBeforeHover = await browserRow.evaluate(
    (element) => getComputedStyle(element).backgroundColor
  );
  await browserRow.hover();
  await expect
    .poll(() =>
      browserRow.evaluate(
        (element) => getComputedStyle(element).backgroundColor
      )
    )
    .not.toBe(backgroundBeforeHover);
  await capture('narrow-short-chooser-hover');
  checks.push(
    'All four chooser options remain in view and Browser retains its hover treatment at a 1000 by 600 content viewport'
  );
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setContentSize(1360, 900);
    win.webContents.setZoomFactor(2);
  });
  await page.getByRole('button', { name: 'Toggle theme', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByText('Open a new view', { exact: true })).toHaveCount(
    0
  );
  await expect(
    page.getByRole('button', { name: /^Terminal Open/ })
  ).toBeInViewport();
  await capture('zoom-200-dark-chooser');
  checks.push(
    'Four chooser options remain usable at 200 percent zoom with the production dark theme'
  );
  await page.getByRole('button', { name: /^File Preview/ }).click();
  await expect(
    page.getByRole('tab', { name: 'File', exact: true })
  ).toBeVisible();
  const workspaceFilesButton = page.getByRole('button', {
    name: 'View all in your workspace files',
    exact: true,
  });
  await expect(workspaceFilesButton).toBeVisible();
  await capture('empty-file-tab-dark');
  await workspaceFilesButton.click();
  await expect(page.locator('body')).toHaveAttribute(
    'data-jumped-to-workspace-files',
    'true'
  );
  checks.push(
    'The empty File tab is singular and its action opens Workspace Files with the requested label'
  );
  expect(errors).toEqual([]);
  await writeFile(
    path.join(artifacts, 'layout-results.json'),
    JSON.stringify({ checks, errors }, null, 2)
  );
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  await app.close();
}
