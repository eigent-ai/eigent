import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repository = path.resolve(__dirname, '../../..');
const fixtures: string[] = [];
const sentinels = [
  'dist-electron/main/previous.js',
  'dist-electron/preload/previous.mjs',
  'dist-electron/preload/index.mjs',
  'dist-electron/another-target/keep.js',
  'dist-electron/keep.txt',
  'dist/previous.html',
  'unrelated/keep.txt',
];

afterEach(() => {
  for (const root of fixtures.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture() {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), 'eigent-electron-build-'))
  );
  fixtures.push(root);
  for (const file of ['vite.config.ts', 'package.json']) {
    cpSync(path.join(repository, file), path.join(root, file));
  }
  // Dependencies are read from this checkout; all outputs and caches live in tmp.
  const dependencies = path.join(repository, 'node_modules');
  mkdirSync(path.join(root, 'node_modules'));
  for (const entry of readdirSync(dependencies, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.bin') continue;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    symlinkSync(
      path.join(dependencies, entry.name),
      path.join(root, 'node_modules', entry.name),
      'junction'
    );
  }
  writeFileSync(
    path.join(root, 'index.html'),
    '<!doctype html><title>Build fixture</title>'
  );
  for (const file of sentinels) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), `sentinel:${file}`);
  }
  return root;
}

function runNode(root: string, source: string) {
  const script = path.join(root, 'verify.mjs');
  writeFileSync(script, source);
  try {
    return execFileSync(process.execPath, [script], {
      cwd: root,
      encoding: 'utf8',
      timeout: 25_000,
      maxBuffer: 4 * 1024 * 1024,
      stdio: 'pipe',
      env: { ...process.env, VSCODE_DEBUG: '', VITE_DEV_SERVER_URL: '' },
    });
  } catch (error) {
    const failure = error as Error & { stdout?: string };
    throw new Error(
      `${failure.message}\nChild stdout:\n${failure.stdout ?? ''}`
    );
  }
}

function expectPreserved(root: string, files = sentinels) {
  for (const file of files) {
    expect(existsSync(path.join(root, file)), file).toBe(true);
    expect(readFileSync(path.join(root, file), 'utf8')).toBe(
      `sentinel:${file}`
    );
  }
}

function copyElectronSources(root: string) {
  for (const dir of ['electron', 'src/shared', 'src/i18n/locales']) {
    cpSync(path.join(repository, dir), path.join(root, dir), {
      recursive: true,
    });
  }
}

