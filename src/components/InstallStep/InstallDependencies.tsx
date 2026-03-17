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

import { CarouselStep } from '@/components/InstallStep/Carousel';
import { ProgressInstall } from '@/components/ui/progress-install';
import { useInstallationUI } from '@/store/installationStore';
import React from 'react';

export const InstallDependencies: React.FC = () => {
  const { progress, latestLog, isInstalling, installationState } =
    useInstallationUI();

  return (
    <div className="fixed inset-0 !z-[100] flex h-full w-full items-center justify-center overflow-hidden px-2 pb-2 pt-10">
      <div className="flex h-full w-full flex-row justify-center gap-lg rounded-2xl border-solid border-border-tertiary bg-surface-secondary p-md">
        <div className="flex h-full w-1/3 pt-6">
          {/* {isInstalling.toString()} */}
          <div className="flex w-full flex-col">
            <ProgressInstall
              value={
                isInstalling || installationState === 'waiting-backend'
                  ? progress
                  : 100
              }
              className="mb-4 w-full"
            />
            <div className="mt-2 flex w-full flex-col items-start justify-between gap-4">
              <div className="flex w-full flex-row items-start justify-between">
                <div className="text-body-sm font-medium leading-normal text-text-heading">
                  {isInstalling
                    ? 'System Installing ...'
                    : installationState === 'waiting-backend'
                      ? 'Starting up... First launch may take a minute.'
                      : ''}
                </div>
                <div className="text-body-sm font-medium leading-normal text-text-heading">
                  {Math.round(
                    (isInstalling || installationState === 'waiting-backend'
                      ? progress
                      : 100) ?? 0
                  )}
                  %
                </div>
              </div>
              <div className="w-full text-body-sm font-normal leading-normal text-text-label">
                {latestLog?.data}
              </div>
            </div>
          </div>
        </div>
        <div className="flex h-full w-2/3 rounded-2xl bg-surface-tertiary p-md">
          <CarouselStep />
        </div>
      </div>
    </div>
  );
};
