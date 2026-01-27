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
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { AlertCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface PrivacyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: React.ReactNode;
}

export function PrivacyDialog({
  open,
  onOpenChange,
  trigger,
}: PrivacyDialogProps) {
  const { t } = useTranslation();
  const API_FIELDS = useMemo(
    () => [
      'take_screenshot',
      'access_local_software',
      'access_your_address',
      'password_storage',
    ],
    []
  );

  const [settings, setSettings] = useState([
    {
      title: t('layout.allow-agent-to-take-screenshots'),
      description: t('layout.permit-the-agent-to-capture'),
      checked: false,
    },
    {
      title: t('layout.allow-agent-to-access-local-software'),
      description: t('layout.grant-the-agent-permission'),
      checked: false,
    },
    {
      title: t('layout.allow-agent-to-access-your-address'),
      description: t('layout.authorize-the-agent-to-view'),
      checked: false,
    },
    {
      title: t('layout.password-storage'),
      description: t('layout.determine-how-passwords-are-handled'),
      checked: false,
    },
  ]);

  useEffect(() => {
    proxyFetchGet('/api/user/privacy')
      .then((res) => {
        setSettings((prev) =>
          prev.map((item, index) => ({
            ...item,
            checked: res[API_FIELDS[index]] || false,
          }))
        );
      })
      .catch((err) => console.error('Failed to fetch settings:', err));
  }, [API_FIELDS]);

  const handleToggle = (index: number) => {
    setSettings((prev) => {
      const newSettings = [...prev];
      newSettings[index] = {
        ...newSettings[index],
        checked: !newSettings[index].checked,
      };
      return newSettings;
    });

    const requestData = {
      [API_FIELDS[0]]: settings[0].checked,
      [API_FIELDS[1]]: settings[1].checked,
      [API_FIELDS[2]]: settings[2].checked,
      [API_FIELDS[3]]: settings[3].checked,
    };

    requestData[API_FIELDS[index]] = !settings[index].checked;

    proxyFetchPut('/api/user/privacy', requestData).catch((err) =>
      console.error('Failed to update settings:', err)
    );
  };

  const handleTurnOnAll = () => {
    const newSettings = settings.map((item) => ({
      ...item,
      checked: true,
    }));
    setSettings(newSettings);

    const requestData = {
      [API_FIELDS[0]]: true,
      [API_FIELDS[1]]: true,
      [API_FIELDS[2]]: true,
      [API_FIELDS[3]]: true,
    };

    proxyFetchPut('/api/user/privacy', requestData)
      .then(() => {
        onOpenChange(false);
      })
      .catch((err) => console.error('Failed to update settings:', err));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="gap-0 !rounded-xl border border-zinc-300 !bg-popup-surface p-0 shadow-sm sm:max-w-[600px]">
        <DialogHeader className="!rounded-t-xl !bg-popup-surface p-md">
          <DialogTitle className="m-0">
            <div className="flex items-center gap-2">
              <div className="text-base font-bold leading-10 text-text-action">
                {t('layout.turn-on-all-privacy-settings')}
              </div>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <AlertCircle
                      size={16}
                      className="cursor-pointer text-icon-primary"
                    />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[340px]">
                    <p className="text-sm text-text-body">
                      {t('layout.eigent-is-a-desktop-software')}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-md bg-popup-bg p-md">
          {settings.map((item, index) => (
            <div key={item.title} className="mb-4 flex items-start gap-md">
              <div className="flex-1">
                <div className="text-text-primary mb-1 text-sm font-bold">
                  {item.title}
                </div>
                <div className="text-xs text-text-body">{item.description}</div>
              </div>
              <div className="flex-shrink-0">
                <Switch
                  checked={item.checked}
                  onCheckedChange={() => handleToggle(index)}
                />
              </div>
            </div>
          ))}
        </div>

        <DialogFooter className="!rounded-b-xl bg-white-100% p-md">
          <DialogClose asChild>
            <Button variant="ghost" size="md">
              {t('layout.cancel')}
            </Button>
          </DialogClose>
          <Button size="md" onClick={handleTurnOnAll} variant="primary">
            {t('layout.turn-on-all-and-finish')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
