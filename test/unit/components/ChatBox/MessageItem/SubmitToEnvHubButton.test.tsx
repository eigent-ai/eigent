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
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchAvailability: vi.fn(),
  bundle: vi.fn(),
  upload: vi.fn(),
  fetchProvider: vi.fn(),
  execute: vi.fn(),
  openExternal: vi.fn(),
  openSettings: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    info: mocks.toastInfo,
  },
}));

vi.mock('@/service/workspaceGitApi', () => ({
  fetchRunHarborTaskAvailability: mocks.fetchAvailability,
  bundleRunHarborTask: mocks.bundle,
  uploadRunHarborTaskBundle: mocks.upload,
  saveRunHarborTask: vi.fn(),
}));

vi.mock('@/api/connectors', () => ({
  fetchConnectorProvider: mocks.fetchProvider,
  executeConnectorAction: mocks.execute,
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ email: 'user@example.com', user_id: 7 }),
}));

vi.mock('@/store/spaceStore', () => ({
  useSpaceStore: (selector: (state: unknown) => unknown) =>
    selector({
      getProjectMeta: (projectId: string) =>
        projectId === 'project-1' ? { spaceId: 'space-1' } : undefined,
    }),
}));

vi.mock('@/store/settingsStore', () => ({
  openSettings: mocks.openSettings,
}));

vi.mock('@/host', () => ({
  useHost: () => ({ electronAPI: { openExternal: mocks.openExternal } }),
}));

import { resetHarborTaskAvailabilityCache } from '@/components/ChatBox/MessageItem/SaveAsHarborTaskButton';
import {
  resetEnvHubOfferedCache,
  SubmitToEnvHubButton,
} from '@/components/ChatBox/MessageItem/SubmitToEnvHubButton';

const SUBMIT = 'Submit to Env Hub';
const MADE = {
  run_id: 'run-1',
  name: 'eigent/task-run-1',
  path: '/Downloads/eigent-harbor-tasks/task-run-1',
  notes: [],
  title: 'Build a brew calculator',
  bundle: {
    filename: 'task-run-1.env-hub.zip',
    content_type: 'application/zip',
    size_bytes: 2048,
    sha256: 'a'.repeat(64),
    conversation_turns: 2,
  },
};

function connected(configured: boolean) {
  return {
    enabled: true,
    source: 'connector_gateway',
    provider: {
      service: 'env_hub',
      connection: configured
        ? {
            service: 'env_hub',
            connectionName: 'default',
            authType: 'oauth2',
            configured: true,
            virtual: false,
            default: true,
          }
        : null,
    },
  };
}

function renderButton() {
  return render(
    <SubmitToEnvHubButton runId="run-1" projectId="project-1" completed />
  );
}

