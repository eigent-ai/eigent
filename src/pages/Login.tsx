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
import { useStackApp } from '@stackframe/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { proxyFetchGet, proxyFetchPost } from '@/api/http';
import WindowControls from '@/components/WindowControls';
import { hasStackKeys } from '@/lib';
import { useTranslation } from 'react-i18next';

import background from '@/assets/background.png';
import eigentLogo from '@/assets/logo/eigent_icon.png';

const HAS_STACK_KEYS = hasStackKeys();
const IS_LOCAL_MODE = import.meta.env.VITE_USE_LOCAL_PROXY === 'true';
let lock = false;

export default function Login() {
  // Always call hooks unconditionally - React Hooks must be called in the same order
  const stackApp = useStackApp();
  const app = HAS_STACK_KEYS ? stackApp : null;
  const {
    setAuth,
    setModelType,
    setLocalProxyValue,
    setInitState,
    setIsFirstLaunch,
  } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [generalError, setGeneralError] = useState('');
  const [callbackUrl, setCallbackUrl] = useState<string | null>(null);
  const titlebarRef = useRef<HTMLDivElement>(null);
  const [platform, setPlatform] = useState<string>('');

  const getLoginErrorMessage = useCallback(
    (data: any) => {
      if (!data || typeof data !== 'object' || typeof data.code !== 'number') {
        return '';
      }

      if (data.code === 0) {
        return '';
      }

      if (data.code === 10) {
        return (
          data.text ||
          t('layout.login-failed-please-check-your-email-and-password')
        );
      }

      if (
        data.code === 1 &&
        Array.isArray(data.error) &&
        data.error.length > 0
      ) {
        const firstError = data.error[0];
        if (typeof firstError === 'string') {
          return firstError;
        }
        if (typeof firstError?.msg === 'string') {
          return firstError.msg;
        }
        if (typeof firstError?.message === 'string') {
          return firstError.message;
        }
      }

      return data.text || t('layout.login-failed-please-try-again');
    },
    [t]
  );

  // Auto login for local mode - calls /api/v1/user/auto-login
  const handleAutoLogin = async () => {
    setGeneralError('');
    setIsLoading(true);
    try {
      const data = await proxyFetchPost('/api/v1/user/auto-login', {});

      const errorMessage = getLoginErrorMessage(data);
      if (errorMessage) {
        setGeneralError(errorMessage);
        return;
      }

      setAuth({ email: data.email, ...data });
      setLocalProxyValue(import.meta.env.VITE_USE_LOCAL_PROXY || null);
      setModelType('custom');
      setInitState('done');
      setIsFirstLaunch(false);
      navigate('/');
    } catch (error: any) {
      console.error('Auto login failed:', error);
      setGeneralError(t('layout.login-failed-please-try-again'));
    } finally {
      setIsLoading(false);
    }
  };

  // Hybrid/app mode: handle Stack Auth callback (reuse existing OAuth flow)
  const handleLoginByStack = useCallback(
    async (token: string) => {
      try {
        const data = await proxyFetchPost(
          '/api/v1/login-by_stack?token=' + token,
          {
            token: token,
          }
        );

        const errorMessage = getLoginErrorMessage(data);
        if (errorMessage) {
          setGeneralError(errorMessage);
          return;
        }
        setModelType('cloud');
        setAuth({ email: data.email, ...data });
        const localProxyValue = import.meta.env.VITE_USE_LOCAL_PROXY || null;
        setLocalProxyValue(localProxyValue);
        navigate('/');
      } catch (error: any) {
        console.error('Login failed:', error);
        setGeneralError(
          t('layout.login-failed-please-check-your-email-and-password')
        );
      } finally {
        setIsLoading(false);
      }
    },
    [
      navigate,
      setAuth,
      setModelType,
      setLocalProxyValue,
      setGeneralError,
      setIsLoading,
      getLoginErrorMessage,
      t,
    ]
  );

  const handleGetToken = useCallback(
    async (code: string) => {
      const code_verifier = localStorage.getItem('stack-oauth-outer-');
      const formData = new URLSearchParams();
      formData.append(
        'redirect_uri',
        import.meta.env.PROD
          ? `${import.meta.env.VITE_BASE_URL}/api/v1/redirect/callback`
          : `${import.meta.env.VITE_PROXY_URL}/api/v1/redirect/callback`
      );
      formData.append('code_verifier', code_verifier || '');
      formData.append('code', code);
      formData.append('grant_type', 'authorization_code');
      formData.append('client_id', 'aa49cdd0-318e-46bd-a540-0f1e5f2b391f');
      formData.append(
        'client_secret',
        'pck_t13egrd9ve57tz52kfcd2s4h1zwya5502z43kr5xv5cx8'
      );

      try {
        const res = await fetch(
          'https://api.stack-auth.com/api/v1/auth/oauth/token',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            },
            body: formData,
          }
        );
        const data = await res.json();
        return data.access_token;
      } catch (error) {
        console.error(error);
        setIsLoading(false);
      }
    },
    [setIsLoading]
  );

  const handleAuthCode = useCallback(
    async (event: any, code: string) => {
      if (lock || location.pathname !== '/login') return;

      lock = true;
      setIsLoading(true);
      let accessToken = await handleGetToken(code);
      handleLoginByStack(accessToken);
      setTimeout(() => {
        lock = false;
      }, 1500);
    },
    [location.pathname, handleLoginByStack, handleGetToken, setIsLoading]
  );

  // Listen for direct token callback from Electron (eigent.ai login redirect)
  useEffect(() => {
    const handleTokenReceived = async (_event: any, token: string) => {
      if (!token) return;
      setIsLoading(true);
      // Temporarily set token so proxyFetchGet can use it for auth
      setAuth({ email: '', token, username: '', user_id: 0 });
      setLocalProxyValue(import.meta.env.VITE_USE_LOCAL_PROXY || null);
      try {
        const userInfo = await proxyFetchGet('/api/v1/user');
        if (userInfo && userInfo.email) {
          setAuth({
            token,
            email: userInfo.email,
            username:
              userInfo.username ||
              userInfo.nickname ||
              userInfo.fullname ||
              userInfo.email?.split('@')[0] ||
              '',
            user_id:
              userInfo.id || JSON.parse(atob(token.split('.')[1])).id || 0,
          });
        }
      } catch (e) {
        console.error('Failed to fetch user info:', e);
      }
      navigate('/');
    };

    window.ipcRenderer?.on('auth-token-received', handleTokenReceived);

    return () => {
      window.ipcRenderer?.off('auth-token-received', handleTokenReceived);
    };
  }, [setAuth, setLocalProxyValue, navigate]);

  // Listen for auth code callback from Electron (Stack Auth OAuth flow)
  useEffect(() => {
    window.ipcRenderer?.on('auth-code-received', handleAuthCode);

    return () => {
      window.ipcRenderer?.off('auth-code-received', handleAuthCode);
    };
  }, [handleAuthCode]);

  useEffect(() => {
    const p = window.electronAPI.getPlatform();
    setPlatform(p);

    if (platform === 'darwin') {
      titlebarRef.current?.classList.add('mac');
    }
  }, [platform]);

  // Handle before-close event for login page
  useEffect(() => {
    const handleBeforeClose = () => {
      window.electronAPI.closeWindow(true);
    };

    window.ipcRenderer?.on('before-close', handleBeforeClose);

    return () => {
      window.ipcRenderer?.off('before-close', handleBeforeClose);
    };
  }, []);

  // Hybrid/app mode: prepare auth callback URL on mount (don't auto-open browser)
  useEffect(() => {
    if (IS_LOCAL_MODE) return;

    const prepareCallbackUrl = async () => {
      let cbUrl: string;
      if (import.meta.env.PROD) {
        cbUrl = 'eigent://auth/callback';
      } else {
        cbUrl = 'eigent://auth/callback';
        try {
          const url = await window.ipcRenderer?.invoke('get-auth-callback-url');
          if (url) cbUrl = url;
        } catch (e) {
          // Fallback to eigent:// protocol
        }
      }
      setCallbackUrl(cbUrl);
    };

    prepareCallbackUrl();
  }, []);

  // Render local mode: "Start Eigent" button only
  const renderLocalMode = () => (
    <div className="relative flex w-80 flex-1 flex-col items-center justify-center pt-8">
      <img
        src={eigentLogo}
        className="absolute left-1/2 top-10 h-16 w-16 -translate-x-1/2"
      />
      <div className="mb-8 text-heading-lg font-bold text-text-heading">
        Eigent
      </div>
      {generalError && (
        <p className="mb-4 mt-1 text-label-md text-text-cuation">
          {generalError}
        </p>
      )}
      <Button
        onClick={handleAutoLogin}
        size="lg"
        variant="primary"
        className="w-full rounded-full"
        disabled={isLoading}
      >
        <span className="flex-1">
          {isLoading ? t('layout.logging-in') : 'Start Eigent'}
        </span>
      </Button>
    </div>
  );

  // Render hybrid/app mode: waiting for external login callback
  const renderHybridMode = () => (
    <div className="relative flex w-80 flex-1 flex-col items-center justify-center pt-8">
      <img
        src={eigentLogo}
        className="absolute left-1/2 top-10 h-16 w-16 -translate-x-1/2"
      />
      <div className="mb-4 text-heading-lg font-bold text-text-heading">
        {t('layout.login')}
      </div>
      {isLoading && (
        <p className="mb-6 text-center text-label-md text-text-secondary">
          {t('layout.logging-in')}...
        </p>
      )}
      <Button
        onClick={() => {
          setIsLoading(true);
          window.open(
            `https://www.eigent.ai/signin?callbackUrl=${encodeURIComponent(callbackUrl || 'eigent://auth/callback')}`,
            '_blank',
            'noopener,noreferrer'
          );
        }}
        size="lg"
        variant="primary"
        className="w-full rounded-full"
      >
        <span className="flex-1">{t('layout.log-in')}</span>
      </Button>
    </div>
  );

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* Titlebar with drag region and window controls */}
      <div
        className="absolute left-0 right-0 top-0 z-50 flex !h-9 items-center justify-between py-1 pl-2"
        id="login-titlebar"
        ref={titlebarRef}
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Center drag region */}
        <div
          className="flex h-full flex-1 items-center"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <div className="h-10 flex-1"></div>
        </div>

        {/* Right window controls */}
        <div
          style={
            {
              WebkitAppRegion: 'no-drag',
              pointerEvents: 'auto',
            } as React.CSSProperties
          }
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <WindowControls />
        </div>
      </div>

      {/* Main content - image extends to top, form has padding */}
      <div
        className={`flex h-full items-center justify-center gap-2 px-2 pb-2 pt-10`}
      >
        <div
          className="flex h-full min-h-0 w-full flex-col items-center justify-center overflow-hidden rounded-2xl border-solid border-border-tertiary bg-surface-secondary px-2 pb-2"
          style={{
            backgroundImage: `url(${background})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          {IS_LOCAL_MODE ? renderLocalMode() : renderHybridMode()}
        </div>
      </div>
    </div>
  );
}
