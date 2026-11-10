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
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** Centered message in place of a Session, with optional actions. */
export function SessionWindowNotice({
  icon,
  title,
  description,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div
      role="status"
      className="flex h-full min-h-0 w-full flex-1 flex-col items-center justify-center gap-ds-stack-related p-ds-panel-inset text-center"
    >
      <DsIcon
        icon={icon}
        recipe="illustration"
        illustrationSize={32}
        className="text-ds-ink-muted-default"
        aria-hidden
      />
      <DsText as="p" role="body-large" weight="semibold">
        {title}
      </DsText>
      {description ? (
        <DsText as="p" role="base" className="text-ds-ink-muted-default">
          {description}
        </DsText>
      ) : null}
      {actions ? (
        <div className="flex flex-wrap items-center justify-center gap-ds-control-gap">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
