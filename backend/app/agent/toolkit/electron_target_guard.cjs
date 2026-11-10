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

'use strict';

/**
 * Target-level guard for CAMEL's Playwright runtime.
 *
 * Electron exposes the main Eigent renderer and its Browser WebContentsViews
 * through one CDP endpoint. CAMEL's default keep-current behavior selects the
 * first page, which must never be trusted here. This require hook wraps the
 * exported toolkit class and rebinds its session to the exact Eigent-owned
 * marker URL before any browser action can navigate a page.
 */

const Module = require('module');
const originalLoad = Module._load;
const TARGET_PREFIX = 'about:blank#eigent-browser-toolkit=';
const PATCHED = Symbol.for('eigent.electronTargetGuard.patched');

function patchSession(session, ownedTargetUrl) {
  if (
    !session ||
    typeof ownedTargetUrl !== 'string' ||
    !ownedTargetUrl.startsWith(TARGET_PREFIX)
  ) {
    throw new Error('Invalid Eigent-owned Electron browser target');
  }

  session.__eigentOwnedTargetUrl = ownedTargetUrl;
  const prototype = Object.getPrototypeOf(session);
  if (prototype[PATCHED]) return;

  const originalEnsureBrowser = prototype.ensureBrowser;
  if (typeof originalEnsureBrowser !== 'function') {
    throw new Error('CAMEL BrowserSession.ensureBrowser is unavailable');
  }

  prototype.ensureBrowser = async function eigentEnsureOwnedBrowserTarget() {
    await originalEnsureBrowser.call(this);

    const targetUrl = this.__eigentOwnedTargetUrl;
    if (!targetUrl || this.__eigentOwnedTargetBound === true) return;

    let ownedPage = null;
    let ownedContext = null;
    const contexts = this.browser?.contexts?.() ?? [];
    for (const context of contexts) {
      const match = context
        .pages()
        .find((page) => !page.isClosed() && page.url() === targetUrl);
      if (match) {
        ownedPage = match;
        ownedContext = context;
        break;
      }
    }
    if (!ownedPage) {
      throw new Error(
        'Reserved Eigent Electron browser target is unavailable; refusing to navigate another page'
      );
    }

    // The original ensure call may have registered the first CDP page, but it
    // does not navigate it. Replace that bookkeeping before the action that
    // follows can observe or mutate any page.
    this.pages.clear();
    this.consoleLogs.clear();
    this.context = ownedContext;
    this.contextOwnedByUs = false;
    const tabId = this.generateTabId();
    this.registerNewPage(tabId, ownedPage);
    this.currentTabId = tabId;
    this.__eigentOwnedPage = ownedPage;
    this.__eigentOwnedTargetBound = true;
  };

  const originalVisitPage = prototype.visitPage;
  if (typeof originalVisitPage === 'function') {
    prototype.visitPage = async function eigentVisitOwnedPage(url) {
      if (this.__eigentOwnedTargetBound === true) {
        const ownedPage = this.__eigentOwnedPage;
        if (!ownedPage || ownedPage.isClosed()) {
          throw new Error(
            'Eigent embedded browser target was closed; refusing to create an external page'
          );
        }

        let ownedTabId = null;
        for (const [tabId, page] of this.pages.entries()) {
          if (page === ownedPage) {
            ownedTabId = tabId;
          } else {
            this.pages.delete(tabId);
            this.consoleLogs.delete(tabId);
          }
        }
        if (!ownedTabId) {
          ownedTabId = this.generateTabId();
          this.registerNewPage(ownedTabId, ownedPage);
        }
        this.currentTabId = ownedTabId;
        // CAMEL otherwise opens a new page after its first navigation. An
        // Electron-owned session must remain inside its assigned WebView.
        this.hasNavigatedBefore = false;
      }
      return originalVisitPage.call(this, url);
    };
  }

  Object.defineProperty(prototype, PATCHED, { value: true });
}

Module._load = function eigentGuardedModuleLoad(request, parent, isMain) {
  const loaded = originalLoad.call(this, request, parent, isMain);
  const OriginalToolkit = loaded?.HybridBrowserToolkit;
  if (
    typeof OriginalToolkit !== 'function' ||
    OriginalToolkit[PATCHED] === true
  ) {
    return loaded;
  }

  class EigentGuardedHybridBrowserToolkit extends OriginalToolkit {
    constructor(config = {}) {
      super(config);
      if (config.ownedTargetUrl !== undefined) {
        patchSession(this.session, config.ownedTargetUrl);
      }
    }
  }
  Object.defineProperty(EigentGuardedHybridBrowserToolkit, PATCHED, {
    value: true,
  });

  return {
    ...loaded,
    HybridBrowserToolkit: EigentGuardedHybridBrowserToolkit,
  };
};
