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

import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function PreviewFailure({ message }: { message?: string }) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="scrollbar-always-visible flex min-h-0 min-w-0 flex-1 flex-col items-center gap-ds-stack-related overflow-y-auto p-ds-panel-inset text-center text-ds-ink-muted-default"
    >
      <div className="my-auto flex min-w-0 flex-col items-center gap-ds-stack-related">
        <DsIcon icon={AlertTriangle} recipe="detailed" />
        <DsText
          role="body-large"
          weight="semibold"
          className="text-ds-ink-default-default"
        >
          {t('folder.preview-not-loaded', {
            defaultValue: 'Preview not loaded',
          })}
        </DsText>
        <DsText>
          {message ||
            t('folder.preview-load-failed', {
              defaultValue:
                'This file could not be previewed. Try again or open it externally.',
            })}
        </DsText>
      </div>
    </div>
  );
}
