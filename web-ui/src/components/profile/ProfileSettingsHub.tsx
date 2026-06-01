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

import { Button } from '@/components/ui/button';
import type { Mode } from '@/lib/themeTokens/types';
import { useAuthStore } from '@/store/authStore';
import { ProfileAccountCard } from '@web/components/profile/ProfileAccountCard';
import {
  formatThemeLabel,
  getAppearanceLabel,
  getLanguageLabel,
  getModelTypeLabel,
  getWorkspaceBackgroundLabel,
} from '@web/components/profile/profileLabels';
import { ProfileSettingsRow } from '@web/components/profile/ProfileSettingsRow';
import { useLogout } from '@web/hooks/useWebAuth';
import { useNavigate } from 'react-router-dom';

export function ProfileSettingsHub() {
  const navigate = useNavigate();
  const logout = useLogout();
  const modelType = useAuthStore((state) => state.modelType);
  const appearanceMode = useAuthStore((state) => state.appearanceMode);
  const appearance = useAuthStore((state) => state.appearance);
  const language = useAuthStore((state) => state.language);
  const workspaceMainBackground = useAuthStore(
    (state) => state.workspaceMainBackground
  );
  const lightColorThemeId = useAuthStore((state) => state.lightColorThemeId);
  const darkColorThemeId = useAuthStore((state) => state.darkColorThemeId);

  const activeMode: Mode =
    appearanceMode === 'system' ? appearance : appearanceMode;
  const activeThemeId =
    activeMode === 'dark' ? darkColorThemeId : lightColorThemeId;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[640px] flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        <ProfileAccountCard onManage={() => navigate('/profile/manage')} />

        <div className="flex flex-col gap-2">
          <ProfileSettingsRow
            label="Model"
            trailing={getModelTypeLabel(modelType)}
            onClick={() => navigate('/profile/model')}
          />
          <ProfileSettingsRow
            label="Skills"
            onClick={() => navigate('/profile/skills')}
          />
          <ProfileSettingsRow
            label="SubAgents"
            onClick={() => navigate('/profile/sub-agents')}
          />
          <ProfileSettingsRow
            label="Connectors"
            onClick={() => navigate('/profile/connectors')}
          />
        </div>

        <div className="flex flex-col gap-2">
          <ProfileSettingsRow
            label="Mode"
            trailing={getAppearanceLabel(appearanceMode, appearance)}
            onClick={() => navigate('/profile/mode')}
          />
          <ProfileSettingsRow
            label="Theme Customization"
            trailing={formatThemeLabel(activeThemeId)}
            onClick={() => navigate('/profile/theme')}
          />
          <ProfileSettingsRow
            label="Workspace Background"
            trailing={getWorkspaceBackgroundLabel(workspaceMainBackground)}
            onClick={() => navigate('/profile/workspace-background')}
          />
          <ProfileSettingsRow
            label="Language"
            trailing={getLanguageLabel(language)}
            onClick={() => navigate('/profile/language')}
          />
        </div>
      </div>

      <Button
        variant="ghost"
        size="md"
        buttonContent="text"
        className="mt-auto w-full shrink-0 text-ds-text-error-default-default"
        onClick={logout}
      >
        Log Out
      </Button>
    </div>
  );
}
