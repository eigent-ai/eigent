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
  SIDEBAR_TAB_LABEL_CLASS,
  sidebarTabButtonClass,
} from '@/components/Layout/AppSidebar';
import {
  SettingsRow,
  SettingsRowGroup,
} from '@/components/Settings/SettingsRowGroup';
import SettingsSectionPage from '@/components/Settings/SettingsSectionPage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { EnvironmentRequirementsEditor } from '@/components/WorkspaceConfiguration/EnvironmentRequirementsEditor';
import { WorkspaceBundleSaveDialog } from '@/components/WorkspaceConfiguration/WorkspaceBundleSaveDialog';
import { useWorkspaceConfiguration } from '@/hooks/useWorkspaceConfiguration';
import { cn } from '@/lib/utils';
import {
  workspaceEnvironmentVariables,
  type ThinkingEffort,
  type WorkspaceConfigurationDocument,
  type WorkspaceContextSource,
} from '@/service/workspaceConfigurationApi';
import { useAuthStore } from '@/store/authStore';
import { useSpaceStore } from '@/store/spaceStore';
import { Plus, RefreshCw, ShareIcon, ShieldCheck, Trash2 } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

const csv = (value: string): string[] =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

const nextId = (prefix: string, existing: string[]): string => {
  for (let index = 1; ; index += 1) {
    const candidate = `${prefix}_${index}`;
    if (!existing.includes(candidate)) return candidate;
  }
};

const nextEnvironmentVariableName = (
  document: WorkspaceConfigurationDocument
): string => {
  const existing = workspaceEnvironmentVariables(document).map(
    (variable) => variable.name
  );
  for (let index = 1; ; index += 1) {
    const candidate = `ENV_VAR_${index}`;
    if (!existing.includes(candidate)) return candidate;
  }
};

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-6 text-center text-body-sm text-ds-text-neutral-muted-default">
      {children}
    </div>
  );
}

function RemoveButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      buttonContent="icon-only"
      aria-label={label}
      onClick={onClick}
    >
      <Trash2 className="h-4 w-4" aria-hidden />
    </Button>
  );
}

function AddSectionButton({
  label = 'Add',
  onClick,
}: {
  label?: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="primary"
      size="sm"
      buttonRadius="full"
      textWeight="semibold"
      onClick={onClick}
    >
      <Plus className="h-4 w-4" aria-hidden />
      {label}
    </Button>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-16 items-center gap-4 px-4 py-3 md:grid-cols-[minmax(180px,0.8fr)_minmax(260px,1.2fr)]">
      <div className="min-w-0">
        <span className="text-body-sm font-bold text-ds-text-neutral-default-default">
          {label}
        </span>
        {description ? (
          <span className="mt-0.5 text-body-xs text-ds-text-neutral-muted-default">
            {description}
          </span>
        ) : null}
      </div>
      <div className="min-w-0 md:justify-self-stretch">{children}</div>
    </div>
  );
}

const workspaceSettingSections = [
  { id: 'space-settings-identity', label: 'Identity' },
  { id: 'space-settings-model', label: 'Model' },
  { id: 'space-settings-environment', label: 'Environment' },
  { id: 'space-settings-instructions', label: 'Instructions' },
  { id: 'space-settings-context', label: 'Context' },
  { id: 'space-settings-agents', label: 'Agents' },
  { id: 'space-settings-skills', label: 'Skills' },
  { id: 'space-settings-connectors', label: 'Connectors' },
  { id: 'space-settings-mcp-servers', label: 'MCP servers' },
] as const;

type WorkspaceSettingSectionId =
  (typeof workspaceSettingSections)[number]['id'];

const tableBoxClassName =
  'w-full overflow-hidden rounded-xl bg-ds-bg-neutral-subtle-default p-0 divide-y divide-ds-border-neutral-subtle-default';

