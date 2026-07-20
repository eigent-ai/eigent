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
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CheckCircle2 } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

export const InstallDependencies: React.FC = () => {
  const shouldReduceMotion = useReducedMotion();
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
    <div className="absolute inset-0 flex min-h-0 flex-row overflow-hidden px-1 pb-1 pt-10">
      <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-row gap-2 rounded-2xl bg-ds-bg-neutral-default-default p-1">
        {/* ── Left: installation progress ───────────────────── */}
        <div
          className={cn(
            'flex flex-col px-6 py-8',
            showOnboarding ? 'w-1/3' : 'w-full'
          )}
        >
          <div className="flex w-full flex-col gap-4">
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
            <AnimatePresence initial={false}>
              {installDone && !isInstalling ? (
                <motion.div
                  key="install-complete"
                  initial={{
                    opacity: 0,
                    transform: shouldReduceMotion
                      ? 'scale(1) translateY(0px)'
                      : 'scale(0.95) translateY(4px)',
                  }}
                  animate={{
                    opacity: 1,
                    transform: 'scale(1) translateY(0px)',
                  }}
                  exit={{
                    opacity: 0,
                    transform: 'scale(1) translateY(0px)',
                    transition: {
                      duration: shouldReduceMotion ? 0.16 : 0.14,
                      ease: [0.23, 1, 0.32, 1],
                    },
                  }}
                  transition={{
                    duration: shouldReduceMotion ? 0.16 : 0.22,
                    ease: [0.23, 1, 0.32, 1],
                  }}
                  style={{ transformOrigin: 'left center' }}
                  className="flex items-center gap-2 text-body-sm font-medium text-ds-text-neutral-muted-default"
                >
                  <CheckCircle2 size={15} className="text-green-500" />
                  {t('layout.install-complete')}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>

        {/* ── Right: onboarding steps (first launch only) ────── */}
        <AnimatePresence mode="popLayout">
          {showOnboarding ? (
            <motion.div
              key="onboarding-steps"
              initial={{
                opacity: 0,
                transform: shouldReduceMotion
                  ? 'translateX(0px)'
                  : 'translateX(12px)',
              }}
              animate={{ opacity: 1, transform: 'translateX(0px)' }}
              exit={{
                opacity: 0,
                transform: shouldReduceMotion
                  ? 'translateX(0px)'
                  : 'translateX(12px)',
                transition: {
                  duration: shouldReduceMotion ? 0.16 : 0.18,
                  ease: [0.23, 1, 0.32, 1],
                },
              }}
              transition={{
                duration: shouldReduceMotion ? 0.18 : 0.25,
                ease: [0.23, 1, 0.32, 1],
              }}
              className="h-full w-2/3 min-w-0 overflow-hidden"
            >
              <OnboardingSteps onComplete={handleOnboardingComplete} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
};
