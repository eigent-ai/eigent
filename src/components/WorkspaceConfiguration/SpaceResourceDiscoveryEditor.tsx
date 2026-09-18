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
import { DsText } from '@/components/ui/ds-text';
import { Input } from '@/components/ui/input';
import type { useSpaceSettingsDiscovery } from '@/hooks/useSpaceSettingsDiscovery';
import type {
  SpaceConnectorCandidate,
  SpaceDiscoveryCandidate,
  SpaceMcpCandidate,
} from '@/service/spaceSettingsDiscovery';
import type { WorkspaceConfigurationDocument } from '@/service/workspaceConfigurationApi';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SpaceAssignmentField,
  SpaceDiscoveryField,
} from './SpaceDiscoveryField';
import type { WorkspaceResourceEditorState } from './WorkspaceResourceEditorPanel';

export type SpaceSettingsDiscovery = ReturnType<
  typeof useSpaceSettingsDiscovery
>;
type ResourceEditor = Extract<
  WorkspaceResourceEditorState,
  { kind: 'skill' | 'connector' | 'mcp' }
>;

export function SpaceResourceDiscoveryEditor({
  editor,
  document,
  discovery,
  onChange,
}: {
  editor: ResourceEditor;
  document: WorkspaceConfigurationDocument;
  discovery: SpaceSettingsDiscovery;
  onChange: (editor: WorkspaceResourceEditorState) => void;
}) {
  const { t } = useTranslation();
  const touched = useRef(new Set<string>());
  const derivedSecretSlots = useRef<string[] | null>(null);
  const [suggested, setSuggested] = useState(false);
  const rawCatalog =
    editor.kind === 'skill'
      ? discovery.skills
      : editor.kind === 'mcp'
        ? discovery.mcpServers
        : discovery.connectors;
  const catalog =
    editor.kind === 'mcp'
      ? {
          ...rawCatalog,
          items: (rawCatalog.items as SpaceMcpCandidate[]).filter(
            (candidate) =>
              editor.mode === 'edit'
                ? candidate.id === editor.item.id
                : (!touched.current.has('id') ||
                    candidate.id === editor.item.id) &&
                  !document.spec.mcpServers.some(
                    (server) => server.id === candidate.id
                  )
          ),
        }
      : rawCatalog;
  const primary =
    editor.kind === 'skill'
      ? 'ref'
      : editor.kind === 'mcp'
        ? 'definition'
        : 'connector';
  const value =
    editor.kind === 'skill'
      ? editor.item.ref
      : editor.kind === 'mcp'
        ? editor.item.definition
        : editor.item.connector;
  const edit = (field: string, next: unknown) => {
    touched.current.add(field);
    onChange({
      ...editor,
      item: { ...editor.item, [field]: next },
    } as ResourceEditor);
  };
  const selectCandidate = (
    candidate: SpaceDiscoveryCandidate,
    automatic = false
  ) => {
    let item = {
      ...editor.item,
      [primary]:
        editor.kind === 'mcp'
          ? (candidate as SpaceMcpCandidate).definition
          : candidate.value,
    };
    if (
      editor.kind === 'mcp' &&
      editor.mode === 'create' &&
      !touched.current.has('id')
    ) {
      item = { ...item, id: (candidate as SpaceMcpCandidate).id };
    }
    if (!automatic) touched.current.add(primary);
    if (editor.kind === 'connector') {
      const connector = candidate as SpaceConnectorCandidate;
      if (
        (editor.mode === 'create' ||
          editor.item.connectionSlot === undefined) &&
        !editor.item.connectionSlot &&
        !touched.current.has('connectionSlot')
      ) {
        const base = `${connector.service.replace(/[^A-Za-z0-9_]/g, '_')}_connection`;
        const existing = document.spec.connectors
          .filter((_entry, index) => index !== editor.index)
          .map((entry) => entry.connectionSlot);
        let slot = base;
        for (let suffix = 2; existing.includes(slot); suffix += 1)
          slot = `${base}_${suffix}`;
        item = { ...item, connectionSlot: slot };
      }
      void discovery.connectors.fetchDetails(connector.service);
    }
    if (
      editor.kind === 'mcp' &&
      editor.mode === 'create' &&
      !touched.current.has('secretSlots')
    ) {
      const previous = derivedSecretSlots.current;
      const canDerive =
        previous === null
          ? editor.item.secretSlots.length === 0
          : previous.length === editor.item.secretSlots.length &&
            previous.every(
              (slot, index) => slot === editor.item.secretSlots[index]
            );
      // Keep only values this editor derived in sync with a new candidate.
      // Pre-existing values and edits made outside this field remain owned by
      // their author, even when no local input event marked them as touched.
      if (canDerive) {
        const secretSlots = [...(candidate as SpaceMcpCandidate).secretSlots];
        derivedSecretSlots.current = [...secretSlots];
        item = { ...item, secretSlots };
      }
    }
    setSuggested(automatic);
    onChange({ ...editor, step: 'editor', item } as ResourceEditor);
  };
  // Only one verified resource is evidence for a suggestion. Creation remains a
  // local draft until Save; no discovery callback writes an existing resource.
  useEffect(() => {
    if (
      editor.mode !== 'create' ||
      editor.kind === 'connector' ||
      value ||
      touched.current.has(primary)
    )
      return;
    const candidates = catalog.items.filter(
      (candidate) =>
        candidate.availability === 'available' &&
        (editor.kind !== 'skill' ||
          !document.spec.skills.some((skill) => skill.ref === candidate.value))
    );
    if (candidates.length !== 1) return;
    selectCandidate(candidates[0], true);
    // Candidate arrival is the only automatic trigger; user edits are tracked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog.items]);

  const title =
    editor.kind === 'skill'
      ? t('layout.workspace-resource-skill-reference')
      : editor.kind === 'mcp'
        ? t('layout.workspace-resource-definition')
        : t('layout.workspace-resource-connector-label');
  const selectedConnector =
    editor.kind === 'connector'
      ? discovery.connectors.items.find(
          (candidate) => candidate.service === editor.item.connector
        )
      : undefined;
  return (
    <div
      className="flex min-w-0 flex-col gap-ds-16"
      data-workspace-resource-picker={
        editor.step === 'picker' ? editor.kind : undefined
      }
    >
      {suggested ? (
        <DsText as="p" role="meta" className="text-ds-ink-muted-default">
          {t('layout.space-discovery-draft-prefill')}
        </DsText>
      ) : null}
      {editor.kind !== 'skill' ? (
        <Input
          autoFocus
          aria-label={
            editor.kind === 'mcp'
              ? t('layout.workspace-resource-mcp-server-id')
              : t('layout.workspace-resource-connector-id')
          }
          title={
            editor.kind === 'mcp'
              ? t('layout.workspace-resource-mcp-server-id')
              : t('layout.workspace-resource-connector-id')
          }
          value={editor.item.id}
          onChange={(event) => edit('id', event.target.value)}
        />
      ) : null}
      <SpaceDiscoveryField
        autoFocus={editor.kind === 'skill'}
        title={title}
        value={value}
        selectedValue={
          editor.kind === 'mcp'
            ? JSON.stringify([editor.item.definition, editor.item.id])
            : value
        }
        onChange={(next) => edit(primary, next)}
        catalog={catalog}
        onSelect={selectCandidate}
        note={
          editor.kind === 'connector'
            ? t('layout.space-discovery-connector-note')
            : undefined
        }
        error={
          editor.kind === 'skill' &&
          document.spec.skills.some(
            (skill, index) => index !== editor.index && skill.ref === value
          )
            ? t('layout.workspace-resource-skill-refs-unique')
            : undefined
        }
        {...(editor.kind === 'connector'
          ? {
              query: discovery.connectors.query,
              onQueryChange: discovery.setConnectorQuery,
              hasMore: discovery.connectors.hasMore,
              loadMore: discovery.connectors.loadMore,
              loadingMore: discovery.connectors.loadingMore,
            }
          : {})}
      />
      {editor.kind === 'connector' ? (
        <>
          <Input
            title={t('layout.workspace-resource-connection-slot')}
            aria-label={t('layout.workspace-resource-connection-slot')}
            value={editor.item.connectionSlot}
            onChange={(event) => edit('connectionSlot', event.target.value)}
          />
          <SpaceAssignmentField
            title={t('layout.workspace-resource-required-grants')}
            values={editor.item.requiredGrants}
            options={selectedConnector?.supportedGrants ?? []}
            onChange={(next) => edit('requiredGrants', next)}
          />
          {!selectedConnector?.supportedGrants.length ? (
            <DsText as="p" role="meta" className="text-ds-ink-muted-default">
              {t('layout.space-discovery-grants-empty')}
            </DsText>
          ) : null}
          {discovery.connectors.detailStatus === 'loading' ||
          discovery.connectors.detailError ? (
            <div aria-live="polite">
              <DsText as="p" role="meta" className="text-ds-ink-muted-default">
                {t(
                  discovery.connectors.detailError
                    ? 'layout.space-discovery-error'
                    : 'setting.loading'
                )}
              </DsText>
            </div>
          ) : null}
          {discovery.connectors.detailError ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                void discovery.connectors.fetchDetails(editor.item.connector)
              }
            >
              {t('layout.retry')}
            </Button>
          ) : null}
        </>
      ) : (
        <>
          {editor.kind === 'mcp' ? (
            <SpaceAssignmentField
              title={t('layout.workspace-resource-secret-slots')}
              values={editor.item.secretSlots}
              options={
                (
                  catalog.items.find(
                    (candidate) =>
                      (candidate as SpaceMcpCandidate).definition === value &&
                      (candidate as SpaceMcpCandidate).id === editor.item.id
                  ) as SpaceMcpCandidate | undefined
                )?.secretSlots ?? []
              }
              onChange={(next) => edit('secretSlots', next)}
            />
          ) : null}
          <SpaceAssignmentField
            title={t('layout.workspace-resource-assign-to-agents')}
            values={editor.item.assignTo}
            options={document.spec.agents.map((agent) => agent.id)}
            onChange={(next) => edit('assignTo', next)}
          />
        </>
      )}
      {editor.step === 'picker' ? (
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={() => onChange({ ...editor, step: 'editor' })}
        >
          {t('layout.space-discovery-manual')}
        </Button>
      ) : null}
    </div>
  );
}