function WorkspaceSettingsSection({
  id,
  title,
  description,
  action,
  boxClassName,
  children,
}: {
  id: WorkspaceSettingSectionId;
  title: string;
  description: string;
  action?: ReactNode;
  boxClassName?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      data-workspace-settings-section={id}
      className="scroll-mt-24"
    >
      <SettingsRowGroup>
        <SettingsRow title={title} description={description} action={action}>
          <div className={cn('w-full', boxClassName)}>{children}</div>
        </SettingsRow>
      </SettingsRowGroup>
    </section>
  );
}

export interface WorkspaceConfigurationEditorProps {
  presentation?: 'page' | 'settings';
  spaceId?: string | null;
}

export function WorkspaceConfigurationEditor({
  presentation = 'page',
  spaceId,
}: WorkspaceConfigurationEditorProps) {
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [activeSectionId, setActiveSectionId] =
    useState<WorkspaceSettingSectionId>('space-settings-identity');
  const settingsContentRef = useRef<HTMLDivElement>(null);
  const storeActiveSpaceId = useSpaceStore((state) => state.activeSpaceId);
  const targetSpaceId = spaceId === undefined ? storeActiveSpaceId : spaceId;
  const targetSpace = useSpaceStore((state) =>
    targetSpaceId ? state.spaces[targetSpaceId] : null
  );
  const email = useAuthStore((state) => state.email);
  const userId = useAuthStore((state) => state.user_id);
  const identity = useMemo(
    () => (email ? { email, userId } : null),
    [email, userId]
  );
  const { draft, document, setDocument, saveState, error, reload, retrySave } =
    useWorkspaceConfiguration({
      spaceId: targetSpaceId,
      spaceName: targetSpace?.name,
      identity,
    });

  const update = useCallback(
    (mutate: (current: WorkspaceConfigurationDocument) => void) => {
      setDocument((current) => {
        const next = structuredClone(current);
        mutate(next);
        return next;
      });
    },
    [setDocument]
  );

  const syncActiveSection = useCallback(() => {
    const content = settingsContentRef.current;
    if (!content) return;

    const sections = workspaceSettingSections.flatMap((section) => {
      const element = globalThis.document.getElementById(section.id);
      return element
        ? [{ id: section.id, rect: element.getBoundingClientRect() }]
        : [];
    });
    if (
      sections.length === 0 ||
      sections.every(({ rect }) => rect.top === 0 && rect.height === 0)
    ) {
      return;
    }

    const scrollRoot = content.closest<HTMLElement>(
      '[data-space-detail-scroll-container], [data-workspace-settings-scroll-root]'
    );
    const rootTop = scrollRoot?.getBoundingClientRect().top ?? 0;
    const activationLine = rootTop + 96;
    let nextSectionId: WorkspaceSettingSectionId =
      workspaceSettingSections[0].id;

    for (const section of sections) {
      if (section.rect.top > activationLine) break;
      nextSectionId = section.id;
    }

    const reachedBottom =
      scrollRoot != null &&
      scrollRoot.scrollHeight > scrollRoot.clientHeight &&
      scrollRoot.scrollTop + scrollRoot.clientHeight >=
        scrollRoot.scrollHeight - 2;
    if (reachedBottom) {
      nextSectionId = workspaceSettingSections.at(-1)!.id;
    }

    setActiveSectionId((current) =>
      current === nextSectionId ? current : nextSectionId
    );
  }, []);

  useEffect(() => {
    const content = settingsContentRef.current;
    const view = content?.ownerDocument.defaultView;
    if (!content || !view) return;

    const scrollRoot = content.closest<HTMLElement>(
      '[data-space-detail-scroll-container], [data-workspace-settings-scroll-root]'
    );
    const scrollTarget: HTMLElement | Window = scrollRoot ?? view;
    let animationFrame: number | null = null;
    const scheduleSync = () => {
      if (animationFrame !== null) return;
      animationFrame = view.requestAnimationFrame(() => {
        animationFrame = null;
        syncActiveSection();
      });
    };

    scrollTarget.addEventListener('scroll', scheduleSync, { passive: true });
    view.addEventListener('resize', scheduleSync);
    scheduleSync();

    return () => {
      scrollTarget.removeEventListener('scroll', scheduleSync);
      view.removeEventListener('resize', scheduleSync);
      if (animationFrame !== null) view.cancelAnimationFrame(animationFrame);
    };
  }, [document, presentation, syncActiveSection]);

  const scrollToSection = useCallback(
    (sectionId: WorkspaceSettingSectionId) => {
      setActiveSectionId(sectionId);
      globalThis.document.getElementById(sectionId)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    },
    []
  );

  if (!targetSpaceId || !targetSpace) {
    return (
      <main className="flex h-full items-center justify-center p-8 text-ds-text-neutral-muted-default">
        Select a Space before configuring its workforce.
      </main>
    );
  }

  if (!email) {
    return (
      <main className="flex h-full items-center justify-center p-8 text-ds-text-neutral-muted-default">
        Sign in to edit this Workspace Configuration.
      </main>
    );
  }

  if (!document) {
    return (
      <main className="flex h-full items-center justify-center gap-3 p-8 text-ds-text-neutral-muted-default">
        <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
        Loading Workspace Configuration…
      </main>
    );
  }

  const instructions = Object.entries(document.spec.instructions);
  const environmentVariables = workspaceEnvironmentVariables(document);

  return (
    <main
      data-workspace-settings-scroll-root={
        presentation === 'page' ? true : undefined
      }
      className={cn(
        'h-full overflow-y-auto',
        presentation === 'page' && 'bg-ds-bg-neutral-muted-default',
        presentation === 'settings' && 'h-auto overflow-visible bg-transparent'
      )}
    >
      <div
        data-workspace-configuration-width
        className={cn(
          'w-full',
          presentation === 'page' && 'mx-auto max-w-5xl px-6 py-8'
        )}
      >
        {presentation !== 'settings' ? (
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <span className="text-body-xs font-medium uppercase tracking-wide text-ds-text-neutral-muted-default">
                {targetSpace.name}
              </span>
              {presentation === 'page' ? (
                <h1 className="text-heading-2xl mt-1 font-semibold text-ds-text-neutral-default-default">
                  Workspace Configuration
                </h1>
              ) : null}
              <span className="mt-2 max-w-2xl text-body-sm text-ds-text-neutral-muted-default">
                Configure the context, tools, agents, permissions, and
                versioning that every Run in this Space inherits.
              </span>
            </div>
          </header>
        ) : null}

        <SettingsSectionPage className="md:grid md:grid-cols-[300px_minmax(0,1fr)] md:items-start md:gap-6">
          <aside
            aria-label="Space identity profile"
            className={cn(
              'w-full min-w-0 md:sticky md:w-[300px]',
              presentation === 'settings' ? 'md:top-16' : 'md:top-4'
            )}
          >
            <div className="w-full min-w-0 rounded-2xl bg-ds-bg-neutral-default-default p-4">
              <div className="flex min-w-0 flex-col gap-2 px-2">
                <div className="flex h-7 min-w-0 items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-body-sm font-semibold text-ds-text-neutral-default-default">
                    Profile
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    buttonContent="icon-only"
                    buttonRadius="full"
                    aria-label="Share workspace bundle"
                    title="Share workspace bundle"
                    onClick={() => setSaveDialogOpen(true)}
                    disabled={!draft?.persisted || saveState !== 'saved'}
                  >
                    <ShareIcon className="h-4 w-4" aria-hidden />
                  </Button>
                </div>

                <span
                  className="block min-w-0 truncate text-body-md font-bold text-ds-text-neutral-default-default"
                  title={document.metadata.name}
                >
                  {document.metadata.name}
                </span>
              </div>

              <nav
                aria-label="Space settings sections"
                className="mt-4 border-x-0 border-b-0 border-t border-solid border-ds-border-neutral-subtle-default pt-4"
              >
                <ul
                  data-workspace-settings-tab-list
                  className="m-0 list-none space-y-0.5 p-0"
                >
                  {workspaceSettingSections.map((section) => {
                    const active = activeSectionId === section.id;
                    return (
                      <li key={section.id} className="m-0 list-none p-0">
                        <button
                          type="button"
                          className={sidebarTabButtonClass(active)}
                          data-workspace-settings-tab={section.id}
                          aria-current={active ? 'location' : undefined}
                          onClick={() => scrollToSection(section.id)}
                        >
                          <span className={SIDEBAR_TAB_LABEL_CLASS}>
                            {section.label}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            </div>
          </aside>

          <div ref={settingsContentRef} className="min-w-0 space-y-4">
            {error ? (
              <div className="flex items-center justify-between gap-4 rounded-xl bg-ds-bg-error-subtle-default px-4 py-3 text-body-sm text-ds-text-error-strong-default">
                <span>{error}</span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void reload()}
                >
                  Reload durable copy
                </Button>
              </div>
            ) : null}

            <section
              id="space-settings-identity"
              data-workspace-settings-section="space-settings-identity"
              className="scroll-mt-24"
            >
              <div
                data-testid="identity-settings-group"
                className="w-full divide-y divide-ds-border-neutral-subtle-default overflow-hidden rounded-2xl bg-ds-bg-neutral-default-default"
              >
                <SettingRow
                  label="Bundle name"
                  description="Shown to collaborators and bundle recipients."
                >
                  <Input
                    variant="secondary"
                    value={document.metadata.name}
                    aria-label="Bundle name"
                    onChange={(event) =>
                      update((next) => {
                        next.metadata.name = event.target.value;
                      })
                    }
                  />
                </SettingRow>
                <SettingRow
                  label="Permission profile"
                  description="Controls how actions are reviewed."
                >
                  <Select
                    value={document.spec.permissions.profile}
                    onValueChange={(value) =>
                      update((next) => {
                        next.spec.permissions.profile = value as
                          | 'request_approval'
                          | 'auto_review'
                          | 'workspace_write'
                          | 'full_access';
                      })
                    }
                  >
                    <SelectTrigger
                      variant="secondary"
                      aria-label="Permission profile"
                      wrapperClassName="w-full"
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="request_approval">
                          Request approval
                        </SelectItem>
                        <SelectItem value="auto_review">
                          Auto-review safe actions
                        </SelectItem>
                        <SelectItem value="workspace_write">
                          Workspace write
                        </SelectItem>
                        <SelectItem value="full_access">Full access</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </SettingRow>
                <SettingRow
                  label="Git workspace environment"
                  description="Use local checkpoints and isolated worktrees."
                >
                  <div className="flex min-h-10 items-center justify-end">
                    <Switch
                      aria-label="Git workspace environment"
                      checked={document.spec.git.enabled}
                      onCheckedChange={(checked) =>
                        update((next) => {
                          next.spec.git.enabled = checked;
                        })
                      }
                    />
                  </div>
                </SettingRow>
                <SettingRow
                  label="Remote policy"
                  description="Choose when remote Git operations are allowed."
                >
                  <Select
                    value={document.spec.git.remotePolicy}
                    onValueChange={(value) =>
                      update((next) => {
                        next.spec.git.remotePolicy = value as
                          | 'deny'
                          | 'prompt'
                          | 'allow';
                      })
                    }
                  >
                    <SelectTrigger
                      variant="secondary"
                      aria-label="Remote policy"
                      wrapperClassName="w-full"
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="deny">Deny</SelectItem>
                        <SelectItem value="prompt">
                          Ask before remote operations
                        </SelectItem>
                        <SelectItem value="allow">
                          Allow according to permission policy
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </SettingRow>
              </div>
            </section>

            <WorkspaceSettingsSection
              id="space-settings-model"
              title="Model"
              description="Set the default model and reasoning effort inherited by this Space."
              boxClassName={tableBoxClassName}
            >
              <SettingRow label="Default model reference">
                <Input
                  value={document.spec.models.default.modelRef}
                  aria-label="Default model reference"
                  onChange={(event) =>
                    update((next) => {
                      next.spec.models.default.modelRef = event.target.value;
                    })
                  }
                />
              </SettingRow>
              <SettingRow label="Thinking effort">
                <Select
                  value={document.spec.models.default.thinkingEffort}
                  onValueChange={(value) =>
                    update((next) => {
                      next.spec.models.default.thinkingEffort =
                        value as ThinkingEffort;
                    })
                  }
                >
                  <SelectTrigger
                    aria-label="Thinking effort"
                    wrapperClassName="w-full"
                    className="w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="xhigh">Extra high</SelectItem>
                      <SelectItem value="max">Max</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </SettingRow>
            </WorkspaceSettingsSection>

            <WorkspaceSettingsSection
              id="space-settings-environment"
              title="Environment"
              description="Declare portable variable names only; local and secret values are never shared."
              action={
                <AddSectionButton
                  onClick={() =>
                    update((next) => {
                      next.spec.environment = {
                        variables: [
                          ...workspaceEnvironmentVariables(next),
                          {
                            name: nextEnvironmentVariableName(next),
                            required: true,
                            sensitive: true,
                          },
                        ],
                      };
                    })
                  }
                />
              }
              boxClassName={tableBoxClassName}
            >
              <EnvironmentRequirementsEditor
                variables={environmentVariables}
                showAddAction={false}
                onChange={(variables) =>
                  update((next) => {
                    next.spec.environment = { variables };
                  })
                }
              />
            </WorkspaceSettingsSection>

            <WorkspaceSettingsSection
              id="space-settings-instructions"
              title="Instructions"
              description="Assign versioned instruction assets to workforce roles."
              action={
                <AddSectionButton
                  onClick={() =>
                    update((next) => {
                      const role = nextId(
                        'role',
                        Object.keys(next.spec.instructions)
                      );
                      next.spec.instructions[role] =
                        `bundle://instructions/${role}.md`;
                    })
                  }
                />
              }
              boxClassName={tableBoxClassName}
            >
              {instructions.length === 0 ? (
                <EmptyRow>
                  Add an instruction asset for a coordinator or worker role.
                </EmptyRow>
              ) : (
                instructions.map(([role, ref], index) => (
                  <SettingRow key={role} label={`Instruction ${index + 1}`}>
                    <div className="grid items-end gap-2 md:grid-cols-[1fr_2fr_auto]">
                      <Input
                        title="Role"
                        value={role}
                        onChange={(event) => {
                          const replacement = event.target.value;
                          update((next) => {
                            const value = next.spec.instructions[role];
                            delete next.spec.instructions[role];
                            next.spec.instructions[replacement] = value;
                          });
                        }}
                      />
                      <Input
                        title="Instruction asset"
                        value={ref}
                        onChange={(event) =>
                          update((next) => {
                            next.spec.instructions[role] = event.target.value;
                          })
                        }
                      />
                      <RemoveButton
                        label={`Remove ${role} instructions`}
                        onClick={() =>
                          update((next) => {
                            delete next.spec.instructions[role];
                          })
                        }
                      />
                    </div>
                  </SettingRow>
                ))
              )}
            </WorkspaceSettingsSection>

            <WorkspaceSettingsSection
              id="space-settings-context"
              title="Context"
              description="Declare shareable context or named local path slots."
              action={
                <AddSectionButton
                  onClick={() =>
                    update((next) => {
                      const id = nextId(
                        'context',
                        next.spec.context.map((item) => item.id)
                      );
                      next.spec.context.push({
                        id,
                        kind: 'inline',
                        content: '',
                        sharing: 'reference_only',
                      });
                    })
                  }
                />
              }
              boxClassName={tableBoxClassName}
            >
              {document.spec.context.length === 0 ? (
                <EmptyRow>No workspace context is configured yet.</EmptyRow>
              ) : (
                document.spec.context.map((item, index) => (
                  <SettingRow
                    key={`${item.id}-${index}`}
                    label={item.id || `Context ${index + 1}`}
                  >
                    <div className="space-y-3">
                      <div className="grid items-end gap-2 md:grid-cols-[1fr_1fr_auto]">
                        <Input
                          title="Context id"
                          value={item.id}
                          onChange={(event) =>
                            update((next) => {
                              next.spec.context[index].id = event.target.value;
                            })
                          }
                        />
                        <Select
                          value={item.kind}
                          onValueChange={(value) =>
                            update((next) => {
                              const kind =
                                value as WorkspaceContextSource['kind'];
                              next.spec.context[index] = {
                                id: next.spec.context[index].id,
                                kind,
                                ...(kind === 'inline'
                                  ? { content: '' }
                                  : kind === 'local_path_slot'
                                    ? { slot: 'workspace_folder' }
                                    : kind === 'bundle_asset'
                                      ? {
                                          path: 'bundle://context/context.md',
                                        }
                                      : {}),
                                sharing: 'reference_only',
                              };
                            })
                          }
                        >
                          <SelectTrigger
                            title="Kind"
                            wrapperClassName="w-full"
                            className="w-full"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="inline">Inline</SelectItem>
                              <SelectItem value="local_path_slot">
                                Local path slot
                              </SelectItem>
                              <SelectItem value="bundle_asset">
                                Bundle asset
                              </SelectItem>
                              <SelectItem value="artifact_ref">
                                Artifact reference
                              </SelectItem>
                              <SelectItem value="memory_scope">
                                Memory scope
                              </SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <RemoveButton
                          label={`Remove context ${item.id}`}
                          onClick={() =>
                            update((next) => {
                              next.spec.context.splice(index, 1);
                            })
                          }
                        />
                      </div>
                      {item.kind === 'inline' ? (
                        <Textarea
                          variant="enhanced"
                          title="Content"
                          value={item.content || ''}
                          onChange={(event) =>
                            update((next) => {
                              next.spec.context[index].content =
                                event.target.value;
                            })
                          }
                        />
                      ) : (
                        <Input
                          title={
                            item.kind === 'local_path_slot'
                              ? 'Slot name'
                              : 'Logical reference'
                          }
                          value={
                            item.kind === 'local_path_slot'
                              ? item.slot || ''
                              : item.path || ''
                          }
                          onChange={(event) =>
                            update((next) => {
                              if (
                                next.spec.context[index].kind ===
                                'local_path_slot'
                              ) {
                                next.spec.context[index].slot =
                                  event.target.value;
                              } else {
                                next.spec.context[index].path =
                                  event.target.value;
                              }
                            })
                          }
                        />
                      )}
                    </div>
                  </SettingRow>
                ))
              )}
            </WorkspaceSettingsSection>

            <WorkspaceSettingsSection
              id="space-settings-agents"
              title="Agents"
              description="Define the workforce roles available in this Space."
              action={
                <AddSectionButton
                  onClick={() =>
                    update((next) => {
                      const id = nextId(
                        'agent',
                        next.spec.agents.map((item) => item.id)
                      );
                      next.spec.agents.push({
                        id,
                        role: 'worker',
                        modelProfile: 'default',
                      });
                    })
                  }
                />
              }
              boxClassName={tableBoxClassName}
            >
              {document.spec.agents.length === 0 ? (
                <EmptyRow>No agents configured.</EmptyRow>
              ) : (
                document.spec.agents.map((item, index) => (
                  <SettingRow
                    key={`${item.id}-${index}`}
                    label={item.id || `Agent ${index + 1}`}
                  >
                    <div className="grid items-end gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
                      <Input
                        title="Agent id"
                        value={item.id}
                        onChange={(event) =>
                          update((next) => {
                            next.spec.agents[index].id = event.target.value;
                          })
                        }
                      />
                      <Input
                        title="Role"
                        value={item.role}
                        onChange={(event) =>
                          update((next) => {
                            next.spec.agents[index].role = event.target.value;
                          })
                        }
                      />
                      <Input
                        title="Model profile"
                        value={item.modelProfile}
                        onChange={(event) =>
                          update((next) => {
                            next.spec.agents[index].modelProfile =
                              event.target.value;
                          })
                        }
                      />
                      <RemoveButton
                        label={`Remove agent ${item.id}`}
                        onClick={() =>
                          update((next) => {
                            next.spec.agents.splice(index, 1);
                          })
                        }
                      />
                    </div>
                  </SettingRow>
                ))
              )}
            </WorkspaceSettingsSection>

            <WorkspaceSettingsSection
              id="space-settings-skills"
              title="Skills"
              description="Assign portable skill packages to workforce roles."
              action={
                <AddSectionButton
                  onClick={() =>
                    update((next) => {
                      const id = next.spec.skills.length + 1;
                      next.spec.skills.push({
                        ref: `bundle://skills/skill_${id}`,
                        assignTo: [],
                      });
                    })
                  }
                />
              }
              boxClassName={tableBoxClassName}
            >
              {document.spec.skills.length === 0 ? (
                <EmptyRow>No skills assigned.</EmptyRow>
              ) : (
                document.spec.skills.map((item, index) => (
                  <SettingRow
                    key={`${item.ref}-${index}`}
                    label={`Skill ${index + 1}`}
                  >
                    <div className="grid items-end gap-2 md:grid-cols-[2fr_1fr_auto]">
                      <Input
                        title="Skill reference"
                        value={item.ref}
                        onChange={(event) =>
                          update((next) => {
                            next.spec.skills[index].ref = event.target.value;
                          })
                        }
                      />
                      <Input
                        title="Assign to"
                        value={item.assignTo.join(', ')}
                        onChange={(event) =>
                          update((next) => {
                            next.spec.skills[index].assignTo = csv(
                              event.target.value
                            );
                          })
                        }
                      />
                      <RemoveButton
                        label={`Remove skill ${item.ref}`}
                        onClick={() =>
                          update((next) => {
                            next.spec.skills.splice(index, 1);
                          })
                        }
                      />
                    </div>
                  </SettingRow>
                ))
              )}
            </WorkspaceSettingsSection>

            <WorkspaceSettingsSection
              id="space-settings-connectors"
              title="Connectors"
              description="Declare connection slots and required grants without storing credentials."
              action={
                <AddSectionButton
                  onClick={() =>
                    update((next) => {
                      const id = nextId(
                        'connector',
                        next.spec.connectors.map((item) => item.id)
                      );
                      next.spec.connectors.push({
                        id,
                        connector: id,
                        connectionSlot: `${id}_connection`,
                        requiredGrants: [],
                      });
                    })
                  }
                />
              }
              boxClassName={tableBoxClassName}
            >
              {document.spec.connectors.length === 0 ? (
                <EmptyRow>No connector requirements.</EmptyRow>
              ) : (
                document.spec.connectors.map((item, index) => (
                  <SettingRow
                    key={`${item.id}-${index}`}
                    label={item.id || `Connector ${index + 1}`}
                  >
                    <div className="grid items-end gap-2 xl:grid-cols-[1fr_1fr_1fr_1fr_auto]">
                      <Input
                        title="Id"
                        value={item.id}
                        onChange={(event) =>
                          update((next) => {
                            next.spec.connectors[index].id = event.target.value;
                          })
                        }
                      />
                      <Input
                        title="Connector"
                        value={item.connector}
                        onChange={(event) =>
                          update((next) => {
                            next.spec.connectors[index].connector =
                              event.target.value;
                          })
                        }
                      />
                      <Input
                        title="Connection slot"
                        value={item.connectionSlot}
                        onChange={(event) =>
                          update((next) => {
                            next.spec.connectors[index].connectionSlot =
                              event.target.value;
                          })
                        }
                      />
                      <Input
                        title="Required grants"
                        value={item.requiredGrants.join(', ')}
                        onChange={(event) =>
                          update((next) => {
                            next.spec.connectors[index].requiredGrants = csv(
                              event.target.value
                            );
                          })
                        }
                      />
                      <RemoveButton
                        label={`Remove connector ${item.id}`}
                        onClick={() =>
                          update((next) => {
                            next.spec.connectors.splice(index, 1);
                          })
                        }
                      />
                    </div>
                  </SettingRow>
                ))
              )}
            </WorkspaceSettingsSection>

            <WorkspaceSettingsSection
              id="space-settings-mcp-servers"
              title="MCP servers"
              description="Configure portable MCP definitions and local secret slots."
              action={
                <AddSectionButton
                  onClick={() =>
                    update((next) => {
                      const id = nextId(
                        'mcp',
                        next.spec.mcpServers.map((item) => item.id)
                      );
                      next.spec.mcpServers.push({
                        id,
                        definition: `bundle://mcp/${id}.json`,
                        secretSlots: [],
                        assignTo: [],
                      });
                    })
                  }
                />
              }
              boxClassName={tableBoxClassName}
            >
              {document.spec.mcpServers.length === 0 ? (
                <EmptyRow>No MCP servers.</EmptyRow>
              ) : (
                document.spec.mcpServers.map((item, index) => (
                  <SettingRow
                    key={`${item.id}-${index}`}
                    label={item.id || `MCP server ${index + 1}`}
                  >
                    <div className="grid items-end gap-2 xl:grid-cols-[1fr_2fr_1fr_1fr_auto]">
                      <Input
                        title="Id"
                        value={item.id}
                        onChange={(event) =>
                          update((next) => {
                            next.spec.mcpServers[index].id = event.target.value;
                          })
                        }
                      />
                      <Input
                        title="Definition"
                        value={item.definition}
                        onChange={(event) =>
                          update((next) => {
                            next.spec.mcpServers[index].definition =
                              event.target.value;
                          })
                        }
                      />
                      <Input
                        title="Secret slots"
                        value={item.secretSlots.join(', ')}
                        onChange={(event) =>
                          update((next) => {
                            next.spec.mcpServers[index].secretSlots = csv(
                              event.target.value
                            );
                          })
                        }
                      />
                      <Input
                        title="Assign to"
                        value={item.assignTo.join(', ')}
                        onChange={(event) =>
                          update((next) => {
                            next.spec.mcpServers[index].assignTo = csv(
                              event.target.value
                            );
                          })
                        }
                      />
                      <RemoveButton
                        label={`Remove MCP ${item.id}`}
                        onClick={() =>
                          update((next) => {
                            next.spec.mcpServers.splice(index, 1);
                          })
                        }
                      />
                    </div>
                  </SettingRow>
                ))
              )}
            </WorkspaceSettingsSection>
            <div className="flex items-center justify-between gap-3 rounded-xl bg-ds-bg-neutral-default-default px-4 py-3 text-body-sm text-ds-text-neutral-muted-default">
              <div className="flex min-w-0 items-center gap-2">
                <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
                <span>
                  Draft version {draft?.version ?? 0} is stored locally. Secret
                  values and physical paths are excluded.
                </span>
              </div>
              <span className="shrink-0">
                {saveState === 'saving'
                  ? 'Saving…'
                  : saveState === 'saved'
                    ? 'Saved'
                    : saveState === 'needs_attention'
                      ? 'Needs attention'
                      : 'Local draft'}
              </span>
              {saveState === 'needs_attention' ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={retrySave}
                >
                  Retry
                </Button>
              ) : null}
            </div>
          </div>
        </SettingsSectionPage>

        {draft && identity ? (
          <WorkspaceBundleSaveDialog
            open={saveDialogOpen}
            onOpenChange={setSaveDialogOpen}
            spaceId={targetSpaceId}
            identity={identity}
            draft={draft}
            onApplyRequirements={(requirements) =>
              update((next) => {
                const byName = new Map(
                  workspaceEnvironmentVariables(next).map((item) => [
                    item.name,
                    item,
                  ])
                );
                for (const requirement of requirements) {
                  const current = byName.get(requirement.name);
                  const merged = current
                    ? {
                        ...current,
                        ...requirement,
                        sensitive: current.sensitive || requirement.sensitive,
                      }
                    : requirement;
                  if (merged.sensitive) delete merged.example;
                  byName.set(requirement.name, merged);
                }
                next.spec.environment = {
                  variables: Array.from(byName.values()),
                };
              })
            }
            onApplyMcpSecretSlots={(requirements) =>
              update((next) => {
                for (const requirement of requirements) {
                  const server = next.spec.mcpServers.find(
                    (item) => item.id === requirement.mcp_id
                  );
                  if (!server) continue;
                  server.secretSlots = Array.from(
                    new Set([
                      ...server.secretSlots,
                      ...requirement.secret_slots,
                    ])
                  ).sort();
                }
              })
            }
            onPublished={reload}
          />
        ) : null}
      </div>
    </main>
  );
}
