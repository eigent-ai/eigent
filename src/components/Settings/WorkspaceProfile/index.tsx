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
  Bot,
  Cable,
  FolderKanban,
  Settings2,
  UsersRound,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsHeader } from '../SettingsHeaderContext';
import SettingsSection from '../SettingsSection';
import SettingsSectionPage from '../SettingsSectionPage';

interface ProfileSettingRowProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

function ProfileSettingRow({
  icon: Icon,
  title,
  description,
}: ProfileSettingRowProps) {
  return (
    <div className="flex w-full items-center gap-3 px-4 py-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ds-bg-neutral-subtle-default text-ds-icon-neutral-default-default">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-sm font-bold text-ds-text-neutral-default-default">
          {title}
        </span>
        <span className="mt-0.5 line-clamp-1 block text-body-xs text-ds-text-neutral-muted-default">
          {description}
        </span>
      </span>
    </div>
  );
}

export default function WorkspaceProfileSettings() {
  const { t } = useTranslation();
  const { setHeaderOverride } = useSettingsHeader();
  const [profileOpen, setProfileOpen] = useState(false);
  const profileName = t('layout.workspace-profile');

  useEffect(() => {
    if (!profileOpen) {
      setHeaderOverride(null);
      return;
    }

    setHeaderOverride({
      title: profileName,
      onBack: () => setProfileOpen(false),
    });

    return () => setHeaderOverride(null);
  }, [profileName, profileOpen, setHeaderOverride]);

  if (profileOpen) {
    return (
      <SettingsSectionPage>
        <SettingsSection boxClassName="items-center gap-3 px-6 py-8 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default text-ds-icon-neutral-default-default shadow-sm">
            <FolderKanban className="h-8 w-8" aria-hidden />
          </span>
          <span className="block text-heading-sm font-bold text-ds-text-neutral-default-default">
            {profileName}
          </span>
          <span className="mx-auto block max-w-xl text-body-sm text-ds-text-neutral-muted-default">
            {t('layout.workspace-profile-card-description')}
          </span>
        </SettingsSection>

        <SettingsSection
          title={t('layout.agents')}
          boxClassName="overflow-hidden p-0"
        >
          <div className="w-full divide-y divide-ds-border-neutral-muted-default">
            <ProfileSettingRow
              icon={Bot}
              title={t('setting.models')}
              description={t('setting.models-default-setting-description')}
            />
            <ProfileSettingRow
              icon={UsersRound}
              title={t('agents.sub-agents')}
              description={t('layout.workspace-profile-sub-agents-description')}
            />
          </div>
        </SettingsSection>

        <SettingsSection
          title={t('layout.connectors')}
          boxClassName="overflow-hidden p-0"
        >
          <ProfileSettingRow
            icon={Cable}
            title={t('layout.connectors')}
            description={t('layout.connectors-description')}
          />
        </SettingsSection>

        <SettingsSection
          title={t('agents.skills')}
          boxClassName="overflow-hidden p-0"
        >
          <ProfileSettingRow
            icon={WandSparkles}
            title={t('agents.skills')}
            description={t('agents.skills-description')}
          />
        </SettingsSection>
      </SettingsSectionPage>
    );
  }

  return (
    <SettingsSectionPage>
      <SettingsSection>
        <div className="grid w-full grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex min-h-24 min-w-0 items-center gap-3 rounded-2xl border border-solid border-transparent bg-ds-bg-neutral-subtle-default p-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ds-bg-neutral-subtle-default text-ds-icon-neutral-default-default">
              <FolderKanban className="h-5 w-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-body-base block truncate font-bold text-ds-text-neutral-default-default">
                {profileName}
              </span>
              <span className="mt-1 line-clamp-2 block text-body-xs text-ds-text-neutral-muted-default">
                {t('layout.workspace-profile-card-description')}
              </span>
            </span>
            <button
              type="button"
              onClick={() => setProfileOpen(true)}
              aria-label={t('layout.workspace-profile-open', {
                name: profileName,
              })}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent text-ds-icon-neutral-muted-default transition-colors hover:bg-ds-bg-neutral-default-hover hover:text-ds-icon-neutral-default-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-ring-brand-default-focus"
            >
              <Settings2 className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      </SettingsSection>
    </SettingsSectionPage>
  );
}
