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
import type { ReactNode } from 'react';

/** Fluid card grid: 1 col narrow, then 2–3 cols as width grows (max 3). */
export const HOME_HUB_GRID_CLASS =
  'grid auto-rows-fr gap-4 grid-cols-[repeat(auto-fill,minmax(clamp(360px,calc((100%-2rem)/3),100%),1fr))]';

type HomeHubGridProps = {
  children: ReactNode;
  className?: string;
};

export default function HomeHubGrid({ children, className }: HomeHubGridProps) {
  return <div className={cn(HOME_HUB_GRID_CLASS, className)}>{children}</div>;
}
