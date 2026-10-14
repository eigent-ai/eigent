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

import { interactionExpiryMs } from '@/lib/approvalPresentation';
import type { HumanInteractionPayload } from '@/service/humanInteractionApi';
import { useEffect, useState } from 'react';

/** Local deadline only removes authority; it never asserts a durable expiry outcome. */
export function useHumanInteractionExpiry(
  interaction?: HumanInteractionPayload
): boolean {
  const deadline = interactionExpiryMs(interaction);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clearTimeout(timer);
      const remaining = deadline - Date.now();
      if (remaining > 0)
        timer = setTimeout(schedule, Math.min(remaining, 2_147_483_647));
      setNow(Date.now());
    };
    schedule();
    window.addEventListener('focus', schedule);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', schedule);
    };
  }, [deadline]);
  return deadline !== null && deadline <= now;
}
