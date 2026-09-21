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

import { DS_FOCUS_RING } from '@/components/ui/semanticProps';
import { Tag } from '@/components/ui/tag';
import { cn } from '@/lib/utils';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { useTranslation } from 'react-i18next';

type SkillAccessTagProps = Omit<
  ComponentPropsWithoutRef<typeof Tag>,
  'size' | 'variant' | 'tone' | 'emphasis' | 'text' | 'icon'
> & {
  allAgents: boolean;
  agentCount: number;
};

const SkillAccessTag = forwardRef<HTMLDivElement, SkillAccessTagProps>(
  function SkillAccessTag(
    { allAgents, agentCount, asChild, children, className, ...props },
    ref
  ) {
    const { t } = useTranslation();
    return (
      <Tag
        {...props}
        ref={ref}
        asChild
        size={asChild ? 'sm' : 'xs'}
        variant="primary"
        tone="neutral"
        emphasis="subtle"
        className={cn(
          'font-text whitespace-nowrap',
          asChild && [
            DS_FOCUS_RING,
            'cursor-pointer hover:bg-ds-neutral-subtle-hover disabled:cursor-not-allowed disabled:opacity-50',
          ],
          className
        )}
      >
        {asChild ? (
          children
        ) : (
          <span>
            {allAgents
              ? t('agents.all-agents')
              : agentCount
                ? t('agents.library-agent-count', { count: agentCount })
                : t('agents.library-no-agents')}
          </span>
        )}
      </Tag>
    );
  }
);

export default SkillAccessTag;
