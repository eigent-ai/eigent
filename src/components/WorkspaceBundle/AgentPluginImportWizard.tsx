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

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useHost } from '@/host';
import { ensureScratchSpaceWorkspaceBinding } from '@/lib/scratchSpaceWorkspace';
import {
  convertAgentPluginToWorkspaceBundleDraft,
  inspectAgentPluginSource,
  type AgentPluginConversionResult,
  type AgentPluginInspection,
  type AgentPluginSelectedSource,
} from '@/service/agentPluginImportApi';
import { fetchWorkspaceConfiguration } from '@/service/workspaceConfigurationApi';
import { useAuthStore } from '@/store/authStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import {
  isUnconfiguredPlaceholderSpace,
  useSpaceStore,
} from '@/store/spaceStore';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileKey2,
  FolderOpen,
  Loader2,
  PackageSearch,
  Puzzle,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

type ConversionContext = {
  clientRequestId: string;
  targetSpaceId: string;
  expectedTargetDraftVersion: number;
};

type ReplacementReview = {
  targetSpaceId: string;
  targetName: string;
  version: number;
};

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

const redactSelectedPath = (
  message: string,
  selectedLabel: string,
  selectedPath?: string
): string =>
  selectedPath ? message.split(selectedPath).join(selectedLabel) : message;

const isDefinitiveDraftConflict = (error: unknown): boolean => {
  const candidate = error as {
    status?: number;
    response?: { data?: { detail?: { code?: unknown } } };
  };
  const code = candidate.response?.data?.detail?.code;
  return (
    candidate.status === 409 &&
    (code === undefined || code === 'workspace_configuration_changed')
  );
};

