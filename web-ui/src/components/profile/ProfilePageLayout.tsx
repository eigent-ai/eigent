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
import { ArrowLeft, X } from 'lucide-react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

const SECTION_TITLES: Record<string, string> = {
  manage: 'Profile',
  model: 'Model',
  skills: 'Skills',
  'sub-agents': 'SubAgents',
  connectors: 'Connectors',
  mode: 'Mode',
  theme: 'Theme Customization',
  'workspace-background': 'Workspace Background',
  language: 'Language',
};

function getSectionKey(pathname: string): string | null {
  const match = pathname.match(/^\/profile\/([^/]+)$/);
  return match?.[1] ?? null;
}

export function ProfilePageLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const sectionKey = getSectionKey(location.pathname);
  const sectionTitle = sectionKey ? SECTION_TITLES[sectionKey] : null;

  const handleClose = () => {
    navigate('/projects');
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-ds-bg-neutral-default-default">
      <header className="border-b-1 h-12 shrink-0 border-x-0 border-t-0 border-solid border-ds-border-neutral-subtle-default bg-ds-bg-neutral-subtle-default px-3">
        <div className="flex h-full items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {sectionTitle ? (
              <Button
                variant="ghost"
                size="md"
                buttonContent="icon-only"
                buttonRadius="full"
                aria-label="Back to profile settings"
                onClick={() => navigate('/profile')}
              >
                <ArrowLeft />
              </Button>
            ) : null}
            <span className="truncate font-display text-body-sm font-semibold text-ds-text-neutral-default-default">
              {sectionTitle ?? 'Profile'}
            </span>
          </div>

          <Button
            variant="ghost"
            size="md"
            buttonContent="icon-only"
            buttonRadius="full"
            aria-label="Close profile"
            onClick={handleClose}
          >
            <X />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <Outlet />
      </div>
    </div>
  );
}
