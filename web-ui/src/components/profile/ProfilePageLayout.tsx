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
    <div className="bg-ds-bg-neutral-default-default flex h-full w-full flex-col overflow-hidden">
      <header className="bg-ds-bg-neutral-subtle-default h-12 border-ds-border-neutral-subtle-default px-3 shrink-0 border-x-0 border-t-0 border-b-1 border-solid">
        <div className="gap-2 flex h-full items-center justify-between">
          <div className="min-w-0 gap-2 flex items-center">
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
            <span className="font-display text-body-sm font-semibold text-ds-text-neutral-default-default truncate">
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

      <div className="min-h-0 px-3 py-4 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
