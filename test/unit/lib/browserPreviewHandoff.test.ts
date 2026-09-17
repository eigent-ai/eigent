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
import { getSessionPreviewSlice, usePageTabStore } from '@/store/pageTabStore';
import { describe, expect, it, vi } from 'vitest';

// Match toolkit_listen's bounded SSE receipt, including an incomplete snapshot.
function toolkitReceipt(value: Record<string, unknown>): string {
  const message = JSON.stringify(value);
  return message.length > 500
    ? `${message.slice(0, 500)}... (truncated, total length: ${message.length} chars)`
    : message;
}

describe('local browser handoff', () => {
  describe.each([
    ['raw query space', 'http://localhost:8080/index.html?label=hello world'],
    [
      'encoded query space',
      'http://localhost:8080/index.html?label=hello%20world',
    ],
    ['raw path space', 'http://localhost:8080/my report.html'],
    ['encoded path space', 'http://localhost:8080/my%20report.html'],
    [
      'JSON-escaped URL with spaces',
      'http://localhost:8080/error report.html?label="hello world"&path=C:\\drafts\\report',
    ],
  ])('%s', (_name, url) => {
    it.each([
      ['current tab', 'plain text', `Navigated to ${url}`],
      ['new tab', 'plain text', `Opened ${url} in new tab`],
      ['current tab', 'full JSON', `Navigated to ${url}`],
      ['new tab', 'full JSON', `Opened ${url} in new tab`],
      ['current tab', 'truncated JSON', `Navigated to ${url}`],
      ['new tab', 'truncated JSON', `Opened ${url} in new tab`],
    ])('reveals the %s from %s once', (_tab, format, result) => {
      const open = vi.fn();
      const handoff = createBrowserPreviewHandoff('session-a', open);
      const receipt =
        format === 'plain text'
          ? result
          : toolkitReceipt({
              result,
              snapshot:
                format === 'truncated JSON'
                  ? `Error rate dashboard: ${'healthy '.repeat(100)}`
                  : 'Ready',
            });
      if (format === 'truncated JSON') {
        expect(() => JSON.parse(receipt)).toThrow();
      }
      expect(isLocalPreviewUrl(url)).toBe(true);
      handoff.recordVisit(url, 'visit-1');
      handoff.completeVisit(receipt, 'visit-1');
      expect(open).toHaveBeenCalledOnce();
      expect(open).toHaveBeenCalledWith(url, 'session-a');

      handoff.completeVisit(receipt, 'visit-1');
      handoff.recordVisit(url, 'visit-2');
      handoff.completeVisit(receipt, 'visit-2');
      expect(open).toHaveBeenCalledOnce();
    });
  });

  it.each([
    ['long snapshot', 'Navigated to http://localhost:8080/index.html'],
    ['current tab', 'Navigated to http://localhost:8080/error-dashboard'],
    ['new tab', 'Opened http://localhost:8080/failed-payments in new tab'],
    ['escaped URL', 'Navigated to http://localhost:8080/error?label="failed"'],
  ])(
    'accepts the explicit %s result with a truncated page snapshot',
    (_name, result) => {
      const open = vi.fn();
      const handoff = createBrowserPreviewHandoff('session-a', open);
      const url = 'http://localhost:8080/error-dashboard';
      const receipt = toolkitReceipt({
        result,
        snapshot: `Error rate dashboard: ${'healthy '.repeat(100)}`,
      });
      expect(() => JSON.parse(receipt)).toThrow();
      handoff.recordVisit(url, 'visit-1');
      handoff.completeVisit(receipt, 'visit-1');
      handoff.recordVisit('http://localhost:8080/another', 'visit-2');
      handoff.completeVisit(receipt, 'visit-2');
      expect(open).toHaveBeenCalledOnce();
      expect(open).toHaveBeenCalledWith(url, 'session-a');
    }
  );

  it.each([
    'Navigated to http://localhost:8080/error-dashboard',
    'Opened http://localhost:8080/failed-payments in new tab',
    '{"result": "Navigated to http://localhost:8080/error-dashboard", "snapshot": "Error rate"}',
    '{"result": "Opened http://localhost:8080/failed-payments in new tab", "snapshot": "Failure count"}',
    '{"success": true, "snapshot": "Error rate"}',
  ])('accepts an explicit successful navigation: %s', (receipt) => {
    const open = vi.fn();
    const handoff = createBrowserPreviewHandoff('session-a', open);
    handoff.recordVisit('http://localhost:8080/error-dashboard');
    handoff.completeVisit(receipt);
    expect(open).toHaveBeenCalledOnce();
  });

  it.each([
    undefined,
    '',
    'null',
    '{}',
    '[]',
    'Unknown outcome',
    '{"result": null}',
    '{"snapshot": "Navigated to http://localhost:8080"}',
    '{"result": "Navigation completed", "success": false}',
    '{"result": "Navigation completed", "error": "blocked"}',
    'Navigation to http://localhost:8080 failed: TimeoutError',
    'Navigation to http://localhost:8080/my report.html failed: TimeoutError',
    'Navigating to http://localhost:8080/my report.html',
    'Opened http://localhost:8080/my report.html',
    'Navigated to http://bad host/report.html',
    'Opened http://bad host/report.html in new tab',
    'Navigated to file:///tmp/my report.html',
    '{"result": "Error visiting page: connection closed", "snapshot": ""}',
    '{"result": "Navigated to http://localhost:8080", invalid JSON',
    toolkitReceipt({
      result: 'Navigation to http://localhost:8080 failed: connection refused',
      snapshot: `Navigated to http://localhost:8080 ${'content '.repeat(100)}`,
    }),
    toolkitReceipt({
      result:
        'Navigation to http://localhost:8080/index.html?label=hello world failed: connection refused',
      snapshot: `Navigated to http://localhost:8080 ${'content '.repeat(100)}`,
    }),
    toolkitReceipt({
      snapshot: 'content '.repeat(100),
      result: 'Navigation completed',
    }),
  ])('does not reveal failed or unconfirmed outcomes: %s', (receipt) => {
    const open = vi.fn();
    const handoff = createBrowserPreviewHandoff('session-a', open);
    handoff.recordVisit('http://localhost:8080');
    handoff.completeVisit(receipt);
    expect(open).not.toHaveBeenCalled();
  });

  it.each([
    [
      'http://localhost:8080/error-dashboard',
      'http://localhost:8080/error-dashboard',
    ],
    [
      'http://localhost:8080/my report.html?label=hello world',
      'http://localhost:8080/my%20report.html?label=hello%20world',
    ],
    [
      'http://localhost:8080/my%20report.html?label=hello%20world',
      'http://localhost:8080/my%20report.html?label=hello%20world',
    ],
  ])(
    'routes %s to its owning Session without changing selection',
    (url, previewUrl) => {
      usePageTabStore.setState({
        sessionPreviewProjectId: 'session-b',
        sessionPreviewByProject: {},
      });
      const handoff = createBrowserPreviewHandoff('session-a', (url, owner) =>
        usePageTabStore.getState().openBrowserPreview(url, owner)
      );
      handoff.recordVisit(url, 'visit-a');
      handoff.completeVisit(
        toolkitReceipt({ result: `Navigated to ${url}` }),
        'unrelated-visit'
      );
      expect(usePageTabStore.getState().sessionPreviewByProject).toEqual({});
      handoff.completeVisit(
        toolkitReceipt({ result: `Navigated to ${url}` }),
        'visit-a'
      );
      const state = usePageTabStore.getState();
      expect(state.sessionPreviewProjectId).toBe('session-b');
      expect(getSessionPreviewSlice(state).open).toBe(false);
      expect(state.sessionPreviewByProject['session-a']).toMatchObject({
        open: true,
        tabs: [expect.objectContaining({ type: 'browser', url: previewUrl })],
      });
    }
  );

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
