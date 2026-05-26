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

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuthStore, type AppearanceMode } from '@/store/authStore';
import { Monitor, Moon, Sun } from 'lucide-react';

export function ProfileModeSection() {
  const appearanceMode = useAuthStore((state) => state.appearanceMode);
  const setAppearanceMode = useAuthStore((state) => state.setAppearanceMode);

  return (
    <div className="rounded-xl border-ds-border-neutral-subtle-default bg-ds-bg-neutral-default-default p-4 mx-auto w-full max-w-[640px] border border-solid">
      <p className="mb-4 text-body-sm text-ds-text-neutral-muted-default">
        Choose light, dark, or match your system appearance.
      </p>
      <Tabs
        value={appearanceMode}
        onValueChange={(value) => setAppearanceMode(value as AppearanceMode)}
      >
        <TabsList className="w-full">
          <TabsTrigger value="light" className="flex-1">
            <Sun className="mr-1 h-4 w-4" />
            Light
          </TabsTrigger>
          <TabsTrigger value="dark" className="flex-1">
            <Moon className="mr-1 h-4 w-4" />
            Dark
          </TabsTrigger>
          <TabsTrigger value="system" className="flex-1">
            <Monitor className="mr-1 h-4 w-4" />
            System
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
