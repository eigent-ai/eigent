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
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/store/authStore';
import {
  autoLoginLocal,
  loginWithPassword,
  refreshAccessToken,
} from '@web/api/server';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const IS_LOCAL_MODE = import.meta.env.VITE_USE_LOCAL_PROXY === 'true';

export default function LoginPage() {
  const token = useAuthStore((state) => state.token);
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (token) {
      navigate('/projects', { replace: true });
      return;
    }
    void refreshAccessToken().then((ok) => {
      if (ok) navigate('/projects', { replace: true });
    });
  }, [token, navigate]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (IS_LOCAL_MODE) {
        await autoLoginLocal();
      } else {
        await loginWithPassword(email.trim(), password);
      }
      navigate('/projects', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-ds-bg-neutral-subtle-default p-4 flex min-h-screen items-center justify-center">
      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="max-w-md rounded-2xl border-ds-border-neutral-subtle-disabled bg-ds-bg-neutral-default-default p-8 shadow-sm w-full border"
      >
        <h1 className="mb-2 text-heading-md font-semibold text-ds-text-neutral-default-default">
          Eigent Remote
        </h1>
        <p className="mb-6 text-body-md text-ds-text-neutral-muted-default">
          Sign in to control your projects from the web.
        </p>

        {IS_LOCAL_MODE ? (
          <p className="mb-4 rounded-lg bg-ds-bg-information-subtle-default p-3 text-body-sm text-ds-text-information-default-default">
            Local mode detected. Click continue to auto-login.
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="mb-1 text-body-sm font-medium block">
                Email
              </label>
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div>
              <label className="mb-1 text-body-sm font-medium block">
                Password
              </label>
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
          </div>
        )}

        {error ? (
          <p className="mt-4 text-body-sm text-ds-text-error-default-default">
            {error}
          </p>
        ) : null}

        <Button type="submit" className="mt-6 w-full" disabled={loading}>
          {loading ? 'Signing in…' : IS_LOCAL_MODE ? 'Continue' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
