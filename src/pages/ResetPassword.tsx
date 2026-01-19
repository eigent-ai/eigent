import { useNavigate, useSearchParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import loginGif from '@/assets/login.gif';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import eye from '@/assets/eye.svg';
import eyeOff from '@/assets/eye-off.svg';
import { proxyFetchPost, proxyFetchGet } from '@/api/http';
import { useTranslation } from 'react-i18next';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const { t } = useTranslation();
  
  const [formData, setFormData] = useState({
    newPassword: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState({
    newPassword: '',
    confirmPassword: '',
  });
  const [hidePassword, setHidePassword] = useState(true);
  const [hideConfirmPassword, setHideConfirmPassword] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(true);
  const [isTokenValid, setIsTokenValid] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [generalError, setGeneralError] = useState('');

  useEffect(() => {
    const verifyToken = async () => {
      if (!token) {
        setIsVerifying(false);
        setIsTokenValid(false);
        return;
      }

      try {
        const data = await proxyFetchGet(`/api/verify-reset-token/${token}`);
        setIsTokenValid(data.valid === true);
      } catch (error) {
        console.error('Token verification failed:', error);
        setIsTokenValid(false);
      } finally {
        setIsVerifying(false);
      }
    };

    verifyToken();
  }, [token]);

  const validateForm = () => {
    const newErrors = {
      newPassword: '',
      confirmPassword: '',
    };

    if (!formData.newPassword) {
      newErrors.newPassword = t('layout.please-enter-password');
    } else if (formData.newPassword.length < 8) {
      newErrors.newPassword = t('layout.password-must-be-at-least-8-characters');
    } else if (
      !/\d/.test(formData.newPassword) ||
      !/[a-zA-Z]/.test(formData.newPassword)
    ) {
      newErrors.newPassword = t('layout.password-must-contain-letters-and-numbers');
    }

    if (!formData.confirmPassword) {
      newErrors.confirmPassword = t('layout.please-confirm-password');
    } else if (formData.newPassword !== formData.confirmPassword) {
      newErrors.confirmPassword = t('layout.passwords-do-not-match');
    }

    setErrors(newErrors);
    return !newErrors.newPassword && !newErrors.confirmPassword;
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

  const handleSubmit = async () => {
    if (!validateForm()) {
      return;
    }

    setGeneralError('');
    setIsLoading(true);
    try {
      const data = await proxyFetchPost('/api/reset-password', {
        token: token,
        new_password: formData.newPassword,
        confirm_password: formData.confirmPassword,
      });

      if (data.code && data.code !== 0) {
        setGeneralError(data.text || t('layout.reset-password-failed'));
        return;
      }

      setIsSuccess(true);
    } catch (error: any) {
      console.error('Reset password failed:', error);
      setGeneralError(t('layout.reset-password-failed'));
    } finally {
      setIsLoading(false);
    }
  };

  if (isVerifying) {
    return (
      <div className="p-2 flex items-center justify-center gap-2 h-full">
        <div className="flex items-center justify-center h-full rounded-3xl bg-white-100%">
          <img src={loginGif} className="rounded-3xl h-full object-cover" />
        </div>
        <div className="h-full flex-1 flex flex-col items-center justify-center">
          <div className="flex-1 flex flex-col w-80 items-center justify-center">
            <div className="text-text-heading text-heading-lg font-bold mb-4">
              {t('layout.verifying')}...
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isTokenValid) {
    return (
      <div className="p-2 flex items-center justify-center gap-2 h-full">
        <div className="flex items-center justify-center h-full rounded-3xl bg-white-100%">
          <img src={loginGif} className="rounded-3xl h-full object-cover" />
        </div>
        <div className="h-full flex-1 flex flex-col items-center justify-center">
          <div className="flex-1 flex flex-col w-80 items-center justify-center">
            <div className="text-text-heading text-heading-lg font-bold mb-4">
              {t('layout.invalid-reset-link')}
            </div>
            <p className="text-text-secondary text-center mb-6">
              {t('layout.reset-link-expired-or-invalid')}
            </p>
            <Button
              onClick={() => navigate('/forgot-password')}
              size="md"
              variant="primary"
              className="w-full rounded-full mb-4"
            >
              {t('layout.request-new-link')}
            </Button>
            <Button
              onClick={() => navigate('/login')}
              size="md"
              variant="ghost"
              className="w-full rounded-full"
            >
              {t('layout.back-to-login')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

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
                id="newPassword"
                title={t('layout.new-password')}
                size="default"
                type={hidePassword ? 'password' : 'text'}
                required
                placeholder={t('layout.enter-new-password')}
                value={formData.newPassword}
                onChange={(e) => handleInputChange('newPassword', e.target.value)}
                state={errors.newPassword ? 'error' : undefined}
                note={errors.newPassword}
                backIcon={<img src={hidePassword ? eye : eyeOff} />}
                onBackIconClick={() => setHidePassword(!hidePassword)}
              />

              <Input
                id="confirmPassword"
                title={t('layout.confirm-password')}
                size="default"
                type={hideConfirmPassword ? 'password' : 'text'}
                required
                placeholder={t('layout.confirm-new-password')}
                value={formData.confirmPassword}
                onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
                state={errors.confirmPassword ? 'error' : undefined}
                note={errors.confirmPassword}
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
