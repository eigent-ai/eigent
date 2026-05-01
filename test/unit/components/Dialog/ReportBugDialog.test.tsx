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
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('ReportBugDialog', () => {
  const mockUseHost = vi.mocked(useHost);
  const mockToast = vi.mocked(toast);

  const mockElectronAPI = {
    exportLog: vi.fn().mockResolvedValue({ success: true }),
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
    mockUseHost.mockReturnValue({ electronAPI: mockElectronAPI } as any);
  });

  it('silently stops when diagnostics save is canceled', async () => {
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
      screen.getByRole('button', { name: 'layout.report-bug-submit' })
    );

    await waitFor(() => {
      expect(mockElectronAPI.exportDiagnosticsZip).toHaveBeenCalledWith({
        description: 'A short repro description',
        steps: undefined,
      });
    });

    expect(mockElectronAPI.openMailto).not.toHaveBeenCalled();
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(mockToast.success).not.toHaveBeenCalled();
  });
});
