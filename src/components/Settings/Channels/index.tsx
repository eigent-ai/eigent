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

import { MessageSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SettingsSection from '../SettingsSection';
import SettingsSectionPage from '../SettingsSectionPage';

export default function Channels() {
  const { t } = useTranslation();

  return (
    <SettingsSectionPage>
      <SettingsSection
        title={t('layout.coming-soon')}
        boxClassName="items-center justify-between"
      >
        <div className="flex h-16 w-16 items-center justify-center">
          <MessageSquare className="h-8 w-8 text-ds-ink-muted-default" />
        </div>
        <span className="mb-2 block text-ds-text-body-large font-bold text-ds-ink-default-default">
          {t('layout.coming-soon')}
        </span>
        <span className="block text-center text-ds-text-base text-ds-ink-muted-default">
          {t('layout.channels-overview-coming-soon-description')}
        </span>
      </SettingsSection>
    </SettingsSectionPage>
  );
}
