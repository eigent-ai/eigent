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
  ArrowRight,
  Bot,
  Cast,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  CircleCheckBig,
  CircleHelp,
  CodeXml,
  FileText,
  Folder,
  Gift,
  Globe,
  Image,
  Inbox,
  Joystick,
  LayoutGrid,
  MessageCircle,
  PanelLeft,
  Plus,
  Settings,
  Sparkles,
  Zap,
} from 'lucide-react';
import React from 'react';
import eigentIcon from '../assets/eigent-icon.svg';
import s from '../ProjectWorkspaceDisplay.module.css';
import WorkspaceCycler from './WorkspaceCycler';

/* ── Sidebar nav item ───────────────────────────────────── */

function NavItem({
  icon,
  label,
  badge,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  badge?: string;
  active?: boolean;
}) {
  return (
    <div className={`${s.navItem} ${active ? s.navItemActive : ''}`}>
      <span className={s.navIcon}>{icon}</span>
      <span className={s.navLabel}>{label}</span>
      {badge && <span className={s.navBadge}>{badge}</span>}
    </div>
  );
}

/* ── Sidebar task row (placeholder projects) ────────────── */

function SidebarRow({
  status,
  label,
}: {
  status: 'done' | 'chat';
  label: string;
}) {
  return (
    <div className={s.taskRow}>
      <span className={s.taskRowIcon}>
        {status === 'done' && (
          <CircleCheckBig size={15} className={s.iconGreen} />
        )}
        {status === 'chat' && (
          <MessageCircle size={15} className={s.iconDefault} />
        )}
      </span>
      <span className={s.taskRowLabel}>{label}</span>
    </div>
  );
}

/* (ProjectRow removed — project list section removed from layout) */

/* ═══════════════════════════════════════════════════════════
   MAIN
═══════════════════════════════════════════════════════════ */

