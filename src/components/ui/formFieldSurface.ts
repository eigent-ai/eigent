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
 * Shared height/typography and validation chrome for `Input`, `Textarea` (enhanced),
 * `Select` trigger, and `InputSelect` — separate from `UiVariant` (buttons/tags).
 */

export type FormFieldSize = 'default' | 'sm';

/** Same union as `Input` `state` (field wrapper, not `UiTone`). */
export type FormFieldInputState =
  'default' | 'hover' | 'input' | 'error' | 'success' | 'disabled';

export const formFieldSizeClasses: Record<FormFieldSize, string> = {
  default: 'h-ds-control-xl !text-ds-text-base rounded-ds-field !px-ds-12',
  sm: 'h-ds-control-md !text-ds-text-base rounded-ds-field !px-ds-12',
};

/** Select trigger: form rhythm plus a compact 28px toolbar size. */
export const formFieldSelectSizeClasses: Record<FormFieldSize | 'xs', string> =
  {
    xs: 'h-ds-control-sm !text-ds-text-base rounded-ds-field !px-ds-12',
    default: 'h-ds-control-xl !text-ds-text-base rounded-ds-field !px-ds-12',
    sm: 'h-ds-control-md !text-ds-text-base rounded-ds-field !px-ds-12',
  };

export const formFieldInputSelectSizeClasses: Record<FormFieldSize, string> = {
  default: 'h-ds-control-xl !text-ds-text-base rounded-ds-field !px-ds-12',
  sm: 'h-ds-control-md !text-ds-text-base rounded-ds-field !px-ds-12',
};

export type TextareaFormFieldState =
  'default' | 'hover' | 'input' | 'error' | 'success' | 'disabled';

export const formFieldTextareaSizeClasses: Record<FormFieldSize, string> = {
  default: 'min-h-[5rem] !text-ds-text-base rounded-ds-field !px-ds-12',
  sm: 'min-h-[4rem] !text-ds-text-base rounded-ds-field !px-ds-12',
};

export function formFieldInputStateClasses(
  state: FormFieldInputState | undefined
): {
  container: string;
  field: string;
  input: string;
  placeholder: string;
} {
  if (state === 'disabled') {
    return {
      container: 'opacity-50 cursor-not-allowed',
      field: 'border-ds-hairline-default-default bg-ds-neutral-default-default',
      input: 'text-ds-ink-default-default',
      placeholder: 'placeholder:text-ds-ink-muted-default',
    };
  }
  if (state === 'hover') {
    return {
      container: '',
      field: 'border-ds-hairline-strong-default bg-ds-neutral-subtle-default',
      input: 'text-ds-ink-default-default',
      placeholder: 'placeholder:text-ds-ink-muted-default',
    };
  }
  if (state === 'input') {
    return {
      container: '',
      field: 'border-ds-ring-focus bg-ds-neutral-subtle-default',
      input: 'text-ds-ink-default-default',
      placeholder: 'placeholder:text-ds-ink-muted-default',
    };
  }
  if (state === 'error') {
    return {
      container: '',
      field:
        'border-ds-border-status-error-default-default bg-ds-neutral-default-default',
      input: 'text-ds-ink-default-default',
      placeholder: 'placeholder:text-ds-ink-muted-default',
    };
  }
  if (state === 'success') {
    return {
      container: '',
      field:
        'border-ds-border-status-completed-default-default bg-ds-bg-status-completed-subtle-default',
      input: 'text-ds-ink-default-default',
      placeholder: 'placeholder:text-ds-ink-muted-default',
    };
  }
  return {
    container: '',
    field: 'border-ds-hairline-default-default bg-ds-neutral-default-default',
    input: 'text-ds-ink-default-default',
    placeholder: 'placeholder:text-ds-ink-muted-default',
  };
}

