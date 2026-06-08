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
  ArrowLeft,
  ArrowRight,
  Cast,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  CircleCheckBig,
  CircleHelp,
  CircleSlash,
  FileSpreadsheet,
  FileText,
  Folder,
  Gift,
  Inbox,
  Joystick,
  LayoutGrid,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Plus,
  Settings,
  Sparkles,
  Zap,
} from 'lucide-react';
import React from 'react';
import eigentIcon from '../assets/eigent-icon.svg';
import tokenIcon from '../assets/token.svg';
import s from '../ProjectWorkspaceDisplay.module.css';
import ProjectWorkspaceCycler from './ProjectWorkspaceCycler';

// 0 = reset, 1..4 = log steps, 5 = all done (hold) → ~10s loop
const TOTAL_STEPS = 5;
const INITIAL_STEP = 2;

function initialLogState(groupStep: number): 'done' | 'active' | 'hidden' {
  if (groupStep < INITIAL_STEP) return 'done';
  if (groupStep === INITIAL_STEP) return 'active';
  return 'hidden';
}
const initialProgressDone = (i: number) => i < INITIAL_STEP - 1;
const initialFileVisible = (fileStep: number) => fileStep <= INITIAL_STEP;

/* ── Sidebar nav item ───────────────────────────────────── */

function NavItem({
  icon,
  label,
  badge,
  dot,
  contextDot,
}: {
  icon: React.ReactNode;
  label: string;
  badge?: string;
  dot?: boolean;
  contextDot?: boolean;
}) {
  return (
    <div className={s.navItem}>
      <span className={s.navIcon}>
        {icon}
        {dot && <span className={s.navDot} />}
        {contextDot !== undefined && (
          <span
            className={s.navDot}
            data-context-dot
            data-visible={contextDot ? 'true' : 'false'}
          />
        )}
      </span>
      <span className={s.navLabel}>{label}</span>
      {badge && <span className={s.navBadge}>{badge}</span>}
    </div>
  );
}

/* ── Sidebar task row ───────────────────────────────────── */

function TaskRow({
  status,
  label,
  active,
  dataTaskActive,
}: {
  status: 'done' | 'failed' | 'chat';
  label: string;
  active?: boolean;
  dataTaskActive?: boolean;
}) {
  return (
    <div
      className={`${s.taskRow} ${active ? s.taskRowActive : ''}`}
      {...(dataTaskActive
        ? { 'data-task-active': '', 'data-task-status': 'running' }
        : {})}
    >
      <span className={s.taskRowIcon}>
        {status === 'done' && (
          <>
            <CircleCheckBig
              size={15}
              className={`${s.iconGreen} ${dataTaskActive ? s.taskDoneIcon : ''}`}
            />
            {dataTaskActive && (
              <Loader2
                size={15}
                className={`${s.iconDefault} ${s.spinner} ${s.taskSpinnerIcon}`}
              />
            )}
          </>
        )}
        {status === 'failed' && <CircleSlash size={15} className={s.iconRed} />}
        {status === 'chat' && (
          <MessageCircle size={15} className={s.iconDefault} />
        )}
      </span>
      <span className={s.taskRowLabel}>{label}</span>
      {active && <MoreHorizontal size={13} className={s.iconMuted} />}
    </div>
  );
}

/* ── Log tool row (toolkit · method) ───────────────────── */

function LogToolRow({ toolkit, method }: { toolkit: string; method: string }) {
  return (
    <div className={s.logToolRow}>
      <span className={s.logRowText}>{toolkit}</span>
      <span className={s.logSep}>·</span>
      <span className={s.logRowText}>{method}</span>
      <ChevronRight size={13} className={s.iconMuted} />
    </div>
  );
}

function LogNarration({ text }: { text: string }) {
  return <div className={s.logNarration}>{text}</div>;
}

/* ── Right-panel accordion ──────────────────────────────── */

