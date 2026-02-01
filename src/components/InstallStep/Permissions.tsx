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
import privacy_settings from '@/assets/privacy_settings.png';
import { useAuthStore } from '@/store/authStore';
import { ArrowRight, Square, SquareCheckBig } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '../ui/button';

export const Permissions: React.FC = () => {
  const { setInitState } = useAuthStore();
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
      title: 'Enable screen recording',
      checked: false,
    },
    {
      title: 'Enable access Local Software',
      checked: false,
    },
    {
      title: 'Grant location access',
      checked: false,
    },
    {
      title: 'Share data to enhance Eigent',
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
  return (
    <div className="flex flex-col gap-lg">
      <div className="flex h-[568px] gap-md">
        <div className="flex w-[438px] flex-col gap-md">
          <div className="text-4xl font-bold leading-5xl text-text-heading">
            <div>Enable Permissions</div>
          </div>
          <div className="text-xl font-medium leading-2xl text-text-body">
            ${`Grant permission to activate the Agent's autonomous actions.`}
          </div>
          {settings.map((item, index) => (
            <div
              key={item.title}
              onClick={() => handleToggle(index)}
              className="flex cursor-pointer items-center gap-sm rounded-md p-xs hover:bg-fill-fill-tertiary-hover"
            >
              <div>
                {item.checked ? (
                  <SquareCheckBig size={24} className="text-icon-success" />
                ) : (
                  <Square size={24} className="text-icon-primary" />
                )}
              </div>
              <div className="flex-1 text-xl font-medium leading-2xl text-text-body">
                {item.title}
              </div>
            </div>
          ))}
        </div>
        <div className="relative flex-1 rounded-3xl">
          <img
            className="absolute bottom-0 left-0 right-0 top-0 h-[533px] w-[899px]"
            src={privacy_settings}
            alt=""
          />
        </div>
      </div>
      <div className="flex items-center justify-end gap-sm">
        <div className="flex items-center justify-center gap-sm">
          <Button
            onClick={() => setInitState('carousel')}
            variant="ghost"
            size="sm"
          >
            skip
          </Button>
          <Button
            onClick={() => setInitState('carousel')}
            variant="primary"
            size="sm"
          >
            <div>Next</div>
            <ArrowRight size={24} className="text-white-100%" />
          </Button>
        </div>
      </div>
    </div>
  );
};
