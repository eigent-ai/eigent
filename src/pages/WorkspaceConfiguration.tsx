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

import { WorkspaceSettingsSkeleton } from '@/components/Home/SpaceDetailLoadingSkeleton';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { WorkspaceBundleSaveDialog } from '@/components/WorkspaceConfiguration/WorkspaceBundleSaveDialog';
import {
  contextDraftForKind,
  WorkspaceResourceEditorPanel,
  type WorkspaceResourceEditorState,
} from '@/components/WorkspaceConfiguration/WorkspaceResourceEditorPanel';
import { WorkspaceResourceListItem } from '@/components/WorkspaceConfiguration/WorkspaceResourceListItem';
import { useWorkspaceConfiguration } from '@/hooks/useWorkspaceConfiguration';
import { cn } from '@/lib/utils';
import { registerWorkspaceConfigurationNavigationGuard } from '@/lib/workspaceConfigurationNavigationGuard';
import {
  workspaceEnvironmentVariables,
  type ThinkingEffort,
  type WorkspaceConfigurationDocument,
} from '@/service/workspaceConfigurationApi';
import { useAuthStore } from '@/store/authStore';
import { useSpaceStore } from '@/store/spaceStore';
import { AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  Bot,
  Cable,
  FileText,
  KeyRound,
  MoreHorizontal,
  Package,
  Plus,
  Server,
  ShareIcon,
  Trash2,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

const nextId = (prefix: string, existing: string[]): string => {
  for (let index = 1; ; index += 1) {
    const candidate = `${prefix}_${index}`;
    if (!existing.includes(candidate)) return candidate;
  }
};

const humanizeIdentifier = (value: string): string => {
  const withoutProtocol = value.replace(/^[a-z]+:\/\//, '');
  const leaf = withoutProtocol.split('/').filter(Boolean).at(-1) || value;
  const withoutVersion = leaf.split('@')[0].replace(/\.[a-z0-9]+$/i, '');
  return withoutVersion
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
};

const resourceVersion = (value: string): string | null => {
  const match = value.match(/@([^/]+)$/);
  return match?.[1] ? `v${match[1].replace(/^v/, '')}` : null;
};

const removeAgentReferences = (
  document: WorkspaceConfigurationDocument,
  agentId: string
) => {
  document.spec.skills.forEach((skill) => {
    skill.assignTo = skill.assignTo.filter((id) => id !== agentId);
  });
  document.spec.mcpServers.forEach((server) => {
    server.assignTo = server.assignTo.filter((id) => id !== agentId);
  });
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
    <div className="px-4 py-6 text-center text-ds-text-base text-ds-ink-muted-default">
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
  label,
  onClick,
}: {
  label?: string;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const resolvedLabel =
    label ??
    t('layout.workspace-configuration-add', {
      defaultValue: 'Add',
    });
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
      {resolvedLabel}
    </Button>
  );
}

function CollectionActions({
  label,
  count,
  onDeleteAll,
}: {
  label: string;
  count: number;
  onDeleteAll: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          buttonContent="icon-only"
          buttonRadius="full"
          aria-label={t('layout.workspace-configuration-collection-actions', {
            defaultValue: '{{label}} actions',
            label,
          })}
          disabled={count === 0}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          className="!text-ds-text-status-error-strong-default focus:!text-ds-text-status-error-strong-default [&>svg]:!text-current"
          onSelect={onDeleteAll}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          {t('layout.workspace-configuration-delete-all', {
            defaultValue: 'Delete all',
          })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
    <div
      data-workspace-setting-row
      className="grid min-h-16 items-center gap-4 px-4 py-3 md:grid-cols-[minmax(180px,0.8fr)_minmax(260px,1.2fr)]"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="text-ds-text-base font-bold text-ds-ink-default-default">
          {label}
        </div>
        {description ? (
          <div className="text-ds-text-meta text-ds-ink-muted-default">
            {description}
          </div>
        ) : null}
      </div>
      <div className="min-w-0 md:justify-self-stretch">{children}</div>
    </div>
  );
}

const workspaceSettingSections = [
  { id: 'space-settings-identity' },
  { id: 'space-settings-model' },
  { id: 'space-settings-environment' },
  { id: 'space-settings-instructions' },
  { id: 'space-settings-context' },
  { id: 'space-settings-agents' },
  { id: 'space-settings-skills' },
  { id: 'space-settings-connectors' },
  { id: 'space-settings-mcp-servers' },
] as const;

type WorkspaceSettingSectionId =
  (typeof workspaceSettingSections)[number]['id'];

const tableBoxClassName = 'w-full rounded-xl bg-ds-neutral-subtle-default p-0';

function CollectionSummaryTitle({
  label,
  count,
}: {
  label: string;
  count: number;
}) {
  return (
    <span className="flex items-center gap-2">
      <span>{label}</span>
      <span
        data-workspace-collection-count
        className="rounded-lg bg-ds-bg-information-subtle-default px-2 text-ds-text-base font-bold text-ds-text-information-strong-default tabular-nums"
      >
        {count}
      </span>
    </span>
  );
}

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
          <SettingsRowGroup className={cn('w-full', boxClassName)}>
            {children}
          </SettingsRowGroup>
        </SettingsRow>
      </SettingsRowGroup>
    </section>
  );
}

