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
import type { ComponentPropsWithoutRef } from 'react';

/** Shared readable measure for document metadata and rendered prose. */
export const DOCUMENT_CONTENT_RAIL_CLASS =
  'mx-auto w-full max-w-[76ch] min-w-0';

export default function DocumentContentRail({
  className,
  ...props
}: ComponentPropsWithoutRef<'div'>) {
  return (
    <div className={cn(DOCUMENT_CONTENT_RAIL_CLASS, className)} {...props} />
  );
}
