// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  powerMonitor,
  session,
  type IpcMainInvokeEvent,
} from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { NativeMenuLocale } from '../../../src/shared/nativeMenu';
import { WindowCompositor } from './compositor';
import messages from './messages.json';
import {
  CommandDecoder,
  RECORDING_WORKER_CHUNK,
  RECORDING_WORKER_COMMAND,
  RECORDING_WORKER_REPORT,
  validateChunk,
  validCommand,
  type CaptureCommand,
} from './protocol';

interface AdapterOptions {
  window: BrowserWindow;
  port: number;
  bootstrap: string;
  workerDirectory: string;
  locale: () => NativeMenuLocale;
}

/** Main owns all media writes and credentials; the sandbox only encodes. */
export class RecordingAdapter {
  private abort = new AbortController();
  private providerToken = '';
  private generation = '';
  private worker: BrowserWindow | null = null;
  private file: fs.FileHandle | null = null;
  private nextChunk = 0;
  private bytes = 0;
  private reportSequence = 0;
  private command: CaptureCommand | null = null;
  private writing = false;
  private reportQueue: Promise<unknown> = Promise.resolve();
  private compositor: WindowCompositor | null = null;
  private disposed = false;
  private loop: Promise<void> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private spoolRoot = path.join(app.getPath('userData'), 'recording-spool');
  private granting = false;
  private leaseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private options: AdapterOptions) {
    ipcMain.handle(RECORDING_WORKER_CHUNK, (event, message) =>
      this.chunk(event, message)
    );
    ipcMain.handle(RECORDING_WORKER_REPORT, (event, message) =>
      this.report(event, message)
    );
    ipcMain.on('recording-worker-frame-ack', this.acknowledgeFrame);
    powerMonitor.on('lock-screen', this.sourceUnavailable);
    powerMonitor.on('suspend', this.sourceUnavailable);
    options.window.once('closed', this.sourceUnavailable);
    options.window.on('minimize', this.sourceUnavailable);
    options.window.webContents.on(
      'render-process-gone',
      this.sourceUnavailable
    );
    this.loop = this.connect().catch(() => this.closeWorker());
  }

  private acknowledgeFrame = (event: Electron.IpcMainEvent, id: unknown) =>
    this.compositor?.acknowledge(event, id);

  private sourceUnavailable = () => {
    void this.revoke();
  };

  private async request(
    route: string,
    body?: unknown,
    bootstrap = false,
    timeout = 10_000
  ) {
    const response = await fetch(
      `http://127.0.0.1:${this.options.port}${route}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          [bootstrap
            ? 'X-Eigent-Recording-Bootstrap'
            : 'X-Eigent-Recording-Provider']: bootstrap
            ? this.options.bootstrap
            : this.providerToken,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.any([
          this.abort.signal,
          AbortSignal.timeout(timeout),
        ]),
        redirect: 'error',
      }
    );
    if (!response.ok)
      throw new Error(`recording request failed (${response.status})`);
    return response.json();
  }

  async authorize(
    runId: string
  ): Promise<{ grant_id: string; source: string } | null> {
    if (
      this.granting ||
      !/^[a-zA-Z0-9_-]{1,256}$/.test(runId) ||
      this.options.window.isDestroyed()
    )
      return null;
    this.granting = true;
    try {
      // This native dialog is the consent boundary. A forged API grant or a
      // prompt cannot silently approve it through renderer-controlled state.
      const copy = messages[this.options.locale()];
      const result = await dialog.showMessageBox(this.options.window, {
        type: 'question',
        title: copy.title,
        message: copy.message,
        detail: copy.detail,
        buttons: [copy.cancel, copy.allow],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (result.response !== 1 || this.disposed) return null;
      if (!this.providerToken)
        throw new Error('recording provider unavailable');
      return await this.request(
        '/recording-adapter/grant',
        { run_id: runId },
        true
      );
    } finally {
      this.granting = false;
    }
  }

  async revoke() {
    if (this.worker && this.command)
      this.worker.webContents.send(RECORDING_WORKER_COMMAND, {
        ...this.command,
        action: 'stop',
        reason: 'grant_revoked',
      });
    await this.request('/recording-adapter/revoke', {}, true).catch(() => {});
  }

  private trusted(event: IpcMainInvokeEvent) {
    return Boolean(
      this.worker &&
      !this.worker.isDestroyed() &&
      event.sender === this.worker.webContents &&
      event.senderFrame === this.worker.webContents.mainFrame
    );
  }

  private async chunk(event: IpcMainInvokeEvent, message: unknown) {
    if (!this.trusted(event) || !this.file || !this.command)
      throw new Error('unauthorized recording worker');
    if (this.writing) throw new Error('recording writer busy');
    const { bytes } = validateChunk(message, this.nextChunk);
    if (Date.now() > this.command.lease_expires_at * 1000)
      throw new Error('recording lease expired');
    if (this.bytes + bytes.length > this.command.profile!.max_bytes)
      throw new Error('recording disk limit');
    const file = this.file;
    this.writing = true;
    this.nextChunk++;
    this.bytes += bytes.length;
    try {
      const stat = await fs.statfs(this.spoolRoot);
      if (stat.bavail * stat.bsize < 256 * 1024 * 1024)
        throw new Error('recording disk limit');
      await file.writeFile(bytes);
      return { accepted: true };
    } finally {
      this.writing = false;
    }
  }

  private report(event: IpcMainInvokeEvent, message: unknown) {
    const task = this.reportQueue.then(() => this.reportNow(event, message));
    this.reportQueue = task.catch(() => {});
    return task;
  }

  private async reportNow(event: IpcMainInvokeEvent, message: unknown) {
    if (
      !this.trusted(event) ||
      !this.command?.recording_id ||
      !message ||
      typeof message !== 'object'
    )
      throw new Error('unauthorized recording worker');
    const body = message as { state: string; reason?: string; media?: unknown };
    if (
      ![
        'recording',
        'finalizing',
        'completed',
        'denied',
        'failed',
        'interrupted',
      ].includes(body.state)
    )
      throw new Error('invalid recording state');
    const id = this.command.recording_id;
    const reportingWorker = this.worker;
    const sequence = this.reportSequence++;
    if (body.state === 'completed') {
      await this.file?.sync();
      await this.file?.close();
      this.file = null;
    }
    try {
      await this.request(
        `/recording-adapter/${id}/report`,
        {
          sequence,
          ...body,
        },
        false,
        body.state === 'completed' ? 65_000 : 10_000
      );
    } catch (error) {
      if (body.state === 'completed') {
        await this.request(`/recording-adapter/${id}/report`, {
          sequence: this.reportSequence++,
          state: 'failed',
          reason: 'source_ended',
        }).catch(() => {});
      }
      throw error;
    } finally {
      if (
        ['completed', 'failed', 'denied', 'interrupted'].includes(body.state)
      ) {
        // Wait until the invoke reply is sent before destroying its sender.
        setImmediate(() => {
          if (this.worker === reportingWorker) void this.closeWorker();
        });
      }
    }
  }

  private async connect() {
    await fs.mkdir(this.spoolRoot, { recursive: true, mode: 0o700 });
    // Never recover a capture grant from disk. Leftover spool files remain
    // private and are bounded by age/total bytes during registration cleanup.
    await this.cleanSpool();
    const probe = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    let formats: string[] = [];
    try {
      await probe.loadURL(
        'data:text/html,<title>Eigent recording capability check</title>'
      );
      if (
        await probe.webContents.executeJavaScript(
          'MediaRecorder.isTypeSupported("video/mp4;codecs=avc1")'
        )
      )
        formats = ['video/mp4'];
    } finally {
      probe.destroy();
    }
    while (!this.disposed) {
      try {
        const registration = await this.request(
          '/recording-adapter/register',
          { instance: randomUUID(), spool_root: this.spoolRoot, formats },
          true
        );
        this.providerToken = registration.token;
        this.generation = registration.generation;
        const response = await fetch(
          `http://127.0.0.1:${this.options.port}/recording-adapter/commands`,
          {
            headers: { 'X-Eigent-Recording-Provider': this.providerToken },
            signal: this.abort.signal,
            redirect: 'error',
          }
        );
        if (!response.ok || !response.body)
          throw new Error('recording command stream unavailable');
        const decoder = new CommandDecoder();
        const textDecoder = new TextDecoder();
        const reader = response.body.getReader();
        this.reader = reader;
        try {
          while (!this.disposed) {
            const { value, done } = await reader.read();
            if (done) break;
            for (const command of decoder.push(
              textDecoder.decode(value, { stream: true })
            )) {
              if (!validCommand(command, this.generation))
                throw new Error('invalid recording command');
              await this.apply(command);
            }
          }
        } finally {
          this.reader = null;
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      } catch {
        if (!this.disposed) await this.closeWorker();
      } finally {
        this.providerToken = '';
      }
      if (!this.disposed)
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 2000);
          this.abort.signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true }
          );
        });
    }
  }

  private async apply(command: CaptureCommand) {
    if (this.leaseTimer) clearTimeout(this.leaseTimer);
    this.leaseTimer = setTimeout(
      () => {
        void this.closeWorker();
      },
      Math.max(0, command.lease_expires_at * 1000 - Date.now())
    );
    if (command.action === 'idle') {
      if (this.worker) await this.closeWorker();
      return;
    }
    if (this.worker && this.command?.recording_id === command.recording_id) {
      this.command = command;
      this.worker.webContents.send(RECORDING_WORKER_COMMAND, command);
      return;
    }
    if (command.action !== 'start') return;
    await this.closeWorker();
    if (this.options.window.isDestroyed())
      throw new Error('owned source ended');
    const directory = path.join(this.spoolRoot, command.recording_id!);
    await fs.mkdir(directory, { mode: 0o700 });
    this.file = await fs.open(path.join(directory, 'capture.mp4'), 'wx', 0o600);
    this.nextChunk = 0;
    this.reportSequence = 0;
    this.bytes = 0;
    this.command = command;
    const captureSession = session.fromPartition(
      `recording-${command.recording_id}`
    );
    captureSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false)
    );
    const worker = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(this.options.workerDirectory, 'preload.cjs'),
        session: captureSession,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    this.worker = worker;
    worker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    worker.webContents.on('will-navigate', (event) => event.preventDefault());
    worker.webContents.on('render-process-gone', () => {
      if (this.worker === worker) void this.closeWorker();
    });
    await worker.loadFile(
      path.join(this.options.workerDirectory, 'worker.html')
    );
    this.compositor = new WindowCompositor(this.options.window, worker);
    worker.webContents.send(RECORDING_WORKER_COMMAND, command);
  }

  private async closeWorker() {
    if (this.leaseTimer) clearTimeout(this.leaseTimer);
    this.leaseTimer = null;
    this.compositor?.dispose();
    this.compositor = null;
    const worker = this.worker;
    this.worker = null;
    this.command = null;
    if (worker && !worker.isDestroyed()) worker.destroy();
    const file = this.file;
    this.file = null;
    await file?.close().catch(() => {});
  }

  private async cleanSpool() {
    const entries = await fs.readdir(this.spoolRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[a-f0-9]{32}$/.test(entry.name)) continue;
      const directory = path.join(this.spoolRoot, entry.name);
      const stat = await fs.lstat(directory);
      if (Date.now() - stat.mtimeMs > 24 * 60 * 60 * 1000)
        await fs.rm(directory, { recursive: true, force: true });
    }
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    void this.reader?.cancel().catch(() => {});
    await this.closeWorker();
    await this.loop;
    ipcMain.removeListener('recording-worker-frame-ack', this.acknowledgeFrame);
    ipcMain.removeHandler(RECORDING_WORKER_CHUNK);
    ipcMain.removeHandler(RECORDING_WORKER_REPORT);
    powerMonitor.removeListener('lock-screen', this.sourceUnavailable);
    powerMonitor.removeListener('suspend', this.sourceUnavailable);
    this.options.window.removeListener('closed', this.sourceUnavailable);
    this.options.window.removeListener('minimize', this.sourceUnavailable);
    if (!this.options.window.webContents.isDestroyed())
      this.options.window.webContents.removeListener(
        'render-process-gone',
        this.sourceUnavailable
      );
  }
}
