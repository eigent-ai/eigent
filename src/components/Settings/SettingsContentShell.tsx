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

import { cn } from '@/lib/utils';
import type { ReactNode, RefObject } from 'react';

interface SettingsContentShellProps {
  children: ReactNode;
  className?: string;
  scrollRef?: RefObject<HTMLDivElement>;
}

export default function SettingsContentShell({
  children,
  className,
  scrollRef,
}: SettingsContentShellProps) {
  return (
    <div
      ref={scrollRef}
      className={cn(
        'scrollbar-always-visible min-h-0 flex-1 [scrollbar-gutter:stable] overflow-y-scroll',
        className
      )}
    >
      {/* Sections stay in one centered measure so they don't stretch across a
          wide window. */}
      <div className="mx-auto min-h-full w-full max-w-[964px] px-8">
        {children}
      </div>
    </div>
  );
}
