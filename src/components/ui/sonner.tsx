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

import { useTheme } from 'next-themes';
import { Toaster as Sonner } from 'sonner';

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-ds-bg-neutral-subtle-default group-[.toaster]:text-ds-text-neutral-default-default group-[.toaster]:border-ds-border-neutral-default-default group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-ds-text-neutral-muted-default',
          actionButton:
            'group-[.toast]:bg-ds-bg-brand-default-default group-[.toast]:text-ds-text-brand-inverse-default',
          cancelButton:
            'group-[.toast]:bg-ds-bg-neutral-muted-default group-[.toast]:text-ds-text-neutral-muted-default',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
