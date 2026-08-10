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
  type WorkspaceBundleValueRequirement,
} from '@/service/workspaceBundleInstallApi';
import { useAuthStore } from '@/store/authStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';
import {
  ArrowLeft,
  Check,
  ExternalLink,
  FolderOpen,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

type RetryMode = 'review' | 'resume' | 'start' | 'materialize' | null;

interface InstallSeed {
  proposalId: string;
  requestId: string;
  spaceId: string;
}

const installSeedKey = (revisionId: string, actorId: string): string =>
  `eigent:workforce-bundle-install-seed:v1:${actorId}:${revisionId}`;

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
}

export function WorkspaceBundleInstallWizard({
  initialHandle = '',
  initialProposalId = '',
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

  const proposal = snapshot?.proposal;
  const configuredSlots = useMemo(
    () => new Set(snapshot?.bindings.map((item) => item.slot_id) ?? []),
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
        setError('Use a published handle such as my-workforce@1.');
        setRetryMode(null);
        return;
      }
      setBusyKey('review');
      setError(null);
      try {
        const next = await fetchWorkspaceBundleInstallReview(parsed);
        setHandle(parsed);
        setReview(next);
        setInstallSeed(readInstallSeed(parsed.revisionId, actorId));
        setRetryMode(null);
      } catch (nextError) {
        setError(errorMessage(nextError));
        setRetryMode('review');
      } finally {
        setBusyKey(null);
      }
    },
    [actorId]
  );

  const resumeProposal = useCallback(async (proposalId: string) => {
    setBusyKey('resume');
    setError(null);
    try {
      const next = await fetchWorkspaceBundleInstallProposal(proposalId);
      setSnapshot(next);
      setHandle(parseWorkspaceBundleHandle(next.proposal.revision_id));
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
      void resumeProposal(initialProposalId);
      return;
    }
    if (initialHandle) void loadReview(initialHandle);
  }, [initialHandle, initialProposalId, loadReview, resumeProposal]);

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
          'Imported workforce';
        const spaceId = await createSpaceOnServer({
          name,
          sourceType: 'blank',
          setActive: false,
          metadata: {
            createdFrom: 'workforce_bundle_install',
            bundleRevision: handle.revisionId,
            bundleInstallProposalId: proposalId,
            bundleInstallRequestId: requestId,
          },
        });
        seed = { proposalId, requestId, spaceId };
        setInstallSeed(seed);
        try {
          writeInstallSeed(handle.revisionId, actorId, seed);
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
          clearInstallSeed(handle.revisionId, actorId);
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
        bundleId: handle.bundleId,
        revisionId: handle.revisionId,
      });
      clearInstallSeed(handle.revisionId, actorId);
      navigate(
        `/workspace-bundles/install?proposal=${encodeURIComponent(seed.proposalId)}&handle=${encodeURIComponent(handle.revisionId)}`,
        { replace: true }
      );
      const approved = await decideWorkspaceBundleInstall({
        proposalId: seed.proposalId,
        expectedVersion: proposed.proposal.version,
        approved: true,
        actorId,
      });
      setSnapshot(approved);
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
    navigate,
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
      try {
        const accountScopeDigest =
          await workspaceBundleAccountScopeDigest(actorId);
        const stored = await host.electronAPI.workspaceSecretPut({
          account_scope_digest: accountScopeDigest,
          space_id: proposal.space_id,
          revision_id: proposal.revision_id,
          slot_id: item.requirement_key,
          value,
        });
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
        try {
          setSnapshot(
            await fetchWorkspaceBundleInstallProposal(proposal.proposal_id)
          );
        } catch {
          // Preserve the binding failure. Reopening Local setup will replay
          // the durable proposal if the response was lost after commit.
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
    navigate('/');
  };

  const retry = () => {
    if (retryMode === 'review') void loadReview(handleInput);
    if (retryMode === 'resume' && initialProposalId)
      void resumeProposal(initialProposalId);
    if (retryMode === 'start') void startInstall();
    if (retryMode === 'materialize') void materialize();
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
          <Button
            className="mt-5"
            variant="secondary"
            onClick={() => navigate('/workspace-bundles/install')}
          >
            Import another Bundle
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <button
        type="button"
        className="inline-flex items-center gap-1 text-body-sm text-ds-text-neutral-muted-default hover:text-ds-text-neutral-default-default"
        onClick={() => navigate('/history?tab=home&section=spaces')}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to Spaces
      </button>

      <header>
        <h1 className="text-heading-2xl font-semibold">
          Install Workforce Bundle
        </h1>
        <p className="mt-2 text-body-sm text-ds-text-neutral-muted-default">
          Review what the workforce can access, then configure required values
          and connections locally.
        </p>
      </header>

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
                placeholder="research-workforce@1"
                aria-label="Workforce Bundle share handle"
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
                <Button className="mt-4" onClick={openWorkspace}>
                  Open Workspace
                </Button>
              </CardContent>
            </Card>
          ) : null}
          {proposal.state === 'proposed' ? (
            <Card>
              <CardHeader>
                <CardTitle>Finish confirming this installation</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-body-sm text-ds-text-neutral-muted-default">
                  The durable proposal was saved, but the approval response did
                  not finish. Continue without creating another Workspace.
                </p>
                <Button
                  className="mt-4"
                  onClick={() => void continueApproval()}
                  disabled={busyKey === 'approval'}
                >
                  {busyKey === 'approval' ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : null}
                  Continue approval
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
                              onClick={() =>
                                navigate('/history?tab=connectors')
                              }
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
                  {proposal.install_plan.script_actions.map((actionId) => (
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
