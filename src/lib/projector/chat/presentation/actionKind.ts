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

import type { ChatActivityNode } from '../types';
import type { TimelineActionKind } from './types';

function normalizedIdentity(value: string | undefined): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function containsAny(identity: string, terms: readonly string[]): boolean {
  return terms.some((term) => identity.includes(term));
}

/**
 * Classify an invocation from projection-owned semantic and tool identity.
 * Visible titles and narration are intentionally excluded: those strings are
 * authored copy, not a UI contract.
 */
export function actionKindForActivities(
  nodes: readonly ChatActivityNode[]
): TimelineActionKind {
  if (nodes.some((node) => node.subagentInvocation === true)) {
    return 'subagent';
  }

  const semanticKinds = new Set(
    nodes.map((node) => node.semanticKind).filter(Boolean)
  );
  if (semanticKinds.has('command_execution')) return 'command';
  if (semanticKinds.has('browser_operation')) return 'browse';
  if (semanticKinds.has('plan') || semanticKinds.has('plan_operation')) {
    return 'plan';
  }
  if (semanticKinds.has('workspace_writer')) return 'write';
  if (
    semanticKinds.has('file_change') ||
    semanticKinds.has('git_conflict_resolution') ||
    semanticKinds.has('git_integration')
  ) {
    return 'edit';
  }

  const operationIdentities = nodes
    .flatMap((node) => [node.methodName, node.toolName])
    .map(normalizedIdentity)
    .filter(Boolean);
  const operationIdentity = operationIdentities.join(' ');
  const operationTokens = new Set(
    operationIdentities.flatMap((identity) => identity.split('_'))
  );
  const hasOperationToken = (terms: readonly string[]) =>
    terms.some((term) => operationTokens.has(term));
  const toolkitIdentity = nodes
    .map((node) => normalizedIdentity(node.toolkitName))
    .filter(Boolean)
    .join(' ');

  if (
    hasOperationToken(['message', 'notify']) ||
    containsAny(operationIdentity, ['send_message', 'message_to_user'])
  ) {
    return 'message';
  }
  if (hasOperationToken(['todo', 'plan'])) {
    return 'plan';
  }
  if (
    hasOperationToken(['edit', 'modify', 'replace', 'patch']) ||
    containsAny(operationIdentity, ['apply_patch', 'update_file'])
  ) {
    return 'edit';
  }
  if (
    hasOperationToken(['write', 'writer', 'save', 'draft']) ||
    containsAny(operationIdentity, ['create_file', 'workspace_writer'])
  ) {
    return 'write';
  }
  if (
    nodes.some((node) => node.activityType === 'terminal') ||
    hasOperationToken(['exec', 'execute', 'shell', 'terminal', 'command']) ||
    containsAny(operationIdentity, ['run_command'])
  ) {
    return 'command';
  }
  if (
    hasOperationToken(['search', 'query', 'research']) ||
    containsAny(operationIdentity, ['web_search', 'google_search'])
  ) {
    return 'search';
  }
  if (
    hasOperationToken(['browser', 'navigate', 'visit', 'click']) ||
    containsAny(operationIdentity, ['open_url'])
  ) {
    return 'browse';
  }
  if (
    hasOperationToken([
      'read',
      'list',
      'find',
      'glob',
      'inspect',
      'check',
      'view',
      'stat',
    ])
  ) {
    return 'inspect';
  }
  if (containsAny(toolkitIdentity, ['search'])) return 'search';
  if (containsAny(toolkitIdentity, ['terminal', 'shell', 'command'])) {
    return 'command';
  }
  if (containsAny(toolkitIdentity, ['browser'])) return 'browse';
  if (containsAny(toolkitIdentity, ['human', 'message'])) return 'message';
  if (containsAny(toolkitIdentity, ['todo', 'plan'])) return 'plan';
  return 'generic';
}
