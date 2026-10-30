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

export interface AppShellReadinessGateOptions {
  announceReadyProbe: () => void;
}

/**
 * Rejects lifecycle messages from a document until Electron confirms that the
 * current navigation finished loading. The probe asks a renderer that may have
 * announced readiness too early to repeat its announcement after that gate
 * opens.
 */
export class AppShellReadinessGate {
  private documentLoaded = false;
  private readonly announceReadyProbe: () => void;

  constructor({ announceReadyProbe }: AppShellReadinessGateOptions) {
    this.announceReadyProbe = announceReadyProbe;
  }

  markDocumentLoading(): void {
    this.documentLoaded = false;
  }

  markDocumentNavigationStarted(
    isMainFrame: boolean,
    isSameDocument: boolean
  ): boolean {
    // Subframe and same-document navigations do not replace the renderer that
    // owns the app-shell IPC listeners. Invalidating readiness for either one
    // strands native app commands until another full document load happens.
    if (!isMainFrame || isSameDocument) return false;
    this.markDocumentLoading();
    return true;
  }

  markDocumentLoaded(): void {
    this.documentLoaded = true;
    this.announceReadyProbe();
  }

  markDocumentLoadFailed(isMainFrame: boolean, errorCode: number): boolean {
    // Electron -3 is ERR_ABORTED/USER_CANCELLED. The current main document is
    // still usable when a provisional navigation is replaced or a subframe
    // fails, so neither event may close the app-shell readiness gate.
    if (!isMainFrame || errorCode === -3) return false;
    this.markDocumentLoading();
    return true;
  }

  canAcceptReady(): boolean {
    return this.documentLoaded;
  }
}
