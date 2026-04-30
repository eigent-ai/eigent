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

import {
  isHistoryTabId,
  type HistoryTabId,
} from '@/components/Dashboard/HorizontalNav';
import type { DashboardHub } from '@/components/Dashboard/Pages/Project/useDashboardData';

export const HISTORY_TAB_ALIASES: Record<string, HistoryTabId> = {
  mcp_tools: 'connectors',
};

export type AgentSection = 'models' | 'skills' | 'memory';
export type ChannelsView = 'overview' | 'whatsapp' | 'lark';
export type BrowserSection = 'cdp' | 'extension' | 'cookies';
export type SettingsTab = 'general' | 'appearance' | 'privacy';

export type HistoryNavState = {
  tab: HistoryTabId;
  hub: DashboardHub;
  agentSection: AgentSection;
  channelsView: ChannelsView;
  browserSection: BrowserSection;
  settingsTab: SettingsTab;
};

function isAgentSection(v: string | null): v is AgentSection {
  return v === 'models' || v === 'skills' || v === 'memory';
}

function isChannelsView(v: string | null): v is ChannelsView {
  return v === 'overview' || v === 'whatsapp' || v === 'lark';
}

function isBrowserSection(v: string | null): v is BrowserSection {
  return v === 'cdp' || v === 'extension' || v === 'cookies';
}

function isSettingsTab(v: string | null): v is SettingsTab {
  return v === 'general' || v === 'appearance' || v === 'privacy';
}

function isDashboardHub(v: string | null): v is DashboardHub {
  return v === 'project' || v === 'task';
}

export function parseHistoryNavState(
  searchParams: URLSearchParams
): HistoryNavState {
  const raw = searchParams.get('tab');
  const normalized = raw != null ? (HISTORY_TAB_ALIASES[raw] ?? raw) : '';
  const tab: HistoryTabId = isHistoryTabId(normalized)
    ? normalized
    : 'dashboard';

  const hubParam = searchParams.get('hub');
  const hub: DashboardHub = isDashboardHub(hubParam) ? hubParam : 'project';

  const sectionParam = searchParams.get('section');
  const agentSection: AgentSection = isAgentSection(sectionParam)
    ? sectionParam
    : 'models';

  const cv = searchParams.get('channelsView');
  const channelsView: ChannelsView = isChannelsView(cv) ? cv : 'overview';

  const browserParam = searchParams.get('browserSection');
  const browserSection: BrowserSection = isBrowserSection(browserParam)
    ? browserParam
    : 'cdp';

  const settingsParam = searchParams.get('settingsTab');
  const settingsTab: SettingsTab = isSettingsTab(settingsParam)
    ? settingsParam
    : 'general';

  return {
    tab,
    hub,
    agentSection,
    channelsView,
    browserSection,
    settingsTab,
  };
}

export function buildHistorySearchString(
  base: URLSearchParams,
  patch: Partial<HistoryNavState>
): string {
  const current = parseHistoryNavState(base);
  const next: HistoryNavState = { ...current, ...patch };
  const p = new URLSearchParams(base.toString());
  p.set('tab', next.tab);
  if (next.tab === 'dashboard') {
    p.set('hub', next.hub);
    p.delete('section');
    p.delete('channelsView');
    p.delete('browserSection');
    p.delete('settingsTab');
  } else if (next.tab === 'agents') {
    p.delete('hub');
    p.set('section', next.agentSection);
    p.delete('channelsView');
    p.delete('browserSection');
    p.delete('settingsTab');
  } else if (next.tab === 'channels') {
    p.delete('hub');
    p.delete('section');
    p.set('channelsView', next.channelsView);
    p.delete('browserSection');
    p.delete('settingsTab');
  } else if (next.tab === 'connectors') {
    p.delete('hub');
    p.delete('section');
    p.delete('channelsView');
    p.delete('browserSection');
    p.delete('settingsTab');
  } else if (next.tab === 'browser') {
    p.delete('hub');
    p.delete('section');
    p.delete('channelsView');
    p.set('browserSection', next.browserSection);
    p.delete('settingsTab');
  } else if (next.tab === 'settings') {
    p.delete('hub');
    p.delete('section');
    p.delete('channelsView');
    p.delete('browserSection');
    p.set('settingsTab', next.settingsTab);
  }
  /* Drop legacy alias */
  p.delete('channel');
  return p.toString();
}
