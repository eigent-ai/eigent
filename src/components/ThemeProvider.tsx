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

import { useAuthStore } from '@/store/authStore';
import { useEffect } from 'react';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { appearance } = useAuthStore();

  useEffect(() => {
    // set data-theme attribute based on appearance
    const root = document.documentElement;

    // remove all possible data-theme attributes
    root.removeAttribute('data-theme');

    // set the corresponding data-theme based on appearance
    if (appearance === 'transparent') {
      root.setAttribute('data-theme', 'transparent');
    } else if (appearance === 'light') {
      root.setAttribute('data-theme', 'light');
    } else if (appearance === 'dark') {
      root.setAttribute('data-theme', 'dark');
    } else {
      root.setAttribute('data-theme', 'light');
    }
  }, [appearance]);

  // initialize theme
  useEffect(() => {
    const root = document.documentElement;
    const currentTheme = root.getAttribute('data-theme');

    if (!currentTheme) {
      if (appearance === 'transparent') {
        root.setAttribute('data-theme', 'transparent');
      } else if (appearance === 'dark') {
        root.setAttribute('data-theme', 'dark');
      } else {
        root.setAttribute('data-theme', 'light');
      }
    }
  }, [appearance]); // only execute once when the component is mounted

  return <>{children}</>;
}
