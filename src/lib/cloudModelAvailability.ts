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

import type { CloudModel } from '@/store/cloudModelStore';

const PLAN_RANK: Record<string, number> = {
  free: 0,
  plus: 1,
  pro: 2,
  team: 3,
  enterprise: 4,
};

export function isCloudModelAvailable(
  model: Pick<CloudModel, 'min_plan_key'>,
  planKey?: string | null
): boolean {
  const requiredPlan = model.min_plan_key?.trim().toLowerCase();
  if (!requiredPlan || requiredPlan === 'free') return true;

  const currentPlan = planKey?.trim().toLowerCase();
  if (!currentPlan) return true;
  if (currentPlan === requiredPlan) return true;

  const requiredRank = PLAN_RANK[requiredPlan];
  const currentRank = PLAN_RANK[currentPlan];
  return (
    requiredRank !== undefined &&
    currentRank !== undefined &&
    currentRank >= requiredRank
  );
}
