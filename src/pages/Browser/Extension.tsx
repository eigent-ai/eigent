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

export default function Extension() {
  const { t } = useTranslation();

  return (
    <div className="m-auto flex h-auto w-full flex-1 flex-col">
      <div className="flex w-full items-center justify-between px-6 pb-6 pt-8">
        <div className="text-heading-sm font-bold text-text-heading">
          {t('layout.browser-plugins')}
        </div>
      </div>
      <div className="flex flex-col gap-4 px-6">
        <div className="flex flex-col items-center justify-center rounded-xl border border-border-disabled bg-surface-secondary px-6 py-16">
          <Puzzle className="mb-4 h-12 w-12 text-icon-secondary opacity-50" />
          <div className="text-body-base text-center font-bold text-text-label">
            {t('layout.coming-soon')}
          </div>
          <p className="mt-2 text-center text-label-sm text-text-label">
            {t('layout.browser-plugins-description')}
          </p>
        </div>
      </div>
    </div>
  );
}
