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

import type { Space } from '@/store/spaceStore';
import type { TFunction } from 'i18next';

const normalizedText = (value?: string | null) =>
  (value ?? '').trim().toLowerCase();

/**
 * Static check (no i18n) for default/placeholder Project names produced by the
 * runtime or seeded by the server. Used by stores where pulling translations
 * isn't worth the dependency.
 */
export function isPlaceholderProjectName(
  name: string | null | undefined,
  projectId: string
) {
  const normalized = normalizedText(name);
  return (
    !normalized ||
    normalized === 'new project' ||
    normalized === 'new space' ||
    normalized === `project ${projectId}`.toLowerCase()
  );
}

/**
 * Static check (no i18n) for default/placeholder Space names. Mirror of
 * `isPlaceholderProjectName` for spaces — used in store-level pruning logic.
 */
export function isPlaceholderSpaceNameStatic(name?: string | null) {
  const normalized = normalizedText(name);
  return (
    !normalized || normalized === 'new space' || normalized === 'new project'
  );
}

/** A space is "legacy" if either the metadata flag or sourceType says so. */
export function isLegacySpace(space: Space): boolean {
  return space.metadata?.legacy === true || space.sourceType === 'legacy';
}

export function isPlaceholderSpaceName(
  name: string | undefined | null,
  t: TFunction
) {
  const trimmed = name?.trim();
  if (!trimmed) return true;

  return (
    trimmed === t('layout.spaces-untitled') ||
    trimmed === t('layout.spaces-new-space') ||
    trimmed === t('layout.new-project') ||
    trimmed === 'Untitled Space' ||
    trimmed === 'New Space' ||
    trimmed === 'New Project'
  );
}

/** Label for space-switch dropdown triggers and other compact space titles. */
export function getActiveSpaceTriggerLabel(
  name: string | undefined | null,
  t: TFunction,
  options?: {
    emptyLabelKey?: 'layout.spaces-select-space' | 'layout.spaces-untitled';
  }
) {
  const trimmed = name?.trim();
  if (!trimmed) {
    return t(options?.emptyLabelKey ?? 'layout.spaces-untitled');
  }
  if (isPlaceholderSpaceName(trimmed, t)) {
    return t('layout.spaces-untitled');
  }
  return trimmed;
}

/** Default name persisted when creating a blank space from the space switcher. */
export function getDefaultNewSpaceName(t: TFunction) {
  return t('layout.spaces-untitled');
}

/** Blank placeholder space with no folder bound — Context tab stays disabled until bound. */
export function isUnboundUntitledSpace(
  space: Space | null | undefined,
  t: TFunction
) {
  if (!space) return false;
  if (space.rootPath) return false;
  if (space.sourceType === 'folder') return false;
  return isPlaceholderSpaceName(space.name, t);
}

export interface ContextTabBindingLabel {
  label: string;
  tooltip?: string;
}

/** Context tab trailing chip: Unbound, Local, or Remote for the active space folder binding. */
export function getContextTabBindingLabel(
  space: Space | null | undefined,
  t: TFunction
): ContextTabBindingLabel | null {
  if (!space) return null;
  if (isUnboundUntitledSpace(space, t)) {
    return {
      label: t('layout.context-tab-unbound'),
      tooltip: t('layout.context-tab-unbound-tooltip'),
    };
  }
  if (space.sourceType === 'folder') {
    return { label: t('layout.context-tab-local') };
  }
  return { label: t('layout.context-tab-remote') };
}

/** Space list tag: Legacy, Local folder, or remote artifact storage. */
export function getSpaceKindLabel(space: Space, t: TFunction) {
  if (space.metadata?.legacy === true || space.sourceType === 'legacy') {
    return t('layout.spaces-hub-legacy-tag');
  }
  if (space.sourceType === 'folder') {
    return t('layout.spaces-hub-local-tag', { defaultValue: 'Local' });
  }
  return t('layout.spaces-hub-remote-tag', { defaultValue: 'Remote' });
}

export function getSpaceStatusLabel(
  status: Space['status'],
  t: TFunction
): string {
  switch (status) {
    case 'disconnected':
      return t('layout.home-space-status-disconnected');
    case 'archived':
      return t('layout.home-space-status-archived');
    case 'active':
    default:
      return t('layout.home-space-status-active');
  }
}
