import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import loginGif from '@/assets/login.gif';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { proxyFetchPost } from '@/api/http';
import { useTranslation } from 'react-i18next';

export default function ForgotPassword() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [generalError, setGeneralError] = useState('');

  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validateForm = () => {
    if (!email) {
      setEmailError(t('layout.please-enter-email-address'));
      return false;
    }
    if (!validateEmail(email)) {
      setEmailError(t('layout.please-enter-a-valid-email-address'));
      return false;
    }
    setEmailError('');
    return true;
  };

  const handleInputChange = (value: string) => {
    setEmail(value);
    if (emailError) {
      setEmailError('');
    }
    if (generalError) {
      setGeneralError('');
    }
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      return;
    }

    setGeneralError('');
    setIsLoading(true);
    try {
      const data = await proxyFetchPost('/api/forgot-password', {
        email: email,
      });

      if (data.code && data.code !== 0) {
        setGeneralError(data.text || t('layout.forgot-password-failed'));
        return;
      }

      setIsSuccess(true);
    } catch (error: any) {
      console.error('Forgot password request failed:', error);
      setGeneralError(t('layout.forgot-password-failed'));
    } finally {
      setIsLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="p-2 flex items-center justify-center gap-2 h-full">
        <div className="flex items-center justify-center h-full rounded-3xl bg-white-100%">
          <img src={loginGif} className="rounded-3xl h-full object-cover" />
        </div>
        <div className="h-full flex-1 flex flex-col items-center justify-center">
          <div className="flex-1 flex flex-col w-80 items-center justify-center">
            <div className="text-text-heading text-heading-lg font-bold mb-4">
              {t('layout.check-your-email')}
            </div>
            <p className="text-text-secondary text-center mb-6">
              {t('layout.password-reset-email-sent')}
            </p>
            <Button
              onClick={() => navigate('/login')}
              size="md"
              variant="primary"
              className="w-full rounded-full"
            >
              {t('layout.back-to-login')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-2 flex items-center justify-center gap-2 h-full">
      <div className="flex items-center justify-center h-full rounded-3xl bg-white-100%">
        <img src={loginGif} className="rounded-3xl h-full object-cover" />
      </div>
      <div className="h-full flex-1 flex flex-col items-center justify-center">
        <div className="flex-1 flex flex-col w-80 items-center justify-center">
          <div className="flex self-stretch items-end justify-between mb-4">
            <div className="text-text-heading text-heading-lg font-bold">
              {t('layout.forgot-password')}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/login')}
            >
              {t('layout.back-to-login')}
            </Button>
          </div>
          <p className="text-text-secondary text-sm mb-6 self-start">
            {t('layout.forgot-password-description')}
          </p>
          <div className="flex flex-col gap-4 w-full">
            {generalError && (
              <p className="text-text-cuation text-label-md mt-1 mb-4">
                {generalError}
              </p>
            )}
            <div className="flex flex-col gap-4 w-full mb-4">
              <Input
                id="email"
                type="email"
                size="default"
                title={t('layout.email')}
                placeholder={t('layout.enter-your-email')}
                required
                value={email}
                onChange={(e) => handleInputChange(e.target.value)}
                state={emailError ? 'error' : undefined}
                note={emailError}
                onEnter={handleSubmit}
              />
            </div>
          </div>
          <Button
            onClick={handleSubmit}
            size="md"
            variant="primary"
            type="submit"
            className="w-full rounded-full"
            disabled={isLoading}
          >
            <span className="flex-1">
              {isLoading ? t('layout.sending') : t('layout.send-reset-link')}
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