describe('Electron build output ownership', () => {
  it.each([
    { command: 'serve', mode: 'development' },
    { command: 'serve', mode: 'test' },
    { command: 'build', mode: 'production' },
    { command: 'build', mode: 'test' },
    { command: 'serve', mode: 'production', isPreview: true },
  ])(
    'preserves existing artifacts when evaluating $command/$mode config',
    (env) => {
      const root = fixture();
      runNode(
        root,
        `
      import { loadConfigFromFile, resolveConfig } from 'vite';
      import assert from 'node:assert/strict';
      const env = ${JSON.stringify(env)};
      const listeners = process.listeners('SIGINT');
      const loaded = await loadConfigFromFile(env);
      if (!loaded) throw new Error('Config was not loaded');
      // Resolve plugin promises/hooks as well as evaluating the config factory.
      await resolveConfig({
        ...loaded.config,
        configFile: false,
        cacheDir: '.cache/vite',
      }, env.command, env.mode);
      assert.deepEqual(process.listeners('SIGINT'), listeners);
    `
      );
      expectPreserved(root);
    }
  );

  it('owns the backend shutdown handler only for the dev server lifetime', () => {
    const root = fixture();
    mkdirSync(path.join(root, 'backend/runtime'), { recursive: true });
    writeFileSync(path.join(root, 'backend/runtime/run.pid'), '12345');
    runNode(
      root,
      `
      import assert from 'node:assert/strict';
      import { EventEmitter } from 'node:events';
      import { resolveConfig } from 'vite';
      const listeners = process.listeners('SIGINT');
      const config = await resolveConfig({}, 'serve');
      const plugin = config.plugins.find(p => p.name === 'eigent-backend-shutdown');
      assert.ok(plugin);
      const configure = typeof plugin.configureServer === 'function'
        ? plugin.configureServer : plugin.configureServer.handler;
      configure({ httpServer: null });
      assert.deepEqual(process.listeners('SIGINT'), listeners);
      const httpServer = new EventEmitter();
      configure({ httpServer });
      assert.equal(process.listenerCount('SIGINT'), listeners.length + 1);
      const signals = [];
      process.kill = (...args) => signals.push(args);
      process.emit('SIGINT');
      assert.deepEqual(signals, [[12345, 'SIGINT']]);
      httpServer.emit('close');
      assert.deepEqual(process.listeners('SIGINT'), listeners);
    `
    );
    expectPreserved(root);
  });

  it('does not build Electron artifacts as part of npm test', () => {
    const root = fixture();
    // Minimal entries let the old pretest build finish, so the regression fails
    // on the deleted sentinel rather than a missing renderer/source dependency.
    for (const target of ['main', 'preload']) {
      const dir = path.join(root, 'electron', target);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'index.ts'), 'console.log("fixture");');
    }
    writeFileSync(
      path.join(root, 'vitest.config.ts'),
      `
      import { defineConfig } from 'vitest/config';
      export default defineConfig({
        cacheDir: '.cache/vitest',
        test: { include: ['fixture.test.ts'], maxWorkers: 1, minWorkers: 1 },
      });
    `
    );
    writeFileSync(
      path.join(root, 'fixture.test.ts'),
      `
      import { expect, test } from 'vitest';
      test('discovered fixture', () => expect(1 + 1).toBe(2));
    `
    );
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['test'], {
      shell: process.platform === 'win32',
      cwd: root,
      encoding: 'utf8',
      timeout: 25_000,
      maxBuffer: 4 * 1024 * 1024,
      stdio: 'pipe',
      env: { ...process.env, VSCODE_DEBUG: '', VITE_DEV_SERVER_URL: '' },
    });
    expectPreserved(root);
  });

  it.each([false, true])(
    'preserves artifacts during test discovery (desktop config: %s)',
    (withDesktopConfig) => {
      const root = fixture();
      writeFileSync(
        path.join(root, 'vitest.config.ts'),
        `
      import { defineConfig, mergeConfig } from 'vitest/config';
      ${withDesktopConfig ? "import desktopConfig from './vite.config';" : ''}
      const testConfig = {
        cacheDir: '.cache/vitest',
        test: { include: ['fixture.test.ts'], maxWorkers: 1, minWorkers: 1 },
      };
      export default defineConfig(${
        withDesktopConfig
          ? '(env) => mergeConfig(desktopConfig(env), testConfig)'
          : 'testConfig'
      });
    `
      );
      writeFileSync(
        path.join(root, 'fixture.test.ts'),
        `
      import { test } from 'vitest';
      test('discovered fixture', () => {});
    `
      );
      const output = execFileSync(
        process.execPath,
        [
          path.join(repository, 'node_modules/vitest/vitest.mjs'),
          'list',
          '--config',
          'vitest.config.ts',
        ],
        { cwd: root, encoding: 'utf8', stdio: 'pipe', timeout: 25_000 }
      );
      expect(output).toContain('discovered fixture');
      expectPreserved(root);
    }
  );

  it('cleans only owned outputs and emits the real main/preload entries on build', () => {
    const root = fixture();
    copyElectronSources(root);
    runNode(
      root,
      `
      import { build } from 'vite';
      await build({ cacheDir: '.cache/vite', logLevel: 'warn' });
    `
    );
    expectPreserved(root, [
      'dist-electron/another-target/keep.js',
      'dist-electron/keep.txt',
      'unrelated/keep.txt',
    ]);
    expect(existsSync(path.join(root, 'dist-electron/main/previous.js'))).toBe(
      false
    );
    expect(
      existsSync(path.join(root, 'dist-electron/preload/previous.mjs'))
    ).toBe(false);
    expect(existsSync(path.join(root, 'dist/previous.html'))).toBe(false);
    const pkg = JSON.parse(
      readFileSync(path.join(root, 'package.json'), 'utf8')
    );
    const main = path.join(root, pkg.main);
    const preload = path.join(path.dirname(main), '../preload/index.mjs');
    const mainChunks = readdirSync(path.dirname(main)).filter((file) =>
      file.endsWith('.js')
    );
    expect(
      mainChunks
        .map((file) =>
          readFileSync(path.join(path.dirname(main), file), 'utf8')
        )
        .join('\n')
    ).toContain('../preload/index.mjs');
    expect(readFileSync(preload, 'utf8')).toContain('electronAPI');
    // Parse the generated entry without importing main (which would start app services).
    execFileSync(process.execPath, ['--check', main]);
    runNode(
      root,
      `
      import assert from 'node:assert/strict';
      import { readFileSync } from 'node:fs';
      import vm from 'node:vm';
      import crypto from 'node:crypto';
      import { build } from 'esbuild';
      // Resolve all emitted main chunks without executing Electron or app services.
      await build({
        entryPoints: ['dist-electron/main/index.js'],
        bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external',
      });
      const bridges = {};
      const calls = [];
      const electron = {
        contextBridge: { exposeInMainWorld: (key, value) => bridges[key] = value },
        ipcRenderer: {
          on() {},
          invoke: async (...args) => { calls.push(args); return 'mock-capability'; },
        },
        webUtils: {},
      };
      vm.runInNewContext(readFileSync('dist-electron/preload/index.mjs', 'utf8'), {
        require: (id) => {
          if (id === 'electron') return electron;
          if (id === 'node:crypto') return crypto;
          throw new Error('Unexpected preload import: ' + id);
        },
        document: {
          readyState: 'loading',
          addEventListener() {},
          createElement: () => ({}),
        },
        window: {},
        setTimeout() {},
      });
      assert.equal(typeof bridges.ipcRenderer.invoke, 'function');
      assert.equal(await bridges.electronAPI.getLocalControlCapability(), 'mock-capability');
      assert.deepEqual(calls, [['get-local-control-capability']]);
    `
    );
  });

  it('keeps main/preload watch rebuilds independent without launching Electron', () => {
    const root = fixture();
    copyElectronSources(root);
    runNode(
      root,
      `
      import assert from 'node:assert/strict';
      import cp from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      import { EventEmitter } from 'node:events';
      import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
      import { setTimeout as delay } from 'node:timers/promises';
      import { resolveConfig } from 'vite';
      // Permit Vite's compiler subprocess, but fail if any app is launched.
      const spawn = cp.spawn;
      cp.spawn = (command, ...args) => {
        assert.match(command, /esbuild/);
        return spawn(command, ...args);
      };
      syncBuiltinESMExports();
      process.env.VSCODE_DEBUG = '1';
      process.electronApp = { send() {} }; // Mock reload IPC; no real Electron process.
      const config = await resolveConfig({ cacheDir: '.cache/vite', logLevel: 'warn' }, 'serve');
      const plugin = config.plugins.find(p => p.name === 'vite-plugin-electron' && p.apply === 'serve');
      const httpServer = new EventEmitter();
      httpServer.address = () => ({ address: '127.0.0.1', port: 0 });
      plugin.configureServer({ config, httpServer, ws: { send() {} } });
      // Exercise the actual dev build/watch hook using a mock server; no port is opened.
      httpServer.emit('listening');
      const read = file => existsSync(file) ? readFileSync(file, 'utf8') : '';
      const mainCode = () => readdirSync('dist-electron/main')
        .filter(file => file.endsWith('.js'))
        .map(file => read('dist-electron/main/' + file)).join('\\n');
      const until = async (condition, phase) => {
        const deadline = Date.now() + 15000;
        while (!condition()) {
          if (Date.now() > deadline) throw new Error('Watch build timed out: ' + phase);
          await delay(50);
        }
      };
      await until(() => existsSync('dist-electron/main/index.js') && read('dist-electron/preload/index.mjs').includes('electronAPI'), 'initial');
      assert.ok(readdirSync('dist-electron/main').some(file => file.endsWith('.map')));
      assert.ok(read('dist-electron/preload/index.mjs').includes('sourceMappingURL=data:'));
      assert.equal(existsSync('dist-electron/main/previous.js'), false);
      assert.equal(existsSync('dist-electron/preload/previous.mjs'), false);
      writeFileSync('dist-electron/preload/keep-on-main-build.txt', 'preload');
      writeFileSync('dist-electron/main/remove-on-main-build.txt', 'stale');
      appendFileSync('electron/main/index.ts', '\\nconsole.log("MAIN_WATCH_REBUILD");\\n');
      await until(() => mainCode().includes('MAIN_WATCH_REBUILD'), 'main rebuild');
      assert.equal(existsSync('dist-electron/main/remove-on-main-build.txt'), false);
      assert.equal(read('dist-electron/preload/keep-on-main-build.txt'), 'preload');
      writeFileSync('dist-electron/main/keep-on-preload-build.txt', 'main');
      appendFileSync('electron/preload/index.ts', '\\nconsole.log("PRELOAD_WATCH_REBUILD");\\n');
      await until(() => read('dist-electron/preload/index.mjs').includes('PRELOAD_WATCH_REBUILD'), 'preload rebuild');
      assert.equal(read('dist-electron/main/keep-on-preload-build.txt'), 'main');
      assert.equal(existsSync('dist-electron/preload/keep-on-main-build.txt'), false);
      // The isolated process owns all watchers; exit releases them without app startup/kill hooks.
      process.exit(0);
    `
    );
    expectPreserved(root, [
      'dist-electron/another-target/keep.js',
      'dist-electron/keep.txt',
      'dist/previous.html',
      'unrelated/keep.txt',
    ]);
  });
});
