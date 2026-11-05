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

import { share } from '@/lib/share';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('@/api/http', () => ({
  proxyFetchPost: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
  },
}));

import { proxyFetchPost } from '@/api/http';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// share
// ---------------------------------------------------------------------------
describe('share', () => {
  let clipboardWriteMock: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    vi.restoreAllMocks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Mock navigator.clipboard
    clipboardWriteMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: clipboardWriteMock },
      writable: true,
      configurable: true,
    });
  });

  it('calls proxyFetchPost with correct endpoint and task_id', async () => {
    (proxyFetchPost as any).mockResolvedValue({ share_token: 'tok-abc' });

    await share('task-123');

    expect(proxyFetchPost).toHaveBeenCalledWith('/api/v1/chat/share', {
      task_id: 'task-123',
    });
  });

  it('builds cloud share link when VITE_USE_LOCAL_PROXY is not "true"', async () => {
    (proxyFetchPost as any).mockResolvedValue({ share_token: 'tok-abc' });
    vi.stubEnv('VITE_USE_LOCAL_PROXY', 'false');

    await share('task-456');

    const writtenText = clipboardWriteMock.mock.calls[0][0] as string;
    expect(writtenText).toContain('https://www.eigent.ai/download');
    expect(writtenText).toContain('share_token=tok-abc__task-456');
  });

  it('builds local proxy share link when VITE_USE_LOCAL_PROXY is "true"', async () => {
    (proxyFetchPost as any).mockResolvedValue({ share_token: 'tok-local' });
    vi.stubEnv('VITE_USE_LOCAL_PROXY', 'true');

    await share('task-789');

    const writtenText = clipboardWriteMock.mock.calls[0][0] as string;
    expect(writtenText).toContain('eigent://callback');
    expect(writtenText).toContain('share_token=tok-local__task-789');
  });

  it('shows toast.success when clipboard write succeeds', async () => {
    (proxyFetchPost as any).mockResolvedValue({ share_token: 'tok' });
    clipboardWriteMock.mockResolvedValue(undefined);
    vi.stubEnv('VITE_USE_LOCAL_PROXY', 'false');

    await share('task-1');

    // Wait for the .then() to execute
    await vi.waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        'The share link has been copied.'
      );
    });
  });

  it('logs error when clipboard write fails', async () => {
    (proxyFetchPost as any).mockResolvedValue({ share_token: 'tok' });
    const clipError = new Error('Clipboard denied');
    clipboardWriteMock.mockRejectedValue(clipError);
    vi.stubEnv('VITE_USE_LOCAL_PROXY', 'false');

    await share('task-1');

    // Wait for the .catch() to execute
    await vi.waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to copy:',
        clipError
      );
    });
  });

  it('logs error when proxyFetchPost throws', async () => {
    const apiError = new Error('Network error');
    (proxyFetchPost as any).mockRejectedValue(apiError);
    vi.stubEnv('VITE_USE_LOCAL_PROXY', 'false');

    // Should not throw — error is caught internally
    await share('task-fail');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to share task:',
      apiError
    );
  });

  it('does not write to clipboard when API call fails', async () => {
    (proxyFetchPost as any).mockRejectedValue(new Error('fail'));
    vi.stubEnv('VITE_USE_LOCAL_PROXY', 'false');

    await share('task-fail');

    expect(clipboardWriteMock).not.toHaveBeenCalled();
  });
});
