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
import eyeOff from '@/assets/eye-off.svg';
import eye from '@/assets/eye.svg';
import github2 from '@/assets/github2.svg';
import google from '@/assets/google.svg';
import { Input } from '@/components/ui/input';
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
  const [hidePassword, setHidePassword] = useState(true);
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({ email: '', password: '' });
  const [isLoading, setIsLoading] = useState(false);
  const [generalError, setGeneralError] = useState('');
  const [callbackUrl, setCallbackUrl] = useState<string | null>(null);
  const titlebarRef = useRef<HTMLDivElement>(null);
  const [platform, setPlatform] = useState<string>('');
  const [rememberMe, setRememberMe] = useState(
    () => localStorage.getItem('rememberMe') === 'true'
  );
  const [savedAccounts, setSavedAccounts] = useState<
    Array<{
      email: string;
      token: string;
      username: string;
      user_id: number;
      password: string;
    }>
  >([]);
  const [showSavedAccounts, setShowSavedAccounts] = useState(false);
  const savedAccountsRef = useRef<HTMLDivElement>(null);

  const validateEmail = (email: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const validateForm = () => {
    const newErrors = {
      email: formData.email
        ? validateEmail(formData.email)
          ? ''
          : t('layout.please-enter-a-valid-email-address')
        : t('layout.please-enter-email-address'),
      password: formData.password
        ? formData.password.length >= 8
          ? ''
          : t('layout.password-must-be-at-least-8-characters')
        : t('layout.please-enter-password'),
    };
    setErrors(newErrors);
    return !newErrors.email && !newErrors.password;
  };

  const handleInputChange = (field: string, value: string) => {
    if (field === 'email') {
      const trimmed = value.trim();
      const exactMatch = savedAccounts.find(
        (a) => a.email.toLowerCase() === trimmed.toLowerCase()
      );
      const passwordToFill = exactMatch?.password ?? '';
      setFormData((prev) => ({
        ...prev,
        email: value,
        password: passwordToFill,
      }));
    } else {
      setFormData((prev) => ({ ...prev, [field]: value }));
    }
    if (errors[field as keyof typeof errors]) {
      setErrors((prev) => ({ ...prev, [field]: '' }));
    }
    if (generalError) setGeneralError('');
    if (field === 'email') {
      const input = value.toLowerCase();
      const hasMatch = savedAccounts.some((a) =>
        a.email.toLowerCase().startsWith(input)
      );
      setShowSavedAccounts(hasMatch && savedAccounts.length > 0);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const result = await window.electronAPI.credentialsLoad();
        if (result.success && result.accounts.length > 0) {
          setSavedAccounts(result.accounts);
        }
      } catch {
        // Non-critical
      }
    })();
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        savedAccountsRef.current &&
        !savedAccountsRef.current.contains(e.target as Node)
      ) {
        setShowSavedAccounts(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectAccount = (account: {
    email: string;
    token: string;
    username: string;
    user_id: number;
    password: string;
  }) => {
    setShowSavedAccounts(false);
    setFormData({
      email: account.email,
      password: account.password || '',
    });
    setErrors({ email: '', password: '' });
    setGeneralError('');
  };

  const handleRemoveAccount = async (e: React.MouseEvent, email: string) => {
    e.stopPropagation();
    await window.electronAPI.credentialsRemove(email);
    const updated = savedAccounts.filter(
      (a) => a.email.toLowerCase() !== email.toLowerCase()
    );
    setSavedAccounts(updated);
    if (formData.email.toLowerCase() === email.toLowerCase()) {
      setFormData({ email: '', password: '' });
    }
  };

  const filteredAccounts = savedAccounts.filter((a) =>
    a.email.toLowerCase().startsWith(formData.email.toLowerCase())
  );

  // Form login (cloud/hybrid): email + password → /api/login
  const handleLogin = async () => {
    if (!validateForm()) return;
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
      if (rememberMe) {
        const saveResult = await window.electronAPI.credentialsSave(
          formData.email,
          data.token,
          data.username ?? '',
          data.user_id ?? 0,
          formData.password
        );
        if (!saveResult.success) {
          // Best-effort: still allow login
        }
      }
      setAuth({ email: formData.email, ...data });
      setModelType('cloud');
      setLocalProxyValue(import.meta.env.VITE_USE_LOCAL_PROXY || null);
      navigate('/');
    } catch {
      setGeneralError(
        t('layout.login-failed-please-check-your-email-and-password')
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Local mode: single button → /api/auto-login
  const handleAutoLogin = async () => {
    setGeneralError('');
    setIsLoading(true);
    try {
      const data = await proxyFetchPost('/api/auto-login', {});
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
    } catch {
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
        setModelType('cloud');
        setAuth({ email: data.email, ...data });
        const localProxyValue = import.meta.env.VITE_USE_LOCAL_PROXY || null;
        setLocalProxyValue(localProxyValue);
        navigate('/');
      } catch {
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

  const handleReloadBtn = async (type: string) => {
    if (!app) return;
    const cookies = document.cookie.split('; ');
    cookies.forEach((cookie) => {
      const [name] = cookie.split('=');
      if (name.startsWith('stack-oauth-outer-')) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/`;
      }
    });
    await app.signInWithOAuth(type);
  };

  const handleGetToken = useCallback(
    async (code: string) => {
      const code_verifier = localStorage.getItem('stack-oauth-outer-');
      const formData = new URLSearchParams();
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
        const data = await res.json();
        return data.access_token;
      } catch {
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
      const accessToken = await handleGetToken(code);
      if (!accessToken) {
        setGeneralError(
          t('layout.login-failed-please-check-your-email-and-password')
        );
        setIsLoading(false);
        lock = false;
        return;
      }
      handleLoginByStack(accessToken);
      setTimeout(() => {
        lock = false;
      }, 1500);
    },
    [
      location.pathname,
      handleLoginByStack,
      handleGetToken,
      setIsLoading,
      setGeneralError,
      t,
    ]
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
        const userInfo = await proxyFetchGet('/api/user');
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
      } catch {
        // Non-critical: still navigate
      }
      setIsLoading(false);
      navigate('/', { replace: true });
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
          {IS_LOCAL_MODE
            ? renderLocalMode()
            : (() => (
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
                        if (IS_LOCAL_MODE) {
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
                      <div className="relative" ref={savedAccountsRef}>
                        <Input
                          id="email"
                          type="email"
                          size="default"
                          title={t('layout.email')}
                          placeholder={t('layout.enter-your-email')}
                          required
                          value={formData.email}
                          onChange={(e) =>
                            handleInputChange('email', e.target.value)
                          }
                          state={errors.email ? 'error' : undefined}
                          note={errors.email}
                          onEnter={handleLogin}
                          onFocus={() => {
                            if (savedAccounts.length > 0) {
                              setShowSavedAccounts(true);
                            }
                          }}
                        />
                        {showSavedAccounts && filteredAccounts.length > 0 && (
                          <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-border-tertiary bg-surface-primary shadow-lg">
                            <div className="px-3 py-2 text-label-sm text-text-secondary">
                              {t('layout.saved-accounts')}
                            </div>
                            {filteredAccounts.map((account) => (
                              <div
                                key={account.email}
                                className="flex cursor-pointer items-center justify-between px-3 py-2 hover:bg-surface-secondary"
                                onClick={() => handleSelectAccount(account)}
                              >
                                <span className="text-label-md text-text-primary">
                                  {account.email}
                                </span>
                                <button
                                  className="text-label-sm text-text-secondary hover:text-text-primary"
                                  onClick={(e) =>
                                    handleRemoveAccount(e, account.email)
                                  }
                                >
                                  {t('layout.remove-account')}
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
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
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={rememberMe}
                          onChange={(e) => {
                            setRememberMe(e.target.checked);
                            localStorage.setItem(
                              'rememberMe',
                              String(e.target.checked)
                            );
                          }}
                          className="h-4 w-4 cursor-pointer rounded border-border-tertiary accent-[#0D0D0D]"
                        />
                        <span className="text-label-md text-text-secondary">
                          {t('layout.remember-me')}
                        </span>
                      </label>
                    </div>
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
              ))()}
        </div>
      </div>
    </div>
  );
}
