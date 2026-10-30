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
import {
  Bot,
  Folder,
  Power,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getSkillLibraryStats, type SkillLibraryEntry } from '../skillLibrary';

function Metric({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
}) {
  return (
    <div className="flex min-w-0 items-center gap-ds-8">
      <DsIcon icon={icon} className="text-ds-ink-muted-default" />
      <div className="min-w-0">
        <DsText
          as="dt"
          role="meta"
          className="truncate text-ds-ink-muted-default"
        >
          {label}
        </DsText>
        <DsText
          as="dd"
          role="base"
          weight="semibold"
          className="truncate text-ds-ink-default-default tabular-nums"
        >
          {value}
        </DsText>
      </div>
    </div>
  );
}

export default function SkillsDashboard({
  entries,
  loading,
  hasErrors,
}: {
  entries: SkillLibraryEntry[];
  loading: boolean;
  hasErrors: boolean;
}) {
  const { t } = useTranslation();
  const stats = getSkillLibraryStats(entries);
  if (loading || hasErrors) return null;

  return (
    <section
      aria-label={t('agents.library-overview')}
      data-skills-dashboard
      className="rounded-ds-card border border-x border-y border-solid border-ds-hairline-subtle-default bg-ds-neutral-subtle-default px-ds-16 py-ds-12"
    >
      <dl className="m-0 grid grid-cols-2 gap-x-ds-24 gap-y-ds-12 lg:grid-cols-4">
        <Metric
          label={t('agents.library-dashboard-total')}
          value={stats.total}
          icon={WandSparkles}
        />
        <Metric
          label={t('agents.library-dashboard-enabled')}
          value={stats.enabled}
          icon={Power}
        />
        <Metric
          label={t('agents.library-dashboard-spaces')}
          value={stats.spaces}
          icon={Folder}
        />
        <Metric
          label={t('agents.library-dashboard-selected')}
          value={stats.selectedAgents}
          icon={Bot}
        />
      </dl>
    </section>
  );
}
