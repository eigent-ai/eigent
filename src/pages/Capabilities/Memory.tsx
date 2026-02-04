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

import { Brain } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function Memory() {
  const { t } = useTranslation();

  return (
    <div className="space-y-8">
      {/* Header Section */}
      <div className="flex items-center justify-between">
        <div className="text-heading-sm font-bold text-text-heading">
          {t('capabilities.memory')}
        </div>
      </div>

      {/* Coming Soon Card */}
      <div className="flex flex-col items-center justify-center rounded-2xl bg-surface-secondary py-16">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-tertiary">
          <Brain className="h-8 w-8 text-icon-secondary" />
        </div>
        <h2 className="mb-2 text-body-md font-bold text-text-heading">
          {t('layout.coming-soon')}
        </h2>
        <p className="max-w-md px-4 text-center text-body-sm text-text-label">
          {t('capabilities.memory-coming-soon-description')}
        </p>
      </div>
    </div>
  );
}
