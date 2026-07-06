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

import { OnboardingSteps } from '@/components/InstallStep/OnboardingSteps';
import { ProgressInstall } from '@/components/ui/progress-install';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { useInstallationUI } from '@/store/installationStore';
import { CheckCircle2 } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

export const InstallDependencies: React.FC = () => {
  const { t } = useTranslation();
  const { progress, latestLog, isInstalling, installationState } =
    useInstallationUI();
  const {
    isFirstLaunch,
    onboardingCompleted,
    setOnboardingCompleted,
    setIsFirstLaunch,
  } = useAuthStore();

  // Show onboarding panel when it's first launch and user hasn't completed setup
  const showOnboarding = isFirstLaunch && !onboardingCompleted;

  const installDone =
    !isInstalling &&
    installationState !== 'waiting-backend' &&
    installationState !== 'idle';

  const displayProgress =
    isInstalling || installationState === 'waiting-backend' ? progress : 100;

  const handleOnboardingComplete = () => {
    setOnboardingCompleted(true);
    setIsFirstLaunch(false);
  };

  return (
    <div className="inset-0 min-h-0 px-1 pb-1 pt-10 absolute flex flex-row overflow-hidden">
      <div className="min-h-0 min-w-0 rounded-2xl bg-ds-bg-neutral-default-default gap-2 p-1 flex h-full w-full flex-1 flex-row">
        {/* ── Left: installation progress ───────────────────── */}
        <div
          className={cn(
            'px-6 py-8 flex flex-col transition-all duration-500',
            showOnboarding ? 'w-1/3' : 'w-full'
          )}
        >
          <div className="gap-4 flex w-full flex-col">
            <ProgressInstall value={displayProgress} className="w-full" />

            <div className="flex w-full flex-row items-start justify-between">
              <div className="text-body-sm font-medium text-ds-text-neutral-default-default">
                {isInstalling
                  ? t('layout.install-system-installing')
                  : installationState === 'waiting-backend'
                    ? t('layout.install-starting-up')
                    : installDone
                      ? t('layout.install-ready')
                      : ''}
              </div>
              <div className="text-body-sm font-medium text-ds-text-neutral-default-default">
                {Math.round(displayProgress ?? 0)}%
              </div>
            </div>

            {/* Latest log line */}
            {latestLog?.data && (
              <div className="text-body-sm font-normal leading-normal text-ds-text-neutral-muted-default">
                {latestLog.data}
              </div>
            )}

            {/* Done state */}
            {installDone && !isInstalling && (
              <div className="gap-2 text-body-sm font-medium text-ds-text-neutral-muted-default flex items-center">
                <CheckCircle2 size={15} className="text-green-500" />
                {t('layout.install-complete')}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: onboarding steps (first launch only) ────── */}
        <div
          className={cn(
            'min-w-0 overflow-hidden transition-all duration-500',
            showOnboarding ? 'w-2/3 opacity-100' : 'w-0 opacity-0'
          )}
        >
          {showOnboarding && (
            <OnboardingSteps onComplete={handleOnboardingComplete} />
          )}
        </div>
      </div>
    </div>
  );
};
