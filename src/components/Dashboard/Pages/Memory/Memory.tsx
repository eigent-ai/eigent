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

import DashboardPageLayout from '../DashboardPageLayout';

import { Brain } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function Memory() {
  const { t } = useTranslation();

  return (
    <DashboardPageLayout title={t('agents.memory')}>
      <div className="gap-6 flex flex-col">
        <div className="rounded-2xl bg-ds-bg-neutral-default-default px-6 py-4 flex w-full flex-col items-center justify-between">
          <div className="h-16 w-16 flex items-center justify-center">
            <Brain className="h-8 w-8 text-ds-icon-neutral-muted-default" />
          </div>
          <h2 className="mb-2 text-body-md font-bold text-ds-text-neutral-default-default">
            {t('layout.coming-soon')}
          </h2>
          <p className="max-w-md text-body-sm text-ds-text-neutral-muted-default text-center">
            {t('agents.memory-coming-soon-description')}
          </p>
        </div>
      </div>
    </DashboardPageLayout>
  );
}
