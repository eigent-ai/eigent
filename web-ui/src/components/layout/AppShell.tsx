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
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { useIsMobile } from '@web/hooks/useWebAuth';
import { FolderKanban, Menu, UserRound, X } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

const navItems = [
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/profile', label: 'Profile', icon: UserRound },
];

export function AppShell() {
  const email = useAuthStore((state) => state.email);
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="bg-ds-bg-neutral-subtle-default flex h-screen flex-col">
      <header className="border-ds-border-neutral-subtle-disabled bg-ds-bg-neutral-default-default px-4 py-3 border-b">
        <div className="gap-4 mx-auto flex max-w-[1400px] items-center justify-between">
          <div className="gap-3 flex items-center">
            {isMobile ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Open navigation"
                onClick={() => setMenuOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </Button>
            ) : null}
            <div>
              <div className="text-heading-sm font-semibold text-ds-text-neutral-default-default">
                Eigent Remote
              </div>
              {email ? (
                <div className="text-body-sm text-ds-text-neutral-muted-default truncate">
                  {email}
                </div>
              ) : null}
            </div>
          </div>

          {!isMobile ? (
            <nav className="gap-1 flex items-center">
              {navItems.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    cn(
                      'gap-2 rounded-lg px-3 py-2 text-body-sm font-medium inline-flex items-center transition-colors',
                      isActive
                        ? 'bg-ds-bg-brand-subtle-default text-ds-text-brand-default-default'
                        : 'text-ds-text-neutral-muted-default hover:bg-ds-bg-neutral-subtle-hover hover:text-ds-text-neutral-default-default'
                    )
                  }
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </NavLink>
              ))}
            </nav>
          ) : null}
        </div>
      </header>

      {isMobile && menuOpen ? (
        <div className="inset-0 fixed z-50 flex">
          <button
            type="button"
            aria-label="Close navigation overlay"
            className="inset-0 bg-black/40 absolute"
            onClick={() => setMenuOpen(false)}
          />
          <aside className="w-72 bg-ds-bg-neutral-default-default p-4 shadow-xl relative z-10 flex max-w-[85vw] flex-col">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-heading-sm font-semibold">Menu</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close navigation"
                onClick={() => setMenuOpen(false)}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <nav className="gap-1 flex flex-col">
              {navItems.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'gap-2 rounded-lg px-3 py-2 text-body-md inline-flex items-center',
                      isActive
                        ? 'bg-ds-bg-brand-subtle-default text-ds-text-brand-default-default'
                        : 'text-ds-text-neutral-default-default hover:bg-ds-bg-neutral-subtle-hover'
                    )
                  }
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </NavLink>
              ))}
            </nav>
          </aside>
        </div>
      ) : null}

      <main
        key={location.pathname}
        className="p-4 mx-auto flex w-full max-w-[1400px] flex-1 overflow-hidden"
      >
        <Outlet />
      </main>
    </div>
  );
}
