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
import type { TFunction } from 'i18next';
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
import { useTranslation } from 'react-i18next';

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

const editorName = (
  kind: WorkspaceResourceEditorState['kind'],
  t: TFunction
): string => {
  switch (kind) {
    case 'environment':
      return t('layout.workspace-resource-environment-variable', {
        defaultValue: 'environment variable',
      });
    case 'instruction':
      return t('layout.workspace-resource-instruction', {
        defaultValue: 'instruction',
      });
    case 'context':
      return t('layout.workspace-resource-context', {
        defaultValue: 'context',
      });
    case 'agent':
      return t('layout.workspace-resource-agent', { defaultValue: 'agent' });
    case 'skill':
      return t('layout.workspace-resource-skill', { defaultValue: 'skill' });
    case 'connector':
      return t('layout.workspace-resource-connector', {
        defaultValue: 'connector',
      });
    case 'mcp':
      return t('layout.workspace-resource-mcp-server', {
        defaultValue: 'MCP server',
      });
  }
};

const drawerEase = [0.32, 0.72, 0, 1] as const;
const uiEaseOut = [0.23, 1, 0.32, 1] as const;
type ContentDirection = 1 | -1;

const ENVIRONMENT_VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const contextKindLabel = (
  kind: WorkspaceContextSource['kind'],
  t: TFunction
): string => {
  switch (kind) {
    case 'bundle_asset':
      return t('layout.workspace-resource-context-bundle-asset', {
        defaultValue: 'Bundle asset',
      });
    case 'inline':
      return t('layout.workspace-resource-context-inline-text', {
        defaultValue: 'Inline text',
      });
    case 'connection_query':
      return t('layout.workspace-resource-context-connection-query', {
        defaultValue: 'Connection query',
      });
    case 'local_path_slot':
      return t('layout.workspace-resource-context-local-folder-slot', {
        defaultValue: 'Local folder slot',
      });
    case 'artifact_ref':
      return t('layout.workspace-resource-context-artifact-reference', {
        defaultValue: 'Artifact reference',
      });
    case 'memory_scope':
      return t('layout.workspace-resource-context-memory-scope', {
        defaultValue: 'Memory scope',
      });
  }
};

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
      className="flex w-full items-start gap-3 rounded-xl bg-ds-neutral-default-default p-3 text-left transition-colors outline-none hover:bg-ds-neutral-default-hover focus-visible:ring-2 focus-visible:ring-ds-ring-focus"
      onClick={onClick}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ds-neutral-subtle-default text-ds-ink-default-default">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-ds-text-base font-bold text-ds-ink-default-default">
          {title}
        </span>
        <span className="mt-0.5 block text-ds-text-meta text-ds-ink-muted-default">
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
  const { t } = useTranslation();

  if (editor.kind === 'context') {
    const options: Array<{
      kind: WorkspaceContextSource['kind'];
      title: string;
      description: string;
      icon: ReactNode;
    }> = [
      {
        kind: 'local_path_slot',
        title: t('layout.workspace-resource-local-folder', {
          defaultValue: 'Local folder',
        }),
        description: t('layout.workspace-resource-local-folder-description', {
          defaultValue: 'Ask each recipient to connect a local folder.',
        }),
        icon: <FolderOpen className="h-4 w-4" aria-hidden />,
      },
      {
        kind: 'bundle_asset',
        title: t('layout.workspace-resource-bundled-file', {
          defaultValue: 'Bundled file',
        }),
        description: t('layout.workspace-resource-bundled-file-description', {
          defaultValue: 'Reference a file shipped with this Bundle.',
        }),
        icon: <FileText className="h-4 w-4" aria-hidden />,
      },
      {
        kind: 'inline',
        title: t('layout.workspace-resource-inline-text', {
          defaultValue: 'Inline text',
        }),
        description: t('layout.workspace-resource-inline-text-description', {
          defaultValue: 'Store a short, portable context note.',
        }),
        icon: <FileText className="h-4 w-4" aria-hidden />,
      },
      {
        kind: 'connection_query',
        title: t('layout.workspace-resource-connection-query', {
          defaultValue: 'Connection query',
        }),
        description: t(
          'layout.workspace-resource-connection-query-description',
          {
            defaultValue: 'Resolve context through a configured connection.',
          }
        ),
        icon: <Database className="h-4 w-4" aria-hidden />,
      },
      {
        kind: 'artifact_ref',
        title: t('layout.workspace-resource-artifact-reference', {
          defaultValue: 'Artifact reference',
        }),
        description: t(
          'layout.workspace-resource-artifact-reference-description',
          {
            defaultValue: 'Point to an authorized Eigent artifact.',
          }
        ),
        icon: <Package className="h-4 w-4" aria-hidden />,
      },
      {
        kind: 'memory_scope',
        title: t('layout.workspace-resource-memory-scope', {
          defaultValue: 'Memory scope',
        }),
        description: t('layout.workspace-resource-memory-scope-description', {
          defaultValue: 'Expose a defined Space memory scope.',
        }),
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
          title={t('layout.workspace-resource-browse-registry', {
            defaultValue: 'Browse registry',
          })}
          description={t(
            'layout.workspace-resource-browse-registry-description',
            {
              defaultValue:
                'Add a versioned skill available from the registry.',
            }
          )}
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
          title={t('layout.workspace-resource-bundle-skill', {
            defaultValue: 'Bundle skill',
          })}
          description={t('layout.workspace-resource-bundle-skill-description', {
            defaultValue: 'Reference a skill packaged inside this Bundle.',
          })}
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
      [
        'github',
        t('layout.workspace-resource-github', { defaultValue: 'GitHub' }),
        t('layout.workspace-resource-github-description', {
          defaultValue: 'Connect repositories and issues.',
        }),
      ],
      [
        'slack',
        t('layout.workspace-resource-slack', { defaultValue: 'Slack' }),
        t('layout.workspace-resource-slack-description', {
          defaultValue: 'Connect channels and messages.',
        }),
      ],
      [
        'google_drive',
        t('layout.workspace-resource-google-drive', {
          defaultValue: 'Google Drive',
        }),
        t('layout.workspace-resource-google-drive-description', {
          defaultValue: 'Connect files and folders.',
        }),
      ],
      [
        'custom',
        t('layout.workspace-resource-custom-connector', {
          defaultValue: 'Custom connector',
        }),
        t('layout.workspace-resource-custom-connector-description', {
          defaultValue: 'Configure another connector type.',
        }),
      ],
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
          title={t('layout.workspace-resource-mcp-registry', {
            defaultValue: 'MCP registry',
          })}
          description={t('layout.workspace-resource-mcp-registry-description', {
            defaultValue: 'Use a versioned MCP definition from the registry.',
          })}
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
          title={t('layout.workspace-resource-bundle-definition', {
            defaultValue: 'Bundle definition',
          })}
          description={t(
            'layout.workspace-resource-bundle-definition-description',
            {
              defaultValue:
                'Reference an MCP definition packaged in this Bundle.',
            }
          )}
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

function hasDuplicateSkillRef(
  editor: Extract<WorkspaceResourceEditorState, { kind: 'skill' }>,
  document?: WorkspaceConfigurationDocument
) {
  return Boolean(
    document?.spec.skills.some(
      (assignment, index) =>
        index !== editor.index && assignment.ref === editor.item.ref
    )
  );
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
  if (editor.kind === 'skill')
    return (
      Boolean(editor.item.ref.trim()) && !hasDuplicateSkillRef(editor, document)
    );
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
  const { t } = useTranslation();

  if (editor.kind === 'environment') {
    const duplicateName = document.spec.environment?.variables.some(
      (variable, index) =>
        index !== editor.index && variable.name === editor.item.name
    );
    const nameNote = !ENVIRONMENT_VARIABLE_NAME.test(editor.item.name)
      ? t('layout.workspace-resource-portable-variable-name', {
          defaultValue:
            'Use a portable environment variable name such as API_TOKEN.',
        })
      : duplicateName
        ? t('layout.workspace-resource-variable-names-unique', {
            defaultValue: 'Variable names must be unique.',
          })
        : undefined;
    const label =
      editor.item.name ||
      t('layout.workspace-resource-environment-variable', {
        defaultValue: 'environment variable',
      });

    return (
      <div className="space-y-4">
        <Input
          autoFocus
          title={t('layout.workspace-resource-variable-name', {
            defaultValue: 'Variable name',
          })}
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
          title={t('setting.description', { defaultValue: 'Description' })}
          optional
          value={editor.item.description || ''}
          placeholder={t(
            'layout.workspace-resource-variable-description-placeholder',
            { defaultValue: 'Why this variable is needed' }
          )}
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
          <label className="flex min-h-10 items-center gap-2 rounded-xl bg-ds-neutral-default-default px-3 text-ds-text-meta font-bold">
            <Switch
              size="sm"
              aria-label={t('layout.workspace-resource-required-label', {
                label,
                defaultValue: 'Required {{label}}',
              })}
              checked={editor.item.required}
              onCheckedChange={(required) =>
                onChange({
                  ...editor,
                  item: { ...editor.item, required },
                })
              }
            />
            <span>
              {t('layout.workspace-resource-required', {
                defaultValue: 'Required',
              })}
            </span>
          </label>
          <label className="flex min-h-10 items-center gap-2 rounded-xl bg-ds-neutral-default-default px-3 text-ds-text-meta font-bold">
            <Switch
              size="sm"
              aria-label={t('layout.workspace-resource-sensitive-label', {
                label,
                defaultValue: 'Sensitive {{label}}',
              })}
              checked={editor.item.sensitive}
              onCheckedChange={(sensitive) => {
                const item = { ...editor.item, sensitive };
                if (sensitive) delete item.example;
                onChange({ ...editor, item });
              }}
            />
            <span>
              {t('layout.workspace-resource-sensitive', {
                defaultValue: 'Sensitive',
              })}
            </span>
          </label>
        </div>
        {editor.item.sensitive ? (
          <span className="block text-ds-text-meta text-ds-ink-muted-default">
            {t('layout.workspace-resource-sensitive-value-description', {
              defaultValue:
                'The recipient will provide this value locally during setup.',
            })}
          </span>
        ) : (
          <Input
            title={t('layout.workspace-resource-safe-example', {
              defaultValue: 'Safe example',
            })}
            optional
            value={editor.item.example || ''}
            placeholder={t(
              'layout.workspace-resource-safe-example-placeholder',
              {
                defaultValue: 'development',
              }
            )}
            note={t('layout.workspace-resource-safe-example-note', {
              defaultValue:
                'Documentation only. Never paste a credential or real local value.',
            })}
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
          title={t('layout.workspace-resource-role', { defaultValue: 'Role' })}
          value={editor.item.role}
          onChange={(event) =>
            onChange({
              ...editor,
              item: { ...editor.item, role: event.target.value },
            })
          }
        />
        <Input
          title={t('layout.workspace-resource-instruction-asset', {
            defaultValue: 'Instruction asset',
          })}
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
          title={t('layout.workspace-resource-context-id', {
            defaultValue: 'Context id',
          })}
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
            title={t('layout.workspace-resource-source-type', {
              defaultValue: 'Source type',
            })}
            aria-label={t('layout.workspace-resource-source-type', {
              defaultValue: 'Source type',
            })}
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
                  {contextKindLabel(kind, t)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {editor.item.kind === 'inline' ? (
          <Textarea
            variant="enhanced"
            title={t('layout.workspace-resource-content', {
              defaultValue: 'Content',
            })}
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
            title={t('layout.workspace-resource-query', {
              defaultValue: 'Query',
            })}
            value={editor.queryText}
            note={editor.queryError}
            onChange={(event) => {
              const queryText = event.target.value;
              try {
                const query = JSON.parse(queryText) as unknown;
                if (!query || Array.isArray(query) || typeof query !== 'object')
                  throw new Error(
                    t('layout.workspace-resource-query-json-object', {
                      defaultValue: 'Query must be a JSON object.',
                    })
                  );
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
                    cause instanceof Error
                      ? cause.message
                      : t('layout.workspace-resource-invalid-json', {
                          defaultValue: 'Invalid JSON',
                        }),
                });
              }
            }}
          />
        ) : (
          <Input
            title={
              editor.item.kind === 'local_path_slot'
                ? t('layout.workspace-resource-slot-name', {
                    defaultValue: 'Slot name',
                  })
                : t('layout.workspace-resource-logical-reference', {
                    defaultValue: 'Logical reference',
                  })
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
            title={t('layout.workspace-resource-sharing', {
              defaultValue: 'Sharing',
            })}
            aria-label={t('layout.workspace-resource-sharing', {
              defaultValue: 'Sharing',
            })}
            wrapperClassName="w-full"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="reference_only">
                {t('layout.workspace-resource-reference-only', {
                  defaultValue: 'Reference only',
                })}
              </SelectItem>
              <SelectItem value="bundled">
                {t('layout.workspace-resource-bundled', {
                  defaultValue: 'Bundled',
                })}
              </SelectItem>
              <SelectItem value="authorized_artifact">
                {t('layout.workspace-resource-authorized-artifact', {
                  defaultValue: 'Authorized artifact',
                })}
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
          title={t('layout.workspace-resource-agent-id', {
            defaultValue: 'Agent id',
          })}
          value={editor.item.id}
          onChange={(event) =>
            onChange({
              ...editor,
              item: { ...editor.item, id: event.target.value },
            })
          }
        />
        <Input
          title={t('layout.workspace-resource-role', { defaultValue: 'Role' })}
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
            title={t('layout.workspace-resource-model-profile', {
              defaultValue: 'Model profile',
            })}
            aria-label={t('layout.workspace-resource-model-profile', {
              defaultValue: 'Model profile',
            })}
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

        <div className="border-x-0 border-t border-b-0 border-solid border-ds-hairline-subtle-default pt-4">
          <div className="text-ds-text-base font-bold text-ds-ink-default-default">
            {t('layout.workspace-resource-assigned-resources', {
              defaultValue: 'Assigned resources',
            })}
          </div>
          <div className="mt-2 space-y-2 text-ds-text-meta text-ds-ink-muted-default">
            <div className="rounded-xl bg-ds-neutral-default-default p-3">
              <span className="font-semibold text-ds-ink-default-default">
                {t('layout.workspace-resource-instruction-label', {
                  defaultValue: 'Instruction',
                })}
              </span>
              <span className="mt-1 block truncate">
                {instruction ||
                  t('layout.workspace-resource-no-instruction-for-role', {
                    defaultValue: 'No instruction for this role',
                  })}
              </span>
            </div>
            <div className="rounded-xl bg-ds-neutral-default-default p-3">
              <span className="font-semibold text-ds-ink-default-default">
                {t('layout.workspace-resource-skills', {
                  defaultValue: 'Skills',
                })}
              </span>
              <span className="mt-1 block truncate">
                {skills.length
                  ? skills.map((item) => item.ref).join(', ')
                  : t('layout.workspace-resource-no-assigned-skills', {
                      defaultValue: 'No assigned skills',
                    })}
              </span>
            </div>
            <div className="rounded-xl bg-ds-neutral-default-default p-3">
              <span className="font-semibold text-ds-ink-default-default">
                {t('layout.workspace-resource-mcp-servers', {
                  defaultValue: 'MCP servers',
                })}
              </span>
              <span className="mt-1 block truncate">
                {mcpServers.length
                  ? mcpServers.map((item) => item.id).join(', ')
                  : t('layout.workspace-resource-no-assigned-mcp-servers', {
                      defaultValue: 'No assigned MCP servers',
                    })}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (editor.kind === 'skill') {
    const duplicateRef = hasDuplicateSkillRef(editor, document);
    const refNote = duplicateRef
      ? t('layout.workspace-resource-skill-refs-unique', {
          defaultValue: 'Skill references must be unique.',
        })
      : undefined;
    return (
      <div className="space-y-4">
        <Input
          autoFocus
          title={t('layout.workspace-resource-skill-reference', {
            defaultValue: 'Skill reference',
          })}
          value={editor.item.ref}
          state={refNote ? 'error' : 'default'}
          note={refNote}
          onChange={(event) =>
            onChange({
              ...editor,
              item: { ...editor.item, ref: event.target.value },
            })
          }
        />
        <Input
          title={t('layout.workspace-resource-assign-to-agents', {
            defaultValue: 'Assign to agents',
          })}
          value={editor.item.assignTo.join(', ')}
          placeholder="lead, researcher"
          note={t('layout.workspace-resource-agent-ids-note', {
            defaultValue: 'Use agent ids separated by commas.',
          })}
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
          title={t('layout.workspace-resource-connector-id', {
            defaultValue: 'Connector id',
          })}
          value={editor.item.id}
          onChange={(event) =>
            onChange({
              ...editor,
              item: { ...editor.item, id: event.target.value },
            })
          }
        />
        <Input
          title={t('layout.workspace-resource-connector-label', {
            defaultValue: 'Connector',
          })}
          value={editor.item.connector}
          onChange={(event) =>
            onChange({
              ...editor,
              item: { ...editor.item, connector: event.target.value },
            })
          }
        />
        <Input
          title={t('layout.workspace-resource-connection-slot', {
            defaultValue: 'Connection slot',
          })}
          value={editor.item.connectionSlot}
          onChange={(event) =>
            onChange({
              ...editor,
              item: { ...editor.item, connectionSlot: event.target.value },
            })
          }
        />
        <Input
          title={t('layout.workspace-resource-required-grants', {
            defaultValue: 'Required grants',
          })}
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
          title={t('layout.workspace-resource-mcp-server-id', {
            defaultValue: 'MCP server id',
          })}
          value={editor.item.id}
          onChange={(event) =>
            onChange({
              ...editor,
              item: { ...editor.item, id: event.target.value },
            })
          }
        />
        <Input
          title={t('layout.workspace-resource-definition', {
            defaultValue: 'Definition',
          })}
          value={editor.item.definition}
          onChange={(event) =>
            onChange({
              ...editor,
              item: { ...editor.item, definition: event.target.value },
            })
          }
        />
        <Input
          title={t('layout.workspace-resource-secret-slots', {
            defaultValue: 'Secret slots',
          })}
          value={editor.item.secretSlots.join(', ')}
          placeholder="API_TOKEN"
          note={t('layout.workspace-resource-secret-slots-note', {
            defaultValue: 'Store slot names only. Secret values remain local.',
          })}
          onChange={(event) =>
            onChange({
              ...editor,
              item: { ...editor.item, secretSlots: csv(event.target.value) },
            })
          }
        />
        <Input
          title={t('layout.workspace-resource-assign-to-agents', {
            defaultValue: 'Assign to agents',
          })}
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
  const { t } = useTranslation();
  const reduceMotion = Boolean(useReducedMotion());
  const [contentDirection, setContentDirection] = useState<ContentDirection>(1);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const resourceName = editorName(editor.kind, t);
  const title =
    editor.mode === 'create'
      ? t('layout.workspace-resource-add-title', {
          resourceName,
          defaultValue: 'Add {{resourceName}}',
        })
      : t('layout.workspace-resource-edit-title', {
          resourceName,
          defaultValue: 'Edit {{resourceName}}',
        });
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
        ? t('layout.workspace-resource-saving', { defaultValue: 'Saving…' })
        : saveState === 'saved'
          ? t('layout.workspace-resource-saved', { defaultValue: 'Saved' })
          : saveState === 'needs_attention'
            ? t('layout.workspace-resource-needs-attention', {
                defaultValue: 'Needs attention',
              })
            : t('layout.workspace-resource-local-draft', {
                defaultValue: 'Local draft',
              })
      : t('layout.workspace-resource-not-yet-added', {
          defaultValue: 'Not yet added',
        });
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
      className="pointer-events-auto ml-auto flex max-h-[calc(100dvh-5rem)] min-h-[80dvh] w-full flex-col overflow-hidden rounded-2xl border border-x border-y border-solid border-ds-hairline-subtle-default bg-ds-neutral-subtle-default shadow-xl md:w-1/2 md:min-w-[420px]"
    >
      <header className="flex items-start justify-between gap-4 border-x-0 border-t-0 border-r-0 border-b border-l-0 border-solid border-ds-hairline-subtle-default px-5 py-4">
        <div className="flex min-w-0 items-start gap-2">
          {canGoBack ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              buttonContent="icon-only"
              className="-ml-2 shrink-0"
              aria-label={t('layout.back', { defaultValue: 'Back' })}
              onClick={goBack}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </Button>
          ) : null}
          <div className="min-w-0">
            <span className="block text-ds-text-section font-bold text-ds-ink-default-default">
              {title}
            </span>
            <span className="mt-1 block text-ds-text-meta text-ds-ink-muted-default">
              {editor.step === 'picker'
                ? t('layout.workspace-resource-choose-type-description', {
                    resourceName,
                    defaultValue:
                      'Choose the type of {{resourceName}} to configure.',
                  })
                : editor.mode === 'create'
                  ? t(
                      'layout.workspace-resource-configure-before-adding-description',
                      {
                        resourceName,
                        defaultValue:
                          'Configure this {{resourceName}} before adding it to the Bundle.',
                      }
                    )
                  : t('layout.workspace-resource-autosave-description', {
                      defaultValue:
                        'Changes autosave to the current Space draft.',
                    })}
            </span>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          buttonContent="icon-only"
          aria-label={t('layout.workspace-resource-close-editor', {
            defaultValue: 'Close editor',
          })}
          onClick={onClose}
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </header>

      <div className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-5">
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

      <footer className="border-x-0 border-t border-r-0 border-b-0 border-l-0 border-solid border-ds-hairline-subtle-default px-4 py-2">
        <div className="flex items-center gap-2">
          {editor.mode === 'edit' ? (
            <Button
              type="button"
              variant="ghost"
              tone="error"
              size="sm"
              aria-label={t('layout.workspace-resource-delete-label', {
                resourceName,
                defaultValue: 'Delete {{resourceName}}',
              })}
              onClick={onDelete}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              {t('layout.delete', { defaultValue: 'Delete' })}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={onClose}
          >
            {t('layout.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={!canCommitResourceEditor(editor, document)}
            onClick={editor.mode === 'create' ? onCommit : onClose}
          >
            {t('layout.save', { defaultValue: 'Save' })}
          </Button>
        </div>
        <span className="relative mt-1 block min-h-5 overflow-hidden text-center text-ds-text-meta text-ds-ink-muted-default">
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