const formatBytes = (value: number): string => {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

const authorLabel = (
  author: AgentPluginInspection['metadata']['author']
): string | null => author?.name || author?.email || author?.url || null;

const visibleReviewValue = (value: string): string =>
  value.replace(
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
  );

const requestId = (): string =>
  `agentplugin_${typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Date.now().toString(36)}`;

export function AgentPluginImportWizard({
  initialTargetSpaceId,
  showHeader = true,
  onConfigurationOpen,
  targetMode = 'existing',
}: {
  initialTargetSpaceId?: string | null;
  showHeader?: boolean;
  onConfigurationOpen?: () => void;
  targetMode?: 'existing' | 'create-space';
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setActiveWorkspaceTab = usePageTabStore(
    (state) => state.setActiveWorkspaceTab
  );
  const host = useHost();
  const email = useAuthStore((state) => state.email);
  const userId = useAuthStore((state) => state.user_id);
  const spaces = useSpaceStore((state) => state.spaces);
  const projectsBySpaceId = useSpaceStore((state) => state.projectsBySpaceId);
  const activeSpaceId = useSpaceStore((state) => state.activeSpaceId);
  const setActiveSpace = useSpaceStore((state) => state.setActiveSpace);
  const createSpaceOnServer = useSpaceStore(
    (state) => state.createSpaceOnServer
  );
  const deleteSpaceOnServer = useSpaceStore(
    (state) => state.deleteSpaceOnServer
  );
  const setActiveProject = useProjectRuntimeStore(
    (state) => state.setActiveProject
  );
  const selectableSpaces = useMemo(
    () =>
      Object.values(spaces)
        .filter(
          (space) =>
            space.status === 'active' &&
            !isUnconfiguredPlaceholderSpace(space, projectsBySpaceId)
        )
        .sort((left, right) => left.name.localeCompare(right.name)),
    [projectsBySpaceId, spaces]
  );
  const selectableSpaceIds = useMemo(
    () => new Set(selectableSpaces.map((space) => space.id)),
    [selectableSpaces]
  );
  const defaultTarget =
    targetMode === 'create-space'
      ? ''
      : initialTargetSpaceId
        ? selectableSpaceIds.has(initialTargetSpaceId)
          ? initialTargetSpaceId
          : ''
        : activeSpaceId && selectableSpaceIds.has(activeSpaceId)
          ? activeSpaceId
          : selectableSpaces.at(0)?.id || '';
  const [targetSpaceId, setTargetSpaceId] = useState(defaultTarget);
  const [newSpaceName, setNewSpaceName] = useState('');
  const [selectedSource, setSelectedSource] =
    useState<AgentPluginSelectedSource | null>(null);
  const [inspection, setInspection] = useState<AgentPluginInspection | null>(
    null
  );
  const [conversion, setConversion] =
    useState<AgentPluginConversionResult | null>(null);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [replacementConfirmed, setReplacementConfirmed] = useState(false);
  const [replacementReview, setReplacementReview] =
    useState<ReplacementReview | null>(null);
  const [busy, setBusy] = useState<'inspect' | 'convert' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const conversionContext = useRef<ConversionContext | null>(null);
  const pickerInFlight = useRef(false);
  const conversionInFlight = useRef(false);
  const selectionGeneration = useRef(0);

  const selectAndInspect = async () => {
    setError(null);
    if (!email) {
      setError(
        t('layout.agent-plugin-import-sign-in-required', {
          defaultValue: 'Sign in before importing an Agent Plugin.',
        })
      );
      return;
    }
    let selectedPath: string | undefined;
    const picker = host?.electronAPI?.selectAgentPluginSource;
    if (!picker) {
      setError(
        t('layout.agent-plugin-import-desktop-required', {
          defaultValue: 'Agent Plugins import requires Eigent Desktop.',
        })
      );
      return;
    }
    if (busy !== null || pickerInFlight.current) return;
    pickerInFlight.current = true;
    setBusy('inspect');
    try {
      const selected = await picker();
      if (selected?.canceled) return;
      if (!selected?.source_path) {
        throw new Error(
          t('layout.agent-plugin-import-no-source-selected', {
            defaultValue: 'No Agent Plugin directory or archive was selected.',
          })
        );
      }
      selectedPath = selected.source_path;
      const source: AgentPluginSelectedSource = {
        source_path: selected.source_path,
        display_name:
          selected.display_name ||
          t('layout.agent-plugin-import-selected-source', {
            defaultValue: 'Selected Agent Plugin',
          }),
        source_kind: selected.source_kind || 'directory',
      };
      setSelectedSource(source);
      setInspection(null);
      setConversion(null);
      setReviewConfirmed(false);
      setReplacementConfirmed(false);
      setReplacementReview(null);
      conversionContext.current = null;
      selectionGeneration.current += 1;
      const next = await inspectAgentPluginSource({
        sourcePath: source.source_path,
        email,
        userId,
      });
      setInspection(next);
      if (targetMode === 'create-space') {
        setNewSpaceName(
          next.metadata.name?.trim() ||
            t('layout.agent-plugin-import-default-space-name', {
              defaultValue: 'Imported Agent Plugin',
            })
        );
      }
    } catch (nextError) {
      setError(
        redactSelectedPath(
          errorMessage(
            nextError,
            t('layout.agent-plugin-import-read-failed', {
              defaultValue: 'The Agent Plugin could not be read.',
            })
          ),
          t('layout.agent-plugin-import-selected-source-lowercase', {
            defaultValue: 'the selected Agent Plugin',
          }),
          selectedPath
        )
      );
    } finally {
      pickerInFlight.current = false;
      setBusy(null);
    }
  };

  const convert = async () => {
    if (
      !selectedSource ||
      !inspection ||
      !reviewConfirmed ||
      (targetMode === 'existing' && !targetSpaceId) ||
      (targetMode === 'create-space' && !newSpaceName.trim()) ||
      !email ||
      conversionInFlight.current
    ) {
      return;
    }
    conversionInFlight.current = true;
    setBusy('convert');
    setError(null);
    const generation = selectionGeneration.current;
    let requestedTargetSpaceId = targetSpaceId;
    try {
      if (!requestedTargetSpaceId && targetMode === 'create-space') {
        requestedTargetSpaceId = await createSpaceOnServer({
          name: newSpaceName.trim(),
          sourceType: 'blank',
          setActive: false,
          metadata: {
            createdFrom: 'agent_plugin_import',
            autoCreatedPlaceholder: false,
          },
        });
        let root: string | null = null;
        try {
          root = await ensureScratchSpaceWorkspaceBinding({
            email,
            userId,
            space: useSpaceStore
              .getState()
              .getSpaceById(requestedTargetSpaceId),
          });
        } catch (bindingError) {
          await deleteSpaceOnServer(requestedTargetSpaceId).catch(
            () => undefined
          );
          requestedTargetSpaceId = '';
          throw bindingError;
        }
        if (!root) {
          await deleteSpaceOnServer(requestedTargetSpaceId).catch(
            () => undefined
          );
          requestedTargetSpaceId = '';
          throw new Error(
            t('layout.agent-plugin-import-workspace-folder-failed', {
              defaultValue:
                'Eigent could not create the local Workspace folder.',
            })
          );
        }
        setTargetSpaceId(requestedTargetSpaceId);
      }
      let context = conversionContext.current;
      if (!context || context.targetSpaceId !== requestedTargetSpaceId) {
        const targetDraft = await fetchWorkspaceConfiguration(
          requestedTargetSpaceId,
          {
            email,
            userId,
          }
        );
        if (selectionGeneration.current !== generation) return;
        context = {
          clientRequestId: requestId(),
          targetSpaceId: requestedTargetSpaceId,
          expectedTargetDraftVersion: targetDraft.version,
        };
        conversionContext.current = context;
        if (targetDraft.persisted || targetDraft.base_revision_id !== null) {
          setReplacementReview({
            targetSpaceId: requestedTargetSpaceId,
            targetName:
              targetDraft.document?.metadata?.name ||
              selectableSpaces.find(
                (space) => space.id === requestedTargetSpaceId
              )?.name ||
              t('layout.agent-plugin-import-selected-workspace', {
                defaultValue: 'the selected Workspace',
              }),
            version: targetDraft.version,
          });
          if (!replacementConfirmed) return;
        }
      }
      if (
        replacementReview?.targetSpaceId === requestedTargetSpaceId &&
        !replacementConfirmed
      ) {
        return;
      }
      const next = await convertAgentPluginToWorkspaceBundleDraft({
        sourcePath: selectedSource.source_path,
        expectedReviewDigest: inspection.review_digest,
        targetSpaceId: requestedTargetSpaceId,
        expectedTargetDraftVersion: context.expectedTargetDraftVersion,
        clientRequestId: context.clientRequestId,
        updatedBy: String(userId || email),
        email,
        userId,
      });
      if (selectionGeneration.current !== generation) return;
      setConversion(next);
    } catch (nextError) {
      if (selectionGeneration.current !== generation) return;
      if (isDefinitiveDraftConflict(nextError)) {
        conversionContext.current = null;
        setReplacementReview(null);
        setReplacementConfirmed(false);
      }
      setError(
        redactSelectedPath(
          errorMessage(
            nextError,
            t('layout.agent-plugin-import-read-failed', {
              defaultValue: 'The Agent Plugin could not be read.',
            })
          ),
          t('layout.agent-plugin-import-selected-source-lowercase', {
            defaultValue: 'the selected Agent Plugin',
          }),
          selectedSource.source_path
        )
      );
    } finally {
      conversionInFlight.current = false;
      setBusy(null);
    }
  };

  const openConfiguration = () => {
    if (!conversion) return;
    setActiveSpace(conversion.target_space_id);
    setActiveProject(null);
    setActiveWorkspaceTab('workforce');
    onConfigurationOpen?.();
    navigate('/');
  };

  if (conversion) {
    return (
      <Card className="mx-auto w-full max-w-2xl">
        <CardHeader>
          <CheckCircle2
            className="mb-3 h-10 w-10 text-ds-text-success-default-default"
            aria-hidden
          />
          <CardTitle>
            {t('layout.agent-plugin-import-converted-title', {
              defaultValue: 'Agent Plugin converted',
            })}
          </CardTitle>
          <CardDescription>
            {t('layout.agent-plugin-import-converted-description', {
              slug: conversion.slug,
              version: conversion.version,
              defaultValue:
                '{{slug}} version {{version}} is a local Workspace Bundle draft. It has not been published or installed elsewhere.',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={openConfiguration}>
            {t('layout.agent-plugin-import-review-draft', {
              defaultValue: 'Review Workspace draft',
            })}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      {showHeader ? (
        <>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-ds-text-base text-ds-ink-muted-default hover:text-ds-ink-default-default"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />{' '}
            {t('layout.back', { defaultValue: 'Back' })}
          </button>

          <header>
            <h1 className="!text-ds-text-display font-semibold">
              {t('layout.agent-plugin-import-title', {
                defaultValue: 'Import Agent Plugin',
              })}
            </h1>
            <p className="mt-2 max-w-2xl !text-ds-text-base text-ds-ink-muted-default">
              {t('layout.agent-plugin-import-description', {
                defaultValue:
                  'Import the Agent Plugins standard. Eigent reviews the package before converting it to a local Workspace Bundle draft.',
              })}
            </p>
          </header>
        </>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-x border-y border-ds-border-error-default-default bg-ds-bg-error-subtle-default p-4 text-ds-text-base text-ds-text-error-strong-default">
          {error}
        </div>
      ) : null}

      <Card
        className={
          showHeader ? undefined : 'space-y-3 !border-0 !border-x-0 !border-y-0'
        }
      >
        <CardHeader className={showHeader ? undefined : '!p-0'}>
          <CardTitle>
            {t('layout.agent-plugin-import-select-title', {
              defaultValue: 'Select an Agent Plugin',
            })}
          </CardTitle>
          <CardDescription>
            {t('layout.agent-plugin-import-select-description', {
              defaultValue:
                'Choose a local plugin directory or archive. The selected path is inspected locally and is never included in the converted Bundle.',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent
          className={
            showHeader
              ? 'flex flex-wrap items-center gap-3'
              : 'flex flex-wrap items-center gap-3 !p-0'
          }
        >
          <Button
            type="button"
            variant="secondary"
            onClick={() => void selectAndInspect()}
            disabled={busy !== null}
          >
            {busy === 'inspect' ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <FolderOpen className="h-4 w-4" aria-hidden />
            )}
            {t('layout.agent-plugin-import-select-action', {
              defaultValue: 'Select directory or archive',
            })}
          </Button>
          {selectedSource ? (
            <span className="text-ds-text-base text-ds-ink-muted-default">
              {selectedSource.display_name} · {selectedSource.source_kind}
            </span>
          ) : null}
        </CardContent>
      </Card>

      {inspection ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{inspection.metadata.name}</CardTitle>
              <CardDescription>
                {t('layout.agent-plugin-import-standard', {
                  defaultValue: 'Agent Plugins standard',
                })}
                {` · schema ${inspection.schema_version}`}
                {inspection.metadata.version
                  ? ` · ${inspection.metadata.version}`
                  : ''}
                {authorLabel(inspection.metadata.author)
                  ? ` · ${authorLabel(inspection.metadata.author)}`
                  : ''}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {inspection.metadata.description ? (
                <p className="text-ds-text-base">
                  {inspection.metadata.description}
                </p>
              ) : null}
              <div className="rounded-xl border p-3 text-ds-text-meta">
                <strong>
                  {t('layout.agent-plugin-import-source-tree-digest', {
                    defaultValue: 'Source tree digest',
                  })}
                </strong>
                <code className="mt-1 block break-all text-ds-ink-muted-default">
                  {inspection.source_tree_digest}
                </code>
                <strong className="mt-3 block">
                  {t('layout.agent-plugin-import-converted-tree-digest', {
                    defaultValue: 'Converted tree digest',
                  })}
                </strong>
                <code className="mt-1 block break-all text-ds-ink-muted-default">
                  {inspection.converted_tree_digest}
                </code>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-ds-neutral-subtle-default p-3">
                  <Puzzle className="h-4 w-4" aria-hidden />
                  <strong className="mt-2 block text-ds-text-base">
                    {t('agents.skills', { defaultValue: 'Skills' })}
                  </strong>
                  <span className="text-ds-text-base">
                    {inspection.skills.length}
                  </span>
                </div>
                <div className="rounded-xl bg-ds-neutral-subtle-default p-3">
                  <Server className="h-4 w-4" aria-hidden />
                  <strong className="mt-2 block text-ds-text-base">
                    {t('setting.mcp-servers-title', {
                      defaultValue: 'MCP servers',
                    })}
                  </strong>
                  <span className="text-ds-text-base">
                    {inspection.mcp_servers.length}
                  </span>
                </div>
                <div className="rounded-xl bg-ds-neutral-subtle-default p-3">
                  <PackageSearch className="h-4 w-4" aria-hidden />
                  <strong className="mt-2 block text-ds-text-base">
                    {t('chat.files', { defaultValue: 'Files' })}
                  </strong>
                  <span className="text-ds-text-base">
                    {inspection.files.length}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>
                  {t('agents.skills', { defaultValue: 'Skills' })}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {inspection.skills.length ? (
                  inspection.skills.map((skill) => (
                    <div key={skill.id} className="rounded-xl border p-3">
                      <strong className="text-ds-text-base">
                        {skill.name}
                      </strong>
                      {skill.description ? (
                        <p className="mt-1 text-ds-text-meta text-ds-ink-muted-default">
                          {skill.description}
                        </p>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="text-ds-text-base text-ds-ink-muted-default">
                    {t('layout.agent-plugin-import-no-skills', {
                      defaultValue: 'No Skills declared.',
                    })}
                  </p>
                )}
                {inspection.skipped_skills.map((skill) => (
                  <div
                    key={`${skill.id || skill.name || skill.logical_path}:${skill.reason_code}`}
                    className="rounded-xl border border-x border-y border-ds-border-warning-default-default p-3"
                  >
                    <strong className="text-ds-text-base">
                      {t('layout.agent-plugin-import-skipped-item', {
                        name: skill.name || skill.id || skill.logical_path,
                        defaultValue: 'Skipped: {{name}}',
                      })}
                    </strong>
                    <p className="mt-1 text-ds-text-meta">
                      {skill.reason_code}: {skill.reason}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  {t('setting.mcp-servers-title', {
                    defaultValue: 'MCP servers',
                  })}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {inspection.mcp_servers.length ? (
                  inspection.mcp_servers.map((server) => (
                    <div key={server.id} className="rounded-xl border p-3">
                      <strong className="text-ds-text-base">
                        {server.name || server.id}
                      </strong>
                      <p className="mt-1 text-ds-text-meta text-ds-ink-muted-default">
                        {server.transport ||
                          t('layout.agent-plugin-import-transport-undeclared', {
                            defaultValue: 'Transport not declared',
                          })}
                      </p>
                      {server.command ? (
                        <div className="mt-2 space-y-1 text-ds-text-meta">
                          <code className="block break-all">
                            command: {visibleReviewValue(server.command)}
                          </code>
                          {(server.args || []).map((argument, index) => (
                            <code
                              key={`${index}:${argument}`}
                              className="block pl-3 break-all"
                            >
                              argv[{index}]: {visibleReviewValue(argument)}
                            </code>
                          ))}
                        </div>
                      ) : server.command_summary ? (
                        <code className="mt-2 block text-ds-text-meta break-all">
                          {visibleReviewValue(server.command_summary)}
                        </code>
                      ) : null}
                      {server.cwd ? (
                        <p className="mt-2 text-ds-text-meta break-all">
                          cwd: {server.cwd}
                        </p>
                      ) : null}
                      {server.url ? (
                        <p className="mt-2 text-ds-text-meta break-all">
                          URL: {server.url}
                        </p>
                      ) : null}
                      {server.env_names.length ? (
                        <p className="mt-2 text-ds-text-meta">
                          {t('layout.agent-plugin-import-environment-names', {
                            names: server.env_names.join(', '),
                            defaultValue: 'Environment names: {{names}}',
                          })}
                        </p>
                      ) : null}
                      {server.header_names.length ? (
                        <p className="mt-1 text-ds-text-meta">
                          {t('layout.agent-plugin-import-header-names', {
                            names: server.header_names.join(', '),
                            defaultValue: 'Header names: {{names}}',
                          })}
                        </p>
                      ) : null}
                      {(server.public_environment || []).map((item) => (
                        <div
                          key={`env:${item.name}`}
                          className="mt-2 rounded-lg bg-ds-neutral-subtle-default p-2 text-ds-text-meta"
                        >
                          <code className="break-all">
                            env {item.name} = {visibleReviewValue(item.value)}
                            {item.truncated ? '…' : ''}
                          </code>
                          {item.truncated ? (
                            <code className="mt-1 block break-all text-ds-ink-muted-default">
                              sha256: {item.value_digest}
                            </code>
                          ) : null}
                        </div>
                      ))}
                      {(server.public_headers || []).map((item) => (
                        <div
                          key={`header:${item.name}`}
                          className="mt-2 rounded-lg bg-ds-neutral-subtle-default p-2 text-ds-text-meta"
                        >
                          <code className="break-all">
                            header {item.name} ={' '}
                            {visibleReviewValue(item.value)}
                            {item.truncated ? '…' : ''}
                          </code>
                          {item.truncated ? (
                            <code className="mt-1 block break-all text-ds-ink-muted-default">
                              sha256: {item.value_digest}
                            </code>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ))
                ) : (
                  <p className="text-ds-text-base text-ds-ink-muted-default">
                    {t('layout.agent-plugin-import-no-mcp-servers', {
                      defaultValue: 'No MCP servers declared.',
                    })}
                  </p>
                )}
                {inspection.skipped_mcp_servers.map((server) => (
                  <div
                    key={`${server.id || server.name || server.logical_path}:${server.reason_code}`}
                    className="rounded-xl border border-x border-y border-ds-border-warning-default-default p-3"
                  >
                    <strong className="text-ds-text-base">
                      {t('layout.agent-plugin-import-skipped-item', {
                        name: server.name || server.id || server.logical_path,
                        defaultValue: 'Skipped: {{name}}',
                      })}
                    </strong>
                    <p className="mt-1 text-ds-text-meta">
                      {server.reason_code}: {server.reason}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>
                {t('layout.agent-plugin-import-credential-requirements', {
                  defaultValue: 'Credential requirements',
                })}
              </CardTitle>
              <CardDescription>
                {t('layout.agent-plugin-import-credential-description', {
                  defaultValue:
                    'Only requirement names are shown. Values explicitly mapped to these secret requirements are removed during conversion.',
                })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {inspection.credential_requirements.length ? (
                inspection.credential_requirements.map((requirement) => (
                  <div
                    key={requirement.requirement_key}
                    className="flex items-start gap-3 rounded-xl border p-3"
                  >
                    <FileKey2 className="mt-0.5 h-4 w-4" aria-hidden />
                    <div>
                      <strong className="text-ds-text-base">
                        {requirement.label || requirement.requirement_key}
                      </strong>
                      <p className="text-ds-text-meta text-ds-ink-muted-default">
                        {requirement.requirement_kind}
                        {requirement.required
                          ? t('layout.agent-plugin-import-required-suffix', {
                              defaultValue: ' · required',
                            })
                          : t('layout.agent-plugin-import-optional-suffix', {
                              defaultValue: ' · optional',
                            })}
                      </p>
                      {requirement.description ? (
                        <p className="mt-1 text-ds-text-meta">
                          {requirement.description}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-ds-text-base text-ds-ink-muted-default">
                  {t('layout.agent-plugin-import-no-credentials', {
                    defaultValue: 'No credential requirements declared.',
                  })}
                </p>
              )}
            </CardContent>
          </Card>

          {inspection.warnings.length ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  {t('layout.agent-plugin-import-warnings', {
                    defaultValue: 'Warnings',
                  })}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {inspection.warnings.map((warning) => (
                  <div
                    key={`${warning.code}:${warning.message}`}
                    className="flex gap-3 rounded-xl border border-x border-y border-ds-border-warning-default-default bg-ds-bg-warning-subtle-default p-3 text-ds-text-base"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <strong>{warning.severity}</strong>
                      <p>{warning.message}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {inspection.diagnostics.length ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  {t('layout.agent-plugin-import-diagnostics-title', {
                    defaultValue: 'Review diagnostics',
                  })}
                </CardTitle>
                <CardDescription>
                  {t('layout.agent-plugin-import-diagnostics-description', {
                    defaultValue:
                      'Parser and conversion diagnostics found during local review.',
                  })}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {inspection.diagnostics.map((diagnostic) => (
                  <div
                    key={`${diagnostic.code}:${diagnostic.logical_path || ''}:${diagnostic.message}`}
                    className="rounded-xl border p-3 text-ds-text-base"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <strong>{diagnostic.code}</strong>
                      <span className="text-ds-text-meta text-ds-ink-muted-default uppercase">
                        {diagnostic.severity}
                      </span>
                    </div>
                    <p className="mt-1">{diagnostic.message}</p>
                    {diagnostic.logical_path ? (
                      <code className="mt-2 block text-ds-text-meta break-all text-ds-ink-muted-default">
                        {diagnostic.logical_path}
                      </code>
                    ) : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>
                {t('layout.agent-plugin-import-file-inventory', {
                  defaultValue: 'File and digest inventory',
                })}
              </CardTitle>
              <CardDescription>
                {t('layout.agent-plugin-import-file-count', {
                  count: inspection.files.length,
                  defaultValue_one: '{{count}} file · review digest',
                  defaultValue_other: '{{count}} files · review digest',
                })}{' '}
                <code>{inspection.review_digest}</code>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {inspection.files.map((file) => (
                  <div
                    key={file.logical_path}
                    className="grid gap-1 rounded-xl border p-3 text-ds-text-meta sm:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <span className="font-medium break-all">
                      {file.logical_path}
                    </span>
                    <span>{formatBytes(file.size_bytes)}</span>
                    <code className="break-all text-ds-ink-muted-default sm:col-span-2">
                      {file.content_digest}
                    </code>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                {t('layout.agent-plugin-import-convert-title', {
                  defaultValue: 'Convert to Workspace draft',
                })}
              </CardTitle>
              <CardDescription>
                {t('layout.agent-plugin-import-convert-description', {
                  defaultValue:
                    'Conversion is local and does not publish or install the Bundle.',
                })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {targetMode === 'create-space' ? (
                <label className="block space-y-1.5 text-ds-text-meta font-medium">
                  <span>
                    {t('layout.agent-plugin-import-new-space-name', {
                      defaultValue: 'New Space name',
                    })}
                  </span>
                  <Input
                    value={newSpaceName}
                    disabled={busy !== null || Boolean(targetSpaceId)}
                    onChange={(event) => setNewSpaceName(event.target.value)}
                    aria-label={t('layout.agent-plugin-import-new-space-name', {
                      defaultValue: 'New Space name',
                    })}
                  />
                </label>
              ) : (
                <label className="block space-y-1.5 text-ds-text-meta font-medium">
                  <span>
                    {t('layout.agent-plugin-import-target-workspace', {
                      defaultValue: 'Target Workspace',
                    })}
                  </span>
                  <select
                    className="h-10 w-full rounded-xl border bg-ds-neutral-default-default px-3"
                    value={targetSpaceId}
                    disabled={busy !== null}
                    onChange={(event) => {
                      selectionGeneration.current += 1;
                      setTargetSpaceId(event.target.value);
                      conversionContext.current = null;
                      setReplacementReview(null);
                      setReplacementConfirmed(false);
                    }}
                  >
                    <option value="">
                      {t('layout.agent-plugin-import-select-workspace', {
                        defaultValue: 'Select a Workspace',
                      })}
                    </option>
                    {selectableSpaces.map((space) => (
                      <option key={space.id} value={space.id}>
                        {space.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {targetMode === 'existing' && selectableSpaces.length === 0 ? (
                <p className="text-ds-text-base text-ds-text-warning-default-default">
                  {t('layout.agent-plugin-import-create-workspace-first', {
                    defaultValue:
                      'Create a Workspace before converting this Agent Plugin.',
                  })}
                </p>
              ) : null}
              <label className="flex items-start gap-3 text-ds-text-base">
                <Checkbox
                  checked={reviewConfirmed}
                  onCheckedChange={(checked) =>
                    setReviewConfirmed(checked === true)
                  }
                  aria-label={t('layout.agent-plugin-import-confirm-review', {
                    defaultValue: 'Confirm Agent Plugin review',
                  })}
                />
                <span>
                  {t('layout.agent-plugin-import-review-confirmation', {
                    defaultValue:
                      'I reviewed the Skills, MCP servers, files, credential requirements, and warnings shown above.',
                  })}
                </span>
              </label>
              {replacementReview ? (
                <div className="space-y-3 rounded-xl border border-x border-y border-ds-border-warning-default-default bg-ds-bg-warning-subtle-default p-4 text-ds-text-base">
                  <div>
                    <strong>
                      {t('layout.agent-plugin-import-replace-title', {
                        defaultValue: 'Replace the existing Workspace draft?',
                      })}
                    </strong>
                    <p className="mt-1 text-ds-text-meta">
                      {t('layout.agent-plugin-import-replace-description', {
                        name: replacementReview.targetName,
                        version: replacementReview.version,
                        defaultValue:
                          '{{name}} already has saved configuration (draft version {{version}}). Agent Plugin conversion replaces that working draft; it does not merge configurations. The currently installed Workspace remains active until you publish and install the new draft.',
                      })}
                    </p>
                  </div>
                  <label className="flex items-start gap-3">
                    <Checkbox
                      checked={replacementConfirmed}
                      onCheckedChange={(checked) =>
                        setReplacementConfirmed(checked === true)
                      }
                      aria-label={t(
                        'layout.agent-plugin-import-confirm-replacement',
                        {
                          defaultValue:
                            'Confirm replacing existing Workspace draft',
                        }
                      )}
                    />
                    <span>
                      {t(
                        'layout.agent-plugin-import-replacement-confirmation',
                        {
                          defaultValue:
                            'I understand this replaces the saved draft.',
                        }
                      )}
                    </span>
                  </label>
                </div>
              ) : null}
              <div className="flex items-center gap-3 rounded-xl bg-ds-neutral-subtle-default p-3 text-ds-text-meta text-ds-ink-muted-default">
                <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
                {t('layout.agent-plugin-import-secret-handling', {
                  defaultValue:
                    'Standard MCP env and header literals are public plugin data and are copied. Values explicitly declared as secret requirements are omitted and configured separately after conversion.',
                })}
              </div>
              <Button
                type="button"
                onClick={() => void convert()}
                disabled={
                  !inspection.convertible ||
                  !reviewConfirmed ||
                  (targetMode === 'existing'
                    ? !targetSpaceId
                    : !newSpaceName.trim()) ||
                  !email ||
                  busy !== null
                }
              >
                {busy === 'convert' ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : null}
                {t('layout.agent-plugin-import-convert-action', {
                  defaultValue: 'Convert to local draft',
                })}
              </Button>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
