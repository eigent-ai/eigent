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
  captureDefaultModelSelection,
  type DefaultModelSelectionSnapshot,
} from '@/lib/defaultModelSelectionState';
import { createSyncedProjectInSpace } from '@/lib/spaceProject';
import {
  assertExecutionScope,
  createSessionMessageIntent,
  deliverSessionMessage,
  executionScope,
  prepareSessionMessage,
  SessionExecutionError,
  type SessionMessageConfiguration,
  type SessionMessageIntent,
} from '@/service/executionApi';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { waitForPendingProjectConfigurationWrites } from '@/store/projectStore';
import {
  refreshSessionExecution,
  selectManagedSession,
} from '@/store/sessionExecutionStore';

export function sessionMessageConfiguration(
  projectId: string
): SessionMessageConfiguration {
  const store = useProjectRuntimeStore.getState();
  const project = store.getProjectById(projectId);
  const selection = store.getProjectModel(projectId);
  if (!project?.spaceId || project.mode !== 'single-agent')
    throw new SessionExecutionError('single_session_required');
  if (
    selection &&
    selection.modelType !== 'custom' &&
    selection.modelType !== 'local'
  )
    throw new SessionExecutionError('model_unsupported');
  return {
    spaceId: project.spaceId,
    selection:
      selection?.provider_id != null
        ? {
            ...selection,
            modelType: selection.modelType as 'custom' | 'local',
            provider_id: selection.provider_id,
          }
        : null,
    thinkingEffort: store.getProjectThinkingEffort(projectId) ?? null,
    waitForConfigurationWrites: () =>
      waitForPendingProjectConfigurationWrites(projectId),
  };
}

/** The UI never drives the dispatcher. One gesture creates one durable intent. */
export async function submitSessionMessage(
  intent: SessionMessageIntent,
  configuration: SessionMessageConfiguration
) {
  await prepareSessionMessage(intent, configuration);
  assertExecutionScope(intent.scope);
  selectManagedSession(intent.scope);
  try {
    return await deliverSessionMessage(intent);
  } finally {
    refreshSessionExecution(intent.scope);
  }
}

export interface WorkspaceSessionDraft {
  intent: SessionMessageIntent;
  spaceId: string;
  thinkingEffort: string | null;
  created: boolean;
  defaultSelection: DefaultModelSelectionSnapshot | null;
  readonly creation: Readonly<{
    name: string;
    metadata: Readonly<Record<string, unknown>>;
  }>;
}
export function createWorkspaceSessionDraft(
  spaceId: string,
  content: string,
  thinkingEffort: string | null,
  signal?: AbortSignal
): WorkspaceSessionDraft {
  const scope = { ...executionScope(crypto.randomUUID()), signal };
  return {
    intent: createSessionMessageIntent(scope, content, 'start'),
    spaceId,
    thinkingEffort,
    created: false,
    defaultSelection: captureDefaultModelSelection(scope.accountKey),
    creation: Object.freeze({
      name: content.trim().slice(0, 120),
      metadata: Object.freeze({
        createdFrom: 'workspace_direct_chat',
        thinkingEffort,
      }),
    }),
  };
}

/** A new Send may correct an unsent message; attempted delivery is immutable. */
export function reviseWorkspaceSessionDraft(
  draft: WorkspaceSessionDraft,
  content: string,
  thinkingEffort: string | null
) {
  if (draft.intent.deliveryAttempted) {
    if (draft.intent.content !== content.trim())
      throw new SessionExecutionError('retry_original_request');
    return;
  }
  draft.intent = createSessionMessageIntent(
    draft.intent.scope,
    content,
    'start'
  );
  draft.thinkingEffort = thinkingEffort;
  draft.defaultSelection = captureDefaultModelSelection(
    draft.intent.scope.accountKey
  );
}

export async function submitWorkspaceSessionDraft(
  draft: WorkspaceSessionDraft
) {
  assertExecutionScope(draft.intent.scope);
  const projectId = draft.intent.scope.projectId;
  if (!draft.intent.deliveryAttempted && draft.defaultSelection) {
    if (!(await draft.defaultSelection.saved))
      throw new SessionExecutionError('configuration_changed');
    assertExecutionScope(draft.intent.scope);
    if (
      !['custom', 'local'].includes(draft.defaultSelection.selection.modelType)
    )
      throw new SessionExecutionError('model_unsupported');
  }
  if (!draft.created) {
    await createSyncedProjectInSpace({
      projectStore: useProjectRuntimeStore.getState(),
      projectId,
      expectedAccountKey: draft.intent.scope.accountKey,
      signal: draft.intent.scope.signal,
      spaceId: draft.spaceId,
      name: draft.creation.name,
      mode: 'single-agent',
      workdirMode: 'direct-write',
      setActive: false,
      metadata: { ...draft.creation.metadata },
    });
    draft.created = true;
  }
  const configuration =
    draft.intent.body && draft.intent.configuration
      ? draft.intent.configuration
      : {
          ...sessionMessageConfiguration(projectId),
          // The gesture owns first-message configuration, even after a lost create ACK.
          selection: null,
          defaultSelection: draft.defaultSelection,
          thinkingEffort: draft.thinkingEffort,
        };
  await submitSessionMessage(draft.intent, configuration);
  assertExecutionScope(draft.intent.scope);
  return projectId;
}
