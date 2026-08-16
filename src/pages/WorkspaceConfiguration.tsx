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

import { isDesktop } from '@/client/platform';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { EnvironmentRequirementsEditor } from '@/components/WorkspaceConfiguration/EnvironmentRequirementsEditor';
import { WorkspaceBundleSaveDialog } from '@/components/WorkspaceConfiguration/WorkspaceBundleSaveDialog';
import { useWorkspaceConfiguration } from '@/hooks/useWorkspaceConfiguration';
import {
  fetchWorkspaceBundleInstallForSpace,
  type WorkspaceBundleInstallProposal,
} from '@/service/workspaceBundleInstallApi';
import {
  workspaceEnvironmentVariables,
  type ThinkingEffort,
  type WorkspaceConfigurationDocument,
} from '@/service/workspaceConfigurationApi';
import { useAuthStore } from '@/store/authStore';
import { useSpaceStore } from '@/store/spaceStore';
import {
  Bot,
  Boxes,
  Cloud,
  GitBranch,
  KeyRound,
  Plus,
  Puzzle,
  RefreshCw,
  Settings2,
  Share2,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

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

function SectionCard({
  title,
  description,
  icon,
  onAdd,
  children,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  onAdd?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-ds-border-neutral-subtle-default bg-ds-bg-neutral-default-default">
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 p-5">
        <div className="flex min-w-0 gap-3">
          <div className="mt-0.5 text-ds-icon-neutral-default-default">
            {icon}
          </div>
          <div>
            <CardTitle className="text-body-md">{title}</CardTitle>
            <CardDescription className="mt-1">{description}</CardDescription>
          </div>
        </div>
        {onAdd ? (
          <Button type="button" variant="secondary" size="sm" onClick={onAdd}>
            <Plus className="h-4 w-4" aria-hidden />
            Add
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3 px-5 pb-5 pt-0">{children}</CardContent>
    </Card>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-ds-border-neutral-default-default px-4 py-5 text-center text-body-sm text-ds-text-neutral-muted-default">
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

const selectClassName =
  'h-10 w-full rounded-xl border border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default px-3 text-body-sm text-ds-text-neutral-default-default outline-none focus:ring-1 focus:ring-ds-ring-brand-default-focus';

export default function WorkspaceConfiguration() {
  const navigate = useNavigate();
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [installedBundle, setInstalledBundle] =
    useState<WorkspaceBundleInstallProposal | null>(null);
  const activeSpaceId = useSpaceStore((state) => state.activeSpaceId);
  const activeSpace = useSpaceStore((state) =>
    state.activeSpaceId ? state.spaces[state.activeSpaceId] : null
  );
  const email = useAuthStore((state) => state.email);
  const userId = useAuthStore((state) => state.user_id);
  const identity = useMemo(
    () => (email ? { email, userId } : null),
    [email, userId]
  );
  const { draft, document, setDocument, saveState, error, reload, retrySave } =
    useWorkspaceConfiguration({
      spaceId: activeSpaceId,
      spaceName: activeSpace?.name,
      identity,
    });

  useEffect(() => {
    let active = true;
    setInstalledBundle(null);
    if (!activeSpaceId) return () => undefined;
    void fetchWorkspaceBundleInstallForSpace(activeSpaceId)
      .then((snapshot) => {
        if (active) setInstalledBundle(snapshot.proposal);
      })
      .catch(() => {
        // A 404 means this is a locally authored Workspace. The configuration
        // editor remains fully usable without an installation proposal.
      });
    return () => {
      active = false;
    };
  }, [activeSpaceId]);

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

  if (!activeSpaceId || !activeSpace) {
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

  return (
    <main className="h-full overflow-y-auto bg-ds-bg-neutral-muted-default">
      <div className="mx-auto w-full max-w-5xl space-y-5 px-6 py-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-body-xs font-medium uppercase tracking-wide text-ds-text-neutral-muted-default">
              {activeSpace.name}
            </p>
            <h1 className="text-heading-2xl mt-1 font-semibold text-ds-text-neutral-default-default">
              Workspace Configuration
            </h1>
            <p className="mt-2 max-w-2xl text-body-sm text-ds-text-neutral-muted-default">
              Configure the context, tools, agents, permissions, and versioning
              that every Run in this Space inherits.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 text-body-sm">
            <span
              className={
                saveState === 'needs_attention'
                  ? 'text-ds-text-error-default-default'
                  : 'text-ds-text-neutral-muted-default'
              }
            >
              {saveState === 'saving'
                ? 'Saving…'
                : saveState === 'saved'
                  ? 'All changes saved locally'
                  : saveState === 'needs_attention'
                    ? 'Changes need attention'
                    : 'Local working copy'}
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
            {installedBundle ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  navigate(
                    `/workspace-bundles/install?proposal=${encodeURIComponent(installedBundle.proposal_id)}`
                  )
                }
              >
                <Settings2 className="h-4 w-4" aria-hidden />
                Local setup
              </Button>
            ) : null}
            {isDesktop() ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  navigate(
                    `/agent-plugins/import?target_space_id=${encodeURIComponent(activeSpaceId)}`
                  )
                }
              >
                <Puzzle className="h-4 w-4" aria-hidden />
                Import Agent Plugin
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              onClick={() => setSaveDialogOpen(true)}
              disabled={!draft?.persisted || saveState !== 'saved'}
            >
              <Share2 className="h-4 w-4" aria-hidden />
              Save & share
            </Button>
          </div>
        </header>

        {error ? (
          <div className="rounded-xl border border-ds-border-error-default-default bg-ds-bg-error-subtle-default px-4 py-3 text-body-sm text-ds-text-error-strong-default">
            {error}{' '}
            <button
              className="underline"
              type="button"
              onClick={() => void reload()}
            >
              Reload durable copy
            </button>
          </div>
        ) : null}

        <SectionCard
          title="Identity and model"
          description="The name shown to collaborators and the default reasoning profile."
          icon={<Boxes className="h-5 w-5" aria-hidden />}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Input
              title="Workspace bundle name"
              value={document.metadata.name}
              onChange={(event) =>
                update((next) => {
                  next.metadata.name = event.target.value;
                })
              }
            />
            <Input
              title="Default model reference"
              value={document.spec.models.default.modelRef}
              onChange={(event) =>
                update((next) => {
                  next.spec.models.default.modelRef = event.target.value;
                })
              }
            />
            <label className="space-y-1.5 text-body-sm font-bold">
              <span>Thinking effort</span>
              <select
                className={selectClassName}
                value={document.spec.models.default.thinkingEffort}
                onChange={(event) =>
                  update((next) => {
                    next.spec.models.default.thinkingEffort = event.target
                      .value as ThinkingEffort;
                  })
                }
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="xhigh">Extra high</option>
                <option value="max">Max</option>
              </select>
            </label>
            <label className="space-y-1.5 text-body-sm font-bold">
              <span>Permission profile</span>
              <select
                className={selectClassName}
                value={document.spec.permissions.profile}
                onChange={(event) =>
                  update((next) => {
                    next.spec.permissions.profile = event.target.value as
                      | 'request_approval'
                      | 'auto_review'
                      | 'workspace_write'
                      | 'full_access';
                  })
                }
              >
                <option value="request_approval">Request approval</option>
                <option value="auto_review">Auto-review safe actions</option>
                <option value="workspace_write">Workspace write</option>
                <option value="full_access">Full access</option>
              </select>
            </label>
          </div>
        </SectionCard>

        <SectionCard
          title="Environment requirements"
          description="Define portable variable names that recipients must configure locally. Values never become Bundle content."
          icon={<KeyRound className="h-5 w-5" aria-hidden />}
        >
          <EnvironmentRequirementsEditor
            variables={workspaceEnvironmentVariables(document)}
            onChange={(variables) =>
              update((next) => {
                next.spec.environment = { variables };
              })
            }
          />
        </SectionCard>

        <SectionCard
          title="Instructions"
          description="Assign versioned instruction assets to workforce roles."
          icon={<Bot className="h-5 w-5" aria-hidden />}
          onAdd={() =>
            update((next) => {
              const role = nextId('role', Object.keys(next.spec.instructions));
              next.spec.instructions[role] = `bundle://instructions/${role}.md`;
            })
          }
        >
          {instructions.length === 0 ? (
            <EmptyRow>
              Add an instruction asset for a coordinator or worker role.
            </EmptyRow>
          ) : (
            instructions.map(([role, ref]) => (
              <div
                key={role}
                className="grid items-end gap-2 md:grid-cols-[1fr_2fr_auto]"
              >
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
            ))
          )}
        </SectionCard>

        <SectionCard
          title="Context"
          description="Declare shareable context or named local path slots; physical local paths are never stored here."
          icon={<Cloud className="h-5 w-5" aria-hidden />}
          onAdd={() =>
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
        >
          {document.spec.context.length === 0 ? (
            <EmptyRow>No workspace context is configured yet.</EmptyRow>
          ) : (
            document.spec.context.map((item, index) => (
              <div
                key={`${item.id}-${index}`}
                className="rounded-xl bg-ds-bg-neutral-subtle-default p-3"
              >
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
                  <label className="space-y-1.5 text-body-sm font-bold">
                    <span>Kind</span>
                    <select
                      className={selectClassName}
                      value={item.kind}
                      onChange={(event) =>
                        update((next) => {
                          next.spec.context[index] = {
                            id: next.spec.context[index].id,
                            kind: event.target.value as typeof item.kind,
                            ...(event.target.value === 'inline'
                              ? { content: '' }
                              : event.target.value === 'local_path_slot'
                                ? { slot: 'workspace_folder' }
                                : event.target.value === 'bundle_asset'
                                  ? { path: 'bundle://context/context.md' }
                                  : event.target.value === 'artifact_ref'
                                    ? { path: 'artifact://project/latest' }
                                    : event.target.value === 'memory_scope'
                                      ? { path: 'memory://project/current' }
                                      : {}),
                            sharing: 'reference_only',
                          };
                        })
                      }
                    >
                      <option value="inline">Inline</option>
                      <option value="local_path_slot">Local path slot</option>
                      <option value="bundle_asset">Bundle asset</option>
                      <option value="artifact_ref">Artifact reference</option>
                      <option value="memory_scope">Memory scope</option>
                    </select>
                  </label>
                  <RemoveButton
                    label={`Remove context ${item.id}`}
                    onClick={() =>
                      update((next) => {
                        next.spec.context.splice(index, 1);
                      })
                    }
                  />
                </div>
                <div className="mt-3">
                  {item.kind === 'inline' ? (
                    <Textarea
                      title="Content"
                      value={item.content || ''}
                      onChange={(event) =>
                        update((next) => {
                          next.spec.context[index].content = event.target.value;
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
                            next.spec.context[index].kind === 'local_path_slot'
                          ) {
                            next.spec.context[index].slot = event.target.value;
                          } else {
                            next.spec.context[index].path = event.target.value;
                          }
                        })
                      }
                    />
                  )}
                </div>
              </div>
            ))
          )}
        </SectionCard>

        <SectionCard
          title="Agents and skills"
          description="Define workforce roles, then assign portable skill packages to them."
          icon={<Bot className="h-5 w-5" aria-hidden />}
          onAdd={() =>
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
        >
          {document.spec.agents.map((item, index) => (
            <div
              key={`${item.id}-${index}`}
              className="grid items-end gap-2 md:grid-cols-[1fr_1fr_1fr_auto]"
            >
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
                    next.spec.agents[index].modelProfile = event.target.value;
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
          ))}
          <div className="border-t border-ds-border-neutral-subtle-default pt-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-body-sm font-bold">Skill assignments</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  update((next) => {
                    const id = next.spec.skills.length + 1;
                    next.spec.skills.push({
                      ref: `bundle://skills/skill_${id}`,
                      assignTo: [],
                    });
                  })
                }
              >
                <Plus className="h-4 w-4" aria-hidden /> Add skill
              </Button>
            </div>
            {document.spec.skills.length === 0 ? (
              <EmptyRow>No skills assigned.</EmptyRow>
            ) : (
              document.spec.skills.map((item, index) => (
                <div
                  key={`${item.ref}-${index}`}
                  className="grid items-end gap-2 md:grid-cols-[2fr_1fr_auto]"
                >
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
                    title="Assign to (comma-separated)"
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
              ))
            )}
          </div>
        </SectionCard>

        <SectionCard
          title="Connectors and MCP"
          description="Declare capabilities and named connection or secret slots. Values remain local and are never saved in the Bundle."
          icon={<Cloud className="h-5 w-5" aria-hidden />}
          onAdd={() =>
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
        >
          {document.spec.connectors.map((item, index) => (
            <div
              key={`${item.id}-${index}`}
              className="grid items-end gap-2 md:grid-cols-[1fr_1fr_1fr_1fr_auto]"
            >
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
                    next.spec.connectors[index].connector = event.target.value;
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
          ))}
          {document.spec.connectors.length === 0 ? (
            <EmptyRow>No connector requirements.</EmptyRow>
          ) : null}
          <div className="border-t border-ds-border-neutral-subtle-default pt-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-body-sm font-bold">MCP servers</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
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
              >
                <Plus className="h-4 w-4" aria-hidden /> Add MCP
              </Button>
            </div>
            {document.spec.mcpServers.length === 0 ? (
              <EmptyRow>No MCP servers.</EmptyRow>
            ) : (
              document.spec.mcpServers.map((item, index) => (
                <div
                  key={`${item.id}-${index}`}
                  className="grid items-end gap-2 md:grid-cols-[1fr_2fr_1fr_1fr_auto]"
                >
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
              ))
            )}
          </div>
        </SectionCard>

        <SectionCard
          title="Git workspace environment"
          description="Use local Git checkpoints and isolated worktrees without requiring a GitHub remote."
          icon={<GitBranch className="h-5 w-5" aria-hidden />}
        >
          <div className="flex items-center justify-between rounded-xl bg-ds-bg-neutral-subtle-default p-3">
            <div>
              <p className="text-body-sm font-bold">
                Version this workspace locally
              </p>
              <p className="text-body-xs text-ds-text-neutral-muted-default">
                Agent branches and save points stay local unless a remote action
                is approved.
              </p>
            </div>
            <Switch
              checked={document.spec.git.enabled}
              onCheckedChange={(checked) =>
                update((next) => {
                  next.spec.git.enabled = checked;
                })
              }
            />
          </div>
          <label className="block space-y-1.5 text-body-sm font-bold">
            <span>Remote policy</span>
            <select
              className={selectClassName}
              value={document.spec.git.remotePolicy}
              onChange={(event) =>
                update((next) => {
                  next.spec.git.remotePolicy = event.target.value as
                    'deny' | 'prompt' | 'allow';
                })
              }
            >
              <option value="deny">Deny</option>
              <option value="prompt">Ask before remote operations</option>
              <option value="allow">
                Allow according to permission policy
              </option>
            </select>
          </label>
        </SectionCard>

        <div className="flex items-center gap-2 rounded-xl border border-ds-border-neutral-subtle-default px-4 py-3 text-body-sm text-ds-text-neutral-muted-default">
          <ShieldCheck className="h-4 w-4" aria-hidden />
          Draft version {draft?.version ?? 0} is stored in the local durable
          journal. Secret values and physical local paths are not part of this
          document.
        </div>

        {draft && identity ? (
          <WorkspaceBundleSaveDialog
            open={saveDialogOpen}
            onOpenChange={setSaveDialogOpen}
            spaceId={activeSpaceId}
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
