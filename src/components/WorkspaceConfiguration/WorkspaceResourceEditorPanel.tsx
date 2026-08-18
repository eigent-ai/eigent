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
import type {
  WorkspaceAgentProfile,
  WorkspaceConfigurationDocument,
  WorkspaceConnectorRequirement,
  WorkspaceContextSource,
  WorkspaceEnvironmentVariableRequirement,
  WorkspaceMcpRequirement,
  WorkspaceSkillAssignment,
} from '@/service/workspaceConfigurationApi';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  Cable,
  Database,
  FileText,
  FolderOpen,
  Package,
  Server,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

type EditorMode = 'create' | 'edit';
type EditorStep = 'picker' | 'editor';

export type WorkspaceResourceEditorState =
  | {
      kind: 'environment';
      mode: EditorMode;
      step: 'editor';
      index?: number;
      item: WorkspaceEnvironmentVariableRequirement;
    }
  | {
      kind: 'instruction';
      mode: EditorMode;
      step: 'editor';
      item: { role: string; ref: string };
    }
  | {
      kind: 'context';
      mode: EditorMode;
      step: EditorStep;
      index?: number;
      item: WorkspaceContextSource;
      queryText: string;
      queryError?: string;
    }
  | {
      kind: 'agent';
      mode: EditorMode;
      step: 'editor';
      index?: number;
      item: WorkspaceAgentProfile;
    }
  | {
      kind: 'skill';
      mode: EditorMode;
      step: EditorStep;
      index?: number;
      item: WorkspaceSkillAssignment;
    }
  | {
      kind: 'connector';
      mode: EditorMode;
      step: EditorStep;
      index?: number;
      item: WorkspaceConnectorRequirement;
    }
  | {
      kind: 'mcp';
      mode: EditorMode;
      step: EditorStep;
      index?: number;
      item: WorkspaceMcpRequirement;
    };

interface WorkspaceResourceEditorPanelProps {
  editor: WorkspaceResourceEditorState;
  document: WorkspaceConfigurationDocument;
  saveState: 'idle' | 'loading' | 'saving' | 'saved' | 'needs_attention';
  onChange: (editor: WorkspaceResourceEditorState) => void;
  onClose: () => void;
  onCommit: () => void;
  onDelete: () => void;
}

const csv = (value: string): string[] =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

const editorNames = {
  environment: 'environment variable',
  instruction: 'instruction',
  context: 'context',
  agent: 'agent',
  skill: 'skill',
  connector: 'connector',
  mcp: 'MCP server',
} as const;

const drawerEase = [0.32, 0.72, 0, 1] as const;
const uiEaseOut = [0.23, 1, 0.32, 1] as const;
type ContentDirection = 1 | -1;

const ENVIRONMENT_VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const contextKindLabel = (kind: WorkspaceContextSource['kind']) =>
  ({
    bundle_asset: 'Bundle asset',
    inline: 'Inline text',
    connection_query: 'Connection query',
    local_path_slot: 'Local folder slot',
    artifact_ref: 'Artifact reference',
    memory_scope: 'Memory scope',
  })[kind];

export const contextDraftForKind = (
  id: string,
  kind: WorkspaceContextSource['kind']
): WorkspaceContextSource => ({
  id,
  kind,
  ...(kind === 'inline'
    ? { content: '' }
    : kind === 'local_path_slot'
      ? { slot: 'workspace_folder' }
      : kind === 'bundle_asset'
        ? { path: 'bundle://context/context.md' }
        : kind === 'artifact_ref'
          ? { path: 'artifact://artifact-id' }
          : kind === 'memory_scope'
            ? { path: 'memory://space' }
            : { query: {} }),
  sharing: 'reference_only',
});

function PickerOption({
  icon,
  title,
  description,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={title}
      className="flex w-full items-start gap-3 rounded-xl bg-ds-bg-neutral-default-default p-3 text-left outline-none transition-colors hover:bg-ds-bg-neutral-default-hover focus-visible:ring-2 focus-visible:ring-ds-ring-brand-default-focus"
      onClick={onClick}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ds-bg-neutral-subtle-default text-ds-icon-neutral-default-default">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-body-sm font-bold text-ds-text-neutral-default-default">
          {title}
        </span>
        <span className="mt-0.5 block text-body-xs text-ds-text-neutral-muted-default">
          {description}
        </span>
      </span>
    </button>
  );
}