export default function WorkspaceDisplay() {
  return (
    <div
      className={s.container}
      data-cycle-root
      data-mode="single"
      aria-hidden="true"
    >
      <WorkspaceCycler />
      <div className={s.inner}>
        {/* ── Title bar ────────────────────────────────────── */}
        <div className={s.titleBar}>
          <div className={s.trafficLights}>
            <span className={`${s.dot} ${s.dotRed}`} />
            <span className={`${s.dot} ${s.dotYellow}`} />
            <span className={`${s.dot} ${s.dotGreen}`} />
          </div>
          <button className={s.titleIconBtn}>
            <PanelLeft size={15} />
          </button>
          <div className={s.appLogo}>
            <img
              src={eigentIcon}
              alt=""
              className={s.appLogoImg}
              draggable={false}
            />
            <span className={s.appLogoText}>Home</span>
          </div>
          <div className={s.titleSpacer} />
          <div className={s.titleTrailing}>
            <button className={s.titleIconBtn}>
              <CircleHelp size={15} />
            </button>
            <button className={s.titleIconBtn}>
              <Gift size={15} />
            </button>
            <div className={s.titleDivider} />
            <button className={s.titleIconBtn}>
              <Settings size={15} />
            </button>
          </div>
        </div>

        {/* ── Shell ────────────────────────────────────────── */}
        <div className={s.shell}>
          {/* ── Left sidebar ───────────────────────────────── */}
          <div className={s.sidebar}>
            <div className={s.spaceHeader}>
              <Folder size={15} className={s.iconDefault} />
              <span className={s.spaceName}>Eigent AI</span>
              <ChevronsUpDown size={15} className={s.iconMuted} />
            </div>

            <div className={s.navGroup}>
              <NavItem
                icon={<LayoutGrid size={15} />}
                label="Workspace"
                active
              />
              <NavItem
                icon={<Inbox size={15} />}
                label="Context"
                badge="Local"
              />
              <NavItem icon={<Zap size={15} />} label="Scheduled" />
              <NavItem icon={<Cast size={15} />} label="Dispatch" />
            </div>

            <div className={s.navDivider} />

            {/* New button */}
            <div className={s.navItem}>
              <span className={s.navIcon}>
                <Plus size={15} />
              </span>
              <span className={s.navLabel}>New</span>
            </div>

            {/* Placeholder project items */}
            <div className={s.taskList}>
              <SidebarRow status="done" label="Create a mock bank tr…" />
              <SidebarRow status="chat" label="what are the top AI trends…" />
              <SidebarRow status="done" label="Draft a blog post on agent…" />
              <SidebarRow status="done" label="Summarize Q3 product feed…" />
              <SidebarRow status="done" label="Research competitor pricing…" />
              <SidebarRow status="done" label="Generate weekly report for…" />
            </div>
          </div>

          {/* ── Content box ──────────────────────────────────── */}
          <div className={s.contentBox}>
            {/* ── Workspace landing column ─────────────────── */}
            <div className={s.workspaceLanding}>
              {/* Workspace header toolbar — 44px */}
              <div className={s.chatHeader}>
                <div className={s.chatHeaderSpacer} />
              </div>

              {/* Two equal-height halves */}
              <div className={s.workspaceScrollArea}>
                {/* ── Top half: input area ─────────────────── */}
                <div className={s.workspaceInputArea}>
                  <div className={s.workspaceComposer}>
                    {/* Project picker — mb-8, centered */}
                    <div className={s.wsPickerRow}>
                      <button className={s.spacePicker}>
                        <Folder size={16} className={s.iconDefault} />
                        <span>Eigent AI</span>
                        <ChevronsUpDown
                          size={16}
                          className={s.iconMuted}
                          style={{ opacity: 0.8 }}
                        />
                      </button>
                    </div>

                    {/* Heading — two variants, CSS shows the active one */}
                    <h2 className={s.workspaceHeading}>
                      <span data-ws-heading="single">
                        Cowork with Single Agent
                      </span>
                      <span data-ws-heading="workforce">
                        Cowork with Workforce
                      </span>
                    </h2>

                    {/* Agent area — single box (default) or workforce row (cycled) */}
                    <div className={s.wsAgentRow}>
                      {/* Single agent mode: one Bot icon box */}
                      <div className={s.singleAgentBox}>
                        <Bot
                          size={24}
                          strokeWidth={2}
                          className={s.iconMuted}
                        />
                      </div>

                      {/* Workforce mode: 4 agent cards + add button (hidden by default) */}
                      <div className={s.workforceAgentRow}>
                        {/* Developer Agent — terminal green */}
                        <div className={s.wfAgentCard}>
                          <div className={s.wfAgentIconWrap}>
                            <Bot
                              size={24}
                              strokeWidth={2}
                              className={s.iconMuted}
                            />
                            <span
                              className={`${s.wfAgentSubIcon} ${s.wfSubIconDev}`}
                            >
                              <CodeXml size={10} />
                            </span>
                          </div>
                        </div>
                        {/* Browser Agent — blue */}
                        <div className={s.wfAgentCard}>
                          <div className={s.wfAgentIconWrap}>
                            <Bot
                              size={24}
                              strokeWidth={2}
                              className={s.iconMuted}
                            />
                            <span
                              className={`${s.wfAgentSubIcon} ${s.wfSubIconBrowser}`}
                            >
                              <Globe size={10} />
                            </span>
                          </div>
                        </div>
                        {/* Multi Modal Agent — fuchsia */}
                        <div className={s.wfAgentCard}>
                          <div className={s.wfAgentIconWrap}>
                            <Bot
                              size={24}
                              strokeWidth={2}
                              className={s.iconMuted}
                            />
                            <span
                              className={`${s.wfAgentSubIcon} ${s.wfSubIconModal}`}
                            >
                              <Image size={10} />
                            </span>
                          </div>
                        </div>
                        {/* Document Agent — amber */}
                        <div className={s.wfAgentCard}>
                          <div className={s.wfAgentIconWrap}>
                            <Bot
                              size={24}
                              strokeWidth={2}
                              className={s.iconMuted}
                            />
                            <span
                              className={`${s.wfAgentSubIcon} ${s.wfSubIconDoc}`}
                            >
                              <FileText size={10} />
                            </span>
                          </div>
                        </div>
                        {/* Add agent button */}
                        <div className={s.wfAddBtn}>
                          <Plus
                            size={24}
                            strokeWidth={2}
                            className={s.iconMuted}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Input / BottomBox */}
                    <div className={s.workspaceInputBox}>
                      <div className={s.inputTextRow}>
                        <span className={s.inputPlaceholder}>
                          Describe a task for your agents…
                        </span>
                      </div>
                      <div className={s.inputActions}>
                        <div className={s.inputActionsLeft}>
                          <button className={s.inputPlusBtn}>
                            <Plus size={15} />
                          </button>
                          <div className={s.modelChip}>
                            <Sparkles size={14} className={s.iconDefault} />
                            <span className={s.modelChipText}>
                              Support Any Model you like
                            </span>
                          </div>
                        </div>
                        <div className={s.inputActionsRight}>
                          <div className={s.modeToggle}>
                            <Joystick size={14} className={s.iconDefault} />
                            <span className={s.modeToggleText}>
                              <span data-ws-mode-label="single">
                                Single Agent
                              </span>
                              <span data-ws-mode-label="workforce">
                                Workforce
                              </span>
                            </span>
                            <span className={s.modeToggleChevrons}>
                              <ChevronUp
                                size={9}
                                strokeWidth={2.5}
                                className={s.iconMuted}
                              />
                              <ChevronDown
                                size={9}
                                strokeWidth={2.5}
                                className={s.iconMuted}
                              />
                            </span>
                          </div>
                          <button className={s.sendBtn}>
                            <ArrowRight size={15} color="#fff" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── Bottom half: example prompts ─────────────── */}
                <div className={s.workspaceProjectsArea}>
                  <div className={s.promptCardsWrap}>
                    <div className={s.promptCard}>
                      <span className={s.promptCardText}>
                        Research the latest AI market trends and summarize key
                        insights
                      </span>
                    </div>
                    <div className={s.promptCard}>
                      <span className={s.promptCardText}>
                        Create a weekly status report from my project notes
                      </span>
                    </div>
                    <div className={s.promptCard}>
                      <span className={s.promptCardText}>
                        Analyze competitors and suggest positioning strategies
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Right CoworkPanel ────────────────────────── */}
            <div className={s.coworkPanel}>
              {/* Instructions + Memory settings card */}
              <div className={s.coworkSettingsCard}>
                <div className={s.coworkSettingsTitle}>Instructions</div>
                <div className={s.coworkMemoryRow}>
                  <span className={s.coworkMemoryLabel}>Memory</span>
                  <button className={s.coworkMemoryBtn}>Off</button>
                </div>
              </div>

              {/* Getting started — folded accordion */}
              <div className={s.coworkAccordion}>
                <button className={s.coworkAccordionTrigger}>
                  <span className={s.coworkAccordionTitle}>
                    Getting started
                  </span>
                  <span className={s.coworkAccordionCount}>0/4</span>
                  <ChevronRight size={15} className={s.iconMuted} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
