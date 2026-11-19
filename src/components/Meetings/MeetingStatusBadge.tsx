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
import type { MeetingStatus } from '@/service/meetingsApi';
import { useTranslation } from 'react-i18next';

/** Status in words; a ready meeting needs no badge. */
export default function MeetingStatusBadge({
  status,
}: {
  status: MeetingStatus;
}) {
  const { t } = useTranslation();
  if (status === 'ready') return null;
  const label =
    status === 'recording'
      ? t('meetings.status-recording')
      : status === 'interrupted'
        ? t('meetings.status-interrupted')
        : t('meetings.status-failed');
  return (
    <Badge
      variant="secondary"
      size="xs"
      tone={status === 'interrupted' ? 'warning' : 'error'}
    >
      {label}
    </Badge>
  );
}
