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

import { notifyExecutionError, reportError } from '@/lib/notifyError';
import {
  acknowledgeUsageNotice,
  confirmCloudRecovery,
  reportUsageIncident,
  setUsageAccount,
  setUsageModelType,
  useUsageNoticeStore,
} from '@/store/usageNoticeStore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ error: vi.fn(), dismiss: vi.fn() }));
vi.mock('sonner', () => ({ toast: mocks }));
vi.mock('i18next', () => ({ default: { t: (key: string) => key } }));
vi.mock('@/host/createHost', () => ({ createHost: () => ({}) }));

describe('execution error notification scope', () => {
  beforeEach(() => {
    setUsageAccount(null);
    setUsageAccount('account-a');
    setUsageModelType('cloud');
    vi.clearAllMocks();
  });

  it.each(['cloud', 'custom', 'local'])(
    'preserves independent listener and background errors in %s mode after dismissal',
    (modelType) => {
      reportUsageIncident({ reason: 'credits' });
      acknowledgeUsageNotice();
      setUsageModelType(modelType);
      mocks.error.mockClear();

      notifyExecutionError('Listener authentication failed');
      notifyExecutionError('Lost connection to the task listener');
      notifyExecutionError('Background task failed', {
        description: 'Could not read the task attachment',
      });

      expect(mocks.error.mock.calls).toEqual([
        ['Listener authentication failed', undefined],
        ['Lost connection to the task listener', undefined],
        [
          'Background task failed',
          { description: 'Could not read the task attachment' },
        ],
      ]);
    }
  );

  it('shows an unrelated execution failure while a usage reminder is visible', () => {
    reportError({ code: 20 }, { executionId: 'execution-a' });
    mocks.error.mockClear();

    notifyExecutionError('Execution failed: B', undefined, 'execution-b');
    notifyExecutionError('Listener authentication failed');

    expect(mocks.error).toHaveBeenCalledTimes(2);
  });

  it('deduplicates classified repeats and summaries of the same executions', () => {
    reportError({ code: 20 }, { executionId: 'execution-a' });
    reportError({ code: 20 }, { executionId: 'execution-b' });
    acknowledgeUsageNotice();
    reportError({ reason: 'trial_daily_exhausted' });

    notifyExecutionError('Background task failed', {
      description: 'chat.notice-trial-daily',
    });
    notifyExecutionError('Execution failed: A', undefined, 'execution-a');
    notifyExecutionError('Execution failed: B', undefined, 'execution-b');

    expect(mocks.error).toHaveBeenCalledTimes(1);
  });

  it('does not carry execution suppression across accounts', () => {
    reportError({ code: 20 }, { executionId: 'execution-a' });
    setUsageAccount('account-b');
    mocks.error.mockClear();

    notifyExecutionError('Execution failed', undefined, 'execution-a');

    expect(mocks.error).toHaveBeenCalledWith('Execution failed', undefined);
  });

  it('preserves a specific or detailed error even for an execution with a usage incident', () => {
    reportError({ code: 20 }, { executionId: 'execution-a' });
    mocks.error.mockClear();

    notifyExecutionError('Connection error', undefined, 'execution-a');
    notifyExecutionError(
      'Background task failed',
      { description: 'Could not read the task attachment' },
      'execution-a'
    );

    expect(mocks.error).toHaveBeenCalledTimes(2);
  });

  it('reuses the model from the same execution when a catch repeats the service error', () => {
    reportError(
      { reason: 'managed_service_unavailable' },
      { modelId: 'model-a', executionId: 'execution-a' }
    );
    notifyExecutionError(
      'Background task failed',
      { description: 'chat.notice-service' },
      'execution-a'
    );
    confirmCloudRecovery('account-a', 'model-a');

    expect(mocks.error).toHaveBeenCalledTimes(1);
    expect(useUsageNoticeStore.getState().incidents).toEqual([]);
  });

  it('retains the remaining model execution after partial service recovery', () => {
    for (const id of ['a', 'b']) {
      reportError(
        { reason: 'managed_service_unavailable' },
        { modelId: `model-${id}`, executionId: `execution-${id}` }
      );
    }
    acknowledgeUsageNotice();
    confirmCloudRecovery('account-a', 'model-a');
    mocks.error.mockClear();

    notifyExecutionError('Execution failed: B', undefined, 'execution-b');
    notifyExecutionError('Execution failed: C', undefined, 'execution-c');

    expect(mocks.error.mock.calls).toEqual([
      ['Execution failed: C', undefined],
    ]);
  });
});
