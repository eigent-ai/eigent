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

import OverviewIconFrame from '@/components/Layout/OverviewIconFrame';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import {
  Bot,
  Folder,
  Power,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import SettingsSection from '../../SettingsSection';
import { getSkillLibraryStats, type SkillLibraryEntry } from '../skillLibrary';
import SkillSourceTag from './SkillSourceTag';

function Metric({
  label,
  value,
  icon,
  children,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <SettingsSection boxClassName="h-full gap-ds-16">
      <div className="flex min-w-0 items-center gap-ds-12">
        <OverviewIconFrame emphasis="subtle">
          <DsIcon icon={icon} recipe="detailed" />
        </OverviewIconFrame>
        <dl className="m-0 min-w-0">
          <DsText
            as="dt"
            role="meta"
            weight="semibold"
            className="text-ds-ink-muted-default"
          >
            {label}
          </DsText>
          <DsText
            as="dd"
            role="body-large"
            weight="semibold"
            className="mt-ds-4 text-ds-ink-default-default tabular-nums"
          >
            {value}
          </DsText>
        </dl>
      </div>
      <div className="mt-auto flex flex-col gap-ds-8">{children}</div>
    </SettingsSection>
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
  const incomplete = loading || hasErrors;
  const value = (count: number) => (incomplete ? '—' : count);
  return (
    <section aria-label={t('agents.library-overview')} aria-busy={loading}>
      <div
        data-skills-dashboard
        className="grid grid-cols-1 gap-ds-16 sm:grid-cols-2"
      >
        <Metric
          label={t('agents.library-dashboard-total')}
          value={value(stats.total)}
          icon={WandSparkles}
        >
          <div className="flex flex-wrap gap-ds-8">
            {(['global', 'builtin', 'space'] as const).map((kind) => (
              <SkillSourceTag
                key={kind}
                kind={kind}
                count={value(stats.sources[kind])}
              />
            ))}
          </div>
        </Metric>
        <Metric
          label={t('agents.library-dashboard-enabled')}
          value={value(stats.enabled)}
          icon={Power}
        >
          <DsText role="meta" className="text-ds-ink-muted-default">
            <Trans
              i18nKey="agents.library-dashboard-enabled-note"
              values={{
                total: value(stats.globalTotal),
                disabled: value(stats.disabled),
              }}
              components={{ separator: <span className="mx-ds-8" /> }}
            />
          </DsText>
        </Metric>
        <Metric
          label={t('agents.library-dashboard-spaces')}
          value={value(stats.spaces)}
          icon={Folder}
        >
          <DsText role="meta" className="text-ds-ink-muted-default">
            {t('agents.library-dashboard-spaces-note', {
              skills: value(stats.sources.space),
            })}
          </DsText>
        </Metric>
        <Metric
          label={t('agents.library-dashboard-selected')}
          value={value(stats.selectedAgents)}
          icon={Bot}
        >
          <DsText role="meta" className="text-ds-ink-muted-default">
            <Trans
              i18nKey="agents.library-dashboard-access-note"
              values={{
                all: value(stats.allAgents),
                none: value(stats.noAgents),
              }}
              components={{ separator: <span className="mx-ds-8" /> }}
            />
          </DsText>
        </Metric>
      </div>
      {incomplete && (
        <DsText
          role="meta"
          className="mt-ds-12 text-ds-ink-muted-default"
          aria-live="polite"
        >
          {t(
            loading
              ? 'agents.library-loading'
              : 'agents.library-dashboard-incomplete'
          )}
        </DsText>
      )}
    </section>
  );
}
