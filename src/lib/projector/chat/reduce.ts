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

import { adaptChatProjectionEvent } from './adapter';
import type {
  ChatProjectionInput,
  ChatProjectionNode,
  ChatProjectionState,
} from './types';

export function createChatProjectionState(
  projectId: string
): ChatProjectionState {
  return {
    projectId,
    nodes: [],
    nodeById: {},
    nodeIndexById: {},
    seenEventIds: {},
  };
}

function inputProjectId(input: ChatProjectionInput): string {
  return input.projectId;
}

function projectionIndex(state: ChatProjectionState): Record<string, number> {
  if (
    state.nodeIndexById &&
    Object.keys(state.nodeIndexById).length === state.nodes.length
  ) {
    return state.nodeIndexById;
  }
  return Object.fromEntries(state.nodes.map((node, index) => [node.id, index]));
}

function appendProjectedNode(
  nodes: ChatProjectionNode[],
  nodeById: Record<string, ChatProjectionNode>,
  nodeIndexById: Record<string, number>,
  node: ChatProjectionNode
): void {
  nodeIndexById[node.id] = nodes.length;
  nodes.push(node);
  nodeById[node.id] = node;
}

/**
 * Pure, idempotent semantic reducer. It never reads a store, performs I/O, or
 * invokes React. Duplicate event IDs preserve the existing state identity.
 */
export function reduceChatProjection(
  state: ChatProjectionState,
  input: ChatProjectionInput
): ChatProjectionState {
  if (
    inputProjectId(input) !== state.projectId ||
    state.seenEventIds[input.eventId] ||
    state.nodeById[input.eventId]
  ) {
    return state;
  }

  const projected = adaptChatProjectionEvent(input);
  const nodes = [...state.nodes];
  const nodeById = { ...state.nodeById };
  const nodeIndexById = { ...projectionIndex(state) };
  if (projected.kind === 'display' || projected.kind === 'unsupported') {
    appendProjectedNode(nodes, nodeById, nodeIndexById, projected.node);
  }

  return {
    ...state,
    nodes,
    nodeById,
    nodeIndexById,
    seenEventIds: { ...state.seenEventIds, [input.eventId]: true },
  };
}

export function projectChatEvents(
  projectId: string,
  inputs: readonly ChatProjectionInput[],
  initial?: ChatProjectionState
): ChatProjectionState {
  const state =
    initial?.projectId === projectId
      ? initial
      : createChatProjectionState(projectId);
  let nodes = state.nodes;
  let nodeById = state.nodeById;
  let nodeIndexById = projectionIndex(state);
  let seenEventIds = state.seenEventIds;
  let changed = false;

  for (const input of inputs) {
    if (
      inputProjectId(input) !== projectId ||
      seenEventIds[input.eventId] ||
      nodeById[input.eventId]
    ) {
      continue;
    }

    if (!changed) {
      nodes = [...nodes];
      nodeById = { ...nodeById };
      nodeIndexById = { ...nodeIndexById };
      seenEventIds = { ...seenEventIds };
      changed = true;
    }

    const projected = adaptChatProjectionEvent(input);
    if (projected.kind === 'display' || projected.kind === 'unsupported') {
      appendProjectedNode(nodes, nodeById, nodeIndexById, projected.node);
    }
    seenEventIds[input.eventId] = true;
  }

  return changed
    ? { ...state, nodes, nodeById, nodeIndexById, seenEventIds }
    : state;
}
