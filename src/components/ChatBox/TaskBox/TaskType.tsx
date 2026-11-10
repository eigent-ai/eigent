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

import { useTranslation } from 'react-i18next';
export const TaskType = ({ type }: { type: 1 | 2 | 3 }) => {
  const { t } = useTranslation();
  const typeMap = {
    1: {
      label: t('layout.task-splitting'),
      textColor: 'text-ds-text-status-splitting-strong-default',
      bgColor: 'bg-ds-bg-status-splitting-subtle-default',
      dotColor: 'bg-ds-text-status-splitting-strong-default',
    },
    2: {
      label: t('layout.task-running'),
      textColor: 'text-ds-text-status-running-default-default',
      bgColor: 'bg-ds-bg-status-running-subtle-default',
      dotColor: 'bg-ds-text-status-running-default-default',
    },
    3: {
      label: t('layout.task-completed'),
      textColor: 'text-ds-ink-default-default',
      bgColor: 'bg-transparent',
      dotColor: 'bg-ds-text-neutral-default-default',
    },
  };
  return (
    <div
      className={`flex h-6 items-center gap-1 rounded-full px-2 py-1 ${typeMap[type].bgColor} ${typeMap[type].textColor} text-xs leading-17 font-medium`}
    >
      <div className={`h-2 w-2 ${typeMap[type].dotColor} rounded-full`}></div>
      <span>{typeMap[type].label}</span>
    </div>
  );
};
