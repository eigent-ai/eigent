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
import { Permissions } from '@/components/InstallStep/Permissions';
import { ProgressInstall } from '@/components/ui/progress-install';
import { useAuthStore } from '@/store/authStore';
import { useInstallationUI } from '@/store/installationStore';
import React from 'react';

export const InstallDependencies: React.FC = () => {
  const { initState } = useAuthStore();

  const { progress, latestLog, isInstalling, installationState } =
    useInstallationUI();

  return (
    <div className="fixed inset-0 !z-[100] flex h-full w-full items-center justify-center bg-opacity-80 backdrop-blur-sm">
      <div className="flex h-full w-[1200px] flex-col justify-center gap-xl p-[40px]">
        <div className="relative">
          {/* {isInstalling.toString()} */}
          <div>
            <ProgressInstall
              value={
                isInstalling || installationState === 'waiting-backend'
                  ? progress
                  : 100
              }
              className="w-full"
            />
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-normal leading-tight text-text-label">
                {isInstalling
                  ? 'System Installing ...'
                  : installationState === 'waiting-backend'
                    ? 'Starting backend service...'
                    : ''}
                <span className="pl-2">{latestLog?.data}</span>
              </div>
            </div>
          </div>
        </div>
        <div>
          {initState === 'permissions' && <Permissions />}
          {initState === 'carousel' &&
            installationState !== 'waiting-backend' && <CarouselStep />}
        </div>
      </div>
    </div>
  );
};
