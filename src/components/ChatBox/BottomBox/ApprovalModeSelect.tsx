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

/**
 * Approval-mode picker for the chat input bar — same pill-trigger shell as
 * `ModelAndThinkingEffortSelect` / `ProjectModeToggle` so the
 * controls read as one family in the `BoxFooter` row.
 *
 * A Space-level permission-profile picker. Changes apply to future Runs;
 * active RunAttempts keep their immutable admission-time profile revision.
 */

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { generateUniqueId } from '@/lib';
import { cn } from '@/lib/utils';
import {
  getSpacePermissionProfile,
  PermissionProfileName,
  putSpacePermissionProfile,
} from '@/service/permissionProfileApi';
import { useAuthStore } from '@/store/authStore';
import {
  Check,
  ChevronDown,
  Eye,
  ShieldCheck,
  ShieldQuestion,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

interface ApprovalOption {
  value: PermissionProfileName;
  label: string;
  description: string;
  icon: typeof ShieldCheck;
}

const MENU_CONTENT_WIDTH_CLASS = 'w-[280px]';

const triggerShellClass = cn(
  'rounded-xl px-2 py-1 inline-flex max-w-[min(100%,320px)] shrink-0 items-center gap-1.5',
  'bg-ds-neutral-default-default text-ds-ink-default-default'
);

export interface ApprovalModeSelectProps {
  spaceId?: string | null;
  disabled?: boolean;
  /** Shows the current mode in the same read-only shell as the model/mode controls. */
  readOnly?: boolean;
  /** When true, hides the text label and shows only the icon (narrow footer). */
  compact?: boolean;
  className?: string;
}

export function ApprovalModeSelect({
  spaceId,
  disabled,
  readOnly = false,
  compact = false,
  className,
}: ApprovalModeSelectProps) {
  const { t } = useTranslation();
  const approvalOptions: ApprovalOption[] = [
    {
      value: 'read_only',
      label: t('chat.approval-mode-read-only', { defaultValue: 'Read only' }),
      description: t('chat.approval-mode-read-only-description', {
        defaultValue: 'Eigent can read your files but cannot change anything.',
      }),
      icon: Eye,
    },
    {
      value: 'request_approval',
      label: t('chat.approval-mode-ask-first', {
        defaultValue: 'Ask me first',
      }),
      description: t('chat.approval-mode-ask-first-description', {
        defaultValue:
          'Eigent asks for your approval before it changes anything.',
      }),
      icon: ShieldQuestion,
    },
    {
      value: 'auto_reviewer',
      label: t('chat.approval-mode-approve-for-me', {
        defaultValue: 'Approve for me',
      }),
      description: t('chat.approval-mode-approve-for-me-description', {
        defaultValue:
          'Eigent approves routine steps and only asks about risky ones.',
      }),
      icon: ShieldCheck,
    },
    {
      value: 'full_access',
      label: t('chat.approval-mode-full-access', {
        defaultValue: 'Full access',
      }),
      description: t('chat.approval-mode-full-access-description', {
        defaultValue: 'Eigent acts without asking. Use with care.',
      }),
      icon: TriangleAlert,
    },
  ];
  const userId = useAuthStore((state) => state.user_id);
  const [value, setValue] = useState<PermissionProfileName>('request_approval');
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!spaceId) {
      setValue('request_approval');
      setRevision(0);
      return;
    }
    setLoading(true);
    void getSpacePermissionProfile(spaceId)
      .then((profile) => {
        if (cancelled) return;
        setValue(profile.profile_name);
        setRevision(profile.revision);
      })
      .catch(() => {
        if (!cancelled) {
          toast.error(
            t('chat.approval-mode-load-failed', {
              defaultValue: "Couldn't load the approval mode.",
            })
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [spaceId, t]);

  const updateProfile = async (next: PermissionProfileName) => {
    if (!spaceId || next === value) return;
    if (
      next === 'full_access' &&
      !window.confirm(
        t('chat.approval-mode-full-access-confirmation', {
          defaultValue:
            'Full access lets Eigent act without asking you first, including actions that change files or send messages. Continue?',
        })
      )
    ) {
      return;
    }
    setLoading(true);
    try {
      const updated = await putSpacePermissionProfile(spaceId, {
        profileName: next,
        requestId: generateUniqueId(),
        updatedBy: String(userId ?? 'local-user'),
        expectedRevision: revision,
      });
      setValue(updated.profile_name);
      setRevision(updated.revision);
      toast.success(
        t('chat.approval-mode-updated', {
          defaultValue: 'Approval mode updated. It applies to new tasks.',
        })
      );
    } catch {
      toast.error(
        t('chat.approval-mode-update-failed', {
          defaultValue: "Couldn't update the approval mode. Try again.",
        })
      );
      try {
        const current = await getSpacePermissionProfile(spaceId, {
          refresh: true,
        });
        setValue(current.profile_name);
        setRevision(current.revision);
      } catch {
        // Keep the last known profile; the next Space change retries loading.
      }
    } finally {
      setLoading(false);
    }
  };

  const current =
    approvalOptions.find((o) => o.value === value) ?? approvalOptions[0];
  const CurrentIcon = current.icon;
  /** Names the control as well as its value, so the label stands alone. */
  const accessibleLabel = t('chat.approval-mode-current', {
    value: current.label,
    defaultValue: 'Approval mode: {{value}}',
  });

  if (readOnly) {
    return (
      <div
        role="status"
        title={current.label}
        aria-label={accessibleLabel}
        className={cn(
          triggerShellClass,
          'pointer-events-none bg-transparent',
          { 'opacity-50': disabled || loading },
          className
        )}
      >
        <span className="inline-flex min-h-[1.25rem] min-w-0 items-center gap-1.5 overflow-hidden">
          <CurrentIcon
            className="h-3.5 w-3.5 shrink-0 opacity-80"
            aria-hidden
          />
          {!compact && (
            <span className="min-w-0 truncate !text-ds-text-meta font-semibold">
              {current.label}
            </span>
          )}
        </span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled || loading || !spaceId}
          title={current.label}
          aria-label={accessibleLabel}
          aria-haspopup="menu"
          className={cn(
            triggerShellClass,
            'min-w-0 cursor-pointer border-0 border-x-0 border-y-0 text-left',
            'justify-between font-semibold transition-colors',
            'hover:bg-ds-neutral-subtle-default active:shadow-ds-elevation-control-pressed data-[state=open]:bg-ds-neutral-subtle-default',
            'focus-visible:ring-2 focus-visible:ring-ds-hairline-strong-default focus-visible:ring-offset-2 focus-visible:ring-offset-ds-neutral-default-default focus-visible:outline-none',
            'disabled:pointer-events-none disabled:opacity-50',
            className
          )}
        >
          <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            <CurrentIcon
              className="h-3.5 w-3.5 shrink-0 opacity-80"
              aria-hidden
            />
            {!compact && (
              <span className="min-w-0 flex-1 truncate text-left !text-ds-text-meta text-ds-ink-default-default">
                {current.label}
              </span>
            )}
          </span>
          <ChevronDown
            className="h-3.5 w-3.5 shrink-0 opacity-80"
            aria-hidden
            strokeWidth={2}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={4}
        collisionPadding={12}
        avoidCollisions
        className={MENU_CONTENT_WIDTH_CLASS}
      >
        {approvalOptions.map((option) => {
          const OptionIcon = option.icon;
          return (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => void updateProfile(option.value)}
              className="flex items-center justify-between gap-2"
            >
              <span className="flex min-w-0 items-start gap-2">
                <OptionIcon
                  className="mt-0.5 h-4 w-4 shrink-0 opacity-80"
                  aria-hidden
                />
                <span className="min-w-0">
                  <span className="block text-ds-text-base">
                    {option.label}
                  </span>
                  <span className="block text-xs text-ds-ink-subtle-default">
                    {option.description}
                  </span>
                </span>
              </span>
              {value === option.value && (
                <Check className="h-4 w-4 text-ds-text-success-default-default" />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