function Picker({
  editor,
  onChange,
}: {
  editor: WorkspaceResourceEditorState;
  onChange: (editor: WorkspaceResourceEditorState) => void;
}) {
  if (editor.kind === 'context') {
    const options: Array<{
      kind: WorkspaceContextSource['kind'];
      title: string;
      description: string;
      icon: ReactNode;
    }> = [
      {
        kind: 'local_path_slot',
        title: 'Local folder',
        description: 'Ask each recipient to connect a local folder.',
        icon: <FolderOpen className="h-4 w-4" aria-hidden />,
      },
      {
        kind: 'bundle_asset',
        title: 'Bundled file',
        description: 'Reference a file shipped with this bundle.',
        icon: <FileText className="h-4 w-4" aria-hidden />,
      },
      {
        kind: 'inline',
        title: 'Inline text',
        description: 'Store a short, portable context note.',
        icon: <FileText className="h-4 w-4" aria-hidden />,
      },
      {
        kind: 'connection_query',
        title: 'Connection query',
        description: 'Resolve context through a configured connection.',
        icon: <Database className="h-4 w-4" aria-hidden />,
      },
      {
        kind: 'artifact_ref',
        title: 'Artifact reference',
        description: 'Point to an authorized Eigent artifact.',
        icon: <Package className="h-4 w-4" aria-hidden />,
      },
      {
        kind: 'memory_scope',
        title: 'Memory scope',
        description: 'Expose a defined Space memory scope.',
        icon: <Database className="h-4 w-4" aria-hidden />,
      },
    ];
    return (
      <div className="space-y-2" data-workspace-resource-picker="context">
        {options.map((option) => (
          <PickerOption
            key={option.kind}
            icon={option.icon}
            title={option.title}
            description={option.description}
            onClick={() =>
              onChange({
                ...editor,
                step: 'editor',
                item: contextDraftForKind(editor.item.id, option.kind),
                queryText: '{}',
                queryError: undefined,
              })
            }
          />
        ))}
      </div>
    );
  }

  if (editor.kind === 'skill') {
    return (
      <div className="space-y-2" data-workspace-resource-picker="skill">
        <PickerOption
          icon={<Package className="h-4 w-4" aria-hidden />}
          title="Browse registry"
          description="Add a versioned skill available from the registry."
          onClick={() =>
            onChange({
              ...editor,
              step: 'editor',
              item: {
                ref: 'registry://skills/new-skill@1.0.0',
                assignTo: [],
              },
            })
          }
        />
        <PickerOption
          icon={<FileText className="h-4 w-4" aria-hidden />}
          title="Bundle skill"
          description="Reference a skill packaged inside this bundle."
          onClick={() =>
            onChange({
              ...editor,
              step: 'editor',
              item: {
                ref: 'bundle://skills/new-skill/SKILL.md',
                assignTo: [],
              },
            })
          }
        />
      </div>
    );
  }

  if (editor.kind === 'connector') {
    const connectors = [
      ['github', 'GitHub', 'Connect repositories and issues.'],
      ['slack', 'Slack', 'Connect channels and messages.'],
      ['google_drive', 'Google Drive', 'Connect files and folders.'],
      ['custom', 'Custom connector', 'Configure another connector type.'],
    ] as const;
    return (
      <div className="space-y-2" data-workspace-resource-picker="connector">
        {connectors.map(([value, title, description]) => (
          <PickerOption
            key={value}
            icon={<Cable className="h-4 w-4" aria-hidden />}
            title={title}
            description={description}
            onClick={() =>
              onChange({
                ...editor,
                step: 'editor',
                item: {
                  ...editor.item,
                  connector: value,
                  connectionSlot: `${value}_connection`,
                },
              })
            }
          />
        ))}
      </div>
    );
  }

  if (editor.kind === 'mcp') {
    return (
      <div className="space-y-2" data-workspace-resource-picker="mcp">
        <PickerOption
          icon={<Server className="h-4 w-4" aria-hidden />}
          title="MCP registry"
          description="Use a versioned MCP definition from the registry."
          onClick={() =>
            onChange({
              ...editor,
              step: 'editor',
              item: {
                ...editor.item,
                definition: 'registry://mcp/new-server@1.0.0',
              },
            })
          }
        />
        <PickerOption
          icon={<FileText className="h-4 w-4" aria-hidden />}
          title="Bundle definition"
          description="Reference an MCP definition packaged in this bundle."
          onClick={() =>
            onChange({
              ...editor,
              step: 'editor',
              item: {
                ...editor.item,
                definition: `bundle://mcp/${editor.item.id}.json`,
              },
            })
          }
        />
      </div>
    );
  }

  return null;
}

