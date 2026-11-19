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

interface SettingsSectionLoadingProps {
  label: string;
  rows?: number;
  className?: string;
}

export default function SettingsSectionLoading({
  label,
  rows = 3,
  className,
}: SettingsSectionLoadingProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('flex w-full flex-col gap-4 py-4', className)}
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          aria-hidden
          className="h-24 w-full animate-pulse rounded-2xl bg-ds-neutral-subtle-default motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}
