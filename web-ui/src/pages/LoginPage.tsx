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

import background from '@/assets/background.png';
import eigentLogo from '@/assets/logo/eigent.svg';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/store/authStore';
import {
  autoLoginLocal,
  loginWithPassword,
  refreshAccessToken,
} from '@web/api/server';
import { isWebUiMock } from '@web/lib/mockMode';
import { mockBootstrapAuth } from '@web/mock/auth';
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
    if (isWebUiMock()) {
      mockBootstrapAuth();
      navigate('/projects', { replace: true });
      return;
    }
    void refreshAccessToken().then((ok) => {
      if (ok) {
        navigate('/projects', { replace: true });
        return;
      }
      if (import.meta.env.DEV) {
        void autoLoginLocal()
          .then(() => navigate('/projects', { replace: true }))
          .catch(() => {
            // fall back to manual sign-in in dev if auto-login is unavailable
          });
      }
    });
  }, [token, navigate]);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      if (IS_LOCAL_MODE || isWebUiMock()) {
        if (isWebUiMock()) {
          mockBootstrapAuth();
        } else {
          await autoLoginLocal();
        }
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

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void handleLogin();
  };

  return (
    <div
      className="inset-0 p-3 sm:p-4 fixed flex min-h-screen flex-col items-center justify-center overflow-x-hidden overflow-y-auto bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: `url(${background})` }}
    >
      <div className="top-4 sm:top-6 absolute left-1/2 z-10 shrink-0 -translate-x-1/2">
        <a
          href="https://eigent.ai"
          className="transition-opacity duration-200 hover:opacity-80"
        >
          <img
            src={eigentLogo}
            alt="Eigent"
            className="h-10 w-auto"
            width={140}
            height={40}
          />
        </a>
      </div>

      <div className="max-w-sm min-w-0 gap-5 px-4 py-5 sm:gap-6 sm:px-6 sm:py-7 flex w-full flex-col">
        <div className="space-y-2 mb-4">
          <h1 className="text-heading-sm sm:text-heading-base md:text-heading-lg font-bold leading-tight text-ds-text-neutral-default-default">
            Sign In
          </h1>
          <p className="text-body-sm text-ds-text-neutral-muted-default">
            Sign in to control your projects from the web.
          </p>
        </div>

        {IS_LOCAL_MODE ? (
          <div className="gap-3 flex flex-col">
            <p className="rounded-xl border-ds-border-information-subtle-default bg-ds-bg-information-subtle-default px-3 py-2 text-body-sm text-ds-text-information-default-default border">
              Local mode detected. Click continue to auto-login.
            </p>
            <Button
              type="button"
              variant="primary"
              size="md"
              buttonContent="text"
              buttonRadius="full"
              className="px-3 w-full justify-center"
              disabled={loading}
              onClick={() => void handleLogin()}
            >
              {loading ? 'Signing in…' : 'Continue'}
            </Button>
          </div>
        ) : (
          <form
            onSubmit={(event) => void handleSubmit(event)}
            className="gap-3 flex flex-col"
          >
            <Input
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setError(null);
              }}
              placeholder="Enter your email"
              required
              autoComplete="email"
              disabled={loading}
            />
            <Input
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setError(null);
              }}
              placeholder="Enter your password"
              required
              autoComplete="current-password"
              disabled={loading}
            />
            <Button
              type="submit"
              variant="primary"
              size="md"
              buttonContent="text"
              buttonRadius="full"
              className="px-3 w-full justify-center"
              disabled={loading}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        )}

        {error ? (
          <div className="rounded-xl border-ds-border-error-subtle-default bg-ds-bg-error-subtle-default px-3 py-2 text-body-sm text-ds-text-error-default-default border">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
