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

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';

import ReportBugDialog from '@/components/Dialog/ReportBugDialog';
import { useHost } from '@/host';
import { toast } from 'sonner';

vi.mock('@/host', () => ({
  useHost: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: (
    selector: (state: { email: string; user_id: number }) => unknown
  ) => selector({ email: 'test@example.com', user_id: 42 }),
}));

vi.mock('@/store/projectRuntimeStore', () => ({
  useProjectRuntimeStore: () => ({
    activeProjectId: 'project_1',
    peekActiveChatStore: () => ({
      getState: () => ({ activeTaskId: 'task_9' }),
    }),
  }),
}));

describe('ReportBugDialog', () => {
  const mockUseHost = vi.mocked(useHost);
  const mockToast = vi.mocked(toast);
  let openSpy: MockInstance;

  const mockElectronAPI = {
    exportLog: vi.fn().mockResolvedValue({ success: true }),
    exportCamelLog: vi.fn().mockResolvedValue({ success: true }),
    getDiagnosticsInfo: vi.fn().mockResolvedValue({
      version: '1.0.0',
      platform: 'darwin',
      arch: 'arm64',
    }),
    exportDiagnosticsZip: vi.fn(),
    openMailto: vi.fn().mockResolvedValue({ success: true }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    mockUseHost.mockReturnValue({ electronAPI: mockElectronAPI } as any);
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  it('skips the saved toast when diagnostics save is canceled', async () => {
    mockElectronAPI.exportDiagnosticsZip.mockResolvedValueOnce({
      success: false,
      error: '',
    });

    render(<ReportBugDialog open onOpenChange={vi.fn()} />);

    await userEvent.type(
      screen.getByLabelText('layout.report-bug-field-description'),
      'A short repro description'
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'layout.report-bug-open-github' })
    );

    await waitFor(() => {
      expect(mockElectronAPI.exportDiagnosticsZip).toHaveBeenCalledWith({
        description: 'A short repro description',
        steps: undefined,
      });
    });

    expect(mockToast.error).not.toHaveBeenCalled();
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('downloads the Eigent log on its own', async () => {
    mockElectronAPI.exportLog.mockResolvedValueOnce({
      success: true,
      savedPath: '/tmp/eigent.log',
    });

    render(<ReportBugDialog open onOpenChange={vi.fn()} />);

    await userEvent.click(
      screen.getByRole('button', { name: 'layout.support-eigent-log' })
    );

    await waitFor(() => {
      expect(mockElectronAPI.exportLog).toHaveBeenCalled();
      expect(mockToast.success).toHaveBeenCalled();
    });
    expect(mockElectronAPI.exportCamelLog).not.toHaveBeenCalled();
  });

  it('downloads the Camel log with the signed-in email', async () => {
    mockElectronAPI.exportCamelLog.mockResolvedValueOnce({
      success: true,
      savedPath: '/tmp/eigent-camel-logs.zip',
    });

    render(<ReportBugDialog open onOpenChange={vi.fn()} />);

    await userEvent.click(
      screen.getByRole('button', { name: 'layout.support-camel-log' })
    );

    await waitFor(() => {
      expect(mockElectronAPI.exportCamelLog).toHaveBeenCalledWith(
        'test@example.com',
        'task_9',
        'project_1',
        42
      );
      expect(mockToast.success).toHaveBeenCalled();
    });
    expect(mockElectronAPI.exportLog).not.toHaveBeenCalled();
  });

  it('reports when no Camel logs exist yet', async () => {
    mockElectronAPI.exportCamelLog.mockResolvedValueOnce({
      success: false,
      error: 'no log file',
    });

    render(<ReportBugDialog open onOpenChange={vi.fn()} />);

    await userEvent.click(
      screen.getByRole('button', { name: 'layout.support-camel-log' })
    );

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('stays silent when the log save dialog is canceled', async () => {
    mockElectronAPI.exportLog.mockResolvedValueOnce({
      success: false,
      error: '',
    });

    render(<ReportBugDialog open onOpenChange={vi.fn()} />);

    await userEvent.click(
      screen.getByRole('button', { name: 'layout.support-eigent-log' })
    );

    await waitFor(() => {
      expect(mockElectronAPI.exportLog).toHaveBeenCalled();
    });
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockToast.error).not.toHaveBeenCalled();
  });
});