describe('SubmitToEnvHubButton', () => {
  beforeEach(() => {
    localStorage.clear();
    resetHarborTaskAvailabilityCache();
    resetEnvHubOfferedCache();
    mocks.fetchAvailability.mockResolvedValue({
      run_id: 'run-1',
      available: true,
      reason: null,
    });
    mocks.fetchProvider.mockResolvedValue(connected(true));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('stays hidden where the Connector Gateway offers no Env Hub', async () => {
    mocks.fetchProvider.mockResolvedValue({
      enabled: false,
      source: 'connector_gateway',
    });

    renderButton();

    await waitFor(() => expect(mocks.fetchProvider).toHaveBeenCalled());
    expect(screen.queryByLabelText(SUBMIT)).toBeNull();
  });

  it('asks to connect Env Hub first and opens its connector', async () => {
    mocks.fetchProvider.mockResolvedValue(connected(false));
    renderButton();

    fireEvent.click(await screen.findByLabelText(SUBMIT));

    await waitFor(() => expect(mocks.toastInfo).toHaveBeenCalled());
    expect(mocks.bundle).not.toHaveBeenCalled();
    const [title, options] = mocks.toastInfo.mock.calls[0];
    expect(title).toBe('Connect Env Hub first');
    act(() => options.action.onClick());
    expect(mocks.openSettings).toHaveBeenCalledWith('connectors', {
      connectorTarget: 'open:env_hub',
    });
  });

  it('sends nothing until the person confirms, then uploads and converts', async () => {
    mocks.bundle.mockResolvedValue(MADE);
    mocks.upload.mockResolvedValue({ run_id: 'run-1', status_code: 200 });
    mocks.execute.mockImplementation(async (action: string) => {
      if (action === 'env_hub.create_upload') {
        return {
          upload_id: 'upl_1',
          upload_url: 'https://storage.googleapis.com/b/upl_1',
          method: 'PUT',
          headers: { 'Content-Type': 'application/zip' },
        };
      }
      return { conversion_id: 'cnv_1', status: 'queued', stage: 'queued' };
    });
    renderButton();

    fireEvent.click(await screen.findByLabelText(SUBMIT));

    expect(await screen.findByText('Submit to Env Hub?')).toBeTruthy();
    expect(screen.getByText(/2\.00 KiB/)).toBeTruthy();
    expect(mocks.bundle).toHaveBeenCalledWith('run-1', 'space-1', {
      email: 'user@example.com',
      userId: 7,
    });
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        'Submitted to Env Hub',
        expect.anything()
      )
    );
    expect(mocks.execute.mock.calls.map(([action]) => action)).toEqual([
      'env_hub.create_upload',
      'env_hub.submit_conversion',
    ]);
    expect(mocks.execute.mock.calls[0][1]).toEqual({
      filename: 'task-run-1.env-hub.zip',
      contentType: 'application/zip',
      sizeBytes: 2048,
      sha256: 'a'.repeat(64),
    });
    expect(mocks.upload).toHaveBeenCalledWith('run-1', {
      upload_url: 'https://storage.googleapis.com/b/upl_1',
      method: 'PUT',
      headers: { 'Content-Type': 'application/zip' },
    });
    expect(mocks.execute.mock.calls[1][1]).toMatchObject({
      uploadId: 'upl_1',
      title: 'Build a brew calculator',
      formatVersion: '1',
      source: { app: 'eigent', taskId: 'run-1' },
    });
    expect(await screen.findByLabelText('Env Hub: Waiting')).toBeTruthy();
  });

  it('cancelling the confirmation sends nothing', async () => {
    mocks.bundle.mockResolvedValue(MADE);
    renderButton();

    fireEvent.click(await screen.findByLabelText(SUBMIT));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByText('Submit to Env Hub?')).toBeNull()
    );
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('follows a conversion until its environment is ready, then opens it', async () => {
    localStorage.setItem(
      'eigent-env-hub-submissions',
      JSON.stringify({
        'run-1': {
          conversion_id: 'cnv_1',
          status: 'running',
          stage: 'drafting',
        },
      })
    );
    mocks.execute.mockResolvedValue({
      conversion_id: 'cnv_1',
      status: 'succeeded',
      stage: 'passed',
      environment_id: 'env_1',
      environment_url: 'https://hub.example/env/env_1',
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderButton();
    expect(
      await screen.findByLabelText('Env Hub: Writing the verifier and solution')
    ).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(mocks.execute).toHaveBeenCalledWith('env_hub.get_conversion', {
      conversionId: 'cnv_1',
    });
    const open = await screen.findByLabelText(
      'Open the environment in Env Hub'
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      'Environment ready in Env Hub',
      expect.anything()
    );
    fireEvent.click(open);
    expect(mocks.openExternal).toHaveBeenCalledWith(
      'https://hub.example/env/env_1'
    );
  });

  it('shows why a submission failed and offers to submit again', async () => {
    mocks.bundle.mockResolvedValue(MADE);
    mocks.execute.mockRejectedValue(new Error("You've reached today's limit."));
    renderButton();

    fireEvent.click(await screen.findByLabelText(SUBMIT));
    fireEvent.click(await screen.findByRole('button', { name: 'Submit' }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Couldn't submit to Env Hub",
        { description: "You've reached today's limit." }
      )
    );
    expect(await screen.findByLabelText(SUBMIT)).toBeTruthy();
  });
});
