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

import type {
  ChatArtifactNode,
  ChatProjectionNode,
  ChatProjectionState,
  ChatRunStatusNode,
  SelectChatNodesOptions,
} from './types';

export function selectChatNodes(
  state: ChatProjectionState,
  options: SelectChatNodesOptions = {}
): ChatProjectionNode[] {
  const includeUnknown = options.includeUnknown ?? true;
  return state.nodes.filter(
    (node) =>
      (!options.runId || node.runId === options.runId) &&
      (!options.kinds || options.kinds.has(node.kind)) &&
      (includeUnknown || node.kind !== 'unknown')
  );
}

export function selectRenderableChatNodes(
  state: ChatProjectionState,
  runId?: string
): ChatProjectionNode[] {
  return selectChatNodes(state, { runId, includeUnknown: true });
}

export function selectLatestRunStatus(
  state: ChatProjectionState,
  runId: string
): ChatRunStatusNode | null {
  for (let index = state.nodes.length - 1; index >= 0; index -= 1) {
    const node = state.nodes[index];
    if (node.kind === 'run_status' && node.runId === runId) return node;
  }
  return null;
}

export function selectArtifacts(
  state: ChatProjectionState,
  runId?: string
): ChatArtifactNode[] {
  return state.nodes.filter(
    (node): node is ChatArtifactNode =>
      node.kind === 'artifact' && (!runId || node.runId === runId)
  );
}
