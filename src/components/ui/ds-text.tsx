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

import { cn } from '@/lib/utils';
import * as React from 'react';

export type DsTextRole =
  'meta' | 'base' | 'body-large' | 'title' | 'section' | 'page' | 'display';

export type DsCodeRole = 'small' | 'base' | 'large';
export type DsTextChannel = 'text' | 'code';

const TEXT_ROLE_CLASS: Record<DsTextRole, string> = {
  meta: '!text-ds-text-meta',
  base: '!text-ds-text-base',
  'body-large': '!text-ds-text-body-large',
  title: '!text-ds-text-title',
  section: '!text-ds-text-section',
  page: '!text-ds-text-page',
  display: '!text-ds-text-display',
};

const CODE_ROLE_CLASS: Record<DsCodeRole, string> = {
  small: '!text-ds-code-small',
  base: '!text-ds-code-base',
  large: '!text-ds-code-large',
};

const DEFAULT_TEXT_ELEMENT: Record<
  DsTextRole,
  keyof React.JSX.IntrinsicElements
> = {
  meta: 'span',
  base: 'p',
  'body-large': 'p',
  title: 'h3',
  section: 'h2',
  page: 'h1',
  display: 'p',
};

export type DsTextProps<T extends React.ElementType = 'p'> = {
  as?: T;
  /** Typography role. This is not the ARIA `role` attribute. */
  role?: DsTextRole | DsCodeRole;
  channel?: DsTextChannel;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
  className?: string;
  children?: React.ReactNode;
} & Omit<React.ComponentPropsWithoutRef<T>, 'as' | 'role' | 'children'>;

function resolveCodeRole(role: DsTextRole | DsCodeRole): DsCodeRole {
  return role === 'small' || role === 'large' ? role : 'base';
}

function resolveTextRole(role: DsTextRole | DsCodeRole): DsTextRole {
  return role in TEXT_ROLE_CLASS ? (role as DsTextRole) : 'base';
}

export function DsText<T extends React.ElementType = 'p'>({
  as,
  role = 'base',
  channel = 'text',
  weight,
  className,
  children,
  ...props
}: DsTextProps<T>) {
  const textRole = resolveTextRole(role);
  const Comp = (as ??
    (channel === 'code'
      ? 'code'
      : DEFAULT_TEXT_ELEMENT[textRole])) as React.ElementType;
  const roleClass =
    channel === 'code'
      ? CODE_ROLE_CLASS[resolveCodeRole(role)]
      : TEXT_ROLE_CLASS[textRole];
  const weightClass =
    weight === 'regular'
      ? 'font-regular'
      : weight === 'medium'
        ? 'font-medium'
        : weight === 'semibold'
          ? 'font-semibold'
          : weight === 'bold'
            ? 'font-bold'
            : null;

  return (
    <Comp
      className={cn(
        'm-0',
        channel === 'code' ? 'font-code' : 'font-text',
        roleClass,
        weightClass,
        className
      )}
      {...props}
    >
      {children}
    </Comp>
  );
}
