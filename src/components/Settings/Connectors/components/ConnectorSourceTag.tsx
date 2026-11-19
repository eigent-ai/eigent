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

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

export type ConnectorSourceTagKind = 'open' | 'builtin' | 'local' | 'remote';

const sourceTagClasses: Record<ConnectorSourceTagKind, string> = {
  open: 'bg-ds-category-blue-background-default text-ds-category-blue-text-strong',
  builtin:
    'bg-ds-category-purple-background-default text-ds-category-purple-text-strong',
  local:
    'bg-ds-category-teal-background-default text-ds-category-teal-text-strong',
  remote:
    'bg-ds-category-indigo-background-default text-ds-category-indigo-text-strong',
};

export default function ConnectorSourceTag({
  kind,
  children,
  className,
}: {
  kind: ConnectorSourceTagKind;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        'w-max shrink-0 whitespace-nowrap',
        sourceTagClasses[kind],
        className
      )}
    >
      {children}
    </Badge>
  );
}
