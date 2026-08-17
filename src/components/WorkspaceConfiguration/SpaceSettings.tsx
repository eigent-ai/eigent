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

import ContentHeader from '@/components/Layout/ContentHeader';
import SettingsContentShell from '@/components/Settings/SettingsContentShell';
import { useSpaceStore } from '@/store/spaceStore';
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

const WorkspaceConfigurationEditor = lazy(async () => {
  const module = await import('@/pages/WorkspaceConfiguration');
  return { default: module.WorkspaceConfigurationEditor };
});

/** Settings editor for the active Space profile. */
export function SpaceSettings() {
  const { t } = useTranslation();
  const activeSpaceId = useSpaceStore((state) => state.activeSpaceId);
  const activeSpace = useSpaceStore((state) =>
    state.activeSpaceId ? state.spaces[state.activeSpaceId] : null
  );
  const title = t('layout.space-settings', { defaultValue: 'Space Settings' });

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-col">
      <ContentHeader title={title} />
      <SettingsContentShell>
        {!activeSpaceId || !activeSpace ? (
          <div className="flex min-h-full items-center justify-center p-8 text-body-sm text-ds-text-neutral-muted-default">
            Select a Space before managing its profile.
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="flex min-h-full items-center justify-center text-body-sm text-ds-text-neutral-muted-default">
                Loading Space profile…
              </div>
            }
          >
            <WorkspaceConfigurationEditor
              key={activeSpaceId}
              presentation="settings"
              spaceId={activeSpaceId}
            />
          </Suspense>
        )}
      </SettingsContentShell>
    </main>
  );
}
