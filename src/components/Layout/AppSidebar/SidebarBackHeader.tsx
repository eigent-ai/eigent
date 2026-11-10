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

import ContentHeader from '@/components/Layout/ContentHeader';
import { DsIcon } from '@/components/ui/ds-icon';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavTab } from './NavTab';

/** The standard sidebar navigation button inside a borderless 40px row. */
export function SidebarBackHeader({
  onBack,
  action,
}: {
  onBack: () => void;
  /** Optional primary collection action kept beside the back control. */
  action?: ReactNode;
}) {
  const { t } = useTranslation();
  const backLabel = t('layout.back');
  return (
    <ContentHeader
      className={action ? '!ps-0 !pe-ds-8' : '!px-0'}
      actions={action}
      border={false}
    >
      <NavTab
        active={false}
        onClick={onBack}
        leading={<DsIcon icon={ArrowLeft} />}
        label={backLabel}
        ariaLabel={backLabel}
        className={action ? 'w-auto flex-1 shrink' : undefined}
      />
    </ContentHeader>
  );
}
