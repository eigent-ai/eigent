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

/** Context displayed with the active human-control question. */
export interface BottomBoxContextItem {
  id: string;
  label: string;
  description?: string;
  kind?: 'file' | 'external-context' | 'agent' | 'operation' | 'other';
  removable?: boolean;
}

export interface BottomBoxHeaderDetail {
  id: string;
  label: string;
  /** Preformatted, display-safe text supplied by the control owner. */
  content: string;
}

/** Display-only question/details. Composer variants render this inside InputBox. */
export interface BottomBoxHeaderContent {
  eyebrow?: string;
  title?: string;
  description?: string;
  contextItems?: readonly BottomBoxContextItem[];
  details?: readonly BottomBoxHeaderDetail[];
  onRemoveContextItem?: (id: string) => void;
}

interface ControlledVariantBase {
  header: BottomBoxHeaderContent;
  disabled?: boolean;
  submitting?: boolean;
}

/** Normal user query/follow-up composer. Existing call sites default here. */
export interface BottomBoxInputVariant {
  kind: 'input';
  header?: BottomBoxHeaderContent;
}

/** A yes/no confirmation requested by an agent. */
export interface BottomBoxConfirmationVariant extends ControlledVariantBase {
  kind: 'confirmation';
  note?: string;
  notePlaceholder?: string;
  confirmLabel?: string;
  rejectLabel?: string;
  onNoteChange?: (value: string) => void;
  onConfirm: () => void;
  onReject: () => void;
}

export type BottomBoxApprovalScope = 'once' | 'run' | 'space';

export interface BottomBoxApprovalOption {
  scope: BottomBoxApprovalScope;
  label: string;
  description?: string;
}

/** A permission request. Only options supplied by the backend are rendered. */
export interface BottomBoxApprovalVariant extends ControlledVariantBase {
  kind: 'approval';
  options: readonly BottomBoxApprovalOption[];
  rejectLabel?: string;
  onApprove: (scope: BottomBoxApprovalScope) => void;
  onReject: () => void;
}

export interface BottomBoxSelectionOption {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

/** A controlled single- or multi-select response requested by an agent. */
export interface BottomBoxSelectionVariant extends ControlledVariantBase {
  kind: 'selection';
  selectionMode?: 'single' | 'multiple';
  options: readonly BottomBoxSelectionOption[];
  selectedIds: readonly string[];
  submitLabel?: string;
  onSelectionChange: (selectedIds: string[]) => void;
  onSubmit: () => void;
}

/** Free-form human-in-the-loop feedback. */
export interface BottomBoxFeedbackVariant extends ControlledVariantBase {
  kind: 'feedback';
  /** Compact agent-question presentation; other feedback keeps normal chrome. */
  presentation?: 'default' | 'question';
  value: string;
  placeholder?: string;
  submitLabel?: string;
  skipLabel?: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onSkip?: () => void;
}

export interface BottomBoxFormField {
  id: string;
  label: string;
  value: string;
  type?: 'text' | 'email' | 'number' | 'textarea';
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}

/** Controlled structured input requested by an agent. */
export interface BottomBoxFormVariant extends ControlledVariantBase {
  kind: 'form';
  fields: readonly BottomBoxFormField[];
  submitLabel?: string;
  onFieldChange: (fieldId: string, value: string) => void;
  onSubmit: () => void;
}

/** A mandatory control that this frontend cannot safely submit yet. */
export interface BottomBoxBlockedVariant extends ControlledVariantBase {
  kind: 'blocked';
  message: string;
  recoveryLabel?: string;
  onRecover?: () => void;
}

export type BottomBoxRunControlState =
  'interrupted' | 'resuming' | 'cancelling' | 'read_only';

/**
 * Display-only Run lifecycle controls. The owner performs every command and
 * receives the explicit target Run id; this variant has no store/API access.
 */
export interface BottomBoxRunControlVariant extends ControlledVariantBase {
  kind: 'run_control';
  runId: string;
  state: BottomBoxRunControlState;
  resumeLabel?: string;
  resumingLabel?: string;
  cancelLabel?: string;
  cancellingLabel?: string;
  readOnlyLabel?: string;
  onResume?: (runId: string) => void;
  onCancel?: (runId: string) => void;
}

/**
 * Human-control state rendered by BottomBox.
 *
 * It intentionally contains only display data and callbacks. Event projection,
 * API calls and stores stay in the owning container.
 */
export type BottomBoxVariant =
  | BottomBoxInputVariant
  | BottomBoxConfirmationVariant
  | BottomBoxApprovalVariant
  | BottomBoxSelectionVariant
  | BottomBoxFeedbackVariant
  | BottomBoxFormVariant
  | BottomBoxBlockedVariant
  | BottomBoxRunControlVariant;

/** Kept temporarily so a legacy `variant="input"` remains source-compatible. */
export type LegacyBottomBoxVariant = 'input';
