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

import { TaskLoadingIndicator } from '@web/components/dispatch/TaskLoadingIndicator';
import {
  getWebTaskElapsedMs,
  isDisplayableAgentMessage,
  shouldShowWebTaskLoading,
} from '@web/lib/webTaskMessages';
import { useEffect, useState } from 'react';

type WebTaskMessage = {
  id: string;
  role: 'user' | 'agent';
  content: string;
  step?: string;
  attaches?: File[];
};

type WebTaskMessageListProps = {
  task: {
    status: string;
    isPending?: boolean;
    taskTime: number;
    elapsed: number;
    messages: WebTaskMessage[];
  } | null;
};

export function WebTaskMessageList({ task }: WebTaskMessageListProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const showLoading = shouldShowWebTaskLoading(task);
  const elapsedMs = task ? getWebTaskElapsedMs(task, nowMs) : 0;

  useEffect(() => {
    if (!showLoading) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [showLoading]);

  if (!task) return null;

  return (
    <div className="flex w-full flex-col gap-sm">
      {task.messages.map((message) => {
        if (message.role === 'user') {
          return (
            <div key={message.id} className="px-sm py-sm">
              <div className="ml-auto max-w-[80%] whitespace-pre-wrap rounded-2xl bg-ds-bg-brand-default-default px-4 py-3 text-body-sm text-ds-text-brand-inverse-default">
                {message.content}
              </div>
            </div>
          );
        }

        if (!isDisplayableAgentMessage(message)) {
          return null;
        }

        return (
          <div key={message.id} className="px-sm py-sm">
            <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-ds-bg-neutral-default-default px-4 py-3 text-body-sm text-ds-text-neutral-default-default shadow-sm">
              {message.content}
            </div>
          </div>
        );
      })}

      {showLoading ? <TaskLoadingIndicator elapsedMs={elapsedMs} /> : null}
    </div>
  );
}
