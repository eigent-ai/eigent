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
  createBrowserPreviewHandoff,
  isLocalPreviewUrl,
} from '@/lib/browserPreviewHandoff';
import { describe, expect, it, vi } from 'vitest';

describe('local browser handoff', () => {
  it('reveals the first local visit once, without focusing background research', () => {
    const open = vi.fn();
    const handoff = createBrowserPreviewHandoff('session-a', open);
    handoff.recordVisit('https://example.com');
    handoff.recordVisit('not a url');
    expect(open).not.toHaveBeenCalled();
    handoff.recordVisit('http://localhost:8080/index.html');
    handoff.completeVisit('{"result":"Navigation completed"}');
    handoff.recordVisit('http://localhost:8080/another.html');
    handoff.completeVisit('{"result":"Navigation completed"}');
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(
      'http://localhost:8080/index.html',
      'session-a'
    );
  });
  it('does not reveal replay or unowned work', () => {
    const open = vi.fn();
    const handoff = createBrowserPreviewHandoff(null, open);
    handoff.recordVisit('http://localhost:8080');
    handoff.completeVisit('{"result":"Navigation completed"}');
    expect(open).not.toHaveBeenCalled();
  });
  it('waits for a successful visit and keeps a failed first visit from consuming the reveal', () => {
    const open = vi.fn();
    const handoff = createBrowserPreviewHandoff('session-a', open);

    handoff.recordVisit('http://localhost:8080/first', 'visit-1');
    handoff.completeVisit(
      '{"result":"Error: net::ERR_CONNECTION_REFUSED"}',
      'visit-1'
    );
    expect(open).not.toHaveBeenCalled();

    handoff.recordVisit('http://localhost:8080/ready', 'visit-2');
    handoff.completeVisit('{"result":"Navigation completed"}', 'visit-2');
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith(
      'http://localhost:8080/ready',
      'session-a'
    );
  });
  it('accepts loopback addresses but not lookalike domains or other schemes', () => {
    for (const url of [
      'http://127.0.0.1:8080',
      'http://[::1]:8080',
      'http://0.0.0.0:8080',
    ])
      expect(isLocalPreviewUrl(url)).toBe(true);
    for (const url of [
      'http://localhost.example.com',
      'file:///tmp/index.html',
      'javascript:alert(1)',
    ])
      expect(isLocalPreviewUrl(url)).toBe(false);
  });
});
