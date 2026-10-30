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

import { TriggerType } from '@/types';
import {
  Clock8,
  Slack,
  WebhookIcon,
  Zap,
  ZapOff,
  type LucideIcon,
} from 'lucide-react';

/**
 * The generic Automation glyph. Use where the trigger type is unknown or the
 * surface covers every automation (nav rail, empty states, provenance badges).
 * A clock would be wrong there: only Schedule automations are time-based.
 */
export const AUTOMATION_ICON: LucideIcon = Zap;

/**
 * Shown when the automation listener is not connected. Colour alone is not a
 * sufficient status signal, so the disconnected state gets its own glyph.
 */
export const AUTOMATION_OFF_ICON: LucideIcon = ZapOff;

/** Icon for one automation, chosen by the event that starts it. */
export function iconForTriggerType(
  triggerType: TriggerType | string | null | undefined
): LucideIcon {
  switch (triggerType) {
    case TriggerType.Schedule:
      return Clock8;
    case TriggerType.Webhook:
      return WebhookIcon;
    case TriggerType.Slack:
      return Slack;
    default:
      return AUTOMATION_ICON;
  }
}
