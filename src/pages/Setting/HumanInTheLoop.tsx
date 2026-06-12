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

import { Switch } from '@/components/ui/switch';
import { TERMINAL_APPROVAL_STORAGE_KEY } from '@/types/constants';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export default function SettingHumanInTheLoop() {
  const { t } = useTranslation();

  // Terminal Command Approval - disabled by default
  const [terminalApproval, setTerminalApproval] = useState(() => {
    try {
      return localStorage.getItem(TERMINAL_APPROVAL_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const handleTerminalApprovalChange = (checked: boolean) => {
    setTerminalApproval(checked);
    try {
      localStorage.setItem(TERMINAL_APPROVAL_STORAGE_KEY, String(checked));
    } catch {
      // ignore
    }
  };

  return (
    <div className="m-auto h-auto w-full flex-1">
      {/* Header Section */}
      <div className="mx-auto flex w-full max-w-[900px] items-center justify-between px-6 pb-6 pt-8">
        <div className="flex w-full flex-row items-center justify-between gap-4">
          <div className="flex flex-col">
            <div className="text-heading-sm font-bold text-text-heading">
              {t('setting.human-in-the-loop-title')}
            </div>
          </div>
        </div>
      </div>

      {/* Content Section */}
      <div className="mb-8 flex flex-col gap-6">
        {/* Terminal Command Approval */}
        <div className="rounded-2xl bg-surface-secondary px-6 py-4">
          <div className="flex flex-row items-center justify-between gap-4">
            <div className="flex flex-1 flex-col gap-1">
              <div className="text-body-base font-bold text-text-heading">
                {t('setting.terminal-approval')}
              </div>
              <div className="text-body-sm text-text-secondary">
                {t('setting.terminal-approval-hint')}
              </div>
            </div>
            <Switch
              checked={terminalApproval}
              onCheckedChange={handleTerminalApprovalChange}
              aria-label={t('setting.terminal-approval')}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
