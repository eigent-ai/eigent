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

import { ProtectedRoute } from '@web/components/auth/ProtectedRoute';
import { AppShell } from '@web/components/layout/AppShell';
import { ProfilePageLayout } from '@web/components/profile/ProfilePageLayout';
import { ProfileSettingsHub } from '@web/components/profile/ProfileSettingsHub';
import { ProfileLanguageSection } from '@web/components/profile/sections/ProfileLanguageSection';
import { ProfileManageSection } from '@web/components/profile/sections/ProfileManageSection';
import { ProfileModeSection } from '@web/components/profile/sections/ProfileModeSection';
import { ProfileModelSection } from '@web/components/profile/sections/ProfileModelSection';
import { ProfilePlaceholderSection } from '@web/components/profile/sections/ProfilePlaceholderSection';
import { ProfileThemeSection } from '@web/components/profile/sections/ProfileThemeSection';
import { ProfileWorkspaceBackgroundSection } from '@web/components/profile/sections/ProfileWorkspaceBackgroundSection';
import DispatchPage from '@web/pages/DispatchPage';
import LoginPage from '@web/pages/LoginPage';
import { Navigate, Route, Routes } from 'react-router-dom';

export default function WebRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/projects" replace />} />
          <Route path="/projects" element={<DispatchPage />} />
          <Route path="/projects/:projectId" element={<DispatchPage />} />
          <Route path="/profile" element={<ProfilePageLayout />}>
            <Route index element={<ProfileSettingsHub />} />
            <Route path="manage" element={<ProfileManageSection />} />
            <Route path="model" element={<ProfileModelSection />} />
            <Route
              path="skills"
              element={<ProfilePlaceholderSection title="Skills" />}
            />
            <Route
              path="sub-agents"
              element={<ProfilePlaceholderSection title="SubAgents" />}
            />
            <Route
              path="connectors"
              element={<ProfilePlaceholderSection title="Connectors" />}
            />
            <Route path="mode" element={<ProfileModeSection />} />
            <Route path="theme" element={<ProfileThemeSection />} />
            <Route
              path="workspace-background"
              element={<ProfileWorkspaceBackgroundSection />}
            />
            <Route path="language" element={<ProfileLanguageSection />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}
