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

import { Input } from '@/components/ui/input';

import { proxyFetchPost } from '@/api/http';
import eyeOff from '@/assets/eye-off.svg';
import eye from '@/assets/eye.svg';
import github2 from '@/assets/github2.svg';
import google from '@/assets/google.svg';
import WindowControls from '@/components/WindowControls';
import { hasStackKeys } from '@/lib';
import { useTranslation } from 'react-i18next';

import background from '@/assets/background.png';
import eigentLogo from '@/assets/logo/eigent_icon.png';

const HAS_STACK_KEYS = hasStackKeys();
let lock = false;
export default function Login() {
  // Always call hooks unconditionally - React Hooks must be called in the same order
  const stackApp = useStackApp();
  const app = HAS_STACK_KEYS ? stackApp : null;
  const { setAuth, setModelType, setLocalProxyValue } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [hidePassword, setHidePassword] = useState(true);
  const { t } = useTranslation();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [errors, setErrors] = useState({
    email: '',
    password: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [generalError, setGeneralError] = useState('');
  const titlebarRef = useRef<HTMLDivElement>(null);
  const [platform, setPlatform] = useState<string>('');

  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validateForm = () => {
    const newErrors = {
      email: '',
      password: '',
    };

    if (!formData.email) {
      newErrors.email = t('layout.please-enter-email-address');
    } else if (!validateEmail(formData.email)) {
      newErrors.email = t('layout.please-enter-a-valid-email-address');
    }

    if (!formData.password) {
      newErrors.password = t('layout.please-enter-password');
    } else if (formData.password.length < 8) {
      newErrors.password = t('layout.password-must-be-at-least-8-characters');
    }

    setErrors(newErrors);
    return !newErrors.email && !newErrors.password;
  };

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

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));

    if (errors[field as keyof typeof errors]) {
      setErrors((prev) => ({
        ...prev,
        [field]: '',
      }));
    }

    if (generalError) {
      setGeneralError('');
    }
  };

  //
  const handleLogin = async () => {
    if (!validateForm()) {
      return;
    }

    setGeneralError('');
    setIsLoading(true);
    try {
      const data = await proxyFetchPost('/api/login', {
        email: formData.email,
        password: formData.password,
      });

      const errorMessage = getLoginErrorMessage(data);
      if (errorMessage) {
        setGeneralError(errorMessage);
        return;
      }

      setAuth({ email: formData.email, ...data });
      setModelType('cloud');
      // Record VITE_USE_LOCAL_PROXY value at login
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
  };

  const handleLoginByStack = useCallback(
    async (token: string) => {
      try {
        const data = await proxyFetchPost(
          '/api/login-by_stack?token=' + token,
          {
            token: token,
          }
        );

        const errorMessage = getLoginErrorMessage(data);
        if (errorMessage) {
          setGeneralError(errorMessage);
          return;
        }
        console.log('data', data);
        setModelType('cloud');
        setAuth({ email: formData.email, ...data });
        // Record VITE_USE_LOCAL_PROXY value at login
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
      formData.email,
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

  const handleReloadBtn = async (type: string) => {
    if (!app) {
      console.error('Stack app not initialized');
      return;
    }
    console.log('handleReloadBtn1', type);
    const cookies = document.cookie.split('; ');
    cookies.forEach((cookie) => {
      const [name] = cookie.split('=');
      if (name.startsWith('stack-oauth-outer-')) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/`;
      }
    });
    console.log('handleReloadBtn2', type);
    await app.signInWithOAuth(type);
  };

  const handleGetToken = useCallback(
    async (code: string) => {
      const code_verifier = localStorage.getItem('stack-oauth-outer-');
      const formData = new URLSearchParams();
      console.log(
        'import.meta.env.PROD',
        import.meta.env.PROD
          ? `${import.meta.env.VITE_BASE_URL}/api/redirect/callback`
          : `${import.meta.env.VITE_PROXY_URL}/api/redirect/callback`
      );
      formData.append(
        'redirect_uri',
        import.meta.env.PROD
          ? `${import.meta.env.VITE_BASE_URL}/api/redirect/callback`
          : `${import.meta.env.VITE_PROXY_URL}/api/redirect/callback`
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
        const data = await res.json(); // parse response data
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
      // On login page, always close directly without confirmation
      window.electronAPI.closeWindow(true);
    };

    window.ipcRenderer?.on('before-close', handleBeforeClose);

    return () => {
      window.ipcRenderer?.off('before-close', handleBeforeClose);
    };
  }, []);

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
          <div className="relative flex w-80 flex-1 flex-col items-center justify-center pt-8">
            <img
              src={eigentLogo}
              className="absolute left-1/2 top-10 h-16 w-16 -translate-x-1/2"
            />
            <div className="mb-4 flex items-end justify-between self-stretch">
              <div className="text-heading-lg font-bold text-text-heading">
                {t('layout.login')}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (import.meta.env.VITE_USE_LOCAL_PROXY === 'true') {
                    navigate('/signup');
                  } else {
                    window.open(
                      'https://www.eigent.ai/signup',
                      '_blank',
                      'noopener,noreferrer'
                    );
                  }
                }}
              >
                {t('layout.sign-up')}
              </Button>
            </div>
            {HAS_STACK_KEYS && (
              <div className="w-full pt-6">
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => handleReloadBtn('google')}
                  className="mb-4 w-full justify-center rounded-[24px] text-center font-inter text-[15px] font-bold leading-[22px] text-[#F5F5F5] transition-all duration-300 ease-in-out"
                  disabled={isLoading}
                >
                  <img src={google} className="h-5 w-5" />
                  <span className="ml-2">
                    {t('layout.continue-with-google-login')}
                  </span>
                </Button>
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => handleReloadBtn('github')}
                  className="mb-4 w-full justify-center rounded-[24px] text-center font-inter text-[15px] font-bold leading-[22px] text-[#F5F5F5] transition-all duration-300 ease-in-out"
                  disabled={isLoading}
                >
                  <img src={github2} className="h-5 w-5" />
                  <span className="ml-2">
                    {t('layout.continue-with-github-login')}
                  </span>
                </Button>
              </div>
            )}
            {HAS_STACK_KEYS && (
              <div className="mb-6 mt-2 w-full text-center font-inter text-[15px] font-medium leading-[22px] text-[#222]">
                {t('layout.or')}
              </div>
            )}
            <div className="flex w-full flex-col gap-4">
              {generalError && (
                <p className="mb-4 mt-1 text-label-md text-text-cuation">
                  {generalError}
                </p>
              )}
              <div className="relative mb-4 flex w-full flex-col gap-4">
                <Input
                  id="email"
                  type="email"
                  size="default"
                  title={t('layout.email')}
                  placeholder={t('layout.enter-your-email')}
                  required
                  value={formData.email}
                  onChange={(e) => handleInputChange('email', e.target.value)}
                  state={errors.email ? 'error' : undefined}
                  note={errors.email}
                  onEnter={handleLogin}
                />

                <Input
                  id="password"
                  title={t('layout.password')}
                  size="default"
                  type={hidePassword ? 'password' : 'text'}
                  required
                  placeholder={t('layout.enter-your-password')}
                  value={formData.password}
                  onChange={(e) =>
                    handleInputChange('password', e.target.value)
                  }
                  state={errors.password ? 'error' : undefined}
                  note={errors.password}
                  backIcon={<img src={hidePassword ? eye : eyeOff} />}
                  onBackIconClick={() => setHidePassword(!hidePassword)}
                  onEnter={handleLogin}
                />
              </div>
            </div>
            <div className="w-full flex justify-end mb-4">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  if (import.meta.env.VITE_USE_LOCAL_PROXY === 'true') {
                    navigate('/forgot-password');
                  } else {
                    window.open(
                      'https://www.eigent.ai/forgot-password',
                      '_blank',
                      'noopener,noreferrer'
                    );
                  }
                }}
              >
                {t('layout.forgot-password')}
              </Button>
            </div>
            <Button
              onClick={handleLogin}
              size="md"
              variant="primary"
              type="submit"
              className="w-full rounded-full"
              disabled={isLoading}
            >
              <span className="flex-1">
                {isLoading ? t('layout.logging-in') : t('layout.log-in')}
              </span>
            </Button>
          </div>
          <Button
            variant="ghost"
            size="xs"
            onClick={() =>
              window.open(
                'https://www.eigent.ai/privacy-policy',
                '_blank',
                'noopener,noreferrer'
              )
            }
          >
            {t('layout.privacy-policy')}
          </Button>
        </div>
      </div>
    </div>
  );
}
