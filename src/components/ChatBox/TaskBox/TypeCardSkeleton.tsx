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
import { Progress } from '@/components/ui/progress';
import { ChevronDown, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TaskType } from './TaskType';

export const TypeCardSkeleton = ({
  isTakeControl,
}: {
  isTakeControl: boolean;
}) => {
  const { t } = useTranslation();
  return (
    <div>
      <div className="gap-2 py-sm px-2 flex h-auto w-full flex-col transition-all duration-300">
        <div className="rounded-xl bg-task-surface py-sm relative h-auto w-full overflow-hidden backdrop-blur-[5px]">
          <div className="left-0 top-0 absolute w-full bg-transparent">
            <Progress value={100} className="h-[2px] w-full" />
          </div>
          <div className="mb-2.5 gap-sm px-sm text-sm font-bold leading-13 flex flex-col">
            <div
              className={`h-5 bg-fill-skeloten-default w-full rounded-full ${
                !isTakeControl ? 'animate-pulse' : ''
              }`}
            ></div>
            <div
              className={`h-5 bg-fill-skeloten-default w-1/2 rounded-full ${
                !isTakeControl ? 'animate-pulse' : ''
              }`}
            ></div>
            <div
              className={`h-5 bg-fill-skeloten-default w-1/2 rounded-full ${
                !isTakeControl ? 'animate-pulse' : ''
              }`}
            ></div>
          </div>

          <div className={`gap-2 px-sm flex items-center justify-between`}>
            <div className="gap-2 flex items-center">
              <TaskType type={1} />
            </div>

            <div className="ease-in-out transition-all duration-300">
              <div className="gap-2 animate-in fade-in-0 slide-in-from-right-2 flex items-center duration-300">
                <div className="text-xs font-medium leading-17 text-text-tertiary">
                  {t('layout.tasks')}
                </div>
                <Button variant="ghost" size="xs" buttonContent="icon-only">
                  <ChevronDown
                    size={16}
                    className={`rotate-180 transition-transform duration-300`}
                  />
                </Button>
              </div>
            </div>
          </div>
          <div className="relative">
            <div className="ease-in-out overflow-hidden transition-all duration-300">
              <div className="mt-sm gap-2 px-2 flex flex-col">
                {[1, 2, 3, 4].map((task: number) => {
                  return (
                    <div
                      key={`taskList-${task}`}
                      className={`gap-2 rounded-lg bg-task-fill-default px-sm py-sm ease-in-out animate-in fade-in-0 slide-in-from-left-2 flex cursor-pointer border border-solid border-transparent transition-all duration-300`}
                    >
                      <div className="pt-0.5">
                        <LoaderCircle
                          size={16}
                          className={`text-icon-success ${
                            !isTakeControl ? 'animate-spin' : ''
                          }`}
                        />
                      </div>
                      <div className="gap-sm flex flex-1 flex-col items-start justify-center">
                        <div
                          className={`h-5 bg-fill-skeloten-default text-sm font-medium leading-13 w-full rounded-full ${
                            !isTakeControl ? 'animate-pulse' : ''
                          }`}
                        ></div>
                        <div
                          className={`h-5 bg-fill-skeloten-default text-sm font-medium leading-13 w-1/3 rounded-full ${
                            !isTakeControl ? 'animate-pulse' : ''
                          }`}
                        ></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