function WorkspaceCollectionSection({
  id,
  title,
  description,
  summaryTitle,
  addLabel,
  count,
  emptyState,
  onAdd,
  onDeleteAll,
  children,
}: {
  id: WorkspaceSettingSectionId;
  title: string;
  description: string;
  summaryTitle: string;
  addLabel: string;
  count: number;
  emptyState: ReactNode;
  onAdd: () => void;
  onDeleteAll: () => void;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      data-workspace-settings-section={id}
      className="scroll-mt-24"
    >
      <SettingsRowGroup>
        <SettingsRow
          title={title}
          description={description}
          action={<AddSectionButton label={addLabel} onClick={onAdd} />}
        />
        <SettingsRow
          title={<CollectionSummaryTitle label={summaryTitle} count={count} />}
          action={
            <CollectionActions
              label={summaryTitle}
              count={count}
              onDeleteAll={onDeleteAll}
            />
          }
        >
          {count === 0 ? (
            <EmptyRow>{emptyState}</EmptyRow>
          ) : (
            <div className="flex w-full min-w-0 flex-col gap-2">{children}</div>
          )}
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
  const { t } = useTranslation();
  const workspaceSettingSectionLabel = (section: WorkspaceSettingSectionId) => {
    switch (section) {
      case 'space-settings-identity':
        return t('layout.workspace-configuration-section-identity', {
          defaultValue: 'Identity',
        });
      case 'space-settings-model':
        return t('layout.workspace-configuration-section-model', {
          defaultValue: 'Model',
        });
      case 'space-settings-environment':
        return t('layout.workspace-configuration-section-environment', {
          defaultValue: 'Environment',
        });
      case 'space-settings-instructions':
        return t('layout.workspace-configuration-section-instructions', {
          defaultValue: 'Instructions',
        });
      case 'space-settings-context':
        return t('layout.workspace-configuration-section-context', {
          defaultValue: 'Context',
        });
      case 'space-settings-agents':
        return t('layout.workspace-configuration-section-agents', {
          defaultValue: 'Agents',
        });
      case 'space-settings-skills':
        return t('layout.workspace-configuration-section-skills', {
          defaultValue: 'Skills',
        });
      case 'space-settings-connectors':
        return t('layout.workspace-configuration-section-connectors', {
          defaultValue: 'Connectors',
        });
      case 'space-settings-mcp-servers':
        return t('layout.workspace-configuration-section-mcp-servers', {
          defaultValue: 'MCP servers',
        });
    }
  };
  const contextKindLabel = (
    kind: WorkspaceConfigurationDocument['spec']['context'][number]['kind']
  ) => {
    switch (kind) {
      case 'bundle_asset':
        return t('layout.workspace-configuration-context-kind-profile-asset', {
          defaultValue: 'Profile asset',
        });
      case 'inline':
        return t('layout.workspace-configuration-context-kind-inline', {
          defaultValue: 'Inline',
        });
      case 'connection_query':
        return t('layout.workspace-configuration-context-kind-connection', {
          defaultValue: 'Connection query',
        });
      case 'local_path_slot':
        return t('layout.workspace-configuration-context-kind-local-path', {
          defaultValue: 'Local path slot',
        });
      case 'artifact_ref':
        return t('layout.workspace-configuration-context-kind-artifact', {
          defaultValue: 'Artifact reference',
        });
      case 'memory_scope':
        return t('layout.workspace-configuration-context-kind-memory', {
          defaultValue: 'Memory scope',
        });
    }
  };
  const contextSharingLabel = (
    sharing: NonNullable<
      WorkspaceConfigurationDocument['spec']['context'][number]['sharing']
    >
  ) => {
    switch (sharing) {
      case 'bundled':
        return t('layout.workspace-configuration-context-sharing-profile', {
          defaultValue: 'Included in profile',
        });
      case 'reference_only':
        return t(
          'layout.workspace-configuration-context-sharing-reference-only',
          { defaultValue: 'Reference only' }
        );
      case 'authorized_artifact':
        return t(
          'layout.workspace-configuration-context-sharing-authorized-artifact',
          { defaultValue: 'Authorized artifact' }
        );
    }
  };
  const reduceMotion = Boolean(useReducedMotion());
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [resourceEditor, setResourceEditor] =
    useState<WorkspaceResourceEditorState | null>(null);
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
  const {
    draft,
    document,
    setDocument,
    saveState,
    error,
    hasPendingChanges,
    flushSave,
    reload,
    retrySave,
  } = useWorkspaceConfiguration({
    spaceId: targetSpaceId,
    spaceName: targetSpace?.name,
    identity,
  });
  const hasPendingChangesRef = useRef(hasPendingChanges);

  useEffect(() => {
    hasPendingChangesRef.current = hasPendingChanges;
  }, [hasPendingChanges]);

  useEffect(() => {
    const unregister = registerWorkspaceConfigurationNavigationGuard({
      hasPendingChanges: () => hasPendingChangesRef.current,
      flushSave,
    });
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasPendingChangesRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      unregister();
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [flushSave]);

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
  const closeResourceEditor = useCallback(() => setResourceEditor(null), []);

  useEffect(() => {
    setResourceEditor(null);
  }, [targetSpaceId]);

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
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'start',
      });
    },
    [reduceMotion]
  );

  if (!targetSpaceId || !targetSpace) {
    return (
      <main className="flex h-full items-center justify-center p-8 text-ds-ink-muted-default">
        {t('layout.workspace-configuration-select-space', {
          defaultValue: 'Select a Space before configuring its workforce.',
        })}
      </main>
    );
  }

  if (!email) {
    return (
      <main className="flex h-full items-center justify-center p-8 text-ds-ink-muted-default">
        {t('layout.workspace-configuration-sign-in', {
          defaultValue: 'Sign in to edit these Space settings.',
        })}
      </main>
    );
  }

  if (!document) {
    return (
      <main
        role="status"
        aria-label={t('layout.workspace-configuration-loading', {
          defaultValue: 'Loading Space settings',
        })}
        className={cn(
          'h-full overflow-y-auto',
          presentation === 'page' && 'bg-ds-neutral-muted-default',
          presentation === 'settings' &&
            'h-auto overflow-visible bg-transparent'
        )}
      >
        <div
          className={cn(
            'w-full',
            presentation === 'page' && 'mx-auto max-w-5xl px-6 py-8'
          )}
        >
          <WorkspaceSettingsSkeleton />
        </div>
      </main>
    );
  }

  const instructions = Object.entries(document.spec.instructions);
  const environmentVariables = workspaceEnvironmentVariables(document);
  const sectionItemCounts: Partial<Record<WorkspaceSettingSectionId, number>> =
    {
      'space-settings-environment': environmentVariables.length,
      'space-settings-instructions': instructions.length,
      'space-settings-context': document.spec.context.length,
      'space-settings-agents': document.spec.agents.length,
      'space-settings-skills': document.spec.skills.length,
      'space-settings-connectors': document.spec.connectors.length,
      'space-settings-mcp-servers': document.spec.mcpServers.length,
    };

  const openCreateResource = (kind: WorkspaceResourceEditorState['kind']) => {
    if (kind === 'environment') {
      setResourceEditor({
        kind,
        mode: 'create',
        step: 'editor',
        item: {
          name: nextEnvironmentVariableName(document),
          required: true,
          sensitive: true,
        },
      });
      return;
    }
    if (kind === 'instruction') {
      const role = nextId('role', Object.keys(document.spec.instructions));
      setResourceEditor({
        kind,
        mode: 'create',
        step: 'editor',
        item: { role, ref: `bundle://instructions/${role}.md` },
      });
      return;
    }
    if (kind === 'context') {
      const id = nextId(
        'context',
        document.spec.context.map((item) => item.id)
      );
      setResourceEditor({
        kind,
        mode: 'create',
        step: 'picker',
        item: contextDraftForKind(id, 'inline'),
        queryText: '{}',
      });
      return;
    }
    if (kind === 'agent') {
      const id = nextId(
        'agent',
        document.spec.agents.map((item) => item.id)
      );
      setResourceEditor({
        kind,
        mode: 'create',
        step: 'editor',
        item: { id, role: 'worker', modelProfile: 'default' },
      });
      return;
    }
    if (kind === 'skill') {
      setResourceEditor({
        kind,
        mode: 'create',
        step: 'picker',
        item: { ref: '', assignTo: [] },
      });
      return;
    }
    if (kind === 'connector') {
      const id = nextId(
        'connector',
        document.spec.connectors.map((item) => item.id)
      );
      setResourceEditor({
        kind,
        mode: 'create',
        step: 'picker',
        item: {
          id,
          connector: '',
          connectionSlot: '',
          requiredGrants: [],
        },
      });
      return;
    }
    const id = nextId(
      'mcp',
      document.spec.mcpServers.map((item) => item.id)
    );
    setResourceEditor({
      kind: 'mcp',
      mode: 'create',
      step: 'picker',
      item: { id, definition: '', secretSlots: [], assignTo: [] },
    });
  };

  const handleResourceEditorChange = (
    nextEditor: WorkspaceResourceEditorState
  ) => {
    const previousEditor = resourceEditor;
    setResourceEditor(nextEditor);
    if (
      !previousEditor ||
      previousEditor.kind !== nextEditor.kind ||
      nextEditor.mode !== 'edit'
    ) {
      return;
    }

    update((next) => {
      if (nextEditor.kind === 'environment' && nextEditor.index !== undefined) {
        const variables = workspaceEnvironmentVariables(next);
        next.spec.environment = {
          variables: variables.map((variable, index) =>
            index === nextEditor.index ? nextEditor.item : variable
          ),
        };
        return;
      }
      if (
        nextEditor.kind === 'instruction' &&
        previousEditor.kind === 'instruction'
      ) {
        if (previousEditor.item.role !== nextEditor.item.role) {
          delete next.spec.instructions[previousEditor.item.role];
        }
        next.spec.instructions[nextEditor.item.role] = nextEditor.item.ref;
        return;
      }
      if (nextEditor.kind === 'context' && nextEditor.index !== undefined) {
        next.spec.context[nextEditor.index] = nextEditor.item;
        return;
      }
      if (
        nextEditor.kind === 'agent' &&
        previousEditor.kind === 'agent' &&
        nextEditor.index !== undefined
      ) {
        const previousAgent = previousEditor.item;
        next.spec.agents[nextEditor.index] = nextEditor.item;
        if (previousAgent.id !== nextEditor.item.id) {
          next.spec.skills.forEach((skill) => {
            skill.assignTo = skill.assignTo.map((id) =>
              id === previousAgent.id ? nextEditor.item.id : id
            );
          });
          next.spec.mcpServers.forEach((server) => {
            server.assignTo = server.assignTo.map((id) =>
              id === previousAgent.id ? nextEditor.item.id : id
            );
          });
        }
        if (
          previousAgent.role !== nextEditor.item.role &&
          next.spec.instructions[previousAgent.role] &&
          !next.spec.instructions[nextEditor.item.role]
        ) {
          next.spec.instructions[nextEditor.item.role] =
            next.spec.instructions[previousAgent.role];
          delete next.spec.instructions[previousAgent.role];
        }
        return;
      }
      if (nextEditor.kind === 'skill' && nextEditor.index !== undefined) {
        next.spec.skills[nextEditor.index] = nextEditor.item;
        return;
      }
      if (nextEditor.kind === 'connector' && nextEditor.index !== undefined) {
        next.spec.connectors[nextEditor.index] = nextEditor.item;
        return;
      }
      if (nextEditor.kind === 'mcp' && nextEditor.index !== undefined) {
        next.spec.mcpServers[nextEditor.index] = nextEditor.item;
      }
    });
  };

  const commitNewResource = () => {
    if (!resourceEditor || resourceEditor.mode !== 'create') return;
    update((next) => {
      if (resourceEditor.kind === 'environment') {
        next.spec.environment = {
          variables: [
            ...workspaceEnvironmentVariables(next),
            resourceEditor.item,
          ],
        };
      } else if (resourceEditor.kind === 'instruction') {
        next.spec.instructions[resourceEditor.item.role] =
          resourceEditor.item.ref;
      } else if (resourceEditor.kind === 'context') {
        next.spec.context.push(resourceEditor.item);
      } else if (resourceEditor.kind === 'agent') {
        next.spec.agents.push(resourceEditor.item);
      } else if (resourceEditor.kind === 'skill') {
        next.spec.skills.push(resourceEditor.item);
      } else if (resourceEditor.kind === 'connector') {
        next.spec.connectors.push(resourceEditor.item);
      } else {
        next.spec.mcpServers.push(resourceEditor.item);
      }
    });
    closeResourceEditor();
  };

  const deleteEditedResource = () => {
    if (!resourceEditor || resourceEditor.mode !== 'edit') {
      closeResourceEditor();
      return;
    }
    update((next) => {
      if (
        resourceEditor.kind === 'environment' &&
        resourceEditor.index !== undefined
      ) {
        next.spec.environment = {
          variables: workspaceEnvironmentVariables(next).filter(
            (_variable, index) => index !== resourceEditor.index
          ),
        };
      } else if (resourceEditor.kind === 'instruction') {
        delete next.spec.instructions[resourceEditor.item.role];
      } else if (
        resourceEditor.kind === 'context' &&
        resourceEditor.index !== undefined
      ) {
        next.spec.context.splice(resourceEditor.index, 1);
      } else if (
        resourceEditor.kind === 'agent' &&
        resourceEditor.index !== undefined
      ) {
        removeAgentReferences(next, resourceEditor.item.id);
        next.spec.agents.splice(resourceEditor.index, 1);
      } else if (
        resourceEditor.kind === 'skill' &&
        resourceEditor.index !== undefined
      ) {
        next.spec.skills.splice(resourceEditor.index, 1);
      } else if (
        resourceEditor.kind === 'connector' &&
        resourceEditor.index !== undefined
      ) {
        next.spec.connectors.splice(resourceEditor.index, 1);
      } else if (
        resourceEditor.kind === 'mcp' &&
        resourceEditor.index !== undefined
      ) {
        next.spec.mcpServers.splice(resourceEditor.index, 1);
      }
    });
    closeResourceEditor();
  };

  return (
    <main
      data-workspace-settings-scroll-root={
        presentation === 'page' ? true : undefined
      }
      className={cn(
        'h-full overflow-y-auto',
        presentation === 'page' && 'bg-ds-neutral-muted-default',
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
              <span className="text-ds-text-meta font-medium tracking-wide text-ds-ink-muted-default uppercase">
                {targetSpace.name}
              </span>
              {presentation === 'page' ? (
                <h1 className="mt-1 !text-ds-text-display font-semibold text-ds-ink-default-default">
                  {t('layout.workspace-configuration-title', {
                    defaultValue: 'Space settings',
                  })}
                </h1>
              ) : null}
              <span className="mt-2 max-w-2xl text-ds-text-base text-ds-ink-muted-default">
                {t('layout.workspace-configuration-description', {
                  defaultValue:
                    'Configure the context, tools, agents, permissions, and versioning that every task in this Space inherits.',
                })}
              </span>
            </div>
          </header>
        ) : null}

        <SettingsSectionPage className="md:grid md:grid-cols-[180px_minmax(0,1fr)] md:items-start md:gap-6">
          <aside
            aria-label={t('layout.workspace-configuration-navigation', {
              defaultValue: 'Space settings navigation',
            })}
            className={cn(
              'w-full min-w-0 md:sticky md:w-[180px]',
              presentation === 'settings' ? 'md:top-16' : 'md:top-4'
            )}
          >
            <nav
              aria-label={t('layout.workspace-configuration-sections', {
                defaultValue: 'Space settings sections',
              })}
              className="w-full min-w-0 rounded-2xl bg-ds-neutral-default-default p-1"
            >
              <ul
                data-workspace-settings-tab-list
                className="m-0 list-none space-y-0.5 p-0"
              >
                {workspaceSettingSections.map((section) => {
                  const active = activeSectionId === section.id;
                  const itemCount = sectionItemCounts[section.id];
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
                          {workspaceSettingSectionLabel(section.id)}
                        </span>
                        {itemCount !== undefined ? (
                          <span
                            data-workspace-settings-tab-count={section.id}
                            aria-hidden
                            className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-lg bg-ds-bg-information-subtle-default px-1.5 text-ds-text-meta font-bold text-ds-text-information-strong-default tabular-nums"
                          >
                            {itemCount}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </aside>

          <div
            ref={settingsContentRef}
            data-workspace-settings-content
            className="relative min-w-0 space-y-4 [&>[data-workspace-resource-panel-anchor]+*]:!mt-0"
          >
            <AnimatePresence initial={false}>
              {resourceEditor ? (
                <div
                  key="workspace-resource-panel"
                  data-workspace-resource-panel-anchor
                  className={cn(
                    'pointer-events-none sticky z-40 h-0 min-w-0',
                    presentation === 'settings' ? 'top-16' : 'top-4'
                  )}
                >
                  <WorkspaceResourceEditorPanel
                    editor={resourceEditor}
                    document={document}
                    saveState={saveState}
                    onChange={handleResourceEditorChange}
                    onClose={closeResourceEditor}
                    onCommit={commitNewResource}
                    onDelete={deleteEditedResource}
                  />
                </div>
              ) : null}
            </AnimatePresence>

            {error ? (
              <div className="flex items-center justify-between gap-4 rounded-xl bg-ds-bg-error-subtle-default px-4 py-3 text-ds-text-base text-ds-text-error-strong-default">
                <span>{error}</span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void reload()}
                >
                  {t('layout.workspace-configuration-reload', {
                    defaultValue: 'Reload saved copy',
                  })}
                </Button>
              </div>
            ) : null}

            <section data-workspace-profile-status-section>
              <SettingsRowGroup
                data-testid="profile-status-settings-group"
                className="w-full"
              >
                <SettingRow
                  label={t('layout.workspace-configuration-draft-version', {
                    defaultValue: 'Draft version {{version}}',
                    version: draft?.version ?? 0,
                  })}
                >
                  <div className="flex min-h-10 items-center justify-end gap-2">
                    <span className="text-ds-text-base text-ds-ink-muted-default">
                      {saveState === 'saving'
                        ? t('layout.workspace-configuration-saving', {
                            defaultValue: 'Saving…',
                          })
                        : saveState === 'saved'
                          ? t('layout.workspace-configuration-saved', {
                              defaultValue: 'Saved',
                            })
                          : saveState === 'needs_attention'
                            ? t(
                                'layout.workspace-configuration-needs-attention',
                                { defaultValue: 'Needs attention' }
                              )
                            : t('layout.workspace-configuration-local-draft', {
                                defaultValue: 'Local draft',
                              })}
                    </span>
                    {saveState === 'needs_attention' ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={retrySave}
                      >
                        {t('layout.workspace-configuration-retry', {
                          defaultValue: 'Retry',
                        })}
                      </Button>
                    ) : null}
                  </div>
                </SettingRow>
                <SettingRow
                  label={t('layout.workspace-configuration-profile', {
                    defaultValue: 'Profile',
                  })}
                >
                  <div className="flex min-h-10 items-center justify-end">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      buttonContent="icon-only"
                      buttonRadius="full"
                      aria-label={t(
                        'layout.workspace-configuration-share-profile',
                        { defaultValue: 'Share Space profile' }
                      )}
                      title={t('layout.workspace-configuration-share-profile', {
                        defaultValue: 'Share Space profile',
                      })}
                      onClick={() => setSaveDialogOpen(true)}
                      disabled={!draft?.persisted || saveState !== 'saved'}
                    >
                      <ShareIcon className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                </SettingRow>
              </SettingsRowGroup>
            </section>

            <section
              id="space-settings-identity"
              data-workspace-settings-section="space-settings-identity"
              className="scroll-mt-24"
            >
              <SettingsRowGroup
                data-testid="identity-settings-group"
                className="w-full"
              >
                <SettingRow
                  label={t('layout.workspace-configuration-profile-name', {
                    defaultValue: 'Profile name',
                  })}
                  description={t(
                    'layout.workspace-configuration-profile-name-description',
                    {
                      defaultValue:
                        'Shown to collaborators and people who receive this profile.',
                    }
                  )}
                >
                  <Input
                    variant="secondary"
                    value={document.metadata.name}
                    aria-label={t(
                      'layout.workspace-configuration-profile-name',
                      { defaultValue: 'Profile name' }
                    )}
                    onChange={(event) =>
                      update((next) => {
                        next.metadata.name = event.target.value;
                      })
                    }
                  />
                </SettingRow>
                <SettingRow
                  label={t('layout.workspace-configuration-approval-mode', {
                    defaultValue: 'Approval mode',
                  })}
                  description={t(
                    'layout.workspace-configuration-approval-mode-description',
                    {
                      defaultValue:
                        'Controls when Eigent asks you before it acts.',
                    }
                  )}
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
                      aria-label={t(
                        'layout.workspace-configuration-approval-mode',
                        { defaultValue: 'Approval mode' }
                      )}
                      wrapperClassName="w-full"
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="request_approval">
                          {t(
                            'layout.workspace-configuration-approval-ask-first',
                            { defaultValue: 'Ask me first' }
                          )}
                        </SelectItem>
                        <SelectItem value="auto_review">
                          {t(
                            'layout.workspace-configuration-approval-automatic',
                            { defaultValue: 'Approve for me' }
                          )}
                        </SelectItem>
                        <SelectItem value="workspace_write">
                          {t(
                            'layout.workspace-configuration-approval-edit-files',
                            { defaultValue: 'Edit files without asking' }
                          )}
                        </SelectItem>
                        <SelectItem value="full_access">
                          {t(
                            'layout.workspace-configuration-approval-full-access',
                            { defaultValue: 'Full access' }
                          )}
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </SettingRow>
                <SettingRow
                  label={t('layout.workspace-configuration-git-enabled', {
                    defaultValue: 'Track this Space in Git',
                  })}
                  description={t(
                    'layout.workspace-configuration-git-enabled-description',
                    {
                      defaultValue:
                        "Save this Space's files to its selected branch. Each agent works in isolation until its changes are merged.",
                    }
                  )}
                >
                  <div className="flex min-h-10 items-center justify-end">
                    <Switch
                      aria-label={t(
                        'layout.workspace-configuration-git-enabled',
                        { defaultValue: 'Track this Space in Git' }
                      )}
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
                  label={t('layout.workspace-configuration-remote-policy', {
                    defaultValue: 'Remote policy',
                  })}
                  description={t(
                    'layout.workspace-configuration-remote-policy-description',
                    {
                      defaultValue:
                        'Choose when Eigent may push to or pull from a remote.',
                    }
                  )}
                >
                  <Select
                    value={document.spec.git.remotePolicy}
                    onValueChange={(value) =>
                      update((next) => {
                        next.spec.git.remotePolicy = value as
                          'deny' | 'prompt' | 'allow';
                      })
                    }
                  >
                    <SelectTrigger
                      variant="secondary"
                      aria-label={t(
                        'layout.workspace-configuration-remote-policy',
                        { defaultValue: 'Remote policy' }
                      )}
                      wrapperClassName="w-full"
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="deny">
                          {t(
                            'layout.workspace-configuration-remote-policy-deny',
                            { defaultValue: 'Deny' }
                          )}
                        </SelectItem>
                        <SelectItem value="prompt">
                          {t(
                            'layout.workspace-configuration-remote-policy-prompt',
                            { defaultValue: 'Ask before remote operations' }
                          )}
                        </SelectItem>
                        <SelectItem value="allow">
                          {t(
                            'layout.workspace-configuration-remote-policy-allow',
                            { defaultValue: 'Allow according to approval mode' }
                          )}
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </SettingRow>
              </SettingsRowGroup>
            </section>

            <WorkspaceSettingsSection
              id="space-settings-model"
              title={t('layout.workspace-configuration-model-title', {
                defaultValue: 'Model',
              })}
              description={t(
                'layout.workspace-configuration-model-description',
                {
                  defaultValue:
                    'Define reusable model profiles for the agents in this Space.',
                }
              )}
              action={
                <AddSectionButton
                  label={t('layout.workspace-configuration-add-model-profile', {
                    defaultValue: 'Add profile',
                  })}
                  onClick={() =>
                    update((next) => {
                      const profileName = nextId(
                        'model',
                        Object.keys(next.spec.models)
                      );
                      next.spec.models[profileName] = {
                        modelRef: 'provider://default',
                        thinkingEffort: 'medium',
                      };
                    })
                  }
                />
              }
              boxClassName={tableBoxClassName}
            >
              {Object.entries(document.spec.models).map(
                ([profileName, profile]) => (
                  <SettingRow
                    key={profileName}
                    label={humanizeIdentifier(profileName)}
                    description={
                      profileName === 'default'
                        ? t(
                            'layout.workspace-configuration-model-profile-inherited',
                            {
                              defaultValue:
                                'Inherited when an agent has no custom profile.',
                            }
                          )
                        : t(
                            'layout.workspace-configuration-model-profile-assignable',
                            {
                              defaultValue:
                                'Available to assign from the agent editor.',
                            }
                          )
                    }
                  >
                    <div className="grid w-full items-end gap-2 xl:grid-cols-[1fr_2fr_1fr_auto]">
                      <Input
                        title={t(
                          'layout.workspace-configuration-model-profile-name',
                          { defaultValue: 'Profile name' }
                        )}
                        value={profileName}
                        disabled={profileName === 'default'}
                        onChange={(event) => {
                          const replacement = event.target.value;
                          update((next) => {
                            const current = next.spec.models[profileName];
                            delete next.spec.models[profileName];
                            next.spec.models[replacement] = current;
                            next.spec.agents.forEach((agent) => {
                              if (agent.modelProfile === profileName) {
                                agent.modelProfile = replacement;
                              }
                            });
                          });
                        }}
                      />
                      <Input
                        title={t(
                          'layout.workspace-configuration-model-reference',
                          { defaultValue: 'Model reference' }
                        )}
                        value={profile.modelRef}
                        aria-label={t(
                          'layout.workspace-configuration-model-reference-label',
                          {
                            defaultValue: '{{profile}} model reference',
                            profile: profileName,
                          }
                        )}
                        onChange={(event) =>
                          update((next) => {
                            next.spec.models[profileName].modelRef =
                              event.target.value;
                          })
                        }
                      />
                      <Select
                        value={profile.thinkingEffort}
                        onValueChange={(value) =>
                          update((next) => {
                            next.spec.models[profileName].thinkingEffort =
                              value as ThinkingEffort;
                          })
                        }
                      >
                        <SelectTrigger
                          title={t(
                            'layout.workspace-configuration-thinking-effort',
                            { defaultValue: 'Thinking effort' }
                          )}
                          aria-label={t(
                            'layout.workspace-configuration-thinking-effort-label',
                            {
                              defaultValue: '{{profile}} thinking effort',
                              profile: profileName,
                            }
                          )}
                          wrapperClassName="w-full"
                          className="w-full"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="low">
                              {t('layout.thinking-effort-low', {
                                defaultValue: 'Low',
                              })}
                            </SelectItem>
                            <SelectItem value="medium">
                              {t('layout.thinking-effort-medium', {
                                defaultValue: 'Medium',
                              })}
                            </SelectItem>
                            <SelectItem value="high">
                              {t('layout.thinking-effort-high', {
                                defaultValue: 'High',
                              })}
                            </SelectItem>
                            <SelectItem value="xhigh">
                              {t('layout.thinking-effort-extra-high', {
                                defaultValue: 'Extra high',
                              })}
                            </SelectItem>
                            <SelectItem value="max">
                              {t('layout.thinking-effort-max', {
                                defaultValue: 'Max',
                              })}
                            </SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      {profileName === 'default' ? (
                        <span className="h-9 w-9" aria-hidden />
                      ) : (
                        <RemoveButton
                          label={t(
                            'layout.workspace-configuration-remove-model-profile',
                            {
                              defaultValue: 'Remove model profile {{profile}}',
                              profile: profileName,
                            }
                          )}
                          onClick={() =>
                            update((next) => {
                              delete next.spec.models[profileName];
                              next.spec.agents.forEach((agent) => {
                                if (agent.modelProfile === profileName) {
                                  agent.modelProfile = 'default';
                                }
                              });
                            })
                          }
                        />
                      )}
                    </div>
                  </SettingRow>
                )
              )}
            </WorkspaceSettingsSection>

            <WorkspaceCollectionSection
              id="space-settings-environment"
              title={t('layout.workspace-configuration-environment-title', {
                defaultValue: 'Environment',
              })}
              description={t(
                'layout.workspace-configuration-environment-description',
                {
                  defaultValue:
                    'Declare portable variable names only; local and secret values are never shared.',
                }
              )}
              summaryTitle={t(
                'layout.workspace-configuration-environment-summary',
                { defaultValue: 'Environment variables' }
              )}
              addLabel={t('layout.workspace-configuration-add-variable', {
                defaultValue: 'Add variable',
              })}
              count={environmentVariables.length}
              emptyState={t(
                'layout.workspace-configuration-environment-empty',
                { defaultValue: 'No environment variables are required.' }
              )}
              onAdd={() => openCreateResource('environment')}
              onDeleteAll={() => {
                update((next) => {
                  next.spec.environment = { variables: [] };
                });
              }}
            >
              {environmentVariables.map((variable, index) => (
                <WorkspaceResourceListItem
                  key={`${variable.name}-${index}`}
                  leading={<KeyRound className="h-4 w-4" aria-hidden />}
                  title={
                    variable.name ||
                    t('layout.workspace-configuration-variable-name', {
                      defaultValue: 'Variable {{number}}',
                      number: index + 1,
                    })
                  }
                  subtitle={
                    variable.description ||
                    t('layout.no-description', {
                      defaultValue: 'No description',
                    })
                  }
                  meta={`${variable.required ? t('layout.required', { defaultValue: 'Required' }) : t('layout.optional', { defaultValue: 'Optional' })}${variable.sensitive ? ` · ${t('layout.sensitive', { defaultValue: 'Sensitive' })}` : ''}`}
                  editLabel={t('layout.workspace-configuration-edit-variable', {
                    defaultValue: 'Edit {{variable}}',
                    variable:
                      variable.name ||
                      t('layout.workspace-configuration-variable-name-lower', {
                        defaultValue: 'variable {{number}}',
                        number: index + 1,
                      }),
                  })}
                  deleteLabel={t(
                    'layout.workspace-configuration-remove-variable',
                    {
                      defaultValue: 'Remove {{variable}}',
                      variable:
                        variable.name ||
                        t(
                          'layout.workspace-configuration-variable-name-lower',
                          {
                            defaultValue: 'variable {{number}}',
                            number: index + 1,
                          }
                        ),
                    }
                  )}
                  onEdit={() =>
                    setResourceEditor({
                      kind: 'environment',
                      mode: 'edit',
                      step: 'editor',
                      index,
                      item: variable,
                    })
                  }
                  onDelete={() =>
                    update((next) => {
                      next.spec.environment = {
                        variables: workspaceEnvironmentVariables(next).filter(
                          (_variable, variableIndex) => variableIndex !== index
                        ),
                      };
                    })
                  }
                />
              ))}
            </WorkspaceCollectionSection>

            <WorkspaceCollectionSection
              id="space-settings-instructions"
              title={t('layout.workspace-configuration-instructions-title', {
                defaultValue: 'Instructions',
              })}
              description={t(
                'layout.workspace-configuration-instructions-description',
                {
                  defaultValue:
                    'Assign versioned instruction assets to workforce roles.',
                }
              )}
              summaryTitle={t(
                'layout.workspace-configuration-instructions-summary',
                { defaultValue: 'Instruction assets' }
              )}
              addLabel={t('layout.workspace-configuration-add-instruction', {
                defaultValue: 'Add instruction',
              })}
              count={instructions.length}
              emptyState={t(
                'layout.workspace-configuration-instructions-empty',
                {
                  defaultValue:
                    'Add an instruction asset for a coordinator or worker role.',
                }
              )}
              onAdd={() => openCreateResource('instruction')}
              onDeleteAll={() =>
                update((next) => {
                  next.spec.instructions = {};
                })
              }
            >
              {instructions.map(([role, ref]) => (
                <WorkspaceResourceListItem
                  key={role}
                  leading={<FileText className="h-4 w-4" aria-hidden />}
                  title={humanizeIdentifier(role)}
                  subtitle={ref}
                  meta={t('layout.instruction', {
                    defaultValue: 'Instruction',
                  })}
                  editLabel={t(
                    'layout.workspace-configuration-edit-instructions',
                    {
                      defaultValue: 'Edit {{role}} instructions',
                      role,
                    }
                  )}
                  deleteLabel={t(
                    'layout.workspace-configuration-remove-instructions',
                    {
                      defaultValue: 'Remove {{role}} instructions',
                      role,
                    }
                  )}
                  onEdit={() =>
                    setResourceEditor({
                      kind: 'instruction',
                      mode: 'edit',
                      step: 'editor',
                      item: { role, ref },
                    })
                  }
                  onDelete={() =>
                    update((next) => {
                      delete next.spec.instructions[role];
                    })
                  }
                />
              ))}
            </WorkspaceCollectionSection>

            <WorkspaceCollectionSection
              id="space-settings-context"
              title={t('layout.workspace-configuration-context-title', {
                defaultValue: 'Context',
              })}
              description={t(
                'layout.workspace-configuration-context-description',
                {
                  defaultValue:
                    'Declare shareable context or named local path slots.',
                }
              )}
              summaryTitle={t(
                'layout.workspace-configuration-context-summary',
                { defaultValue: 'Context items' }
              )}
              addLabel={t('layout.workspace-configuration-add-context', {
                defaultValue: 'Add context',
              })}
              count={document.spec.context.length}
              emptyState={t('layout.workspace-configuration-context-empty', {
                defaultValue: 'No Space context is configured yet.',
              })}
              onAdd={() => openCreateResource('context')}
              onDeleteAll={() =>
                update((next) => {
                  next.spec.context = [];
                })
              }
            >
              {document.spec.context.map((item, index) => (
                <WorkspaceResourceListItem
                  key={`${item.id}-${index}`}
                  leading={<FileText className="h-4 w-4" aria-hidden />}
                  title={humanizeIdentifier(item.id)}
                  subtitle={t(
                    'layout.workspace-configuration-context-item-summary',
                    {
                      defaultValue: '{{kind}} · {{sharing}}',
                      kind: contextKindLabel(item.kind),
                      sharing: contextSharingLabel(
                        item.sharing || 'reference_only'
                      ),
                    }
                  )}
                  meta={t('layout.context', { defaultValue: 'Context' })}
                  editLabel={t('layout.workspace-configuration-edit-context', {
                    defaultValue: 'Edit context {{id}}',
                    id: item.id,
                  })}
                  deleteLabel={t(
                    'layout.workspace-configuration-remove-context',
                    {
                      defaultValue: 'Remove context {{id}}',
                      id: item.id,
                    }
                  )}
                  onEdit={() =>
                    setResourceEditor({
                      kind: 'context',
                      mode: 'edit',
                      step: 'editor',
                      index,
                      item,
                      queryText: JSON.stringify(item.query || {}, null, 2),
                    })
                  }
                  onDelete={() =>
                    update((next) => {
                      next.spec.context.splice(index, 1);
                    })
                  }
                />
              ))}
            </WorkspaceCollectionSection>

            <WorkspaceCollectionSection
              id="space-settings-agents"
              title={t('layout.workspace-configuration-agents-title', {
                defaultValue: 'Agents',
              })}
              description={t(
                'layout.workspace-configuration-agents-description',
                {
                  defaultValue:
                    'Define the workforce roles available in this Space.',
                }
              )}
              summaryTitle={t('layout.workspace-configuration-agents-summary', {
                defaultValue: 'Configured agents',
              })}
              addLabel={t('layout.workspace-configuration-add-agent', {
                defaultValue: 'Add agent',
              })}
              count={document.spec.agents.length}
              emptyState={t('layout.workspace-configuration-agents-empty', {
                defaultValue: 'No agents configured.',
              })}
              onAdd={() => openCreateResource('agent')}
              onDeleteAll={() =>
                update((next) => {
                  next.spec.agents.forEach((agent) =>
                    removeAgentReferences(next, agent.id)
                  );
                  next.spec.agents = [];
                })
              }
            >
              {document.spec.agents.map((item, index) => (
                <WorkspaceResourceListItem
                  key={`${item.id}-${index}`}
                  leading={<Bot className="h-4 w-4" aria-hidden />}
                  title={humanizeIdentifier(item.id)}
                  subtitle={t(
                    'layout.workspace-configuration-agent-model-summary',
                    {
                      defaultValue: '{{role}} · {{model}} model',
                      role: humanizeIdentifier(item.role),
                      model: humanizeIdentifier(item.modelProfile),
                    }
                  )}
                  meta={t('layout.workspace-configuration-assigned-count', {
                    defaultValue_one: '{{count}} assigned',
                    defaultValue_other: '{{count}} assigned',
                    count:
                      document.spec.skills.filter((skill) =>
                        skill.assignTo.includes(item.id)
                      ).length +
                      document.spec.mcpServers.filter((server) =>
                        server.assignTo.includes(item.id)
                      ).length,
                  })}
                  editLabel={t('layout.workspace-configuration-edit-agent', {
                    defaultValue: 'Edit agent {{id}}',
                    id: item.id,
                  })}
                  deleteLabel={t(
                    'layout.workspace-configuration-remove-agent',
                    {
                      defaultValue: 'Remove agent {{id}}',
                      id: item.id,
                    }
                  )}
                  onEdit={() =>
                    setResourceEditor({
                      kind: 'agent',
                      mode: 'edit',
                      step: 'editor',
                      index,
                      item,
                    })
                  }
                  onDelete={() =>
                    update((next) => {
                      removeAgentReferences(next, item.id);
                      next.spec.agents.splice(index, 1);
                    })
                  }
                />
              ))}
            </WorkspaceCollectionSection>

            <WorkspaceCollectionSection
              id="space-settings-skills"
              title={t('layout.workspace-configuration-skills-title', {
                defaultValue: 'Skills',
              })}
              description={t(
                'layout.workspace-configuration-skills-description',
                {
                  defaultValue:
                    'Assign portable skill packages to workforce roles.',
                }
              )}
              summaryTitle={t('layout.workspace-configuration-skills-summary', {
                defaultValue: 'Assigned skills',
              })}
              addLabel={t('layout.workspace-configuration-add-skill', {
                defaultValue: 'Add skill',
              })}
              count={document.spec.skills.length}
              emptyState={t('layout.workspace-configuration-skills-empty', {
                defaultValue: 'No skills assigned.',
              })}
              onAdd={() => openCreateResource('skill')}
              onDeleteAll={() =>
                update((next) => {
                  next.spec.skills = [];
                })
              }
            >
              {document.spec.skills.map((item, index) => (
                <WorkspaceResourceListItem
                  key={`${item.ref}-${index}`}
                  leading={<Package className="h-4 w-4" aria-hidden />}
                  title={humanizeIdentifier(item.ref)}
                  subtitle={t(
                    'layout.workspace-configuration-resource-assignment-summary',
                    {
                      defaultValue: '{{resource}} · {{assignment}}',
                      resource:
                        resourceVersion(item.ref) ||
                        t('layout.workspace-configuration-profile-skill', {
                          defaultValue: 'Profile skill',
                        }),
                      assignment: item.assignTo.length
                        ? t('layout.workspace-configuration-assigned-to', {
                            defaultValue: 'Assigned to {{agents}}',
                            agents: item.assignTo
                              .map(humanizeIdentifier)
                              .join(', '),
                          })
                        : t('layout.workspace-configuration-not-assigned', {
                            defaultValue: 'Not assigned',
                          }),
                    }
                  )}
                  meta={t('layout.workspace-configuration-agent-count', {
                    defaultValue_one: '{{count}} agent',
                    defaultValue_other: '{{count}} agents',
                    count: item.assignTo.length,
                  })}
                  editLabel={t('layout.workspace-configuration-edit-skill', {
                    defaultValue: 'Edit skill {{skill}}',
                    skill: item.ref,
                  })}
                  deleteLabel={t(
                    'layout.workspace-configuration-remove-skill',
                    {
                      defaultValue: 'Remove skill {{skill}}',
                      skill: item.ref,
                    }
                  )}
                  onEdit={() =>
                    setResourceEditor({
                      kind: 'skill',
                      mode: 'edit',
                      step: 'editor',
                      index,
                      item,
                    })
                  }
                  onDelete={() =>
                    update((next) => {
                      next.spec.skills.splice(index, 1);
                    })
                  }
                />
              ))}
            </WorkspaceCollectionSection>

            <WorkspaceCollectionSection
              id="space-settings-connectors"
              title={t('layout.workspace-configuration-connectors-title', {
                defaultValue: 'Connectors',
              })}
              description={t(
                'layout.workspace-configuration-connectors-description',
                {
                  defaultValue:
                    'Declare connection slots and required grants without storing credentials.',
                }
              )}
              summaryTitle={t(
                'layout.workspace-configuration-connectors-summary',
                { defaultValue: 'Connector requirements' }
              )}
              addLabel={t('layout.workspace-configuration-add-connector', {
                defaultValue: 'Add connector',
              })}
              count={document.spec.connectors.length}
              emptyState={t('layout.workspace-configuration-connectors-empty', {
                defaultValue: 'No connector requirements.',
              })}
              onAdd={() => openCreateResource('connector')}
              onDeleteAll={() =>
                update((next) => {
                  next.spec.connectors = [];
                })
              }
            >
              {document.spec.connectors.map((item, index) => (
                <WorkspaceResourceListItem
                  key={`${item.id}-${index}`}
                  leading={<Cable className="h-4 w-4" aria-hidden />}
                  title={humanizeIdentifier(item.connector)}
                  subtitle={t(
                    'layout.workspace-configuration-connector-summary',
                    {
                      defaultValue_one: '{{id}} · {{count}} required grant',
                      defaultValue_other: '{{id}} · {{count}} required grants',
                      id: humanizeIdentifier(item.id),
                      count: item.requiredGrants.length,
                    }
                  )}
                  meta={humanizeIdentifier(item.connectionSlot)}
                  editLabel={t(
                    'layout.workspace-configuration-edit-connector',
                    {
                      defaultValue: 'Edit connector {{id}}',
                      id: item.id,
                    }
                  )}
                  deleteLabel={t(
                    'layout.workspace-configuration-remove-connector',
                    {
                      defaultValue: 'Remove connector {{id}}',
                      id: item.id,
                    }
                  )}
                  onEdit={() =>
                    setResourceEditor({
                      kind: 'connector',
                      mode: 'edit',
                      step: 'editor',
                      index,
                      item,
                    })
                  }
                  onDelete={() =>
                    update((next) => {
                      next.spec.connectors.splice(index, 1);
                    })
                  }
                />
              ))}
            </WorkspaceCollectionSection>

            <WorkspaceCollectionSection
              id="space-settings-mcp-servers"
              title={t('layout.workspace-configuration-mcp-title', {
                defaultValue: 'MCP servers',
              })}
              description={t('layout.workspace-configuration-mcp-description', {
                defaultValue:
                  'Configure portable MCP definitions and local secret slots.',
              })}
              summaryTitle={t('layout.workspace-configuration-mcp-summary', {
                defaultValue: 'Configured MCP servers',
              })}
              addLabel={t('layout.workspace-configuration-add-mcp', {
                defaultValue: 'Add MCP server',
              })}
              count={document.spec.mcpServers.length}
              emptyState={t('layout.workspace-configuration-mcp-empty', {
                defaultValue: 'No MCP servers.',
              })}
              onAdd={() => openCreateResource('mcp')}
              onDeleteAll={() =>
                update((next) => {
                  next.spec.mcpServers = [];
                })
              }
            >
              {document.spec.mcpServers.map((item, index) => (
                <WorkspaceResourceListItem
                  key={`${item.id}-${index}`}
                  leading={<Server className="h-4 w-4" aria-hidden />}
                  title={humanizeIdentifier(item.id)}
                  subtitle={t(
                    'layout.workspace-configuration-resource-assignment-summary',
                    {
                      defaultValue: '{{resource}} · {{assignment}}',
                      resource: humanizeIdentifier(item.definition),
                      assignment: item.assignTo.length
                        ? t('layout.workspace-configuration-assigned-to', {
                            defaultValue: 'Assigned to {{agents}}',
                            agents: item.assignTo
                              .map(humanizeIdentifier)
                              .join(', '),
                          })
                        : t('layout.workspace-configuration-not-assigned', {
                            defaultValue: 'Not assigned',
                          }),
                    }
                  )}
                  meta={t('layout.workspace-configuration-secret-slot-count', {
                    defaultValue_one: '{{count}} secret slot',
                    defaultValue_other: '{{count}} secret slots',
                    count: item.secretSlots.length,
                  })}
                  editLabel={t('layout.workspace-configuration-edit-mcp', {
                    defaultValue: 'Edit MCP {{id}}',
                    id: item.id,
                  })}
                  deleteLabel={t('layout.workspace-configuration-remove-mcp', {
                    defaultValue: 'Remove MCP {{id}}',
                    id: item.id,
                  })}
                  onEdit={() =>
                    setResourceEditor({
                      kind: 'mcp',
                      mode: 'edit',
                      step: 'editor',
                      index,
                      item,
                    })
                  }
                  onDelete={() =>
                    update((next) => {
                      next.spec.mcpServers.splice(index, 1);
                    })
                  }
                />
              ))}
            </WorkspaceCollectionSection>
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