export function formFieldTextareaStateClasses(
  state: TextareaFormFieldState | undefined
): {
  container: string;
  field: string;
  placeholder: string;
} {
  if (state === 'disabled') {
    return {
      container: 'opacity-50 cursor-not-allowed',
      field:
        'border-transparent bg-ds-neutral-default-default text-ds-ink-default-default',
      placeholder: 'placeholder:text-ds-ink-muted-default',
    };
  }
  if (state === 'hover') {
    return {
      container: '',
      field:
        'border-transparent bg-ds-neutral-subtle-default text-ds-ink-default-default',
      placeholder: 'placeholder:text-ds-ink-muted-default',
    };
  }
  if (state === 'input') {
    return {
      container: '',
      field:
        'border-transparent bg-ds-neutral-subtle-default text-ds-ink-default-default',
      placeholder: 'placeholder:text-ds-ink-muted-default',
    };
  }
  if (state === 'error') {
    return {
      container: '',
      field:
        'border-ds-border-status-error-default-default bg-ds-neutral-default-default text-ds-ink-default-default',
      placeholder: 'placeholder:text-ds-ink-muted-default',
    };
  }
  if (state === 'success') {
    return {
      container: '',
      field:
        'border-ds-border-status-completed-default-default bg-ds-bg-status-completed-subtle-default text-ds-ink-default-default',
      placeholder: 'placeholder:text-ds-ink-muted-default',
    };
  }
  return {
    container: '',
    field:
      'border-transparent bg-ds-neutral-default-default text-ds-ink-default-default',
    placeholder: 'placeholder:text-ds-ink-muted-default',
  };
}

export type FormFieldSelectValidation = 'error' | 'success';

export function formFieldSelectTriggerState(
  state: FormFieldSelectValidation | undefined,
  disabled: boolean
): {
  wrapper: string;
  trigger: string;
  note: string;
} {
  if (disabled) {
    return {
      wrapper: 'opacity-50 cursor-not-allowed',
      trigger: 'border-transparent',
      note: 'text-ds-ink-muted-default',
    };
  }
  if (state === 'error') {
    return {
      wrapper: '',
      trigger:
        'border-ds-border-error-default-default bg-ds-bg-error-default-default',
      note: 'text-ds-text-error-strong-default',
    };
  }
  if (state === 'success') {
    return {
      wrapper: '',
      trigger:
        'border-ds-border-success-default-default bg-ds-bg-success-subtle-default',
      note: 'text-ds-text-status-completed-strong-default',
    };
  }
  return {
    wrapper: '',
    trigger: 'border-transparent',
    note: 'text-ds-ink-muted-default',
  };
}

export function formFieldInputSelectState(
  state: FormFieldSelectValidation | undefined,
  disabled: boolean
): {
  wrapper: string;
  container: string;
  note: string;
} {
  if (disabled) {
    return {
      wrapper: 'opacity-50 cursor-not-allowed',
      container: 'border-transparent bg-ds-neutral-default-default',
      note: 'text-ds-ink-muted-default',
    };
  }
  if (state === 'error') {
    return {
      wrapper: '',
      container:
        'border-ds-border-status-error-default-default bg-ds-neutral-default-default',
      note: 'text-ds-text-status-error-strong-default',
    };
  }
  if (state === 'success') {
    return {
      wrapper: '',
      container:
        'border-ds-border-status-completed-default-default bg-ds-bg-status-completed-subtle-default',
      note: 'text-ds-text-status-completed-strong-default',
    };
  }
  return {
    wrapper: '',
    container: 'border-transparent bg-ds-neutral-default-default',
    note: 'text-ds-ink-muted-default',
  };
}

/**
 * Note/helper line under a field: HTML `note` in Input/Textarea, plain text in Select.
 */
export function formFieldNoteTextClassName(
  validation: 'error' | 'success' | 'default'
): string {
  if (validation === 'error') {
    return 'text-ds-text-status-error-strong-default';
  }
  if (validation === 'success') {
    return 'text-ds-text-status-completed-strong-default';
  }
  return 'text-ds-ink-muted-default';
}
