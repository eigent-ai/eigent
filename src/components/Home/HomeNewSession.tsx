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

import { DsText } from '@/components/ui/ds-text';
import { useTranslation } from 'react-i18next';
import { useHomeGreetingText } from './HomeGreeting';

/** Home's New session greeting, above the composer. */
export function HomeNewSessionGreeting() {
  const { t } = useTranslation();
  const greeting = useHomeGreetingText();
  return (
    <div data-home-new-session-greeting className="mb-ds-24 min-w-0">
      <DsText as="h1" role="section" weight="semibold">
        {greeting}
      </DsText>
      <DsText as="p" role="base" className="mt-ds-4 text-ds-ink-muted-default">
        {t('layout.home-new-session-description')}
      </DsText>
    </div>
  );
}
