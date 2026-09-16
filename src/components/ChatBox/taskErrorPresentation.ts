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

import type { ChatNoticeNode } from '@/lib/projector/chat/types';
import { classifyError, type ErrorReason } from '@/lib/usageErrors';
import { useProjectStore } from '@/store/projectStore';

/** Presentation boundary shared by every timeline, including collapsed summaries. */
export function taskErrorReason(
  node: Pick<ChatNoticeNode, 'severity' | 'content'> &
    Partial<Pick<ChatNoticeNode, 'legacyStep' | 'projectId' | 'code'>>
): ErrorReason | null {
  if (node.legacyStep === 'budget_not_enough') return 'credits';
  if (node.legacyStep === 'context_too_long') return 'context';
  if (node.severity !== 'error') return null;
  const model = node.projectId
    ? useProjectStore.getState().projects[node.projectId]?.metadata
        ?.modelSelection
    : undefined;
  return classifyError(
    { message: node.content, code: node.code },
    { modelType: model?.modelType }
  );
}
