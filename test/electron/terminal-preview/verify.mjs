import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect } from 'playwright/test';
const profile = await mkdtemp(
  path.join(os.tmpdir(), 'eigent-electron-terminal-')
);
const artifacts = path.resolve('test/electron/terminal-preview/.artifacts');
await mkdir(artifacts, { recursive: true });
const app = await electron.launch({
  args: [path.resolve('test/electron/terminal-preview/.build/main.cjs')],
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '',
    EIGENT_SMOKE_PROFILE: profile,
    EIGENT_SMOKE_URL:
      'http://127.0.0.1:18740/test/electron/terminal-preview/index.html',
  },
});
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => {
  errors.push(e.message);
  console.log('PAGE ERROR', e.message);
});
const checks = [];
const pass = (text) => {
  checks.push(text);
  console.log('PASS', text);
};
const screenshot = async (name) => {
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(artifacts, `${name}.png`) });
};
const readScreen = () =>
  page
    .locator('.xterm-rows')
    .evaluate((el) =>
      [...el.children].map((row) => row.textContent.trimEnd()).filter(Boolean)
    );
const shellInput = (text) =>
  page.evaluate(async (text) => {
    const { usePageTabStore, getSessionPreviewSlice } =
      await import('/src/store/pageTabStore.ts');
    const tab = getSessionPreviewSlice(usePageTabStore.getState()).tabs.find(
      (t) => t.shellId
    );
    window.electronAPI.terminalInput(tab.shellId, text);
  }, text);
