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

import type { BrowserWindow } from 'electron';
import {
  WINDOW_CLOSE_REQUEST_CHANNEL,
  type CloseIntent,
  type WindowCloseRequest,
  type WindowCloseResponse,
} from '../../src/shared/windowClose';

type CloseEvent = Parameters<Parameters<BrowserWindow['on']>[1]>[0] & {
  preventDefault(): void;
};

type CoordinatedWindow = Pick<
  BrowserWindow,
  'close' | 'isDestroyed' | 'on' | 'off' | 'webContents'
>;

export interface CloseCoordinatorOptions {
  defaultIntent: CloseIntent;
  quit: () => void;
  /** False while no renderer exists to answer a confirmation request. */
  shouldGuard?: () => boolean;
  /**
   * How long to wait for the renderer to acknowledge the request before
   * closing anyway. Once acknowledged, its visible dialog owns the pending
   * decision. Without this initial watchdog, a renderer that never replies --
   * crashed, hung, or unmounted by an error boundary -- leaves `pendingIntent`
   * set forever, and because every later request short-circuits on it the
   * window can never be closed and the app can only be force-quit.
   */
  responseTimeoutMs?: number;
  setTimeoutFn?: (handler: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
  diagnostic?: (message: string) => void;
}

export const DEFAULT_CLOSE_RESPONSE_TIMEOUT_MS = 5_000;

/**
 * Coordinates native Close Window and Quit requests with the renderer's
 * running-task confirmation. App-level cleanup remains owned by the caller.
 */
export class CloseCoordinator {
  private readonly defaultIntent: CloseIntent;
  private readonly quit: () => void;
  private readonly shouldGuard: () => boolean;
  private readonly responseTimeoutMs: number;
  private readonly setTimeoutFn: (handler: () => void, ms: number) => unknown;
  private readonly clearTimeoutFn: (handle: unknown) => void;
  private readonly diagnostic: (message: string) => void;
  private responseTimer: unknown = null;
  private window: CoordinatedWindow | null = null;
  private webContents: CoordinatedWindow['webContents'] | null = null;
  private pendingIntent: CloseIntent | null = null;
  private pendingAcknowledged = false;
  private nextIntent: CloseIntent | null = null;
  private allowNextWindowClose = false;
  private appQuitInProgress = false;
  private rendererReady = false;

  constructor({
    defaultIntent,
    quit,
    shouldGuard = () => true,
    responseTimeoutMs = DEFAULT_CLOSE_RESPONSE_TIMEOUT_MS,
    setTimeoutFn = (handler, ms) => setTimeout(handler, ms),
    clearTimeoutFn = (handle) => clearTimeout(handle as NodeJS.Timeout),
    diagnostic = () => undefined,
  }: CloseCoordinatorOptions) {
    this.defaultIntent = defaultIntent;
    this.quit = quit;
    this.shouldGuard = shouldGuard;
    this.responseTimeoutMs = responseTimeoutMs;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.diagnostic = diagnostic;
  }

  private clearResponseTimer(): void {
    if (this.responseTimer === null) return;
    this.clearTimeoutFn(this.responseTimer);
    this.responseTimer = null;
  }

  /**
   * The user asked to close; a silent renderer must not veto that. Proceed as
   * though they confirmed -- they saw no dialog either way.
   */
  private readonly handleResponseTimeout = () => {
    this.responseTimer = null;
    const intent = this.pendingIntent;
    if (!intent) return;
    this.respond({ intent, action: 'confirm' });
  };

  private sendRequest(intent: CloseIntent): void {
    const request: WindowCloseRequest = { intent };
    if (
      this.window &&
      !this.window.isDestroyed() &&
      !this.window.webContents.isDestroyed()
    ) {
      this.window.webContents.send(WINDOW_CLOSE_REQUEST_CHANNEL, request);
    }

    this.clearResponseTimer();
    if (this.responseTimeoutMs > 0) {
      this.responseTimer = this.setTimeoutFn(
        this.handleResponseTimeout,
        this.responseTimeoutMs
      );
    }
  }

  private readonly handleWindowClose = (event: CloseEvent) => {
    if (this.appQuitInProgress || this.allowNextWindowClose) {
      this.allowNextWindowClose = false;
      return;
    }
    if (
      !this.shouldGuard() ||
      !this.rendererReady ||
      !this.window ||
      this.window.webContents.isDestroyed()
    ) {
      return;
    }

    event.preventDefault();

    const intent = this.nextIntent ?? this.defaultIntent;
    if (this.pendingIntent) return;

    this.pendingIntent = intent;
    this.pendingAcknowledged = false;
    this.sendRequest(intent);
  };

  private readonly handleRendererUnresponsive = () => {
    this.markRendererUnavailable('unresponsive');
  };

  private readonly handleRendererResponsive = () => {
    this.markRendererReady('responsive');
  };

  private readonly handleRendererLoading = () => {
    this.markRendererUnavailable('did-start-loading');
  };

  private readonly handleRendererGone = () => {
    this.markRendererUnavailable('render-process-gone');
  };

  private readonly handleRendererDestroyed = () => {
    this.markRendererUnavailable('destroyed');
  };

