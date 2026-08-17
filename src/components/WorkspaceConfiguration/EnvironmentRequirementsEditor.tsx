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
import { Switch } from '@/components/ui/switch';
import type { WorkspaceEnvironmentVariableRequirement } from '@/service/workspaceConfigurationApi';
import { Plus, Trash2 } from 'lucide-react';

interface EnvironmentRequirementsEditorProps {
  variables: WorkspaceEnvironmentVariableRequirement[];
  onChange: (variables: WorkspaceEnvironmentVariableRequirement[]) => void;
  showAddAction?: boolean;
}

const ENVIRONMENT_VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const nextVariableName = (
  variables: WorkspaceEnvironmentVariableRequirement[]
): string => {
  const names = new Set(variables.map((variable) => variable.name));
  for (let index = 1; ; index += 1) {
    const candidate = `ENV_VAR_${index}`;
    if (!names.has(candidate)) return candidate;
  }
};

export function EnvironmentRequirementsEditor({
  variables,
  onChange,
  showAddAction = true,
}: EnvironmentRequirementsEditorProps) {
  const updateVariable = (
    index: number,
    update: (
      variable: WorkspaceEnvironmentVariableRequirement
    ) => WorkspaceEnvironmentVariableRequirement
  ) => {
    onChange(
      variables.map((variable, variableIndex) =>
        variableIndex === index ? update(variable) : variable
      )
    );
  };

  const nameCounts = variables.reduce<Record<string, number>>(
    (counts, variable) => {
      if (variable.name)
        counts[variable.name] = (counts[variable.name] || 0) + 1;
      return counts;
    },
    {}
  );

  return (
    <div className="w-full divide-y divide-ds-border-neutral-subtle-default">
      {showAddAction ? (
        <div className="flex items-start justify-between gap-4 px-4 py-3">
          <p className="max-w-2xl text-body-xs text-ds-text-neutral-muted-default">
            Declare names and safe documentation only. Secret values, tokens,
            and local environment values are never stored in or shared with a
            Workspace Bundle.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              onChange([
                ...variables,
                {
                  name: nextVariableName(variables),
                  required: true,
                  sensitive: true,
                },
              ])
            }
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add
          </Button>
        </div>
      ) : null}

      {variables.length === 0 ? (
        <div className="px-4 py-6 text-center text-body-sm text-ds-text-neutral-muted-default">
          No environment variables are required.
        </div>
      ) : (
        variables.map((variable, index) => {
          const nameIsValid = ENVIRONMENT_VARIABLE_NAME.test(variable.name);
          const nameIsUnique = nameCounts[variable.name] === 1;
          const nameNote = !nameIsValid
            ? 'Use a portable environment variable name such as API_TOKEN.'
            : !nameIsUnique
              ? 'Variable names must be unique.'
              : undefined;
          const label = variable.name || `variable ${index + 1}`;

          return (
            <div
              key={`${variable.name}-${index}`}
              className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(140px,0.45fr)_minmax(0,1.55fr)]"
            >
              <div className="min-w-0 pt-1">
                <p className="truncate text-body-sm font-bold text-ds-text-neutral-default-default">
                  {label}
                </p>
                <p className="mt-1 text-body-xs text-ds-text-neutral-muted-default">
                  Environment variable
                </p>
              </div>
              <div className="min-w-0 space-y-3">
                <div className="grid items-end gap-2 md:grid-cols-[1fr_2fr_auto]">
                  <Input
                    title="Variable name"
                    value={variable.name}
                    state={nameNote ? 'error' : 'default'}
                    note={nameNote}
                    spellCheck={false}
                    autoCapitalize="none"
                    onChange={(event) =>
                      updateVariable(index, (current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                  />
                  <Input
                    title="Description"
                    optional
                    value={variable.description || ''}
                    placeholder="Why this variable is needed"
                    onChange={(event) =>
                      updateVariable(index, (current) => ({
                        ...current,
                        ...(event.target.value
                          ? { description: event.target.value }
                          : { description: undefined }),
                      }))
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    buttonContent="icon-only"
                    aria-label={`Remove ${label}`}
                    onClick={() =>
                      onChange(
                        variables.filter(
                          (_variable, variableIndex) => variableIndex !== index
                        )
                      )
                    }
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>

                <div className="grid gap-3 md:grid-cols-[auto_auto_1fr] md:items-end">
                  <label className="flex min-h-10 items-center gap-2 text-body-sm font-bold">
                    <Switch
                      size="sm"
                      aria-label={`Required ${label}`}
                      checked={variable.required}
                      onCheckedChange={(required) =>
                        updateVariable(index, (current) => ({
                          ...current,
                          required,
                        }))
                      }
                    />
                    Required
                  </label>
                  <label className="flex min-h-10 items-center gap-2 text-body-sm font-bold">
                    <Switch
                      size="sm"
                      aria-label={`Sensitive ${label}`}
                      checked={variable.sensitive}
                      onCheckedChange={(sensitive) =>
                        updateVariable(index, (current) => {
                          const next = { ...current, sensitive };
                          if (sensitive) delete next.example;
                          return next;
                        })
                      }
                    />
                    Sensitive
                  </label>
                  {variable.sensitive ? (
                    <p className="pb-2 text-body-xs text-ds-text-neutral-muted-default">
                      The recipient will provide this value locally during
                      setup.
                    </p>
                  ) : (
                    <Input
                      title="Safe example"
                      optional
                      value={variable.example || ''}
                      placeholder="development"
                      note="Documentation only. Never paste a credential or real local value."
                      onChange={(event) =>
                        updateVariable(index, (current) => ({
                          ...current,
                          ...(event.target.value
                            ? { example: event.target.value }
                            : { example: undefined }),
                        }))
                      }
                    />
                  )}
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
