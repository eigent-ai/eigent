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

import { proxyFetchGet, proxyFetchPut } from '@/api/http';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { SITE_URL } from '@/lib';
import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import SettingsPage from '../SettingsPage';
import SettingsSection from '../SettingsSection';
export default function SettingPrivacy() {
  const [helpImprove, setHelpImprove] = useState(false);
  const { t } = useTranslation();
  const [isHowWeHandleOpen, setIsHowWeHandleOpen] = useState(false);

  useEffect(() => {
    proxyFetchGet('/api/v1/user/privacy')
      .then((res) => {
        setHelpImprove(res.help_improve || false);
      })
      .catch((err) => console.error('Failed to fetch settings:', err));
  }, []);

  const handleToggleHelpImprove = (checked: boolean) => {
    setHelpImprove(checked);
    proxyFetchPut('/api/v1/user/privacy', { help_improve: checked }).catch(
      (err) => console.error('Failed to update settings:', err)
    );
  };

  return (
    <SettingsPage>
      {/* How We Handle Your Data Section */}
      <SettingsSection
        title={t('setting.how-we-handle-your-data')}
        action={
          <Button
            variant="ghost"
            size="xs"
            buttonContent="icon-only"
            onClick={() => setIsHowWeHandleOpen((prev) => !prev)}
            aria-expanded={isHowWeHandleOpen}
            aria-controls="how-we-handle-your-data"
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${isHowWeHandleOpen ? 'rotate-0' : '-rotate-90'}`}
            />
          </Button>
        }
      >
        <span className="text-body-sm font-normal text-ds-text-neutral-default-default">
          {t('setting.data-privacy-description')}{' '}
          <a
            className="text-blue-500 no-underline"
            href={`${SITE_URL}/privacy-policy`}
            target="_blank"
            rel="noreferrer"
          >
            {t('setting.privacy-policy')}
          </a>
          .
        </span>
        {isHowWeHandleOpen && (
          <div className="mr-10 mt-4 border-x-0 border-b-0 border-t-[0.5px] border-solid border-ds-border-neutral-default-default">
            <ol
              id="how-we-handle-your-data"
              className="pl-5 text-body-sm font-normal text-ds-text-neutral-default-default"
            >
              <li>
                {t(
                  'setting.we-only-use-the-essential-data-needed-to-run-your-tasks'
                )}
                :
              </li>
              <ul className="mb-2 pl-4">
                <li>{t('setting.how-we-handle-your-data-line-1-line-1')}</li>
                <li>{t('setting.how-we-handle-your-data-line-1-line-2')}</li>
                <li>{t('setting.how-we-handle-your-data-line-1-line-3')}</li>
              </ul>
              <li>{t('setting.how-we-handle-your-data-line-2')}</li>
              <li>{t('setting.how-we-handle-your-data-line-3')}</li>
              <li>{t('setting.how-we-handle-your-data-line-4')}</li>
              <li>{t('setting.how-we-handle-your-data-line-5')}</li>
            </ol>
          </div>
        )}
      </SettingsSection>

      {/* Help Improve Eigent Section */}
      <SettingsSection
        title={t('setting.help-improve-eigent')}
        variant="horizontal"
        boxClassName="items-center justify-between gap-md"
      >
        <div className="flex flex-col gap-2">
          <div className="text-body-sm font-normal text-ds-text-neutral-default-default">
            {t('setting.help-improve-eigent-description')}
          </div>
        </div>
        <div className="flex items-center justify-center">
          <Switch
            checked={helpImprove}
            onCheckedChange={handleToggleHelpImprove}
          />
        </div>
      </SettingsSection>
    </SettingsPage>
  );
}
