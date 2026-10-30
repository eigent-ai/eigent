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

/**
 * Minimal surface of Electron's `<webview>` tag that the preview uses. Typed
 * locally (instead of importing electron types) so the renderer stays
 * host-agnostic: on the web the element never mounts and none of this runs.
 * All methods are optional — they only exist once the guest is attached.
 */
export interface PreviewWebviewElement extends HTMLElement {
  src?: string;
  loadURL?: (url: string) => Promise<void>;
  getURL?: () => string;
  getTitle?: () => string;
  isLoading?: () => boolean;
  canGoBack?: () => boolean;
  canGoForward?: () => boolean;
  goBack?: () => void;
  goForward?: () => void;
  reload?: () => void;
  stop?: () => void;
}

/**
 * Live `<webview>` elements keyed by the store's webviewId. The browser layer
 * registers elements as they mount; the preview panel's toolbar and address
 * bar drive navigation through this without owning the elements (which must
 * outlive the panel so guests keep their history).
 */
const registry = new Map<string, PreviewWebviewElement>();

export function registerPreviewWebview(
  webviewId: string,
  element: PreviewWebviewElement
): void {
  registry.set(webviewId, element);
}

export function unregisterPreviewWebview(webviewId: string): void {
  registry.delete(webviewId);
}

export function getPreviewWebview(
  webviewId: string
): PreviewWebviewElement | undefined {
  return registry.get(webviewId);
}
