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
import { autoLoginLocal, refreshAccessToken } from '@web/api/server';
import { isWebUiMock } from '@web/lib/mockMode';
import { mockBootstrapAuth } from '@web/mock/auth';
import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';

export function ProtectedRoute() {
  const token = useAuthStore((state) => state.token);
  const [checking, setChecking] = useState(!token);

  useEffect(() => {
    if (isWebUiMock()) {
      mockBootstrapAuth();
      setChecking(false);
      return;
    }

    if (token) {
      setChecking(false);
      return;
    }
    void refreshAccessToken()
      .then((ok) => {
        if (ok || !import.meta.env.DEV) return;
        return autoLoginLocal()
          .then(() => true)
          .catch(() => false);
      })
      .finally(() => setChecking(false));
  }, [token]);

  if (checking) {
    return (
      <div className="flex h-screen items-center justify-center text-ds-text-neutral-muted-default">
        Checking session…
      </div>
    );
  }

  const currentToken = useAuthStore.getState().token;
  if (!currentToken) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
