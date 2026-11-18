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

import { postSessionWindowMessage } from '@/lib/sessionWindows';
import { useTriggerStore, type WebSocketEvent } from '@/store/triggerStore';
import type { Trigger } from '@/types';

/** The event the execution websocket would have sent for this execution. */
export function triggerExecutionEvent(
  trigger: Trigger,
  executionId: string,
  inputData: Record<string, any> = {}
): WebSocketEvent {
  return {
    triggerId: trigger.id,
    triggerName: trigger.name,
    taskPrompt: trigger.task_prompt || '',
    executionId,
    timestamp: Date.now(),
    triggerType: trigger.trigger_type,
    projectId: trigger.project_id ?? null,
    spaceId: trigger.space_id ?? null,
    inputData,
    needsClaim: true,
  };
}

/**
 * Start an execution the user just created, without waiting for the
 * websocket. Only the window that owns background work starts runs; any other
 * window asks it to look for pending executions instead.
 */
export function startRequestedExecution(
  trigger: Trigger,
  executionId: string
): void {
  const store = useTriggerStore.getState();
  if (store.executionAdmissionAvailable) {
    store.emitWebSocketEvent(triggerExecutionEvent(trigger, executionId));
    return;
  }
  postSessionWindowMessage({ type: 'trigger-executions-requested' });
}