export function canCommitResourceEditor(
  editor: WorkspaceResourceEditorState,
  document?: WorkspaceConfigurationDocument
): boolean {
  if (editor.step === 'picker') return false;
  if (editor.kind === 'environment') {
    const duplicateName = document?.spec.environment?.variables.some(
      (variable, index) =>
        index !== editor.index && variable.name === editor.item.name
    );
    return ENVIRONMENT_VARIABLE_NAME.test(editor.item.name) && !duplicateName;
  }
  if (editor.kind === 'instruction')
    return Boolean(editor.item.role.trim() && editor.item.ref.trim());
  if (editor.kind === 'context')
    return Boolean(editor.item.id.trim() && !editor.queryError);
  if (editor.kind === 'agent')
    return Boolean(
      editor.item.id.trim() &&
      editor.item.role.trim() &&
      editor.item.modelProfile.trim()
    );
  if (editor.kind === 'skill') return Boolean(editor.item.ref.trim());
  if (editor.kind === 'connector')
    return Boolean(
      editor.item.id.trim() &&
      editor.item.connector.trim() &&
      editor.item.connectionSlot.trim()
    );
  return Boolean(editor.item.id.trim() && editor.item.definition.trim());
}

function EditorFields({
  editor,
  document,
  onChange,
}: {
  editor: WorkspaceResourceEditorState;
  document: WorkspaceConfigurationDocument;
  onChange: (editor: WorkspaceResourceEditorState) => void;
}) {
  if (editor.kind === 'environment') {
    const duplicateName = document.spec.environment?.variables.some(
      (variable, index) =>
        index !== editor.index && variable.name === editor.item.name
    );
    const nameNote = !ENVIRONMENT_VARIABLE_NAME.test(editor.item.name)
      ? 'Use a portable environment variable name such as API_TOKEN.'
      : duplicateName
        ? 'Variable names must be unique.'
        : undefined;
    const label = editor.item.name || 'environment variable';

    return (
      <div className="space-y-4">
        <Input
          autoFocus
          title="Variable name"
          value={editor.item.name}
          state={nameNote ? 'error' : 'default'}
          note={nameNote}
          spellCheck={false}
          autoCapitalize="none"
          onChange={(event) =>
            onChange({
              ...editor,
              item: { ...editor.item, name: event.target.value },
            })
          }
        />
        <Input
          title="Description"
          optional
          value={editor.item.description || ''}
          placeholder="Why this variable is needed"
          onChange={(event) =>
            onChange({
              ...editor,
              item: {
                ...editor.item,
                ...(event.target.value
                  ? { description: event.target.value }
                  : { description: undefined }),
              },
            })
          }
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex min-h-10 items-center gap-2 rounded-xl bg-ds-bg-neutral-default-default px-3 text-body-sm font-bold">
            <Switch
              size="sm"
              aria-label={`Required ${label}`}
              checked={editor.item.required}
              onCheckedChange={(required) =>
                onChange({
                  ...editor,
                  item: { ...editor.item, required },
                })
              }
            />
            <span>Required</span>
          </label>
          <label className="flex min-h-10 items-center gap-2 rounded-xl bg-ds-bg-neutral-default-default px-3 text-body-sm font-bold">
            <Switch
              size="sm"
              aria-label={`Sensitive ${label}`}
              checked={editor.item.sensitive}
              onCheckedChange={(sensitive) => {
                const item = { ...editor.item, sensitive };
                if (sensitive) delete item.example;
                onChange({ ...editor, item });
              }}
            />
            <span>Sensitive</span>
          </label>
        </div>
        {editor.item.sensitive ? (
          <span className="block text-body-xs text-ds-text-neutral-muted-default">
            The recipient will provide this value locally during setup.
          </span>
        ) : (
          <Input
            title="Safe example"
            optional
            value={editor.item.example || ''}
            placeholder="development"
            note="Documentation only. Never paste a credential or real local value."
            onChange={(event) =>
              onChange({
                ...editor,
                item: {
                  ...editor.item,
                  ...(event.target.value
                    ? { example: event.target.value }
                    : { example: undefined }),
                },
              })
            }
          />
        )}
      </div>
    );
  }

  if (editor.kind === 'instruction') {
    return (
      <div className="space-y-4">
        <Input
          autoFocus
          title="Role"
          value={editor.item.role}
          onChange={(event) =>
            onChange({
              ...editor,
              item: { ...editor.item, role: event.target.value },
            })
          }
        />
        <Input
          title="Instruction asset"
          value={editor.item.ref}
          placeholder="bundle://instructions/coordinator.md"
          onChange={(event) =>
            onChange({
              ...editor,
              item: { ...editor.item, ref: event.target.value },
            })
          }
        />
      </div>
    );
  }

  if (editor.kind === 'context') {
    const changeKind = (kind: WorkspaceContextSource['kind']) =>
      onChange({
        ...editor,
        item: contextDraftForKind(editor.item.id, kind),
        queryText: '{}',
        queryError: undefined,
      });
    return (
      <div className="space-y-4">
        <Input
          autoFocus
          title="Context id"
          value={editor.item.id}
          onChange={(event) =>
            onChange({
              ...editor,
              item: { ...editor.item, id: event.target.value },
            })
          }
        />
        <Select value={editor.item.kind} onValueChange={changeKind}>
          <SelectTrigger
            title="Source type"
            aria-label="Source type"
            wrapperClassName="w-full"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {(
                [
                  'local_path_slot',
                  'bundle_asset',
                  'inline',
                  'connection_query',
                  'artifact_ref',
                  'memory_scope',
                ] as const
              ).map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {contextKindLabel(kind)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {editor.item.kind === 'inline' ? (
          <Textarea
            variant="enhanced"
            title="Content"
            value={editor.item.content || ''}
            onChange={(event) =>
              onChange({
                ...editor,
                item: { ...editor.item, content: event.target.value },
              })
            }
          />
        ) : editor.item.kind === 'connection_query' ? (
          <Textarea
            variant="enhanced"
            title="Query"
            value={editor.queryText}
            note={editor.queryError}
            onChange={(event) => {
              const queryText = event.target.value;
              try {
                const query = JSON.parse(queryText) as unknown;
                if (!query || Array.isArray(query) || typeof query !== 'object')
                  throw new Error('Query must be a JSON object.');
                onChange({
                  ...editor,
                  queryText,
                  queryError: undefined,
                  item: {
                    ...editor.item,
                    query: query as Record<string, unknown>,
                  },
                });
              } catch (cause) {
                onChange({
                  ...editor,
                  queryText,
                  queryError:
                    cause instanceof Error ? cause.message : 'Invalid JSON',
                });
              }
            }}
          />
        ) : (
          <Input
            title={
              editor.item.kind === 'local_path_slot'
                ? 'Slot name'
                : 'Logical reference'
            }
            value={
              editor.item.kind === 'local_path_slot'
                ? editor.item.slot || ''
                : editor.item.path || ''
            }
            onChange={(event) =>
              onChange({
                ...editor,
                item:
                  editor.item.kind === 'local_path_slot'
                    ? { ...editor.item, slot: event.target.value }
                    : { ...editor.item, path: event.target.value },
              })
            }
          />
        )}
        <Select
          value={editor.item.sharing || 'reference_only'}
          onValueChange={(sharing) =>
            onChange({
              ...editor,
              item: {
                ...editor.item,
                sharing: sharing as WorkspaceContextSource['sharing'],
              },
            })
          }
        >
          <SelectTrigger
            title="Sharing"
            aria-label="Sharing"
            wrapperClassName="w-full"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="reference_only">Reference only</SelectItem>
              <SelectItem value="bundled">Bundled</SelectItem>
              <SelectItem value="authorized_artifact">
                Authorized artifact
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (editor.kind === 'agent') {
    const instruction = document.spec.instructions[editor.item.role];
    const skills = document.spec.skills.filter((item) =>
      item.assignTo.includes(editor.item.id)
    );
    const mcpServers = document.spec.mcpServers.filter((item) =>
      item.assignTo.includes(editor.item.id)
    );
    return (
      <div className="space-y-4">
        <Input
          autoFocus
          title="Agent id"
          value={editor.item.id}
          onChange={(event) =>
            onChange({
              ...editor,
              item: { ...editor.item, id: event.target.value },
            })
          }
        />
        <Input
          title="Role"
          value={editor.item.role}
          onChange={(event) =>
            onChange({
              ...editor,
              item: { ...editor.item, role: event.target.value },
            })
          }
        />
        <Select
          value={editor.item.modelProfile}
          onValueChange={(modelProfile) =>
            onChange({ ...editor, item: { ...editor.item, modelProfile } })
          }
        >
          <SelectTrigger
            title="Model profile"
            aria-label="Model profile"
            wrapperClassName="w-full"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {Object.keys(document.spec.models).map((profile) => (
                <SelectItem key={profile} value={profile}>
                  {profile}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <div className="border-x-0 border-b-0 border-t border-solid border-ds-border-neutral-subtle-default pt-4">
          <div className="text-body-sm font-bold text-ds-text-neutral-default-default">
            Assigned resources
          </div>
          <div className="mt-2 space-y-2 text-body-xs text-ds-text-neutral-muted-default">
            <div className="rounded-xl bg-ds-bg-neutral-default-default p-3">
              <span className="font-semibold text-ds-text-neutral-default-default">
                Instruction
              </span>
              <span className="mt-1 block truncate">
                {instruction || 'No instruction for this role'}
              </span>
            </div>
            <div className="rounded-xl bg-ds-bg-neutral-default-default p-3">
              <span className="font-semibold text-ds-text-neutral-default-default">
                Skills
              </span>
              <span className="mt-1 block truncate">
                {skills.length
                  ? skills.map((item) => item.ref).join(', ')
                  : 'No assigned skills'}
              </span>
            </div>
            <div className="rounded-xl bg-ds-bg-neutral-default-default p-3">
              <span className="font-semibold text-ds-text-neutral-default-default">
                MCP servers
              </span>
              <span className="mt-1 block truncate">
                {mcpServers.length
                  ? mcpServers.map((item) => item.id).join(', ')
                  : 'No assigned MCP servers'}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (editor.kind === 'skill') {
    return (
      <div className="space-y-4">
        <Input
          autoFocus
          title="Skill reference"
          value={editor.item.ref}
          onChange={(event) =>
            onChange({
              ...editor,
              item: { ...editor.item, ref: event.target.value },
            })
          }
        />
        <Input
          title="Assign to agents"
          value={editor.item.assignTo.join(', ')}
          placeholder="lead, researcher"
          note="Use agent ids separated by commas."
          onChange={(event) =>
            onChange({
              ...editor,
              item: { ...editor.item, assignTo: csv(event.target.value) },
            })
          }
        />
      </div>
    );
  }

  if (editor.kind === 'connector') {
    return (
      <div className="space-y-4">
        <Input
          autoFocus
          title="Connector id"
          value={editor.item.id}
          onChange={(event) =>
            onChange({
              ...editor,
              item: { ...editor.item, id: event.target.value },
            })
          }
        />
        <Input
          title="Connector"
          value={editor.item.connector}
          onChange={(event) =>
            onChange({
              ...editor,
              item: { ...editor.item, connector: event.target.value },
            })
          }
        />
        <Input
          title="Connection slot"
          value={editor.item.connectionSlot}
          onChange={(event) =>
            onChange({
              ...editor,
              item: { ...editor.item, connectionSlot: event.target.value },
            })
          }
        />
        <Input
          title="Required grants"
          value={editor.item.requiredGrants.join(', ')}
          placeholder="repository.read, issues.read"
          onChange={(event) =>
            onChange({
              ...editor,
              item: {
                ...editor.item,
                requiredGrants: csv(event.target.value),
              },
            })
          }
        />
      </div>
    );
  }

  if (editor.kind === 'mcp') {
    return (
      <div className="space-y-4">
        <Input
          autoFocus
          title="MCP server id"
          value={editor.item.id}
          onChange={(event) =>
            onChange({
              ...editor,
              item: { ...editor.item, id: event.target.value },
            })
          }
        />
        <Input
          title="Definition"
          value={editor.item.definition}
          onChange={(event) =>
            onChange({
              ...editor,
              item: { ...editor.item, definition: event.target.value },
            })
          }
        />
        <Input
          title="Secret slots"
          value={editor.item.secretSlots.join(', ')}
          placeholder="API_TOKEN"
          note="Store slot names only. Secret values remain local."
          onChange={(event) =>
            onChange({
              ...editor,
              item: { ...editor.item, secretSlots: csv(event.target.value) },
            })
          }
        />
        <Input
          title="Assign to agents"
          value={editor.item.assignTo.join(', ')}
          placeholder="lead, researcher"
          onChange={(event) =>
            onChange({
              ...editor,
              item: { ...editor.item, assignTo: csv(event.target.value) },
            })
          }
        />
      </div>
    );
  }

  return null;
}

export function WorkspaceResourceEditorPanel({
  editor,
  document,
  saveState,
  onChange,
  onClose,
  onCommit,
  onDelete,
}: WorkspaceResourceEditorPanelProps) {
  const reduceMotion = Boolean(useReducedMotion());
  const [contentDirection, setContentDirection] = useState<ContentDirection>(1);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const resourceName = editorNames[editor.kind];
  const title =
    editor.mode === 'create' ? `Add ${resourceName}` : `Edit ${resourceName}`;
  const canGoBack =
    editor.mode === 'create' &&
    editor.step === 'editor' &&
    (editor.kind === 'context' ||
      editor.kind === 'skill' ||
      editor.kind === 'connector' ||
      editor.kind === 'mcp');
  const handleEditorChange = useCallback(
    (nextEditor: WorkspaceResourceEditorState) => {
      if (nextEditor.step !== editor.step) {
        setContentDirection(nextEditor.step === 'editor' ? 1 : -1);
      }
      onChange(nextEditor);
    },
    [editor.step, onChange]
  );
  const goBack = () => {
    if (
      editor.kind === 'context' ||
      editor.kind === 'skill' ||
      editor.kind === 'connector' ||
      editor.kind === 'mcp'
    ) {
      handleEditorChange({ ...editor, step: 'picker' });
    }
  };
  const footerStatus =
    editor.mode === 'edit'
      ? saveState === 'saving'
        ? 'Saving…'
        : saveState === 'saved'
          ? 'Saved'
          : saveState === 'needs_attention'
            ? 'Needs attention'
            : 'Local draft'
      : 'Not yet added';
  const panelTransform = 'translate3d(0, 0, 0)';
  const panelOffsetTransform = reduceMotion
    ? panelTransform
    : 'translate3d(8%, 0, 0)';
  const contentTransition = {
    duration: reduceMotion ? 0.12 : 0.18,
    ease: drawerEase,
  };
  const contentVariants = {
    enter: (direction: ContentDirection) => ({
      opacity: 0,
      transform: reduceMotion
        ? panelTransform
        : `translate3d(${direction === 1 ? '2%' : '-2%'}, 0, 0)`,
    }),
    center: {
      opacity: 1,
      transform: panelTransform,
    },
    exit: (direction: ContentDirection) => ({
      opacity: 0,
      transform: reduceMotion
        ? panelTransform
        : `translate3d(${direction === 1 ? '-2%' : '2%'}, 0, 0)`,
    }),
  };

  return (
    <motion.aside
      data-workspace-resource-editor-panel
      data-motion-reduced={reduceMotion ? 'true' : 'false'}
      aria-label={title}
      initial={{ opacity: 0, transform: panelOffsetTransform }}
      animate={{
        opacity: 1,
        transform: panelTransform,
        transition: {
          duration: reduceMotion ? 0.12 : 0.24,
          ease: drawerEase,
        },
      }}
      exit={{
        opacity: 0,
        transform: panelOffsetTransform,
        transition: {
          duration: reduceMotion ? 0.12 : 0.18,
          ease: drawerEase,
        },
      }}
      className="pointer-events-auto ml-auto flex max-h-[calc(100dvh-5rem)] min-h-[80dvh] w-full flex-col overflow-hidden rounded-2xl border border-solid border-ds-border-neutral-subtle-default bg-ds-bg-neutral-subtle-default shadow-xl md:w-1/2 md:min-w-[420px]"
    >
      <header className="flex items-start justify-between gap-4 border-x-0 border-b border-l-0 border-r-0 border-t-0 border-solid border-ds-border-neutral-subtle-default px-5 py-4">
        <div className="flex min-w-0 items-start gap-2">
          {canGoBack ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              buttonContent="icon-only"
              className="-ml-2 shrink-0"
              aria-label="Back"
              onClick={goBack}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </Button>
          ) : null}
          <div className="min-w-0">
            <span className="block text-body-lg font-bold text-ds-text-neutral-default-default">
              {title}
            </span>
            <span className="mt-1 block text-body-xs text-ds-text-neutral-muted-default">
              {editor.step === 'picker'
                ? `Choose the type of ${resourceName} to configure.`
                : editor.mode === 'create'
                  ? `Configure this ${resourceName} before adding it to the bundle.`
                  : 'Changes autosave to the current Space draft.'}
            </span>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          buttonContent="icon-only"
          aria-label="Close editor"
          onClick={onClose}
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </header>

      <div className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-5">
        <AnimatePresence
          initial={false}
          mode="popLayout"
          custom={contentDirection}
        >
          <motion.div
            key={editor.step}
            data-workspace-resource-content-step={editor.step}
            data-workspace-resource-content-direction={
              contentDirection === 1 ? 'forward' : 'back'
            }
            custom={contentDirection}
            variants={contentVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={contentTransition}
            className="min-h-full"
          >
            {editor.step === 'picker' ? (
              <Picker editor={editor} onChange={handleEditorChange} />
            ) : (
              <EditorFields
                editor={editor}
                document={document}
                onChange={handleEditorChange}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <footer className="border-x-0 border-b-0 border-l-0 border-r-0 border-t border-solid border-ds-border-neutral-subtle-default px-4 py-2">
        <div className="flex items-center gap-2">
          {editor.mode === 'edit' ? (
            <Button
              type="button"
              variant="ghost"
              tone="error"
              size="sm"
              aria-label={`Delete ${resourceName}`}
              onClick={onDelete}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              Delete
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={!canCommitResourceEditor(editor, document)}
            onClick={editor.mode === 'create' ? onCommit : onClose}
          >
            Save
          </Button>
        </div>
        <span className="relative mt-1 block min-h-5 overflow-hidden text-center text-label-xs text-ds-text-neutral-muted-default">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={footerStatus}
              data-workspace-resource-status-visual
              aria-hidden
              className="block text-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12, ease: uiEaseOut }}
            >
              {footerStatus}
            </motion.span>
          </AnimatePresence>
          <span
            className="sr-only"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {footerStatus}
          </span>
        </span>
      </footer>
    </motion.aside>
  );
}
