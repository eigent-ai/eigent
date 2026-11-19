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
  confirmQuitWithoutRenderer?: () => Promise<boolean>;
  /** False when no process exists that could be running work. */
  mayHaveRunningWork?: () => boolean;
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
  private readonly confirmQuitWithoutRenderer: () => Promise<boolean>;
  private readonly mayHaveRunningWork: () => boolean;
  private nativeConfirmationPending = false;
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
    confirmQuitWithoutRenderer = async () => false,
    mayHaveRunningWork = () => true,
    responseTimeoutMs = DEFAULT_CLOSE_RESPONSE_TIMEOUT_MS,
    setTimeoutFn = (handler, ms) => setTimeout(handler, ms),
    clearTimeoutFn = (handle) => clearTimeout(handle as NodeJS.Timeout),
    diagnostic = () => undefined,
  }: CloseCoordinatorOptions) {
    this.defaultIntent = defaultIntent;
    this.quit = quit;
    this.shouldGuard = shouldGuard;
    this.confirmQuitWithoutRenderer = confirmQuitWithoutRenderer;
    this.mayHaveRunningWork = mayHaveRunningWork;
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

  /** With nothing able to run, "could not check" would be a false warning. */
  private quitIfNoWorkCanRun(): boolean {
    if (this.appQuitInProgress || this.mayHaveRunningWork()) return false;
    this.clearResponseTimer();
    this.pendingIntent = null;
    this.pendingAcknowledged = false;
    this.appQuitInProgress = true;
    this.quit();
    return true;
  }

  private confirmNativeQuit(): void {
    if (this.nativeConfirmationPending || this.appQuitInProgress) return;
    if (this.quitIfNoWorkCanRun()) return;
    this.nativeConfirmationPending = true;
    this.clearResponseTimer();
    this.pendingIntent = null;
    this.pendingAcknowledged = false;
    void this.confirmQuitWithoutRenderer()
      .then((confirmed) => {
        if (confirmed) {
          this.appQuitInProgress = true;
          this.quit();
        }
      })
      .catch((error) => {
        this.diagnostic(
          `[WINDOW CLOSE] Native quit confirmation failed: ${String(error)}`
        );
      })
      .finally(() => {
        this.nativeConfirmationPending = false;
      });
  }

  private readonly handleResponseTimeout = () => {
    this.responseTimer = null;
    if (this.pendingIntent === 'quit-app') this.confirmNativeQuit();
    else if (this.pendingIntent)
      this.respond({ intent: this.pendingIntent, action: 'confirm' });
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
      if ((this.nextIntent ?? this.defaultIntent) === 'quit-app') {
        event.preventDefault();
        this.confirmNativeQuit();
      }
      return;
    }

    event.preventDefault();

    const intent = this.nextIntent ?? this.defaultIntent;
    if (intent === 'quit-app' && this.quitIfNoWorkCanRun()) return;
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

  private readonly handleRendererNavigation = (event: {
    isMainFrame?: boolean;
    isSameDocument?: boolean;
  }) => {
    // An embedded preview (file, PDF, diff) loading in an iframe also starts
    // loading the WebContents. Only a new main document removes the listener
    // that answers close requests; treating a preview as one silently moved
    // every later Quit to the no-renderer path.
    if (!event?.isMainFrame || event.isSameDocument) return;
    this.markRendererUnavailable('main-frame-navigation');
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
    webContents.off('did-start-navigation', this.handleRendererNavigation);
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
    webContents.on('did-start-navigation', this.handleRendererNavigation);
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
    if (pendingIntent === 'quit-app') this.confirmNativeQuit();
    this.diagnostic(
      `[WINDOW CLOSE] Renderer unavailable (${reason}); cleared intent=${pendingIntent ?? 'none'} acknowledged=${acknowledged}`
    );
  }

  request(intent: CloseIntent): void {
    if (intent === 'quit-app' && this.quitIfNoWorkCanRun()) return;
    const window = this.window;
    if (!window || window.isDestroyed()) {
      if (intent === 'quit-app') {
        this.confirmNativeQuit();
      }
      return;
    }

    if (
      (!this.shouldGuard() ||
        !this.rendererReady ||
        window.webContents.isDestroyed()) &&
      intent === 'quit-app'
    ) {
      this.confirmNativeQuit();
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
