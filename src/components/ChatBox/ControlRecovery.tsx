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

import { Button } from '@/components/ui/button';
import { DsText } from '@/components/ui/ds-text';
import {
  checkControlOperation,
  controlOperationsRevision,
  listControlOperations,
  submitControlOperation,
  subscribeControlOperations,
  type ControlOperation,
} from '@/service/controlOperations';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

export function useControlOperations() {
  useSyncExternalStore(subscribeControlOperations, controlOperationsRevision);
  return listControlOperations();
}

export function ControlRecovery({
  operation,
}: {
  operation: ControlOperation;
}) {
  useSyncExternalStore(subscribeControlOperations, controlOperationsRevision);
  const { t } = useTranslation();
  if (operation.phase === 'pending') return null;
  const resolved = operation.phase === 'resolved';
  const response = operation.receipt?.response as
    Record<string, unknown> | undefined;
  const decision = response?.decision;
  const status = operation.receipt?.status;
  const receipt =
    operation.kind === 'interaction'
      ? decision === 'approved'
        ? t(
            response?.scope === 'space'
              ? 'chat.control-approved-space-receipt'
              : response?.scope === 'run'
                ? 'chat.control-approved-run-receipt'
                : 'chat.control-approved-once-receipt'
          )
        : decision === 'rejected'
          ? t('chat.control-rejected')
          : status === 'expired'
            ? t('chat.control-recovery-expired')
            : status === 'cancelled'
              ? t('chat.control-recovery-cancelled')
              : t('chat.control-decision-saved')
      : t('chat.control-recovery-task-status', {
          status: t(`chat.control-recovery-status-${String(status)}`),
        });
  const checking = operation.phase === 'checking';
  return (
    <div className="flex flex-col gap-ds-stack-related" role="status">
      <DsText role="meta" className="text-ds-ink-muted-default">
        {resolved ? receipt : t('chat.control-outcome-unknown')}
      </DsText>
      <div className="flex flex-wrap gap-ds-control-gap">
        <Button
          variant="secondary"
          size="sm"
          disabled={checking}
          onClick={() => {
            void checkControlOperation(operation).catch(() => {});
          }}
        >
          {checking
            ? t('chat.control-checking-status')
            : t('chat.control-check-status')}
        </Button>
        {!resolved && (
          <Button
            variant="ghost"
            size="sm"
            disabled={checking || !operation.retryAllowed}
            onClick={() => {
              void submitControlOperation(operation, true).catch(() => {});
            }}
          >
            {t('chat.control-retry-same-request')}
          </Button>
        )}
      </div>
    </div>
  );
}
