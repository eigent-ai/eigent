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
import { logoutWeb, refreshAccessToken } from '@web/api/server';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export function useWebAuthGuard() {
  const token = useAuthStore((state) => state.token);
  const navigate = useNavigate();

  useEffect(() => {
    if (!token) {
      void refreshAccessToken().then((ok) => {
        if (!ok) {
          navigate('/login', { replace: true });
        }
      });
    }
  }, [token, navigate]);

  return { token };
}

export function useLogout() {
  const navigate = useNavigate();
  return useCallback(() => {
    logoutWeb();
    navigate('/login', { replace: true });
  }, [navigate]);
}

export function useMediaQuery(query: string): boolean {
  const getMatch = () =>
    typeof window !== 'undefined' && window.matchMedia(query).matches;

  const [matches, setMatches] = useState(getMatch);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);

  return matches;
}

export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 767px)');
}

export function useIsTablet(): boolean {
  return useMediaQuery('(min-width: 768px) and (max-width: 1023px)');
}
