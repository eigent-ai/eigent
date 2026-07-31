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

import { Puzzle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SettingsPage from '../SettingsPage';
import SettingsSection from '../SettingsSection';

export default function Extension() {
  const { t } = useTranslation();

  return (
    <SettingsPage>
      <SettingsSection
        title={t('layout.coming-soon')}
        boxClassName="min-h-[200px] items-center justify-center py-16"
      >
        <Puzzle className="mb-4 h-12 w-12 text-ds-icon-neutral-muted-default opacity-50" />
        <div className="text-body-base text-center font-bold text-ds-text-neutral-muted-default">
          {t('layout.coming-soon')}
        </div>
        <span className="mt-2 block text-center text-label-sm text-ds-text-neutral-muted-default">
          {t('layout.browser-plugins-description')}
        </span>
      </SettingsSection>
    </SettingsPage>
  );
}
