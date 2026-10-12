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

import { cn } from '@/lib/utils';
import { useTriggerStore } from '@/store/triggerStore';
import Overview from './Triggers';

type TriggerPanelProps = {
  className?: string;
  selectedTriggerId: number | null;
  onSelectedTriggerIdChange: (id: number | null) => void;
  isDialogOpen: boolean;
  onDialogOpenChange: (open: boolean) => void;
};

export default function TriggerPanel({
  className,
  selectedTriggerId,
  onSelectedTriggerIdChange,
  isDialogOpen,
  onDialogOpenChange,
}: TriggerPanelProps) {
  const wsConnectionStatus = useTriggerStore(
    (state) => state.wsConnectionStatus
  );

  return (
    <div
      className={cn(
        'flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden',
        wsConnectionStatus === 'disconnected' &&
          'pointer-events-none opacity-50 grayscale',
        className
      )}
    >
      <Overview
        selectedTriggerId={selectedTriggerId}
        onSelectedTriggerIdChange={onSelectedTriggerIdChange}
        isDialogOpen={isDialogOpen}
        onDialogOpenChange={onDialogOpenChange}
      />
    </div>
  );
}