const start = async (kind) => {
  const response = await fetch(`http://127.0.0.1:18741/smoke/start/${kind}`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error(await response.text());
  console.log('START', kind, await response.text());
};
const activeTab = () =>
  page.evaluate(async () => {
    const { usePageTabStore, getSessionPreviewSlice } =
      await import('/src/store/pageTabStore.ts');
    const slice = getSessionPreviewSlice(usePageTabStore.getState());
    return slice.tabs.find((t) => t.id === slice.activeTabId);
  });
try {
  await page.waitForSelector('.xterm', { timeout: 60000 });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(
    page.getByRole('button', { name: 'Stop Terminal', exact: true })
  ).toBeVisible();
  await shellInput(
    "PROMPT='smoke% '; RPROMPT=''; printf '\\033[2J\\033[H'; printf 'first line\\nliteral %%\\n'; printf 'no-newline'\r"
  );
  await expect.poll(readScreen).toContain('literal %');
  await page.waitForTimeout(500);
  await page.locator('.xterm').evaluate((el) => {
    el.dataset.retentionProof = 'same-parser';
  });
  const before = await readScreen();
  for (let i = 0; i < 5; i++) {
    await page
      .getByRole('button', { name: 'Switch Session', exact: true })
      .click();
    await expect(page.locator('.xterm')).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Switch Session', exact: true })
      .click();
    await expect(page.locator('.xterm')).toHaveAttribute(
      'data-retention-proof',
      'same-parser'
    );
  }
  await expect.poll(readScreen).toEqual(before);
  pass(
    'Five Session round trips preserve the same parsed screen, literal %, and no-newline prompt'
  );
  await page
    .getByRole('button', { name: 'Resize preview', exact: true })
    .click();
  await page.waitForTimeout(200);
  await page
    .getByRole('button', { name: 'Switch Session', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Resize preview', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Switch Session', exact: true })
    .click();
  await expect(page.locator('.xterm')).toHaveAttribute(
    'data-retention-proof',
    'same-parser'
  );
  await expect.poll(readScreen).toContain('literal %');
  await screenshot('history-after-switches');
  pass('Changing viewport width while away retains terminal parser and output');

  await start('server');
  await start('silent');
  await expect(
    page.getByRole('button', { name: /Smoke server · server.*Running/ })
  ).toBeVisible({ timeout: 15000 });
  await expect(
    page.getByRole('button', { name: /Smoke silent · silent.*Running/ })
  ).toBeVisible();
  pass(
    'A managed server and a silent terminal appear as separate Summary rows'
  );
  await page
    .getByRole('button', { name: /Smoke server · server.*Running/ })
    .click();
  await expect.poll(async () => (await activeTab())?.type).toBe('browser');
  await page.waitForFunction(() => {
    const webview = document.querySelector('webview');
    return webview && webview.getURL().includes('18742');
  });
  await expect
    .poll(async () =>
      page.evaluate(async () =>
        document
          .querySelector('webview')
          .executeJavaScript('document.body.innerText')
      )
    )
    .toContain('Managed preview server');
  await screenshot('server-preview-light');
  pass(
    'Summary server row expands the real Electron webview and loads the server'
  );
  const browserId = (await activeTab()).id;
  await page.getByRole('link', { name: 'Server link', exact: true }).click();
  await expect.poll(async () => (await activeTab())?.id).toBe(browserId);
  await page.getByRole('link', { name: 'Terminal link', exact: true }).click();
  await expect
    .poll(async () => (await activeTab())?.agentSourceId)
    .toMatch(/^process:/);
  const outputId = (await activeTab()).id;
  await page.getByRole('link', { name: 'Terminal link', exact: true }).click();
  await expect.poll(async () => (await activeTab())?.id).toBe(outputId);
  pass(
    'Chat server and terminal links select the matching preview without duplicate tabs'
  );

  await page.getByRole('button', { name: 'New view', exact: true }).click();
  await expect(page.getByText('Open a new view', { exact: true })).toHaveCount(
    0
  );
  await expect(
    page.getByText('From this session', { exact: true })
  ).toHaveCount(0);
  for (const label of ['Browser', 'File', 'Review', 'Terminal']) {
    await expect(
      page.getByRole('button', {
        name: new RegExp(`^${label} (Open|Preview|Inspect)`),
      })
    ).toHaveCount(1);
  }
  await expect(page.locator('kbd')).toHaveCount(2);
  await expect(page.locator('.lucide-chevron-right')).toHaveCount(0);
  await screenshot('four-view-chooser');
  pass(
    'New tab contains four direct view rows, inline shortcuts and no heading or chevrons'
  );

  let blockingReturned = false;
  const blockingCall = start('stream').then(() => {
    blockingReturned = true;
  });
  await expect(
    page.getByRole('button', { name: /Smoke stream · stream.*Running/ })
  ).toBeVisible();
  await page
    .getByRole('button', { name: /Smoke stream · stream.*Running/ })
    .click();
  await expect.poll(readScreen).toContain('tick-0 世界');
  await expect(
    page.getByRole('button', { name: /Smoke stream · stream.*Running/ })
  ).toBeVisible();
  expect(blockingReturned).toBe(false);
  pass(
    'Blocking command output is visible in Electron before the tool call returns'
  );
  await expect(
    page.getByRole('button', { name: /Smoke stream · stream.*Completed/ })
  ).toBeVisible({ timeout: 10000 });
  await blockingCall;
  const streamed = await readScreen();
  for (let i = 0; i < 5; i++)
    expect(streamed.filter((line) => line === `tick-${i} 世界`)).toHaveLength(
      1
    );
  pass('Final Unicode output arrives exactly once with completed status');

  await page
    .getByRole('button', { name: 'Stop Smoke server · server', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: /Smoke server · server.*Stopped/ })
  ).toBeVisible();
  await expect
    .poll(async () => {
      try {
        await fetch('http://127.0.0.1:18742/');
        return true;
      } catch {
        return false;
      }
    })
    .toBe(false);
  await expect(
    page.getByRole('button', { name: /Smoke silent · silent.*Running/ })
  ).toBeVisible();
  expect((await activeTab()).id).not.toBe(browserId);
  pass(
    'Stop terminates the selected server, closes its port, and leaves the other terminal running'
  );
  await page
    .getByRole('button', { name: /Smoke server · server.*Stopped/ })
    .click();
  await expect.poll(readScreen).toContain('http://127.0.0.1:18742/');
  pass('Stopped server output remains readable');
  await page
    .getByRole('button', { name: 'Stop Smoke silent · silent', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: /Smoke silent · silent.*Stopped/ })
  ).toBeVisible();

  await start('failure');
  await expect(
    page.getByRole('button', { name: /Smoke failure · failure.*Failed/ })
  ).toBeVisible();
  await page
    .getByRole('button', { name: /Smoke failure · failure.*Failed/ })
    .click();
  await expect.poll(readScreen).toContain('expected failure');
  pass('Nonzero exit shows failed status with retained stderr/output');

  // A server launched from the real local shell must stop with that shell.
  await page.getByRole('button', { name: /^Terminal Running$/ }).click();
  await shellInput('python3 -u -m http.server 18743 --bind 127.0.0.1 &\r');
  await expect
    .poll(async () => {
      try {
        return (await fetch('http://127.0.0.1:18743/')).ok;
      } catch {
        return false;
      }
    })
    .toBe(true);
  await page
    .getByRole('button', { name: 'Stop Terminal', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: /^Terminal Stopped$/ })
  ).toBeVisible();
  await expect
    .poll(async () => {
      try {
        await fetch('http://127.0.0.1:18743/');
        return true;
      } catch {
        return false;
      }
    })
    .toBe(false);
  await expect(page.locator('.xterm')).toHaveAttribute(
    'data-retention-proof',
    'same-parser'
  );
  await expect.poll(readScreen).toContain('literal %');
  pass(
    'Stopping a local shell terminates its background server and preserves scrollback'
  );
  await page.getByRole('button', { name: 'Toggle theme', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await screenshot('stopped-shell-dark');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page
    .getByRole('button', { name: 'Switch Session', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Switch Session', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: /^Terminal Stopped$/ })
  ).toBeVisible();
  pass(
    'Stopped shell remains stopped across Session switches; dark theme and reduced motion rendered'
  );
  expect(errors).toEqual([]);
  await writeFile(
    path.join(artifacts, 'results.json'),
    JSON.stringify({ checks, errors }, null, 2)
  );
} catch (error) {
  console.log('BODY', (await page.locator('body').innerText()).slice(0, 4000));
  await screenshot('failure');
  throw error;
} finally {
  await app.close();
}
