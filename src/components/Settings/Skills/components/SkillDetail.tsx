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

import ContentBreadcrumb from '@/components/Layout/ContentBreadcrumb';
import ContentHeader from '@/components/Layout/ContentHeader';
import DocumentContentRail from '@/components/Layout/DocumentContentRail';
import { Button } from '@/components/ui/button';
import { DsText } from '@/components/ui/ds-text';
import { Switch } from '@/components/ui/switch';
import { Tag } from '@/components/ui/tag';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSkillsLibrary } from '../SkillsProvider';
import SkillAccessMenu from './SkillAccessMenu';
import SkillAccessTag from './SkillAccessTag';
import SkillActions from './SkillActions';
import SkillFiles from './SkillFiles';
import SkillSourceTag from './SkillSourceTag';

const SKILL_DETAIL_HEADER_CONTROL_CLASS = 'box-border h-ds-control-sm';

export default function SkillDetail({
  skillId,
  onNavigateHome,
  onNavigateToSkills,
}: {
  skillId: string;
  /** Breadcrumb root — returns to the Home hub. */
  onNavigateHome?: () => void;
  /** Breadcrumb parent — returns to the Skills list. */
  onNavigateToSkills?: () => void;
}) {
  const { t } = useTranslation();
  const {
    entries,
    loading,
    profilesLoading,
    updateGlobal,
    pendingIds,
    refresh,
    refreshKey,
    previewGeneration,
  } = useSkillsLibrary();
  const entry = entries.find((item) => item.id === skillId);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [entry?.id]);
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col" data-skill-detail>
      <ContentHeader
        className="gap-ds-12 px-ds-16"
        titleAsChild
        title={
          <ContentBreadcrumb
            headingRef={heading}
            ariaLabel={t('layout.breadcrumb', { defaultValue: 'Breadcrumb' })}
            segments={[
              {
                label: t('layout.home', { defaultValue: 'Home' }),
                onClick: onNavigateHome,
              },
              {
                label: t('agents.skills', { defaultValue: 'Skills' }),
                onClick: onNavigateToSkills,
              },
              { label: entry?.name || t('agents.library-title') },
            ]}
          />
        }
        actions={
          entry && (
            <>
              {entry.kind !== 'space' && (
                <Tag
                  asChild
                  size="sm"
                  variant="primary"
                  tone="neutral"
                  emphasis="subtle"
                  className={SKILL_DETAIL_HEADER_CONTROL_CLASS}
                >
                  <label
                    data-skill-detail-enabled-control
                    className="cursor-pointer whitespace-nowrap"
                  >
                    <DsText as="span" role="meta">
                      {t(
                        entry.skill.enabled
                          ? 'agents.library-enabled'
                          : 'agents.library-disabled'
                      )}
                    </DsText>
                    <Switch
                      size="sm"
                      checked={entry.skill.enabled}
                      disabled={loading || pendingIds.has(entry.skill.id)}
                      aria-label={t('agents.library-enable', {
                        name: entry.name,
                      })}
                      onCheckedChange={(enabled) =>
                        void updateGlobal(entry.skill, { enabled })
                      }
                    />
                  </label>
                </Tag>
              )}
              <SkillActions entry={entry} />
            </>
          )
        }
      >
        {entry && (
          <div className="flex shrink-0 items-center gap-ds-8">
            <SkillSourceTag
              kind={entry.kind}
              className={SKILL_DETAIL_HEADER_CONTROL_CLASS}
            />
            {entry.kind === 'space' ? (
              <SkillAccessTag
                allAgents={!entry.assignTo.length}
                agentCount={new Set(entry.assignTo).size}
                title={entry.assignTo.join(', ')}
                className={SKILL_DETAIL_HEADER_CONTROL_CLASS}
              />
            ) : (
              <SkillAccessMenu
                skill={entry.skill}
                className={SKILL_DETAIL_HEADER_CONTROL_CLASS}
              />
            )}
          </div>
        )}
      </ContentHeader>
      {entry ? (
        <DocumentContentRail className="flex min-h-0 flex-1 flex-col px-ds-16">
          <SkillFiles
            key={`${entry.id}:${refreshKey}:${previewGeneration}`}
            entry={entry}
            revision={`${refreshKey}:${previewGeneration}`}
          />
        </DocumentContentRail>
      ) : (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-ds-12 p-ds-24"
          role="status"
        >
          <DsText>
            {t(
              loading || profilesLoading
                ? 'agents.library-loading'
                : 'agents.library-not-found'
            )}
          </DsText>
          {!loading && !profilesLoading && (
            <Button
              variant="secondary"
              disabled={pendingIds.size > 0}
              onClick={refresh}
            >
              {t('agents.library-retry')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
