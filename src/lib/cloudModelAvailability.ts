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
  return cloudModelAvailabilityStatus(model, planKey) === 'available';
}

export function cloudModelAvailabilityStatus(
  model: Pick<CloudModel, 'min_plan_key'>,
  planKey?: string | null
): 'available' | 'upgrade' | 'unknown' {
  const requiredPlan = model.min_plan_key?.trim().toLowerCase();
  if (!requiredPlan || requiredPlan === 'free') return 'available';

  const currentPlan = planKey?.trim().toLowerCase();
  if (!currentPlan) return 'unknown';
  if (currentPlan === requiredPlan) return 'available';

  const requiredRank = PLAN_RANK[requiredPlan];
  const currentRank = PLAN_RANK[currentPlan];
  if (requiredRank === undefined || currentRank === undefined) return 'unknown';
  return currentRank >= requiredRank ? 'available' : 'upgrade';
}
