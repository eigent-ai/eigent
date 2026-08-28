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

import { describe, expect, it, vi } from 'vitest';
import { AppShellReadinessGate } from '../../../../electron/main/appShellReadinessGate';

describe('AppShellReadinessGate', () => {
  it('rejects an early READY and probes again after did-finish-load', () => {
    const announceReadyProbe = vi.fn();
    const gate = new AppShellReadinessGate({ announceReadyProbe });

    expect(gate.canAcceptReady()).toBe(false);

    gate.markDocumentLoaded();

    expect(announceReadyProbe).toHaveBeenCalledOnce();
    expect(gate.canAcceptReady()).toBe(true);

    gate.markDocumentLoading();
    expect(gate.canAcceptReady()).toBe(false);
  });

  it.each([
    { isMainFrame: false, isSameDocument: false, label: 'subframe navigation' },
    {
      isMainFrame: true,
      isSameDocument: true,
      label: 'same-document navigation',
    },
  ])('keeps the current document ready after a $label', (navigation) => {
    const gate = new AppShellReadinessGate({
      announceReadyProbe: vi.fn(),
    });
    gate.markDocumentLoaded();

    expect(
      gate.markDocumentNavigationStarted(
        navigation.isMainFrame,
        navigation.isSameDocument
      )
    ).toBe(false);
    expect(gate.canAcceptReady()).toBe(true);
  });

  it('invalidates readiness when the main document is replaced', () => {
    const gate = new AppShellReadinessGate({
      announceReadyProbe: vi.fn(),
    });
    gate.markDocumentLoaded();

    expect(gate.markDocumentNavigationStarted(true, false)).toBe(true);
    expect(gate.canAcceptReady()).toBe(false);
  });

  it.each([
    { errorCode: -3, isMainFrame: true, label: 'cancelled main navigation' },
    { errorCode: -105, isMainFrame: false, label: 'failed subframe' },
  ])('keeps the current document ready after a $label', (failure) => {
    const gate = new AppShellReadinessGate({
      announceReadyProbe: vi.fn(),
    });
    gate.markDocumentLoaded();

    expect(
      gate.markDocumentLoadFailed(failure.isMainFrame, failure.errorCode)
    ).toBe(false);
    expect(gate.canAcceptReady()).toBe(true);
  });

  it('invalidates a non-cancelled main-frame load failure', () => {
    const gate = new AppShellReadinessGate({
      announceReadyProbe: vi.fn(),
    });
    gate.markDocumentLoaded();

    expect(gate.markDocumentLoadFailed(true, -105)).toBe(true);
    expect(gate.canAcceptReady()).toBe(false);
  });
});
