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

import { fetchConnectedProviders, providerLabel } from '@/api/connectors';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useHost } from '@/host';
import { ensureScratchSpaceWorkspaceBinding } from '@/lib/scratchSpaceWorkspace';
import {
  approveWorkspaceBundleScript,
  bindWorkspaceBundleConnector,
  bindWorkspaceBundleLocalPath,
  bindWorkspaceBundleLocalValues,
  createWorkspaceBundleInstallProposal,
  decideWorkspaceBundleInstall,
  fetchWorkspaceBundleInstallProposal,
  fetchWorkspaceBundleInstallReview,
  materializeWorkspaceBundle,
  parseWorkspaceBundleHandle,
  workspaceBundleAccountScopeDigest,
  type ParsedWorkspaceBundleHandle,
  type WorkspaceBundleInstallPlan,
  type WorkspaceBundleInstallReview,
  type WorkspaceBundleInstallSnapshot,
  type WorkspaceBundleMcpDestination,
  type WorkspaceBundleValueRequirement,
} from '@/service/workspaceBundleInstallApi';
import { useAuthStore } from '@/store/authStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { openSettings } from '@/store/settingsStore';
import { useSpaceStore } from '@/store/spaceStore';
import {
  Check,
  ExternalLink,
  FolderOpen,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

type RetryMode = 'review' | 'resume' | 'start' | 'materialize' | null;

interface InstallSeed {
  proposalId: string;
  requestId: string;
  spaceId: string;
}

interface ActiveInstall {
  proposalId: string;
  handle: string;
}

const RUNTIME_READINESS_ISSUE_MESSAGES: Readonly<Record<string, string>> = {
  connector_runtime_adapter_unavailable:
    'A required connector cannot run in this Desktop version.',
  mcp_destination_confirmation_required:
    'One or more MCP servers require explicit destination review.',
  multi_agent_runtime_adapter_unavailable:
    'This Bundle requires multi-agent runtime support that is not available.',
  registry_dependencies_unmaterialized:
    'A registry dependency has not been downloaded and pinned locally yet.',
  local_setup_incomplete:
    'Required local values, folders, connections, or approvals are incomplete.',
  workspace_bundle_not_materialized:
    'Workspace files and configuration have not finished installing.',
};

const runtimeReadinessIssueMessage = (issue: string): string => {
  if (issue.startsWith('mcp_secret_stdio_runtime_adapter_unavailable:')) {
    return 'This Desktop version cannot yet safely start this approved secret-backed MCP server.';
  }
  return (
    RUNTIME_READINESS_ISSUE_MESSAGES[issue] ||
    'An additional runtime requirement needs attention.'
  );
};

function RuntimeReadinessStatus({
  status,
  issues,
}: {
  status: WorkspaceBundleInstallSnapshot['runtime_readiness'];
  issues: WorkspaceBundleInstallSnapshot['runtime_readiness_issues'];
}) {
  const visibleIssues = Array.isArray(issues)
    ? Array.from(
        new Set(
          issues
            .filter((issue): issue is string => typeof issue === 'string')
            .map(runtimeReadinessIssueMessage)
        )
      )
    : [];
  const issueList = visibleIssues.length ? (
    <ul className="mt-2 list-inside list-disc text-body-xs">
      {visibleIssues.map((issue, index) => (
        <li key={`${issue}-${index}`}>{issue}</li>
      ))}
    </ul>
  ) : null;

  if (status === 'ready') {
    return (
      <div className="mt-4 rounded-xl bg-ds-bg-success-subtle-default p-3 text-body-sm text-ds-text-success-default-default">
        <p className="font-semibold">Runtime ready</p>
        <p className="mt-1 text-body-xs">
          Brain preflight confirmed this installed configuration can start a
          Run.
        </p>
      </div>
    );
  }
  if (status === 'needs_confirmation') {
    return (
      <div className="mt-4 rounded-xl border border-ds-border-warning-default-default bg-ds-bg-warning-subtle-default p-3 text-body-sm">
        <p className="font-semibold">MCP target review required</p>
        <p className="mt-1 text-body-xs text-ds-text-neutral-muted-default">
          Review and approve each supported MCP destination in Actions and
          readiness below. Unsupported destination types must be removed or
          replaced before a Run can start.
        </p>
        {issueList}
      </div>
    );
  }
  if (status === 'unavailable') {
    return (
      <div className="mt-4 rounded-xl border border-ds-border-error-default-default bg-ds-bg-error-subtle-default p-3 text-body-sm text-ds-text-error-strong-default">
        <p className="font-semibold">Runtime unavailable</p>
        <p className="mt-1 text-body-xs">
          Resolve these runtime preflight issues before starting a Run.
        </p>
        {issueList}
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-xl bg-ds-bg-neutral-subtle-default p-3 text-body-sm">
      <p className="font-semibold">Runtime check unavailable</p>
      <p className="mt-1 text-body-xs text-ds-text-neutral-muted-default">
        Workspace files and local bindings are installed, but runtime readiness
        has not been verified.
      </p>
    </div>
  );
}

const mcpDestinationActionId = (mcpId: string): string =>
  `mcp.server.start:${mcpId}`;

function McpDestinationReview({
  destination,
  approved,
  missingSecretSlots,
  busy,
  onApprove,
}: {
  destination: WorkspaceBundleMcpDestination;
  approved: boolean;
  missingSecretSlots: string[];
  busy: boolean;
  onApprove: () => void;
}) {
  const isStdio = destination.destination_kind.startsWith('stdio');
  const canApprove = Boolean(
    destination.definition_digest &&
    destination.attestation_digest &&
    ((destination.destination_kind === 'stdio' &&
      destination.executable_command) ||
      (destination.destination_kind === 'http' && destination.endpoint_url))
  );
  const secretBindings = destination.secret_environment_bindings ?? [];

  return (
    <div className="rounded-xl border border-ds-border-warning-default-default p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-body-sm font-semibold">{destination.mcp_id}</p>
          <p className="text-body-xs text-ds-text-neutral-muted-default">
            MCP destination · {destination.destination_kind}
          </p>
        </div>
        {approved ? (
          <div className="flex items-center gap-1 text-body-xs text-ds-text-success-default-default">
            <Check className="h-4 w-4" aria-hidden /> Approved
          </div>
        ) : canApprove ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={onApprove}
            disabled={busy || missingSecretSlots.length > 0}
            aria-label={`Approve ${destination.mcp_id} MCP destination`}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Approve
          </Button>
        ) : null}
      </div>

      <dl className="mt-3 grid gap-3 text-body-xs">
        {isStdio ? (
          <div>
            <dt className="font-semibold">Command and arguments</dt>
            <dd className="mt-1 break-all rounded-lg bg-ds-bg-neutral-subtle-default p-2 font-mono">
              <span>{destination.executable_command || 'Unavailable'}</span>
              {destination.argument_preview.map((argument, index) => (
                <span key={`${argument}-${index}`} className="ml-2">
                  {argument}
                </span>
              ))}
            </dd>
          </div>
        ) : (
          <div>
            <dt className="font-semibold">Endpoint</dt>
            <dd className="mt-1 break-all font-mono">
              {destination.endpoint_url || 'Not provided'}
            </dd>
          </div>
        )}
        <div>
          <dt className="font-semibold">Working directory scope</dt>
          <dd className="mt-1 break-all font-mono">
            {destination.cwd_scope || 'Workspace default'}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Definition</dt>
          <dd className="mt-1 break-all font-mono">
            {destination.definition_ref}
          </dd>
          <dd className="mt-1 break-all font-mono text-ds-text-neutral-muted-default">
            SHA-256: {destination.definition_digest || 'Unavailable'}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Destination attestation</dt>
          <dd className="mt-1 break-all font-mono">
            {destination.attestation_digest || 'Unavailable'}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Local secrets sent to this MCP</dt>
          <dd className="mt-1">
            {secretBindings.length ? (
              <ul className="space-y-1">
                {secretBindings.map((binding) => (
                  <li
                    key={`${binding.slot_id}:${binding.environment_variable}`}
                  >
                    <code>{binding.slot_id}</code>
                    <span aria-hidden> → </span>
                    <code>{binding.environment_variable}</code>
                  </li>
                ))}
              </ul>
            ) : destination.secret_slots.length ? (
              <ul className="list-inside list-disc">
                {destination.secret_slots.map((slot) => (
                  <li key={slot}>
                    <code>{slot}</code>
                  </li>
                ))}
              </ul>
            ) : (
              'None'
            )}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Public environment sent to this MCP</dt>
          <dd className="mt-1">
            {destination.public_environment.length ? (
              <div
                role="region"
                aria-label={`Public environment for ${destination.mcp_id}`}
                className="max-h-32 overflow-y-auto rounded-lg bg-ds-bg-neutral-subtle-default p-2"
              >
                <ul className="space-y-1">
                  {destination.public_environment.map((item, index) => (
                    <li key={`${item.name}-${index}`} className="break-all">
                      <code>{item.name}</code>
                      <span aria-hidden> · </span>
                      <code>SHA-256 {item.value_digest}</code>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              'None'
            )}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Public headers sent to this MCP</dt>
          <dd className="mt-1">
            {destination.public_headers.length ? (
              <div
                role="region"
                aria-label={`Public headers for ${destination.mcp_id}`}
                className="max-h-32 overflow-y-auto rounded-lg bg-ds-bg-neutral-subtle-default p-2"
              >
                <ul className="space-y-1">
                  {destination.public_headers.map((item, index) => (
                    <li key={`${item.name}-${index}`} className="break-all">
                      <code>{item.name}</code>
                      <span aria-hidden> · </span>
                      <code>SHA-256 {item.value_digest}</code>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              'None'
            )}
          </dd>
        </div>
      </dl>

      {!approved && canApprove && missingSecretSlots.length > 0 ? (
        <p className="mt-3 rounded-lg bg-ds-bg-warning-subtle-default p-2 text-body-xs">
          Add the required local secrets before approving:{' '}
          {missingSecretSlots.join(', ')}.
        </p>
      ) : null}

      {!approved && !canApprove ? (
        <p className="mt-3 rounded-lg bg-ds-bg-error-subtle-default p-2 text-body-xs text-ds-text-error-strong-default">
          {destination.destination_kind === 'stdio_unstable'
            ? 'This MCP executable is not pinned to a reviewed Bundle asset and cannot be approved or started.'
            : destination.destination_kind === 'http_secret_unavailable'
              ? 'Secret-backed HTTP or header MCP destinations are not supported in this version. This destination cannot be approved or started.'
              : 'This MCP definition is unavailable and cannot be approved or started.'}
        </p>
      ) : null}
    </div>
  );
}

const installSeedKey = (revisionId: string, actorId: string): string =>
  `eigent:workspace-bundle-install-seed:v1:${actorId}:${revisionId}`;

function readInstallSeed(
  revisionId: string,
  actorId: string
): InstallSeed | null {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(installSeedKey(revisionId, actorId)) || 'null'
    ) as Partial<InstallSeed> | null;
    if (
      !value ||
      !/^bundleinstall_[a-f0-9]{32}$/u.test(value.proposalId || '') ||
      !/^bundlerequest_[a-f0-9]{32}$/u.test(value.requestId || '') ||
      typeof value.spaceId !== 'string' ||
      !value.spaceId
    ) {
      return null;
    }
    return value as InstallSeed;
  } catch {
    return null;
  }
}

function writeInstallSeed(
  revisionId: string,
  actorId: string,
  seed: InstallSeed
): void {
  window.localStorage.setItem(
    installSeedKey(revisionId, actorId),
    JSON.stringify(seed)
  );
}

function clearInstallSeed(revisionId: string, actorId: string): void {
  window.localStorage.removeItem(installSeedKey(revisionId, actorId));
}

const activeInstallKey = (actorId: string): string =>
  `eigent:workspace-bundle-active-install:v1:${actorId}`;

function readActiveInstall(actorId: string): ActiveInstall | null {
  if (!actorId) return null;
  try {
    const value = JSON.parse(
      window.localStorage.getItem(activeInstallKey(actorId)) || 'null'
    ) as Partial<ActiveInstall> | null;
    if (
      !value ||
      typeof value.proposalId !== 'string' ||
      typeof value.handle !== 'string' ||
      !parseWorkspaceBundleHandle(value.handle)
    ) {
      return null;
    }
    return value as ActiveInstall;
  } catch {
    return null;
  }
}

function writeActiveInstall(actorId: string, install: ActiveInstall): void {
  if (!actorId) return;
  window.localStorage.setItem(
    activeInstallKey(actorId),
    JSON.stringify(install)
  );
}

function clearActiveInstall(actorId: string): void {
  if (!actorId) return;
  window.localStorage.removeItem(activeInstallKey(actorId));
}

const errorMessage = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : 'The installation could not continue.';

const newInstallId = (prefix: string): string =>
  `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;

function requirementLabel(item: WorkspaceBundleValueRequirement): string {
  if (item.requirement_kind === 'environment') {
    return item.name || item.requirement_key.replace(/^environment:/, '');
  }
  return (
    item.slot_id ||
    item.requirement_key.split(':').at(-1) ||
    item.requirement_key
  );
}

function LocalValueRow({
  item,
  busy,
  onSave,
}: {
  item: WorkspaceBundleValueRequirement;
  busy: boolean;
  onSave: (value: string) => Promise<boolean>;
}) {
  return (
    <form
      className="rounded-xl border border-ds-border-neutral-subtle-default p-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const value = new FormData(form).get('local-value');
        if (typeof value !== 'string' || !value) return;
        void onSave(value).then((saved) => {
          if (saved) form.reset();
        });
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-body-sm font-semibold">
            {requirementLabel(item)}
          </p>
          <p className="mt-1 text-body-xs text-ds-text-neutral-muted-default">
            {item.requirement_kind === 'mcp_secret'
              ? `Secret for ${item.mcp_id || 'MCP server'}`
              : item.description || 'Local environment value'}
            {' · '}
            {item.required ? 'Required' : 'Optional'}
          </p>
        </div>
        {item.configured && item.available ? (
          <span className="inline-flex items-center gap-1 text-body-xs font-semibold text-ds-text-success-default-default">
            <Check className="h-3.5 w-3.5" aria-hidden /> Stored locally
          </span>
        ) : null}
      </div>
      {item.configured && !item.available ? (
        <p className="mt-2 text-body-xs font-semibold text-ds-text-warning-default-default">
          The previous local value is unavailable. Re-enter it to repair this
          binding.
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <Input
          name="local-value"
          type="password"
          autoComplete="off"
          placeholder={
            item.configured && item.available
              ? 'Enter a replacement value'
              : item.example || 'Enter a value stored only on this device'
          }
          aria-label={`Local value for ${requirementLabel(item)}`}
          required={item.required}
        />
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : item.configured && item.available ? (
            'Replace'
          ) : (
            'Save'
          )}
        </Button>
      </div>
    </form>
  );
}

export interface WorkspaceBundleInstallWizardProps {
  initialHandle?: string;
  initialProposalId?: string;
  showHeader?: boolean;
  onProposalChange?: (proposalId: string | null, handle: string | null) => void;
  onWorkspaceOpen?: () => void;
}

export function WorkspaceBundleInstallWizard({
  initialHandle = '',
  initialProposalId = '',
  showHeader = true,
  onProposalChange,
  onWorkspaceOpen,
}: WorkspaceBundleInstallWizardProps) {
  const navigate = useNavigate();
  const host = useHost();
  const email = useAuthStore((state) => state.email);
  const userId = useAuthStore((state) => state.user_id);
  const actorId = String(userId ?? email ?? '');
  const createSpaceOnServer = useSpaceStore(
    (state) => state.createSpaceOnServer
  );
  const deleteSpaceOnServer = useSpaceStore(
    (state) => state.deleteSpaceOnServer
  );
  const setActiveSpace = useSpaceStore((state) => state.setActiveSpace);
  const projectStore = useProjectRuntimeStore();
  const setActiveWorkspaceTab = usePageTabStore(
    (state) => state.setActiveWorkspaceTab
  );

  const [handleInput, setHandleInput] = useState(initialHandle);
  const [handle, setHandle] = useState<ParsedWorkspaceBundleHandle | null>(
    null
  );
  const [review, setReview] = useState<WorkspaceBundleInstallReview | null>(
    null
  );
  const [snapshot, setSnapshot] =
    useState<WorkspaceBundleInstallSnapshot | null>(null);
  const [connectedProviders, setConnectedProviders] = useState<
    Awaited<ReturnType<typeof fetchConnectedProviders>>
  >([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryMode, setRetryMode] = useState<RetryMode>(null);
  const [installSeed, setInstallSeed] = useState<InstallSeed | null>(null);
  const requestedProposalIdRef = useRef('');
  const requestedHandleRef = useRef('');

  const proposal = snapshot?.proposal;
  const mcpDestinations = useMemo(
    () => proposal?.install_plan.mcp_destinations ?? [],
    [proposal]
  );
  const mcpDestinationActionIds = useMemo(
    () =>
      new Set(
        mcpDestinations.map((destination) =>
          mcpDestinationActionId(destination.mcp_id)
        )
      ),
    [mcpDestinations]
  );
  const configuredSlots = useMemo(
    () =>
      new Set(
        snapshot?.bindings
          .filter((item) => item.current !== false)
          .map((item) => item.slot_id) ?? []
      ),
    [snapshot]
  );
  const reviewedSetup = useMemo(() => {
    const spec = review?.revision.manifest.spec;
    if (!spec) return [];
    return [
      ...(spec.environment?.variables.map(
        (item) =>
          `${item.required ? 'Required' : 'Optional'} value: ${item.name}`
      ) ?? []),
      ...spec.mcpServers.flatMap((server) =>
        server.secretSlots.map((slot) => `Local secret: ${server.id} / ${slot}`)
      ),
      ...spec.context
        .filter((source) => source.kind === 'local_path_slot' && source.slot)
        .map((source) => `Local folder: ${source.slot}`),
      ...spec.connectors.map(
        (connector) =>
          `Connection: ${connector.connector} (${connector.connectionSlot})`
      ),
      ...spec.mcpServers.map(
        (server) => `Approve local MCP start: ${server.id}`
      ),
      ...spec.skills
        .filter((skill) => skill.ref.startsWith('bundle://'))
        .map((skill) => `Approve bundled skill code: ${skill.ref}`),
    ];
  }, [review]);

  const loadReview = useCallback(
    async (rawHandle: string) => {
      const parsed = parseWorkspaceBundleHandle(rawHandle);
      if (!parsed) {
        setError('Use a published handle such as @user-7/my-workspace@1.');
        setRetryMode(null);
        return;
      }
      setBusyKey('review');
      setError(null);
      try {
        const next = await fetchWorkspaceBundleInstallReview(parsed);
        setHandle(parsed);
        setReview(next);
        setInstallSeed(readInstallSeed(parsed.coordinate, actorId));
        requestedHandleRef.current = parsed.coordinate;
        writeActiveInstall(actorId, {
          proposalId: '',
          handle: parsed.coordinate,
        });
        onProposalChange?.(null, parsed.coordinate);
        setRetryMode(null);
      } catch (nextError) {
        setError(errorMessage(nextError));
        setRetryMode('review');
      } finally {
        setBusyKey(null);
      }
    },
    [actorId, onProposalChange]
  );

  const resumeProposal = useCallback(async (proposalId: string) => {
    setBusyKey('resume');
    setError(null);
    try {
      const next = await fetchWorkspaceBundleInstallProposal(proposalId);
      setSnapshot(next);
      setHandle(
        parseWorkspaceBundleHandle(
          next.proposal.install_plan.public_coordinate || ''
        )
      );
      setRetryMode(null);
    } catch (nextError) {
      setError(errorMessage(nextError));
      setRetryMode('resume');
    } finally {
      setBusyKey(null);
    }
  }, []);

  useEffect(() => {
    if (initialProposalId) {
      if (requestedProposalIdRef.current === initialProposalId) return;
      requestedProposalIdRef.current = initialProposalId;
      void resumeProposal(initialProposalId);
      return;
    }
    if (initialHandle) {
      if (requestedHandleRef.current === initialHandle) return;
      requestedHandleRef.current = initialHandle;
      void loadReview(initialHandle);
      return;
    }
    const activeInstall = readActiveInstall(actorId);
    if (activeInstall) {
      requestedProposalIdRef.current = activeInstall.proposalId;
      requestedHandleRef.current = activeInstall.handle;
      setHandleInput(activeInstall.handle);
      onProposalChange?.(activeInstall.proposalId, activeInstall.handle);
      if (activeInstall.proposalId) {
        void resumeProposal(activeInstall.proposalId);
      } else {
        void loadReview(activeInstall.handle);
      }
    }
  }, [
    actorId,
    initialHandle,
    initialProposalId,
    loadReview,
    onProposalChange,
    resumeProposal,
  ]);

  useEffect(() => {
    if (
      !proposal ||
      !['approved', 'needs_attention', 'materialized'].includes(proposal.state)
    ) {
      return;
    }
    void fetchConnectedProviders()
      .then(setConnectedProviders)
      .catch(() => setConnectedProviders([]));
  }, [proposal]);

  const startInstall = useCallback(async () => {
    if (!review || !handle || !email || !actorId) return;
    setBusyKey('start');
    setError(null);
    try {
      let seed = installSeed;
      if (!seed) {
        const proposalId = newInstallId('bundleinstall');
        const requestId = newInstallId('bundlerequest');
        const name =
          review.bundle?.name ||
          review.revision.manifest.metadata.name ||
          'Imported workspace';
        const spaceId = await createSpaceOnServer({
          name,
          sourceType: 'blank',
          setActive: false,
          metadata: {
            createdFrom: 'workspace_bundle_install',
            bundleRevision: handle.coordinate,
            bundleInstallProposalId: proposalId,
            bundleInstallRequestId: requestId,
          },
        });
        seed = { proposalId, requestId, spaceId };
        setInstallSeed(seed);
        try {
          writeInstallSeed(handle.coordinate, actorId, seed);
        } catch {
          setInstallSeed(null);
          await deleteSpaceOnServer(spaceId).catch(() => undefined);
          throw new Error(
            'Eigent could not save the recoverable installation intent.'
          );
        }
        const space = useSpaceStore.getState().getSpaceById(spaceId);
        const root = await ensureScratchSpaceWorkspaceBinding({
          email,
          userId,
          space,
        });
        if (!root) {
          clearInstallSeed(handle.coordinate, actorId);
          setInstallSeed(null);
          await deleteSpaceOnServer(spaceId).catch(() => undefined);
          throw new Error(
            'Eigent could not create the local Workspace folder.'
          );
        }
      }
      const proposed = await createWorkspaceBundleInstallProposal({
        proposalId: seed.proposalId,
        requestId: seed.requestId,
        spaceId: seed.spaceId,
        publisherNamespace: handle.publisherNamespace,
        slug: handle.slug,
        version: handle.version,
      });
      clearInstallSeed(handle.coordinate, actorId);
      requestedProposalIdRef.current = seed.proposalId;
      writeActiveInstall(actorId, {
        proposalId: seed.proposalId,
        handle: handle.coordinate,
      });
      onProposalChange?.(seed.proposalId, handle.coordinate);
      // Persisting the proposal is not user consent. Keep the installation in
      // `proposed` until the review card below receives a separate click.
      setSnapshot(proposed);
      setRetryMode(null);
    } catch (nextError) {
      setError(errorMessage(nextError));
      setRetryMode('start');
    } finally {
      setBusyKey(null);
    }
  }, [
    actorId,
    createSpaceOnServer,
    deleteSpaceOnServer,
    email,
    handle,
    installSeed,
    onProposalChange,
    review,
    userId,
  ]);

  const storeLocalValue = useCallback(
    async (item: WorkspaceBundleValueRequirement, value: string) => {
      if (!proposal || !host?.electronAPI?.workspaceSecretPut || !actorId) {
        setError('Secure local value storage is unavailable.');
        return false;
      }
      setBusyKey(item.requirement_key);
      setError(null);
      let storedSecretRef: string | null = null;
      let accountScopeDigest: string | null = null;
      try {
        accountScopeDigest = await workspaceBundleAccountScopeDigest(actorId);
        const stored = await host.electronAPI.workspaceSecretPut({
          account_scope_digest: accountScopeDigest,
          space_id: proposal.space_id,
          revision_id: proposal.revision_id,
          slot_id: item.requirement_key,
          value,
        });
        storedSecretRef = stored.secret_ref;
        const next = await bindWorkspaceBundleLocalValues({
          proposalId: proposal.proposal_id,
          clientRequestId: `local-value:${proposal.proposal_id}:${crypto.randomUUID()}`,
          expectedVersion: proposal.version,
          actorId,
          bindings: [
            {
              requirement_key: item.requirement_key,
              requirement_kind: item.requirement_kind,
              secret_ref: stored.secret_ref,
              account_scope_digest: accountScopeDigest,
              expected_binding_version: item.binding_version,
            },
          ],
        });
        setSnapshot(next);
        await Promise.allSettled(
          (next.cleanup_secret_refs ?? []).map((secretRef) =>
            host.electronAPI.workspaceSecretDelete({
              secret_ref: secretRef,
              account_scope_digest: accountScopeDigest,
              space_id: proposal.space_id,
              revision_id: proposal.revision_id,
              slot_id: item.requirement_key,
            })
          )
        );
        return true;
      } catch (nextError) {
        setError(errorMessage(nextError));
        let bindingWasCommitted = false;
        try {
          const recovered = await fetchWorkspaceBundleInstallProposal(
            proposal.proposal_id
          );
          setSnapshot(recovered);
          const requirement = recovered.value_requirements.find(
            (candidate) =>
              candidate.requirement_key === item.requirement_key &&
              candidate.requirement_kind === item.requirement_kind
          );
          bindingWasCommitted = Boolean(
            requirement?.configured &&
            requirement.available &&
            (requirement.binding_version ?? 0) > (item.binding_version ?? 0)
          );
        } catch {
          // Preserve the binding failure. Reopening Local setup will replay
          // the durable proposal if the response was lost after commit.
        }
        if (
          storedSecretRef &&
          accountScopeDigest &&
          !bindingWasCommitted &&
          host.electronAPI.workspaceSecretDelete
        ) {
          await Promise.resolve(
            host.electronAPI.workspaceSecretDelete({
              secret_ref: storedSecretRef,
              account_scope_digest: accountScopeDigest,
              space_id: proposal.space_id,
              revision_id: proposal.revision_id,
              slot_id: item.requirement_key,
            })
          ).catch(() => undefined);
        }
        return false;
      } finally {
        setBusyKey(null);
      }
    },
    [actorId, host, proposal]
  );

  const bindPath = useCallback(
    async (slotId: string) => {
      if (!proposal || !host?.electronAPI?.selectFile || !actorId) return;
      const selected = await host.electronAPI.selectFile({
        properties: ['openDirectory'],
      });
      const localPath = selected?.files?.[0]?.filePath;
      if (!selected?.success || !localPath) return;
      setBusyKey(slotId);
      setError(null);
      try {
        setSnapshot(
          await bindWorkspaceBundleLocalPath({
            proposalId: proposal.proposal_id,
            expectedVersion: proposal.version,
            slotId,
            localPath,
            actorId,
          })
        );
      } catch (nextError) {
        setError(errorMessage(nextError));
      } finally {
        setBusyKey(null);
      }
    },
    [actorId, host, proposal]
  );

  const bindConnector = useCallback(
    async (slot: WorkspaceBundleInstallPlan['connector_slots'][number]) => {
      if (!proposal || !actorId) return;
      const provider = connectedProviders.find(
        (item) => item.service.toLowerCase() === slot.connector_id.toLowerCase()
      );
      const connectionId =
        provider?.connection?.id || provider?.connection?.connectionName;
      if (!connectionId) {
        setError(`Connect ${slot.connector_id} before binding this slot.`);
        return;
      }
      setBusyKey(slot.slot_id);
      setError(null);
      try {
        setSnapshot(
          await bindWorkspaceBundleConnector({
            proposalId: proposal.proposal_id,
            expectedVersion: proposal.version,
            slotId: slot.slot_id,
            connectorId: slot.connector_id,
            connectionId,
            actorId,
          })
        );
      } catch (nextError) {
        setError(errorMessage(nextError));
      } finally {
        setBusyKey(null);
      }
    },
    [actorId, connectedProviders, proposal]
  );

  const approveScript = useCallback(
    async (actionId: string) => {
      if (!proposal || !actorId) return;
      setBusyKey(actionId);
      setError(null);
      try {
        setSnapshot(
          await approveWorkspaceBundleScript({
            proposalId: proposal.proposal_id,
            expectedVersion: proposal.version,
            actionId,
            actorId,
          })
        );
      } catch (nextError) {
        setError(errorMessage(nextError));
      } finally {
        setBusyKey(null);
      }
    },
    [actorId, proposal]
  );

  const continueApproval = useCallback(async () => {
    if (!proposal || proposal.state !== 'proposed' || !actorId) return;
    setBusyKey('approval');
    setError(null);
    try {
      setSnapshot(
        await decideWorkspaceBundleInstall({
          proposalId: proposal.proposal_id,
          expectedVersion: proposal.version,
          approved: true,
          actorId,
        })
      );
      setRetryMode(null);
    } catch (nextError) {
      setError(errorMessage(nextError));
      setRetryMode('resume');
    } finally {
      setBusyKey(null);
    }
  }, [actorId, proposal]);

  const materialize = useCallback(async () => {
    if (!proposal || !email || !actorId) return;
    setBusyKey('materialize');
    setError(null);
    try {
      setSnapshot(
        await materializeWorkspaceBundle({
          proposalId: proposal.proposal_id,
          expectedVersion: proposal.version,
          email,
          userId,
          actorId,
        })
      );
      setRetryMode(null);
    } catch (nextError) {
      const message = errorMessage(nextError);
      setError(message);
      setRetryMode('materialize');
      try {
        setSnapshot(
          await fetchWorkspaceBundleInstallProposal(proposal.proposal_id)
        );
      } catch {
        // Preserve the materialization failure as the actionable error.
      }
    } finally {
      setBusyKey(null);
    }
  }, [actorId, email, proposal, userId]);

  const openWorkspace = () => {
    if (!proposal) return;
    setActiveSpace(proposal.space_id);
    projectStore.setActiveProject(null);
    setActiveWorkspaceTab('workforce');
    clearActiveInstall(actorId);
    onWorkspaceOpen?.();
    navigate('/');
  };

  const retry = () => {
    if (retryMode === 'review') void loadReview(handleInput);
    if (retryMode === 'resume' && initialProposalId)
      void resumeProposal(initialProposalId);
    if (retryMode === 'start') void startInstall();
    if (retryMode === 'materialize') void materialize();
  };

  const resetInstall = () => {
    setHandleInput('');
    setHandle(null);
    setReview(null);
    setSnapshot(null);
    setError(null);
    setRetryMode(null);
    setInstallSeed(null);
    clearActiveInstall(actorId);
    onProposalChange?.(null, null);
  };

  if (proposal?.state === 'rejected') {
    return (
      <Card className="mx-auto w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Installation cancelled</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-body-sm text-ds-text-neutral-muted-default">
            This durable proposal was rejected and cannot be reused.
          </p>
          <Button className="mt-5" variant="secondary" onClick={resetInstall}>
            Import another Bundle
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      {showHeader ? (
        <header>
          <h1 className="text-heading-2xl font-semibold">
            Install Workspace Bundle
          </h1>
          <p className="mt-2 text-body-sm text-ds-text-neutral-muted-default">
            Review what the workspace environment can access, then configure
            required values and connections locally.
          </p>
        </header>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-ds-border-error-default-default bg-ds-bg-error-subtle-default p-4 text-body-sm text-ds-text-error-strong-default">
          <p>{error}</p>
          {retryMode === 'start' && installSeed ? (
            <p className="mt-2 text-ds-text-neutral-muted-default">
              The inactive Workspace draft was kept for recovery. Retry reuses
              the same draft and does not create another Workspace.
            </p>
          ) : null}
          {retryMode ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={retry}
            >
              <RefreshCw className="h-4 w-4" aria-hidden /> Retry
            </Button>
          ) : null}
        </div>
      ) : null}

      {!review && !snapshot ? (
        <Card>
          <CardHeader>
            <CardTitle>Import by share handle</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void loadReview(handleInput);
              }}
            >
              <Input
                value={handleInput}
                onChange={(event) => setHandleInput(event.target.value)}
                placeholder="@verified-publisher/research-workspace@1"
                aria-label="Workspace Bundle share handle"
              />
              <Button type="submit" disabled={busyKey === 'review'}>
                {busyKey === 'review' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Review'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {review && !snapshot ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {review.bundle?.name || review.revision.manifest.metadata.name}
            </CardTitle>
            <p className="font-mono text-body-xs text-ds-text-neutral-muted-default">
              {review.revision.id}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-ds-bg-neutral-subtle-default p-3 text-body-sm">
                <strong>Permission profile</strong>
                <p className="mt-1">
                  {review.revision.manifest.spec.permissions.profile}
                </p>
              </div>
              <div className="rounded-xl bg-ds-bg-neutral-subtle-default p-3 text-body-sm">
                <strong>Assets</strong>
                <p className="mt-1">
                  {review.revision.assets.length} verified files
                </p>
              </div>
              <div className="rounded-xl bg-ds-bg-neutral-subtle-default p-3 text-body-sm">
                <strong>Connectors</strong>
                <p className="mt-1">
                  {review.revision.manifest.spec.connectors.length} requested
                </p>
              </div>
              <div className="rounded-xl bg-ds-bg-neutral-subtle-default p-3 text-body-sm">
                <strong>Local requirements</strong>
                <p className="mt-1">
                  {(review.revision.manifest.spec.environment?.variables
                    .length || 0) +
                    review.revision.manifest.spec.mcpServers.reduce(
                      (total, item) => total + item.secretSlots.length,
                      0
                    )}{' '}
                  values
                </p>
              </div>
            </div>
            {reviewedSetup.length > 0 ? (
              <section className="rounded-xl border border-ds-border-neutral-subtle-default p-3">
                <p className="text-body-sm font-semibold">
                  Required local setup and actions
                </p>
                <ul className="mt-2 list-inside list-disc space-y-1 text-body-xs text-ds-text-neutral-muted-default">
                  {reviewedSetup.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            ) : null}
            {review.revision.manifest.spec.connectors.map((connector) => (
              <div
                key={connector.connectionSlot}
                className="rounded-xl border border-ds-border-neutral-subtle-default p-3"
              >
                <p className="text-body-sm font-semibold">
                  {connector.connector}
                </p>
                <p className="mt-1 text-body-xs text-ds-text-neutral-muted-default">
                  Grants:{' '}
                  {connector.requiredGrants.join(', ') ||
                    'No additional grants declared'}
                </p>
              </div>
            ))}
            <details className="rounded-xl border border-ds-border-neutral-subtle-default p-3">
              <summary className="cursor-pointer text-body-sm font-semibold">
                Inspect manifest and verified assets
              </summary>
              <div className="mt-3 space-y-3 text-body-xs">
                <p className="break-all font-mono text-ds-text-neutral-muted-default">
                  Manifest SHA-256: {review.revision.manifest_digest}
                </p>
                {review.revision.assets.length > 0 ? (
                  <ul className="max-h-48 space-y-2 overflow-y-auto rounded-lg bg-ds-bg-neutral-subtle-default p-3">
                    {review.revision.assets.map((asset) => (
                      <li key={asset.id}>
                        <p className="break-all font-mono">
                          {asset.logical_path}
                        </p>
                        <p className="break-all text-ds-text-neutral-muted-default">
                          SHA-256 {asset.content_digest} · {asset.size_bytes}{' '}
                          bytes
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-ds-text-neutral-muted-default">
                    No packaged assets.
                  </p>
                )}
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-ds-bg-neutral-subtle-default p-3 font-mono">
                  {JSON.stringify(review.revision.manifest, null, 2)}
                </pre>
              </div>
            </details>
            <div className="rounded-xl border border-ds-border-success-default-default bg-ds-bg-success-subtle-default p-3 text-body-sm">
              <p className="flex items-center gap-2 font-semibold">
                <ShieldCheck className="h-4 w-4" aria-hidden /> Secrets are not
                part of this Bundle
              </p>
              <p className="mt-1 text-body-xs text-ds-text-neutral-muted-default">
                Required values are collected only after approval and stored
                using the operating system encryption service.
              </p>
            </div>
            <Button
              onClick={() => void startInstall()}
              disabled={busyKey === 'start' || !email}
            >
              {busyKey === 'start' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Confirm and create Workspace'
              )}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {snapshot && proposal ? (
        <>
          {proposal.state === 'materialized' ? (
            <Card>
              <CardHeader>
                <CardTitle>Workspace files installed</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-body-sm text-ds-text-neutral-muted-default">
                  {proposal.revision_id} is installed. Local bindings are
                  encrypted on this device and can be repaired or replaced
                  below. They are not exposed globally to unrelated tools.
                </p>
                <RuntimeReadinessStatus
                  status={snapshot.runtime_readiness}
                  issues={snapshot.runtime_readiness_issues}
                />
                <Button className="mt-4" onClick={openWorkspace}>
                  Open Workspace
                </Button>
              </CardContent>
            </Card>
          ) : null}
          {proposal.state === 'proposed' ? (
            <Card>
              <CardHeader>
                <CardTitle>Review and approve this installation</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-body-sm text-ds-text-neutral-muted-default">
                  The proposal is saved, but nothing has been approved or
                  materialized yet. Review every local capability before
                  continuing.
                </p>
                <div className="rounded-xl border border-ds-border-neutral-subtle-default p-3 text-body-sm">
                  <p>
                    Permission profile:{' '}
                    <span className="font-mono">
                      {proposal.install_plan.permission_profile}
                    </span>
                  </p>
                  <p>
                    Assets: {proposal.install_plan.asset_count} ·{' '}
                    {proposal.install_plan.asset_bytes} bytes
                  </p>
                  {proposal.install_plan.connector_slots.map((slot) => (
                    <p key={slot.slot_id}>
                      Connector {slot.connector_id}: grants{' '}
                      {slot.required_grants.join(', ') || 'none'}
                    </p>
                  ))}
                  {proposal.install_plan.local_path_slots.map((slotId) => (
                    <p key={slotId}>Local folder access: {slotId}</p>
                  ))}
                  {proposal.install_plan.script_actions.map((actionId) => (
                    <p
                      key={actionId}
                      className="text-ds-text-warning-default-default"
                    >
                      Executable action: {actionId}
                    </p>
                  ))}
                  {(proposal.install_plan.mcp_destinations || []).map(
                    (destination) => (
                      <div
                        key={destination.mcp_id}
                        className="mt-2 rounded-lg bg-ds-bg-neutral-subtle-default p-2"
                      >
                        <p className="font-semibold">
                          MCP: {destination.mcp_id}
                        </p>
                        {destination.executable_command ? (
                          <p className="break-all font-mono">
                            {destination.executable_command}{' '}
                            {destination.argument_preview.join(' ')}
                          </p>
                        ) : null}
                        {destination.endpoint_url ? (
                          <p className="break-all font-mono">
                            {destination.endpoint_url}
                          </p>
                        ) : null}
                      </div>
                    )
                  )}
                </div>
                <Button
                  onClick={() => void continueApproval()}
                  disabled={busyKey === 'approval'}
                >
                  {busyKey === 'approval' ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : null}
                  Approve installation
                </Button>
              </CardContent>
            </Card>
          ) : null}
          {proposal.state === 'materializing' ? (
            <Card>
              <CardHeader>
                <CardTitle>Checking installation progress</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-body-sm text-ds-text-neutral-muted-default">
                  The previous materialization was interrupted. Refresh the
                  durable proposal before retrying.
                </p>
                <Button
                  className="mt-4"
                  variant="secondary"
                  onClick={() => void resumeProposal(proposal.proposal_id)}
                  disabled={busyKey === 'resume'}
                >
                  <RefreshCw className="h-4 w-4" aria-hidden /> Refresh
                </Button>
              </CardContent>
            </Card>
          ) : null}
          {['approved', 'needs_attention', 'materialized'].includes(
            proposal.state
          ) ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>1. Local values</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {snapshot.value_requirements.length === 0 ? (
                    <p className="text-body-sm text-ds-text-neutral-muted-default">
                      No local values required.
                    </p>
                  ) : (
                    snapshot.value_requirements.map((item) => (
                      <LocalValueRow
                        key={item.requirement_key}
                        item={item}
                        busy={busyKey === item.requirement_key}
                        onSave={(value) => storeLocalValue(item, value)}
                      />
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>2. Local folders and connections</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {proposal.install_plan.local_path_slots.map((slotId) => (
                    <div
                      key={slotId}
                      className="flex items-center justify-between gap-3 rounded-xl border border-ds-border-neutral-subtle-default p-3"
                    >
                      <div>
                        <p className="font-mono text-body-sm">{slotId}</p>
                        <p className="text-body-xs text-ds-text-neutral-muted-default">
                          Local folder access
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void bindPath(slotId)}
                        disabled={busyKey === slotId}
                      >
                        <FolderOpen className="h-4 w-4" />
                        {configuredSlots.has(slotId)
                          ? 'Change folder'
                          : 'Choose folder'}
                      </Button>
                    </div>
                  ))}
                  {proposal.install_plan.connector_slots.map((slot) => {
                    const provider = connectedProviders.find(
                      (item) =>
                        item.service.toLowerCase() ===
                        slot.connector_id.toLowerCase()
                    );
                    const connected = Boolean(
                      provider?.connection?.configured &&
                      !provider.connection.virtual
                    );
                    return (
                      <div
                        key={slot.slot_id}
                        className="rounded-xl border border-ds-border-neutral-subtle-default p-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-body-sm font-semibold">
                              {provider
                                ? providerLabel(provider)
                                : slot.connector_id}
                            </p>
                            <p className="text-body-xs text-ds-text-neutral-muted-default">
                              Grants:{' '}
                              {slot.required_grants.join(', ') || 'None'}
                            </p>
                          </div>
                          {connected ? (
                            <Button
                              size="sm"
                              onClick={() => void bindConnector(slot)}
                              disabled={busyKey === slot.slot_id}
                            >
                              {configuredSlots.has(slot.slot_id)
                                ? 'Rebind connection'
                                : 'Use connection'}
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => openSettings('connectors')}
                            >
                              <ExternalLink className="h-4 w-4" /> Connect
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {proposal.install_plan.local_path_slots.length === 0 &&
                  proposal.install_plan.connector_slots.length === 0 ? (
                    <p className="text-body-sm text-ds-text-neutral-muted-default">
                      No folder or connector binding required.
                    </p>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>3. Actions and readiness</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {mcpDestinations.map((destination) => {
                    const actionId = mcpDestinationActionId(destination.mcp_id);
                    const missingSecretSlots = destination.secret_slots.filter(
                      (slotId) => {
                        const requirementKey = `mcp_secret:${destination.mcp_id}:${slotId}`;
                        const requirement = snapshot.value_requirements.find(
                          (item) =>
                            item.requirement_kind === 'mcp_secret' &&
                            item.requirement_key === requirementKey
                        );
                        return !(
                          requirement?.configured && requirement.available
                        );
                      }
                    );
                    return (
                      <McpDestinationReview
                        key={destination.mcp_id}
                        destination={destination}
                        approved={configuredSlots.has(actionId)}
                        missingSecretSlots={missingSecretSlots}
                        busy={busyKey === actionId}
                        onApprove={() => void approveScript(actionId)}
                      />
                    );
                  })}
                  {proposal.install_plan.script_actions
                    .filter(
                      (actionId) => !mcpDestinationActionIds.has(actionId)
                    )
                    .map((actionId) => (
                      <div
                        key={actionId}
                        className="flex items-center justify-between gap-3 rounded-xl border border-ds-border-warning-default-default p-3"
                      >
                        <div>
                          <p className="font-mono text-body-sm">{actionId}</p>
                          <p className="text-body-xs text-ds-text-neutral-muted-default">
                            This action may execute local code.
                          </p>
                        </div>
                        {configuredSlots.has(actionId) ? (
                          <Check className="h-4 w-4 text-ds-text-success-default-default" />
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void approveScript(actionId)}
                            disabled={busyKey === actionId}
                          >
                            Approve
                          </Button>
                        )}
                      </div>
                    ))}
                  {!snapshot.readiness.ready ? (
                    <div className="rounded-xl bg-ds-bg-neutral-subtle-default p-3 text-body-sm">
                      <p className="font-semibold">Still required</p>
                      <ul className="mt-1 list-inside list-disc text-body-xs text-ds-text-neutral-muted-default">
                        {snapshot.readiness.missing_requirements.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="rounded-xl bg-ds-bg-success-subtle-default p-3 text-body-sm text-ds-text-success-default-default">
                      All declared local bindings are currently available.
                    </div>
                  )}
                  {proposal.state === 'materialized' ? (
                    <p className="text-body-xs text-ds-text-neutral-muted-default">
                      Changes on this screen are saved immediately. Runtime
                      access is consumer-specific; this installation step does
                      not inject values into the global process environment or
                      unrelated tools.
                    </p>
                  ) : (
                    <Button
                      onClick={() => void materialize()}
                      disabled={
                        !snapshot.readiness.ready || busyKey === 'materialize'
                      }
                    >
                      {busyKey === 'materialize' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <KeyRound className="h-4 w-4" />
                      )}
                      {proposal.error_code === 'bundle_reconfiguration_pending'
                        ? 'Sync local changes to Cloud'
                        : 'Install Workspace files and configuration'}
                    </Button>
                  )}
                </CardContent>
              </Card>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