function PanelSection({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div className={s.panelSection}>
      <div className={s.panelSectionHeader}>
        <span className={s.panelSectionTitle}>{title}</span>
        {count !== undefined && <span className={s.countPill}>{count}</span>}
        <ChevronDown size={15} className={s.panelChevron} />
      </div>
      <div className={s.panelSectionBody}>{children}</div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN
═══════════════════════════════════════════════════════════ */

export default function ProjectWorkspaceDisplay() {
  const progressItems = [
    'Create mock bank transfer CSV with 10 columns',
    'Read and verify the CSV file contents',
    'Summarize the data in a written report',
    'Generate a chart to visualize relevant trends',
  ];

  return (
    <div className={s.container} data-cycle-root aria-hidden="true">
      <ProjectWorkspaceCycler totalSteps={TOTAL_STEPS} />
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

        {/* ── Shell (sidebar layer + content box) ──────────── */}
        <div className={s.shell}>
          {/* ── Left sidebar ───────────────────────────────── */}
          <div className={s.sidebar}>
            <div className={s.spaceHeader}>
              <Folder size={15} className={s.iconDefault} />
              <span className={s.spaceName}>Eigent AI</span>
              <ChevronsUpDown size={15} className={s.iconMuted} />
            </div>

            <div className={s.navGroup}>
              <NavItem icon={<LayoutGrid size={15} />} label="Workspace" />
              <NavItem
                icon={<Inbox size={15} />}
                label="Context"
                badge="Local"
                contextDot={initialFileVisible(1)}
              />
              <NavItem icon={<Zap size={15} />} label="Scheduled" />
              <NavItem icon={<Cast size={15} />} label="Dispatch" />
            </div>

            <div className={s.navDivider} />

            <div className={s.navItem}>
              <span className={s.navIcon}>
                <Plus size={15} />
              </span>
              <span className={s.navLabel}>New</span>
            </div>

            <div className={s.taskList}>
              <TaskRow
                status="done"
                label="Create a mock bank tr…"
                active
                dataTaskActive
              />
              <TaskRow status="chat" label="what are the top AI trends…" />
              <TaskRow status="done" label="Draft a blog post on agent…" />
              <TaskRow status="done" label="Summarize Q3 product feed…" />
              <TaskRow status="done" label="Research competitor pricing…" />
              <TaskRow status="done" label="Generate weekly report for…" />
            </div>
          </div>

          {/* ── Content box (chat + panel share one bg) ──────── */}
          <div className={s.contentBox}>
            {/* Chat column */}
            <div className={s.chat}>
              {/* Chat header */}
              <div className={s.chatHeader}>
                <button className={s.chatBackBtn}>
                  <ArrowLeft size={15} />
                </button>
                <div className={s.chatHeaderSpacer} />
                <div className={s.tokenBadge}>
                  <img src={tokenIcon} alt="" className={s.tokenIcon} />
                  <span className={s.tokenText}>
                    Total:{' '}
                    <span data-token data-token-anim="a">
                      108.9K
                    </span>
                  </span>
                </div>
              </div>

              {/* Scroll body (content capped + centered) */}
              <div className={s.chatScroll}>
                <div className={s.chatColumn}>
                  {/* User message */}
                  <div className={s.userBubble}>
                    <p className={s.userBubbleText}>
                      Create a mock bank transfer CSV file include 10 columns
                      and 10 rows. Read the generated CSV file and summarize the
                      data, generate a chart to visualize relevant trends or
                      insights from the data.
                    </p>
                  </div>

                  {/* Worked for */}
                  <div className={s.workedRow}>
                    <span className={s.workedLabel}>Worked for </span>
                    <span className={s.workedValue} data-worked>
                      0s
                    </span>
                    <ChevronDown size={13} className={s.iconMuted} />
                  </div>

                  {/* Preparing agent */}
                  <div className={s.prepRow}>
                    <span className={s.prepText}>Preparing agent</span>
                    <span className={s.logSep}>·</span>
                    <span className={s.prepText}>2 Registered</span>
                    <ChevronRight size={13} className={s.iconMuted} />
                  </div>

                  {/* ── Animated log groups ───────────────────── */}

                  {/* Step 1 */}
                  <div
                    className={s.logGroup}
                    data-log-step={1}
                    data-state={initialLogState(1)}
                  >
                    <div className={s.logGroupHeader}>
                      <span className={s.logGroupLabel}>
                        <span className={s.logAgentName}>CAMEL Agent</span>
                        <span className={s.logSep}>·</span>
                        <span className={s.logGroupDetail}>
                          File Toolkit · Write to file
                        </span>
                      </span>
                      <ChevronDown
                        size={13}
                        className={`${s.iconMuted} ${s.logChevronDown}`}
                      />
                      <ChevronRight
                        size={13}
                        className={`${s.iconMuted} ${s.logChevronRight}`}
                      />
                    </div>
                    <div className={s.logBody}>
                      <LogToolRow toolkit="TodoToolkit" method="Todo_write" />
                      <LogNarration text="Writing mock bank transfer data to CSV file..." />
                      <LogToolRow
                        toolkit="File Toolkit"
                        method="Write to file"
                      />
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div
                    className={s.logGroup}
                    data-log-step={2}
                    data-state={initialLogState(2)}
                  >
                    <div className={s.logGroupHeader}>
                      <span className={s.logGroupLabel}>
                        <span className={s.logAgentName}>CAMEL Agent</span>
                        <span className={s.logSep}>·</span>
                        <span className={s.logGroupDetail}>
                          File Toolkit · Read file
                        </span>
                      </span>
                      <ChevronDown
                        size={13}
                        className={`${s.iconMuted} ${s.logChevronDown}`}
                      />
                      <ChevronRight
                        size={13}
                        className={`${s.iconMuted} ${s.logChevronRight}`}
                      />
                    </div>
                    <div className={s.logBody}>
                      <LogToolRow toolkit="File Toolkit" method="Read file" />
                      <LogNarration text="Parsing CSV contents and verifying column structure..." />
                      <LogToolRow toolkit="TodoToolkit" method="Todo_write" />
                    </div>
                  </div>

                  {/* Step 3 */}
                  <div
                    className={s.logGroup}
                    data-log-step={3}
                    data-state={initialLogState(3)}
                  >
                    <div className={s.logGroupHeader}>
                      <span className={s.logGroupLabel}>
                        <span className={s.logAgentName}>CAMEL Agent</span>
                        <span className={s.logSep}>·</span>
                        <span className={s.logGroupDetail}>
                          File Toolkit · Write to file
                        </span>
                      </span>
                      <ChevronDown
                        size={13}
                        className={`${s.iconMuted} ${s.logChevronDown}`}
                      />
                      <ChevronRight
                        size={13}
                        className={`${s.iconMuted} ${s.logChevronRight}`}
                      />
                    </div>
                    <div className={s.logBody}>
                      <LogToolRow
                        toolkit="Terminal Toolkit"
                        method="Shell exec"
                      />
                      <LogNarration text="Generating markdown report with data summary..." />
                      <LogToolRow
                        toolkit="File Toolkit"
                        method="Write to file"
                      />
                    </div>
                  </div>

                  {/* Step 4 */}
                  <div
                    className={s.logGroup}
                    data-log-step={4}
                    data-state={initialLogState(4)}
                  >
                    <div className={s.logGroupHeader}>
                      <span className={s.logGroupLabel}>
                        <span className={s.logAgentName}>CAMEL Agent</span>
                        <span className={s.logSep}>·</span>
                        <span className={s.logGroupDetail}>
                          Terminal Toolkit · Shell exec
                        </span>
                      </span>
                      <ChevronDown
                        size={13}
                        className={`${s.iconMuted} ${s.logChevronDown}`}
                      />
                      <ChevronRight
                        size={13}
                        className={`${s.iconMuted} ${s.logChevronRight}`}
                      />
                    </div>
                    <div className={s.logBody}>
                      <LogToolRow
                        toolkit="Screenshot Toolkit"
                        method="Read image"
                      />
                      <LogNarration text="Rendering chart visualization from bank transfer data..." />
                      <LogToolRow
                        toolkit="Terminal Toolkit"
                        method="Shell exec"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Input bar (bottom box) */}
              <div className={s.inputWrap}>
                <div className={s.inputColumn}>
                  <div className={s.inputBox}>
                    <div className={s.inputTextRow}>
                      <span className={s.inputPlaceholder}>
                        Ask a follow-up
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
                          <span className={s.modeToggleText}>Single Agent</span>
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
            </div>

            {/* ── Right session panel ──────────────────────── */}
            <div className={s.panel}>
              <div className={s.panelHeader}>
                <PanelRight size={15} className={s.iconDefault} />
                <span className={s.panelHeaderTitle}>Single Agent</span>
              </div>

              <div className={s.panelScroll}>
                <PanelSection title="Progress" count={4}>
                  <div className={s.progressList}>
                    {progressItems.map((text, i) => (
                      <div
                        key={i}
                        className={s.progressItem}
                        data-progress-index={i}
                        data-done={initialProgressDone(i) ? 'true' : 'false'}
                      >
                        <span className={s.progressCircleWrap}>
                          <span className={s.progressCircleDone}>
                            <Check size={9} strokeWidth={3.5} color="#fff" />
                          </span>
                          <span className={s.progressCirclePending} />
                        </span>
                        <span className={s.progressText}>{text}</span>
                      </div>
                    ))}
                  </div>
                </PanelSection>

                <PanelSection title="Execution Context">
                  <p className={s.panelEmpty}>
                    Track skills, MCPs and referenced files used in this task.
                  </p>
                </PanelSection>

                <PanelSection title="Agent Folder">
                  <p
                    className={s.panelEmpty}
                    data-folder-empty
                    data-visible="false"
                  >
                    Files the agent writes or updates during this task appear
                    here so you can open them.
                  </p>
                  <div className={s.folderList}>
                    <div
                      className={s.folderFile}
                      data-file-step={1}
                      data-visible={initialFileVisible(1) ? 'true' : 'false'}
                    >
                      <FileSpreadsheet size={15} className={s.iconMuted} />
                      <span className={s.folderFileName}>
                        bank_transfers.csv
                      </span>
                    </div>
                    <div
                      className={s.folderFile}
                      data-file-step={3}
                      data-visible={initialFileVisible(3) ? 'true' : 'false'}
                    >
                      <FileText size={15} className={s.iconMuted} />
                      <span className={s.folderFileName}>
                        analysis_report.md
                      </span>
                    </div>
                    <div
                      className={s.folderFile}
                      data-file-step={4}
                      data-visible={initialFileVisible(4) ? 'true' : 'false'}
                    >
                      <FileText size={15} className={s.iconMuted} />
                      <span className={s.folderFileName}>
                        bank_transfer_chart.png
                      </span>
                    </div>
                  </div>
                </PanelSection>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
