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
  | 'default'
  | 'hover'
  | 'input'
  | 'error'
  | 'success'
  | 'disabled';

export const formFieldSizeClasses: Record<FormFieldSize, string> = {
  default: 'h-10 text-body-sm md:text-sm',
  sm: 'h-8 text-body-sm',
};

/** Select trigger: same vertical rhythm, no `md:` breakpoint on body text. */
export const formFieldSelectSizeClasses: Record<FormFieldSize, string> = {
  default: 'h-10 text-body-sm',
  sm: 'h-8 text-body-sm',
};

export const formFieldInputSelectSizeClasses: Record<FormFieldSize, string> = {
  default: 'h-10 text-body-sm',
  sm: 'h-8 text-body-sm',
};

export type TextareaFormFieldState =
  | 'default'
  | 'hover'
  | 'input'
  | 'error'
  | 'success'
  | 'disabled';

export const formFieldTextareaSizeClasses: Record<FormFieldSize, string> = {
  default: 'min-h-[60px] text-body-sm md:text-sm',
  sm: 'min-h-[40px] text-body-sm',
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
      field:
        'border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default',
      input: 'text-ds-text-neutral-default-default',
      placeholder: 'placeholder-input-label-default',
    };
  }
  if (state === 'hover') {
    return {
      container: '',
      field:
        'border-ds-border-neutral-strong-default bg-ds-bg-neutral-subtle-default',
      input: 'text-ds-text-neutral-default-default',
      placeholder: 'placeholder-input-label-default',
    };
  }
  if (state === 'input') {
    return {
      container: '',
      field:
        'border-ds-border-brand-default-focus bg-ds-bg-neutral-subtle-default',
      input: 'text-ds-text-neutral-default-default',
      placeholder: 'placeholder-input-label-default',
    };
  }
  if (state === 'error') {
    return {
      container: '',
      field:
        'border-ds-border-status-error-default-default bg-ds-bg-neutral-default-default',
      input: 'text-ds-text-neutral-default-default',
      placeholder: 'placeholder-input-label-default',
    };
  }
  if (state === 'success') {
    return {
      container: '',
      field:
        'border-ds-border-status-completed-default-default bg-ds-bg-status-completed-subtle-default',
      input: 'text-ds-text-neutral-default-default',
      placeholder: 'placeholder-input-label-default',
    };
  }
  return {
    container: '',
    field:
      'border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default',
    input: 'text-ds-text-neutral-default-default',
    placeholder: 'placeholder-input-label-default/10',
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
        'border-transparent bg-ds-bg-neutral-default-default text-ds-text-neutral-default-default',
      placeholder: 'text-ds-text-neutral-muted-default',
    };
  }
  if (state === 'hover') {
    return {
      container: '',
      field:
        'border-transparent bg-ds-bg-neutral-subtle-default text-ds-text-neutral-default-default',
      placeholder: 'text-ds-text-neutral-muted-default',
    };
  }
  if (state === 'input') {
    return {
      container: '',
      field:
        'border-transparent bg-ds-bg-neutral-subtle-default text-ds-text-neutral-default-default',
      placeholder: 'text-ds-text-neutral-muted-default',
    };
  }
  if (state === 'error') {
    return {
      container: '',
      field:
        'border-ds-border-status-error-default-default bg-ds-bg-neutral-default-default text-ds-text-neutral-default-default',
      placeholder: 'text-ds-text-neutral-muted-default',
    };
  }
  if (state === 'success') {
    return {
      container: '',
      field:
        'border-ds-border-status-completed-default-default bg-ds-bg-status-completed-subtle-default text-ds-text-neutral-default-default',
      placeholder: 'text-ds-text-neutral-muted-default',
    };
  }
  return {
    container: '',
    field:
      'border-transparent bg-ds-bg-neutral-default-default text-ds-text-neutral-default-default',
    placeholder: 'text-ds-text-neutral-muted-default/10',
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
      note: 'text-ds-text-neutral-muted-default',
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
    note: 'text-ds-text-neutral-muted-default',
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
      container: 'border-transparent bg-ds-bg-neutral-default-default',
      note: 'text-ds-text-neutral-muted-default',
    };
  }
  if (state === 'error') {
    return {
      wrapper: '',
      container:
        'border-ds-border-status-error-default-default bg-ds-bg-neutral-default-default',
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
    container: 'border-transparent bg-ds-bg-neutral-default-default',
    note: 'text-ds-text-neutral-muted-default',
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
  return 'text-ds-text-neutral-muted-default';
}