  private unbindHealthListeners(
    window: CoordinatedWindow,
    webContents: CoordinatedWindow['webContents']
  ): void {
    if (!window.isDestroyed()) {
      window.off('unresponsive', this.handleRendererUnresponsive);
      window.off('responsive', this.handleRendererResponsive);
    }

    if (webContents.isDestroyed()) return;
    webContents.off('did-start-loading', this.handleRendererLoading);
    webContents.off('render-process-gone', this.handleRendererGone);
    webContents.off('destroyed', this.handleRendererDestroyed);
  }

  bindWindow(window: CoordinatedWindow): void {
    this.unbindWindow();
    const webContents = window.webContents;
    this.window = window;
    this.webContents = webContents;
    this.clearResponseTimer();
    this.pendingIntent = null;
    this.pendingAcknowledged = false;
    this.nextIntent = null;
    this.allowNextWindowClose = false;
    this.appQuitInProgress = false;
    // `shouldGuard` owns the app-shell handshake. This flag tracks renderer
    // health after binding and is cleared by loading/crash/unresponsive events.
    this.rendererReady = true;
    window.on('close', this.handleWindowClose);
    window.on('unresponsive', this.handleRendererUnresponsive);
    window.on('responsive', this.handleRendererResponsive);
    webContents.on('did-start-loading', this.handleRendererLoading);
    webContents.on('render-process-gone', this.handleRendererGone);
    webContents.on('destroyed', this.handleRendererDestroyed);
  }

  unbindWindow(): void {
    const window = this.window;
    const webContents = this.webContents;
    // Clear the reference before touching Electron objects so a destruction
    // event or a repeated cleanup cannot try to unbind the same window again.
    this.window = null;
    this.webContents = null;

    if (window && webContents) {
      if (!window.isDestroyed()) {
        window.off('close', this.handleWindowClose);
      }
      this.unbindHealthListeners(window, webContents);
    }
    this.clearResponseTimer();
    this.pendingIntent = null;
    this.pendingAcknowledged = false;
    this.nextIntent = null;
    this.allowNextWindowClose = false;
    this.rendererReady = false;
  }

  markRendererReady(reason = 'app-shell-ready'): void {
    this.rendererReady = true;
    this.diagnostic(`[WINDOW CLOSE] Renderer ready (${reason})`);
  }

  markRendererUnavailable(reason: string): void {
    const pendingIntent = this.pendingIntent;
    const acknowledged = this.pendingAcknowledged;
    this.rendererReady = false;
    this.clearResponseTimer();
    this.pendingIntent = null;
    this.pendingAcknowledged = false;
    this.nextIntent = null;
    this.allowNextWindowClose = false;
    this.diagnostic(
      `[WINDOW CLOSE] Renderer unavailable (${reason}); cleared intent=${pendingIntent ?? 'none'} acknowledged=${acknowledged}`
    );
  }

  request(intent: CloseIntent): void {
    const window = this.window;
    if (!window || window.isDestroyed()) {
      if (intent === 'quit-app') {
        this.appQuitInProgress = true;
        this.quit();
      }
      return;
    }

    if (
      (!this.shouldGuard() ||
        !this.rendererReady ||
        window.webContents.isDestroyed()) &&
      intent === 'quit-app'
    ) {
      this.appQuitInProgress = true;
      this.quit();
      return;
    }

    if (this.pendingIntent) {
      // Quit is stronger than Close Window. If it arrives while the close
      // confirmation is open (for example from the Dock), update that same
      // dialog rather than letting a stale Close confirmation win.
      if (intent === 'quit-app' && this.pendingIntent === 'close-window') {
        this.pendingIntent = intent;
        this.pendingAcknowledged = false;
        this.sendRequest(intent);
      }
      return;
    }
    this.nextIntent = intent;
    // The close event is the single gateway that publishes the request.
    window.close();
    this.nextIntent = null;
  }

  respond(response: WindowCloseResponse): boolean {
    if (response.intent !== this.pendingIntent) return false;

    this.clearResponseTimer();
    if (response.action === 'acknowledge') {
      // The renderer is alive and owns a visible decision UI. Keep the intent
      // pending, but do not mistake normal user deliberation for a hung
      // renderer and auto-confirm it through the watchdog.
      this.pendingAcknowledged = true;
      this.diagnostic(
        `[WINDOW CLOSE] Renderer acknowledged intent=${response.intent}`
      );
      return true;
    }

    this.pendingIntent = null;
    this.pendingAcknowledged = false;
    if (response.action === 'cancel') return true;

    if (response.intent === 'quit-app') {
      this.appQuitInProgress = true;
      this.quit();
      return true;
    }

    const window = this.window;
    if (!window || window.isDestroyed()) return false;
    this.allowNextWindowClose = true;
    window.close();
    return true;
  }

  markAppQuitInProgress(): void {
    this.appQuitInProgress = true;
    this.clearResponseTimer();
    this.pendingIntent = null;
    this.pendingAcknowledged = false;
  }

  isAppQuitInProgress(): boolean {
    return this.appQuitInProgress;
  }

  getPendingIntent(): CloseIntent | null {
    return this.pendingIntent;
  }

  isRendererReady(): boolean {
    return this.rendererReady;
  }
}
