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

import { renameSession } from '@/lib/sessionRename';
import type { ProjectRuntimeStore } from '@/store/projectRuntimeStore';
import type { useSpaceStore } from '@/store/spaceStore';
import type { Trigger } from '@/types';

/**
 * The names earlier versions gave an Automation's Session, one per app
 * language (the retired `triggers.automation-project-name` translation).
 * They are stored data now, not copy, so they stay fixed here.
 */
const GENERATED_NAME_TEMPLATES = [
  'Automation: {{name}}',
  'الأتمتة: {{name}}',
  'Automatisierung: {{name}}',
  'Automatización: {{name}}',
  'Automatisation : {{name}}',
  'Automatizzazione: {{name}}',
  'オートメーション：{{name}}',
  '자동화: {{name}}',
  'Автоматизация: {{name}}',
  '自动化：{{name}}',
  '自動化：{{name}}',
] as const;

/**
 * Whether a Session still has the name an earlier version generated for this
 * Automation. A name the person edited never matches.
 */
export function isGeneratedAutomationSessionName(
  sessionName: string | null | undefined,
  automationName: string | null | undefined
): boolean {
  const name = sessionName?.trim();
  const automation = automationName?.trim();
  if (!name || !automation) return false;
  return GENERATED_NAME_TEMPLATES.some(
    (template) => template.replace('{{name}}', automation) === name
  );
}

type SessionNameStores = {
  projectStore: Pick<ProjectRuntimeStore, 'getProjectById' | 'updateProject'>;
  spaceStore: Pick<
    ReturnType<typeof useSpaceStore.getState>,
    'getProjectMeta' | 'updateProjectMeta'
  >;
};

/**
 * Rename each Automation's Session from the old generated name
 * ("Automation: Daily report") to the Automation's own name. Only Sessions
 * linked to an Automation and still carrying the exact generated name change,
 * so this is safe to run every time the Automation list loads.
 *
 * @returns the ids of the Sessions that were renamed.
 */
export async function renameGeneratedAutomationSessions(
  automations: readonly Pick<Trigger, 'name' | 'project_id'>[],
  { projectStore, spaceStore }: SessionNameStores,
  rename: typeof renameSession = renameSession
): Promise<string[]> {
  const renamed: string[] = [];
  const seen = new Set<string>();
  for (const automation of automations) {
    const projectId = automation.project_id;
    const automationName = automation.name?.trim();
    if (!projectId || !automationName || seen.has(projectId)) continue;
    seen.add(projectId);

    const currentName =
      spaceStore.getProjectMeta(projectId)?.name ??
      projectStore.getProjectById(projectId)?.name;
    if (!isGeneratedAutomationSessionName(currentName, automationName)) {
      continue;
    }
    try {
      await rename(projectId, automationName, projectStore, spaceStore);
      renamed.push(projectId);
    } catch (error) {
      // Leave it for the next load; the old name is still a valid name.
      console.warn(
        '[automationSessionName] Failed to rename an Automation Session:',
        projectId,
        error
      );
    }
  }
  return renamed;
}
