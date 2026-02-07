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

import { proxyFetchPost, proxyFetchPut } from '@/api/http';
import background from '@/assets/background.png';
import eyeOff from '@/assets/eye-off.svg';
import eye from '@/assets/eye.svg';
import github2 from '@/assets/github2.svg';
import google from '@/assets/google.svg';
import eigentLogo from '@/assets/logo/eigent_icon.png';
import { Checkbox } from '@/components/ui/checkbox';
import WindowControls from '@/components/WindowControls';
import { hasStackKeys } from '@/lib';
import { useTranslation } from 'react-i18next';

const HAS_STACK_KEYS = hasStackKeys();
let lock = false;
export default function SignUp() {
  // Always call hooks unconditionally - React Hooks must be called in the same order
  const stackApp = useStackApp();
  const app = HAS_STACK_KEYS ? stackApp : null;
  const { setAuth, initState: _initState } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [hidePassword, setHidePassword] = useState(true);
  const { t } = useTranslation();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    invite_code: '',
  });
  const [errors, setErrors] = useState({
    email: '',
    password: '',
    invite_code: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [generalError, setGeneralError] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const titlebarRef = useRef<HTMLDivElement | null>(null);
  const [platform, setPlatform] = useState<string>('');

  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const acceptPrivacy = async () => {
    try {
      await proxyFetchPut('/api/user/privacy', {
        take_screenshot: true,
        access_local_software: true,
        access_your_address: true,
        password_storage: true,
      });
    } catch (err) {
      console.error('Failed to set privacy:', err);
    }
  };

  const validateForm = () => {
    const newErrors = {
      email: '',
      password: '',
      invite_code: '',
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

  const handleRegister = async () => {
    if (!termsAccepted) {
      setGeneralError(t('layout.please-accept-terms'));
      return;
    }
    if (!validateForm()) {
      return;
    }

    setGeneralError('');
    setIsLoading(true);
    try {
      const data = await proxyFetchPost('/api/register', {
        email: formData.email,
        password: formData.password,
        invite_code: formData.invite_code,
      });

      if (data.code === 10 || data.code === 1) {
        setGeneralError(
          data.text || t('layout.sign-up-failed-please-try-again')
        );
        return;
      }
      if (data.code === 100 && data.error) {
        let errors = {
          email: '',
          password: '',
          invite_code: '',
        };
        data.error.map((item: any) => {
          errors[item.loc.at(-1) as keyof typeof errors] = item.msg.replace(
            t('layout.value-error'),
            ''
          );
        });
        setErrors(errors);
        return;
      }

      // setAuth({ email: formData.email, ...data });
      navigate('/login');
    } catch (error: any) {
      console.error('Sign up failed:', error);
      setGeneralError(
        t('layout.sign-up-failed-please-check-your-email-and-password')
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
            invite_code: localStorage.getItem('invite_code') || '',
          }
        );

        if (data.code === 10) {
          setGeneralError(
            data.text || t('layout.login-failed-please-try-again')
          );
          return;
        }
        console.log('data', data);
        setAuth({ email: formData.email, ...data });
        acceptPrivacy();
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
    [formData.email, navigate, setAuth, setGeneralError, setIsLoading, t]
  );

  const handleReloadBtn = async (type: string) => {
    if (!termsAccepted) {
      setGeneralError(t('layout.please-accept-terms'));
      return;
    }
    localStorage.setItem('invite_code', formData.invite_code);
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
      formData.append('client_id', '7b927864-23c3-4bff-969f-ef90e85f1707');
      formData.append(
        'client_secret',
        'pck_r0g1stv09a2fy2ecnc8tfnzt1rdp2dntemt37pjfc4am0'
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
      if (lock || location.pathname !== '/signup') return;

      lock = true;
      setIsLoading(true);
      const accessToken = await handleGetToken(code);
      await handleLoginByStack(accessToken);
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

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* Titlebar with drag region and window controls */}
      <div
        className="absolute left-0 right-0 top-0 z-50 flex !h-9 items-center justify-between py-1 pl-2"
        id="signup-titlebar"
        ref={titlebarRef}
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Center drag region */}
        <div
          className="flex h-full flex-1 items-center"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <div className="h-10 flex-1" />
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
                {t('layout.sign-up')}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/login')}
              >
                {t('layout.login')}
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
                    {t('layout.continue-with-google-sign-up')}
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
                    {t('layout.continue-with-github-sign-up')}
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
                />

                <Input
                  id="invite_code"
                  title={t('layout.invitation-code-optional')}
                  size="default"
                  type="text"
                  placeholder={t('layout.enter-your-invite-code')}
                  value={formData.invite_code}
                  onChange={(e) =>
                    handleInputChange('invite_code', e.target.value)
                  }
                  state={errors.invite_code ? 'error' : undefined}
                  note={errors.invite_code}
                />
              </div>
            </div>
            <Button
              onClick={handleRegister}
              size="md"
              variant="primary"
              type="submit"
              className="w-full rounded-full"
              disabled={isLoading}
            >
              <span className="flex-1">
                {isLoading ? t('layout.signing-up') : t('layout.sign-up')}
              </span>
            </Button>
          </div>
          <div className="flex items-center gap-2 px-2 py-1">
            <Checkbox
              id="terms"
              checked={termsAccepted}
              onCheckedChange={(checked) => setTermsAccepted(checked === true)}
            />
            <label
              htmlFor="terms"
              className="cursor-pointer text-label-xs font-medium leading-normal text-text-body"
            >
              {t('layout.agree-to-terms')}{' '}
              <a
                href="https://www.eigent.ai/terms-of-use"
                target="_blank"
                className="text-text-information underline"
                onClick={(e) => e.stopPropagation()}
                rel="noreferrer"
              >
                {t('layout.terms-of-use')}
              </a>{' '}
              {t('layout.and')}{' '}
              <a
                href="https://www.eigent.ai/privacy-policy"
                target="_blank"
                className="text-text-information underline"
                onClick={(e) => e.stopPropagation()}
                rel="noreferrer"
              >
                {t('layout.privacy-policy')}
              </a>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
