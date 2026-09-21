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

import {
  NavTab,
  SidebarCountBadge,
  SidebarNavGroup,
} from '@/components/Layout/AppSidebar';
import type { LucideIcon } from 'lucide-react';
import { Folder } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useHomeHub } from './context';
import { HOME_SECTIONS, type HomeSection } from './hooks/useHomeSection';
import { capitalizeLabel } from './utils';

const SECTION_ICONS: Record<HomeSection, LucideIcon> = {
  spaces: Folder,
};

const SECTION_LABEL_KEYS: Record<HomeSection, string> = {
  spaces: 'layout.spaces',
};

interface HomeSidebarNavGroupProps {
  activeSection: HomeSection | null;
  onSectionChange: (section: HomeSection) => void;
  sections?: readonly HomeSection[];
}

/** Home group shared by the combined Home / Settings navigation rail. */
export function HomeSidebarNavGroup({
  activeSection,
  onSectionChange,
  sections = HOME_SECTIONS,
}: HomeSidebarNavGroupProps) {
  const { t } = useTranslation();
  const { sectionCounts } = useHomeHub();

  const items = useMemo(
    () =>
      sections.map((id) => ({
        id,
        label: capitalizeLabel(t(SECTION_LABEL_KEYS[id])),
        icon: SECTION_ICONS[id],
        count: sectionCounts[id],
      })),
    [sectionCounts, sections, t]
  );

  return (
    <SidebarNavGroup label={capitalizeLabel(t('layout.home'))}>
      {items.map(({ id, label, icon: Icon, count }) => {
        const active = activeSection === id;
        return (
          <NavTab
            key={id}
            active={active}
            onClick={() => onSectionChange(id)}
            leading={<Icon className="h-4 w-4 shrink-0" aria-hidden />}
            label={label}
            trailing={<SidebarCountBadge count={count} />}
            ariaLabel={label}
            ariaCurrentPage={active}
          />
        );
      })}
    </SidebarNavGroup>
  );
}
