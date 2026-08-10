import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { useHost } from '@/host';
import {
  convertAgentPluginToWorkspaceBundleDraft,
  inspectAgentPluginSource,
  type AgentPluginConversionResult,
  type AgentPluginInspection,
  type AgentPluginSelectedSource,
} from '@/service/agentPluginImportApi';
import { fetchWorkspaceConfiguration } from '@/service/workspaceConfigurationApi';
import { useAuthStore } from '@/store/authStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';
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

const errorMessage = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : 'The Agent Plugin could not be read.';

const redactSelectedPath = (message: string, selectedPath?: string): string =>
  selectedPath
    ? message.split(selectedPath).join('the selected Agent Plugin')
    : message;

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
}: {
  initialTargetSpaceId?: string | null;
}) {
  const navigate = useNavigate();
  const host = useHost();
  const email = useAuthStore((state) => state.email);
  const userId = useAuthStore((state) => state.user_id);
  const spaces = useSpaceStore((state) => state.spaces);
  const activeSpaceId = useSpaceStore((state) => state.activeSpaceId);
  const setActiveSpace = useSpaceStore((state) => state.setActiveSpace);
  const setActiveProject = useProjectRuntimeStore(
    (state) => state.setActiveProject
  );
  const selectableSpaces = useMemo(
    () =>
      Object.values(spaces)
        .filter((space) => space.status === 'active')
        .sort((left, right) => left.name.localeCompare(right.name)),
    [spaces]
  );
  const selectableSpaceIds = useMemo(
    () => new Set(selectableSpaces.map((space) => space.id)),
    [selectableSpaces]
  );
  const defaultTarget = initialTargetSpaceId
    ? selectableSpaceIds.has(initialTargetSpaceId)
      ? initialTargetSpaceId
      : ''
    : activeSpaceId && selectableSpaceIds.has(activeSpaceId)
      ? activeSpaceId
      : selectableSpaces.at(0)?.id || '';
  const [targetSpaceId, setTargetSpaceId] = useState(defaultTarget);
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
      setError('Sign in before importing an Agent Plugin.');
      return;
    }
    let selectedPath: string | undefined;
    const picker = host?.electronAPI?.selectAgentPluginSource;
    if (!picker) {
      setError('Agent Plugins import requires Eigent Desktop.');
      return;
    }
    if (busy !== null || pickerInFlight.current) return;
    pickerInFlight.current = true;
    setBusy('inspect');
    try {
      const selected = await picker();
      if (selected?.canceled) return;
      if (!selected?.source_path) {
        throw new Error('No Agent Plugin directory or archive was selected.');
      }
      selectedPath = selected.source_path;
      const source: AgentPluginSelectedSource = {
        source_path: selected.source_path,
        display_name: selected.display_name || 'Selected Agent Plugin',
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
    } catch (nextError) {
      setError(redactSelectedPath(errorMessage(nextError), selectedPath));
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
      !targetSpaceId ||
      !email ||
      conversionInFlight.current
    ) {
      return;
    }
    conversionInFlight.current = true;
    setBusy('convert');
    setError(null);
    const generation = selectionGeneration.current;
    const requestedTargetSpaceId = targetSpaceId;
    try {
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
              'the selected Workspace',
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
        redactSelectedPath(errorMessage(nextError), selectedSource.source_path)
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
    navigate('/workspace-configuration');
  };

  if (conversion) {
    return (
      <Card className="mx-auto w-full max-w-2xl">
        <CardHeader>
          <CheckCircle2
            className="mb-3 h-10 w-10 text-ds-text-success-default-default"
            aria-hidden
          />
          <CardTitle>Agent Plugin converted</CardTitle>
          <CardDescription>
            {conversion.bundle_id}@{conversion.revision_id} is a local Workforce
            Bundle draft. It has not been published or installed elsewhere.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={openConfiguration}>Review Workspace draft</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <button
        type="button"
        className="inline-flex items-center gap-1 text-body-sm text-ds-text-neutral-muted-default hover:text-ds-text-neutral-default-default"
        onClick={() => navigate(-1)}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back
      </button>

      <header>
        <h1 className="text-heading-2xl font-semibold">Import Agent Plugin</h1>
        <p className="mt-2 max-w-2xl text-body-sm text-ds-text-neutral-muted-default">
          Import the Agent Plugins standard. Eigent reviews the package before
          converting it to a local Workforce Bundle draft.
        </p>
      </header>

      {error ? (
        <div className="rounded-xl border border-ds-border-error-default-default bg-ds-bg-error-subtle-default p-4 text-body-sm text-ds-text-error-strong-default">
          {error}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Select an Agent Plugin</CardTitle>
          <CardDescription>
            Choose a local plugin directory or archive. The selected path is
            inspected locally and is never included in the converted Bundle.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
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
            Select directory or archive
          </Button>
          {selectedSource ? (
            <span className="text-body-sm text-ds-text-neutral-muted-default">
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
                Agent Plugins standard
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
                <p className="text-body-sm">
                  {inspection.metadata.description}
                </p>
              ) : null}
              <div className="rounded-xl border p-3 text-body-xs">
                <strong>Source tree digest</strong>
                <code className="mt-1 block break-all text-ds-text-neutral-muted-default">
                  {inspection.source_tree_digest}
                </code>
                <strong className="mt-3 block">Converted tree digest</strong>
                <code className="mt-1 block break-all text-ds-text-neutral-muted-default">
                  {inspection.converted_tree_digest}
                </code>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-ds-bg-neutral-subtle-default p-3">
                  <Puzzle className="h-4 w-4" aria-hidden />
                  <strong className="mt-2 block text-body-sm">Skills</strong>
                  <span className="text-body-sm">
                    {inspection.skills.length}
                  </span>
                </div>
                <div className="rounded-xl bg-ds-bg-neutral-subtle-default p-3">
                  <Server className="h-4 w-4" aria-hidden />
                  <strong className="mt-2 block text-body-sm">
                    MCP servers
                  </strong>
                  <span className="text-body-sm">
                    {inspection.mcp_servers.length}
                  </span>
                </div>
                <div className="rounded-xl bg-ds-bg-neutral-subtle-default p-3">
                  <PackageSearch className="h-4 w-4" aria-hidden />
                  <strong className="mt-2 block text-body-sm">Files</strong>
                  <span className="text-body-sm">
                    {inspection.files.length}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Skills</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {inspection.skills.length ? (
                  inspection.skills.map((skill) => (
                    <div key={skill.id} className="rounded-xl border p-3">
                      <strong className="text-body-sm">{skill.name}</strong>
                      {skill.description ? (
                        <p className="mt-1 text-body-xs text-ds-text-neutral-muted-default">
                          {skill.description}
                        </p>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="text-body-sm text-ds-text-neutral-muted-default">
                    No Skills declared.
                  </p>
                )}
                {inspection.skipped_skills.map((skill) => (
                  <div
                    key={`${skill.id || skill.name || skill.logical_path}:${skill.reason_code}`}
                    className="rounded-xl border border-ds-border-warning-default-default p-3"
                  >
                    <strong className="text-body-sm">
                      Skipped: {skill.name || skill.id || skill.logical_path}
                    </strong>
                    <p className="mt-1 text-body-xs">
                      {skill.reason_code}: {skill.reason}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>MCP servers</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {inspection.mcp_servers.length ? (
                  inspection.mcp_servers.map((server) => (
                    <div key={server.id} className="rounded-xl border p-3">
                      <strong className="text-body-sm">
                        {server.name || server.id}
                      </strong>
                      <p className="mt-1 text-body-xs text-ds-text-neutral-muted-default">
                        {server.transport || 'transport not declared'}
                      </p>
                      {server.command ? (
                        <div className="mt-2 space-y-1 text-body-xs">
                          <code className="block break-all">
                            command: {visibleReviewValue(server.command)}
                          </code>
                          {(server.args || []).map((argument, index) => (
                            <code
                              key={`${index}:${argument}`}
                              className="block break-all pl-3"
                            >
                              argv[{index}]: {visibleReviewValue(argument)}
                            </code>
                          ))}
                        </div>
                      ) : server.command_summary ? (
                        <code className="mt-2 block break-all text-body-xs">
                          {visibleReviewValue(server.command_summary)}
                        </code>
                      ) : null}
                      {server.cwd ? (
                        <p className="mt-2 break-all text-body-xs">
                          cwd: {server.cwd}
                        </p>
                      ) : null}
                      {server.url ? (
                        <p className="mt-2 break-all text-body-xs">
                          URL: {server.url}
                        </p>
                      ) : null}
                      {server.env_names.length ? (
                        <p className="mt-2 text-body-xs">
                          Environment names: {server.env_names.join(', ')}
                        </p>
                      ) : null}
                      {server.header_names.length ? (
                        <p className="mt-1 text-body-xs">
                          Header names: {server.header_names.join(', ')}
                        </p>
                      ) : null}
                      {(server.public_environment || []).map((item) => (
                        <div
                          key={`env:${item.name}`}
                          className="mt-2 rounded-lg bg-ds-bg-neutral-subtle-default p-2 text-body-xs"
                        >
                          <code className="break-all">
                            env {item.name} = {visibleReviewValue(item.value)}
                            {item.truncated ? '…' : ''}
                          </code>
                          {item.truncated ? (
                            <code className="mt-1 block break-all text-ds-text-neutral-muted-default">
                              sha256: {item.value_digest}
                            </code>
                          ) : null}
                        </div>
                      ))}
                      {(server.public_headers || []).map((item) => (
                        <div
                          key={`header:${item.name}`}
                          className="mt-2 rounded-lg bg-ds-bg-neutral-subtle-default p-2 text-body-xs"
                        >
                          <code className="break-all">
                            header {item.name} ={' '}
                            {visibleReviewValue(item.value)}
                            {item.truncated ? '…' : ''}
                          </code>
                          {item.truncated ? (
                            <code className="mt-1 block break-all text-ds-text-neutral-muted-default">
                              sha256: {item.value_digest}
                            </code>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ))
                ) : (
                  <p className="text-body-sm text-ds-text-neutral-muted-default">
                    No MCP servers declared.
                  </p>
                )}
                {inspection.skipped_mcp_servers.map((server) => (
                  <div
                    key={`${server.id || server.name || server.logical_path}:${server.reason_code}`}
                    className="rounded-xl border border-ds-border-warning-default-default p-3"
                  >
                    <strong className="text-body-sm">
                      Skipped: {server.name || server.id || server.logical_path}
                    </strong>
                    <p className="mt-1 text-body-xs">
                      {server.reason_code}: {server.reason}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Credential requirements</CardTitle>
              <CardDescription>
                Only requirement names are shown. Values explicitly mapped to
                these secret requirements are removed during conversion.
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
                      <strong className="text-body-sm">
                        {requirement.label || requirement.requirement_key}
                      </strong>
                      <p className="text-body-xs text-ds-text-neutral-muted-default">
                        {requirement.requirement_kind}
                        {requirement.required ? ' · required' : ' · optional'}
                      </p>
                      {requirement.description ? (
                        <p className="mt-1 text-body-xs">
                          {requirement.description}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-body-sm text-ds-text-neutral-muted-default">
                  No credential requirements declared.
                </p>
              )}
            </CardContent>
          </Card>

          {inspection.warnings.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Warnings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {inspection.warnings.map((warning) => (
                  <div
                    key={`${warning.code}:${warning.message}`}
                    className="flex gap-3 rounded-xl border border-ds-border-warning-default-default bg-ds-bg-warning-subtle-default p-3 text-body-sm"
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
                <CardTitle>Review diagnostics</CardTitle>
                <CardDescription>
                  Parser and conversion diagnostics found during local review.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {inspection.diagnostics.map((diagnostic) => (
                  <div
                    key={`${diagnostic.code}:${diagnostic.logical_path || ''}:${diagnostic.message}`}
                    className="rounded-xl border p-3 text-body-sm"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <strong>{diagnostic.code}</strong>
                      <span className="text-body-xs uppercase text-ds-text-neutral-muted-default">
                        {diagnostic.severity}
                      </span>
                    </div>
                    <p className="mt-1">{diagnostic.message}</p>
                    {diagnostic.logical_path ? (
                      <code className="mt-2 block break-all text-body-xs text-ds-text-neutral-muted-default">
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
              <CardTitle>File and digest inventory</CardTitle>
              <CardDescription>
                {inspection.files.length} files · review digest{' '}
                <code>{inspection.review_digest}</code>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {inspection.files.map((file) => (
                  <div
                    key={file.logical_path}
                    className="grid gap-1 rounded-xl border p-3 text-body-xs sm:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <span className="break-all font-medium">
                      {file.logical_path}
                    </span>
                    <span>{formatBytes(file.size_bytes)}</span>
                    <code className="break-all text-ds-text-neutral-muted-default sm:col-span-2">
                      {file.content_digest}
                    </code>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Convert to Workspace draft</CardTitle>
              <CardDescription>
                Conversion is local and does not publish or install the Bundle.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="block space-y-1.5 text-body-sm font-medium">
                <span>Target Workspace</span>
                <select
                  className="h-10 w-full rounded-xl border bg-ds-bg-neutral-default-default px-3"
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
                  <option value="">Select a Workspace</option>
                  {selectableSpaces.map((space) => (
                    <option key={space.id} value={space.id}>
                      {space.name}
                    </option>
                  ))}
                </select>
              </label>
              {selectableSpaces.length === 0 ? (
                <p className="text-body-sm text-ds-text-warning-default-default">
                  Create a Workspace before converting this Agent Plugin.
                </p>
              ) : null}
              <label className="flex items-start gap-3 text-body-sm">
                <Checkbox
                  checked={reviewConfirmed}
                  onCheckedChange={(checked) =>
                    setReviewConfirmed(checked === true)
                  }
                  aria-label="Confirm Agent Plugin review"
                />
                <span>
                  I reviewed the Skills, MCP servers, files, credential
                  requirements, and warnings shown above.
                </span>
              </label>
              {replacementReview ? (
                <div className="space-y-3 rounded-xl border border-ds-border-warning-default-default bg-ds-bg-warning-subtle-default p-4 text-body-sm">
                  <div>
                    <strong>Replace the existing Workspace draft?</strong>
                    <p className="mt-1 text-body-xs">
                      {replacementReview.targetName} already has saved
                      configuration (draft version {replacementReview.version}).
                      Agent Plugin conversion replaces that working draft; it
                      does not merge configurations. The currently installed
                      Workspace remains active until you publish and install the
                      new draft.
                    </p>
                  </div>
                  <label className="flex items-start gap-3">
                    <Checkbox
                      checked={replacementConfirmed}
                      onCheckedChange={(checked) =>
                        setReplacementConfirmed(checked === true)
                      }
                      aria-label="Confirm replacing existing Workspace draft"
                    />
                    <span>I understand this replaces the saved draft.</span>
                  </label>
                </div>
              ) : null}
              <div className="flex items-center gap-3 rounded-xl bg-ds-bg-neutral-subtle-default p-3 text-body-xs text-ds-text-neutral-muted-default">
                <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
                Standard MCP env and header literals are public plugin data and
                are copied. Values explicitly declared as secret requirements
                are omitted and configured separately after conversion.
              </div>
              <Button
                type="button"
                onClick={() => void convert()}
                disabled={
                  !inspection.convertible ||
                  !reviewConfirmed ||
                  !targetSpaceId ||
                  !email ||
                  busy !== null
                }
              >
                {busy === 'convert' ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : null}
                Convert to local draft
              </Button>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
