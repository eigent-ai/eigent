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

import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import type { LucideIcon } from 'lucide-react';

export default function HomeHubEmptyState({
  icon,
  title,
  actionLabel,
  onAction,
}: {
  icon?: LucideIcon;
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center rounded-ds-card border border-x border-y border-solid border-ds-hairline-subtle-default bg-ds-neutral-subtle-default p-ds-32 text-center"
    >
      {icon ? (
        <DsIcon
          icon={icon}
          recipe="detailed"
          className="mb-ds-12 text-ds-ink-muted-default"
        />
      ) : null}
      <DsText role="body-large" weight="semibold">
        {title}
      </DsText>
      {actionLabel && onAction ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-ds-12 rounded-full"
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
