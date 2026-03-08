import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import loginGif from '@/assets/login.gif';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { proxyFetchPost } from '@/api/http';
import { useTranslation } from 'react-i18next';
import eye from '@/assets/eye.svg';
import eyeOff from '@/assets/eye-off.svg';

export default function ForgotPassword() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmPasswordError, setConfirmPasswordError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [generalError, setGeneralError] = useState('');
  const [hidePassword, setHidePassword] = useState(true);
  const [hideConfirmPassword, setHideConfirmPassword] = useState(true);

  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validatePassword = (password: string) => {
    const hasLetter = /[a-zA-Z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    return password.length >= 8 && hasLetter && hasNumber;
  };

  const validateForm = () => {
    let isValid = true;

    if (!email) {
      setEmailError(t('layout.please-enter-email-address'));
      isValid = false;
    } else if (!validateEmail(email)) {
      setEmailError(t('layout.please-enter-a-valid-email-address'));
      isValid = false;
    } else {
      setEmailError('');
    }

    if (!newPassword) {
      setPasswordError(t('layout.please-enter-password'));
      isValid = false;
    } else if (!validatePassword(newPassword)) {
      setPasswordError(t('layout.password-must-contain-letters-and-numbers'));
      isValid = false;
    } else {
      setPasswordError('');
    }

    if (!confirmPassword) {
      setConfirmPasswordError(t('layout.please-confirm-password'));
      isValid = false;
    } else if (newPassword !== confirmPassword) {
      setConfirmPasswordError(t('layout.passwords-do-not-match'));
      isValid = false;
    } else {
      setConfirmPasswordError('');
    }

    return isValid;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      return;
    }

    setGeneralError('');
    setIsLoading(true);
    try {
      const data = await proxyFetchPost('/api/reset-password-direct', {
        email: email,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });

      if (data.code && data.code !== 0) {
        setGeneralError(data.text || t('layout.reset-password-failed'));
        return;
      }

      setIsSuccess(true);
    } catch (error: any) {
      console.error('Reset password request failed:', error);
      setGeneralError(t('layout.reset-password-failed'));
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
              {t('layout.password-reset-success')}
            </div>
            <p className="text-text-secondary text-center mb-6">
              {t('layout.password-reset-success-description')}
            </p>
            <Button
              onClick={() => navigate('/login')}
              size="md"
              variant="primary"
              className="w-full rounded-full"
            >
              {t('layout.go-to-login')}
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
              {t('layout.reset-password')}
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
            {t('layout.reset-password-description')}
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
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (emailError) setEmailError('');
                  if (generalError) setGeneralError('');
                }}
                state={emailError ? 'error' : undefined}
                note={emailError}
              />
              <Input
                id="newPassword"
                type={hidePassword ? 'password' : 'text'}
                size="default"
                title={t('layout.new-password')}
                placeholder={t('layout.enter-new-password')}
                required
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  if (passwordError) setPasswordError('');
                  if (generalError) setGeneralError('');
                }}
                state={passwordError ? 'error' : undefined}
                note={passwordError}
                backIcon={<img src={hidePassword ? eye : eyeOff} />}
                onBackIconClick={() => setHidePassword(!hidePassword)}
              />
              <Input
                id="confirmPassword"
                type={hideConfirmPassword ? 'password' : 'text'}
                size="default"
                title={t('layout.confirm-password')}
                placeholder={t('layout.confirm-new-password')}
                required
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  if (confirmPasswordError) setConfirmPasswordError('');
                  if (generalError) setGeneralError('');
                }}
                state={confirmPasswordError ? 'error' : undefined}
                note={confirmPasswordError}
                backIcon={<img src={hideConfirmPassword ? eye : eyeOff} />}
                onBackIconClick={() => setHideConfirmPassword(!hideConfirmPassword)}
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
              {isLoading ? t('layout.resetting') : t('layout.reset-password')}
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
