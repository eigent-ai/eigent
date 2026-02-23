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
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const SAFE_MODE_STORAGE_KEY = 'eigent_safe_mode';

export default function SettingHumanInTheLoop() {
  const { t } = useTranslation();

  // Safe Mode (user approval for high-risk operations) - disabled by default
  const [safeMode, setSafeMode] = useState(() => {
    try {
      return localStorage.getItem(SAFE_MODE_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const handleSafeModeChange = (checked: boolean) => {
    setSafeMode(checked);
    try {
      localStorage.setItem(SAFE_MODE_STORAGE_KEY, String(checked));
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="text-body-lg font-bold text-text-heading">
        {t('setting.human-in-the-loop')}
      </div>

      {/* Terminal Command Approval: Human-in-the-Loop for dangerous terminal commands */}
      <div className="flex flex-col gap-4 rounded-2xl bg-surface-secondary px-6 py-4">
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
            checked={safeMode}
            onCheckedChange={handleSafeModeChange}
            aria-label={t('setting.terminal-approval')}
          />
        </div>
      </div>
    </div>
  );
}
