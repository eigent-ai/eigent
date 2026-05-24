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

export type RuntimeArtifactType = 'dashboard' | 'approval' | 'selection';
export type RuntimeInteractionMode =
  | 'view_only'
  | 'editable'
  | 'approval_required';
export type RuntimeSectionType =
  | 'markdown'
  | 'kpi_row'
  | 'table'
  | 'progress_list'
  | 'action_row'
  | 'approval_panel'
  | 'chart_placeholder'
  | 'line_chart'
  | 'bar_chart'
  | 'area_chart'
  | 'pie_chart'
  | 'selection_list'
  | 'trigger_card'
  | 'status_tile'
  | 'timeline'
  | 'compare_card';
export type RuntimeActionType = 'agent_action' | 'approval' | 'reject' | 'edit';
export type RuntimeTone =
  | 'neutral'
  | 'success'
  | 'warning'
  | 'error'
  | 'information';

export interface RuntimeSelectionOption {
  id: string;
  label: string;
  description?: string;
}

export interface RuntimeUiAction {
  id: string;
  label: string;
  type: RuntimeActionType;
  tone?: RuntimeTone;
  payload?: Record<string, unknown>;
}

export interface RuntimeUiSection {
  id: string;
  type: RuntimeSectionType;
  title?: string | null;
  content?: string | null;
  data_source?: string | null;
  columns?: string[] | null;
  actions?: RuntimeUiAction[];
  tone?: RuntimeTone;
  x_field?: string | null;
  y_fields?: string[] | null;
  options?: RuntimeSelectionOption[] | null;
  // Chart display options (Phase 3)
  stacked?: boolean | null;
  smooth?: boolean | null;
  show_legend?: boolean | null;
  // status_tile fields (Phase 2)
  icon?: string | null;
  value?: string | null;
  caption?: string | null;
  delta?: string | null;
}

export interface RuntimeUiArtifact {
  id: string;
  type: RuntimeArtifactType;
  title: string;
  prompt: string;
  interaction_mode: RuntimeInteractionMode;
  layout: {
    type: 'stack' | 'grid';
    columns: number;
  };
  sections: RuntimeUiSection[];
  actions?: RuntimeUiAction[];
}

export interface RuntimeUiArtifactPayload {
  artifact: RuntimeUiArtifact;
  data: Record<string, unknown>;
  state: Record<string, unknown>;
}

export interface RuntimeUiArtifactEvent {
  artifact_id: string;
  event_type: 'action_clicked' | 'approval_submitted';
  action_id: string;
  payload: Record<string, unknown>;
  state: Record<string, unknown>;
}

/** KPI metric entry — supports plain number or delta shape */
export interface RuntimeKpiMetric {
  value: number;
  delta?: string;
  direction?: 'up' | 'down' | 'neutral';
}
