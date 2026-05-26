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

import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/authStore';

export function ProfileAccountCard({ onManage }: { onManage: () => void }) {
  const email = useAuthStore((state) => state.email);

  return (
    <div className="gap-3 rounded-xl border-ds-border-neutral-subtle-default bg-ds-bg-neutral-default-default p-3 flex items-center border border-solid">
      <div className="min-w-0 flex-1">
        <div className="text-body-sm font-semibold text-ds-text-neutral-default-default">
          Profile
        </div>
        <div className="text-body-sm text-ds-text-neutral-muted-default truncate">
          {email ?? 'No email on file'}
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        buttonContent="text"
        className="shrink-0"
        onClick={onManage}
      >
        Manage
      </Button>
    </div>
  );
}
