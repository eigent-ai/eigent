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
import {
  openModelSettings,
  openPricing,
  type CreditRecoveryAction,
} from '@/lib/creditRecovery';
import { useTranslation } from 'react-i18next';

export interface CreditRecoveryActionsProps {
  action: CreditRecoveryAction;
  refreshing?: boolean;
  onRefresh: () => void;
}

/**
 * Ways out of an empty balance, shared by the toast, the composer notice, and
 * the in-task notice. Refresh stays available for a purchase made in the browser.
 */
export function CreditRecoveryActions({
  action,
  refreshing,
  onRefresh,
}: CreditRecoveryActionsProps) {
  const { t } = useTranslation();
  return (
    <>
      <Button size="sm" variant="primary" onClick={openPricing}>
        {t(
          action === 'start-trial'
            ? 'chat.notice-start-trial'
            : 'chat.notice-upgrade-plan'
        )}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={refreshing}
        onClick={onRefresh}
      >
        {t(refreshing ? 'chat.notice-refreshing' : 'chat.notice-refresh')}
      </Button>
      <Button size="sm" variant="text" onClick={openModelSettings}>
        {t('chat.notice-use-own-api-key')}
      </Button>
    </>
  );
}

/** Toast description with the same actions as the inline notices. */
export function CreditRecoveryToastBody({
  description,
  ...actions
}: CreditRecoveryActionsProps & { description: string }) {
  return (
    <div className="flex flex-col gap-ds-8">
      <span>{description}</span>
      <div className="flex flex-wrap items-center gap-ds-control-gap">
        <CreditRecoveryActions {...actions} />
      </div>
    </div>
  );
}
