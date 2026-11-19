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

import {
  AnimatedTokenNumber,
  formatSplittingElapsed,
} from '@/components/ChatBox/MessageItem/TokenUtils';
import { ClipboardList } from '@/components/ui/animate-ui/icons/clipboard-list';
import { AnimateIcon } from '@/components/ui/animate-ui/icons/icon';
import { cn } from '@/lib/utils';
import type { VanillaChatStore } from '@/store/chatStore';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useSplittingElapsedMs } from './utils';

interface StatusRowProps {
  chatStore: VanillaChatStore;
  taskId: string;
  className?: string;
}

/** Animated icon + "Splitting tasks" label + elapsed + token count. */
export function StatusRow({ chatStore, taskId, className }: StatusRowProps) {
  const { t } = useTranslation();
  const elapsedMs = useSplittingElapsedMs(chatStore, taskId);
  const tokens = useSyncExternalStore(
    (cb) => chatStore.subscribe(cb),
    () => chatStore.getState().tasks[taskId]?.tokens ?? 0,
    () => chatStore.getState().tasks[taskId]?.tokens ?? 0
  );

  return (
    <div
      className={cn('flex flex-wrap items-center gap-x-2 gap-y-1', className)}
    >
      <AnimateIcon
        animate
        loop
        className="flex h-4 w-4 shrink-0 items-center justify-center !text-ds-text-information-default-default"
      >
        <ClipboardList size={16} />
      </AnimateIcon>
      <span className="shrink-0 text-ds-text-base font-bold text-ds-text-information-default-default">
        {t('chat.splitting-tasks')}
      </span>
      <span className="shrink-0 text-ds-text-base font-normal text-ds-ink-subtle-default tabular-nums">
        {formatSplittingElapsed(elapsedMs)}
      </span>
      <span className="shrink-0 text-ds-text-base font-normal text-ds-ink-subtle-default">
        •
      </span>
      <span className="flex shrink-0 items-center gap-1 text-ds-text-base font-normal text-ds-ink-subtle-default">
        <AnimatedTokenNumber value={tokens} />
        tokens
      </span>
    </div>
  );
}
