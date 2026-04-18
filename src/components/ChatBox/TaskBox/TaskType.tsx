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
      textColor: 'text-[color:var(--ds-text-status-splitting-strong-default)]',
      bgColor: 'bg-[var(--ds-bg-status-splitting-subtle-default)]',
      dotColor: 'bg-[var(--ds-bg-status-splitting-subtle-default)]-foreground',
    },
    2: {
      label: t('layout.task-running'),
      textColor: 'text-[color:var(--ds-text-status-running-muted-default)]',
      bgColor: 'bg-[var(--ds-bg-status-running-subtle-default)]',
      dotColor: 'bg-[var(--ds-icon-status-running-default-default)]',
    },
    3: {
      label: t('layout.task-completed'),
      textColor: 'text-[color:var(--ds-text-neutral-default-default)]',
      bgColor: 'bg-transparent',
      dotColor: 'bg-[var(--ds-icon-neutral-default-default)]',
    },
  };
  return (
    <div
      className={`h-6 gap-1 px-2 py-1 flex items-center rounded-full ${typeMap[type].bgColor} ${typeMap[type].textColor} text-xs font-medium leading-17`}
    >
      <div className={`h-2 w-2 ${typeMap[type].dotColor} rounded-full`}></div>
      <span>{typeMap[type].label}</span>
    </div>
  );
};
