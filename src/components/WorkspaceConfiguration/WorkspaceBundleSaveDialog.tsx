import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import {
  buildWorkspaceBundleAuthorReview,
  ensureWorkspaceBundle,
  findWorkspaceBundle,
  getWorkspaceBundleRevision,
  publishWorkspaceBundleRevision,
  uploadWorkspaceBundleAsset,
  validateWorkspaceBundleRevision,
  type CloudWorkspaceBundle,
  type CloudWorkspaceBundleRevision,
  type WorkspaceBundleSelectedAsset,
} from '@/service/workspaceBundleAuthoringApi';
import {
  preflightPreparedWorkspaceConfigurationAssets,
  preflightWorkspaceConfigurationAsset,
  recordPublishedWorkspaceConfiguration,
  reviewWorkspaceConfiguration,
  uploadPreparedWorkspaceConfigurationAsset,
  type WorkspaceConfigurationAssetPreflight,
  type WorkspaceConfigurationDraft,
  type WorkspaceConfigurationIdentity,
  type WorkspaceConfigurationPreparedAsset,
  type WorkspaceConfigurationSaveReview,
  type WorkspaceEnvironmentVariableRequirement,
} from '@/service/workspaceConfigurationApi';
import { Check, Copy, FileUp, RefreshCw, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

const MAX_ASSET_BYTES = 16 * 1024 * 1024;
const MAX_ASSET_COUNT = 512;
const MAX_TOTAL_ASSET_BYTES = 128 * 1024 * 1024;
type PublishableWorkspaceBundleVisibility = 'private' | 'public';

const isPublishableVisibility = (
  value: string
): value is PublishableWorkspaceBundleVisibility =>
  value === 'private' || value === 'public';

interface WorkspaceBundleSaveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceId: string;
  identity: WorkspaceConfigurationIdentity;
  draft: WorkspaceConfigurationDraft;
  onApplyRequirements: (
    requirements: WorkspaceEnvironmentVariableRequirement[]
  ) => void;
  onApplyMcpSecretSlots: (
    requirements: Array<{ mcp_id: string; secret_slots: string[] }>
  ) => void;
  onPublished: () => Promise<void> | void;
}

const errorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  return 'The Bundle could not be published. Try again.';
};

const logicalAssetPath = (value: string): string =>
  value.replace(/^bundle:\/\//, '');

const assetDescriptorKey = (
  asset: WorkspaceConfigurationPreparedAsset
): string =>
  [
    logicalAssetPath(asset.logical_path),
    asset.content_digest,
    asset.media_type,
    asset.size_bytes,
    asset.executable ? '1' : '0',
    asset.provenance,
  ].join('\0');

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
};

const isVerifiedPublishedRevision = (
  revision: CloudWorkspaceBundleRevision,
  review: WorkspaceConfigurationSaveReview
): boolean =>
  revision.status === 'published' &&
  revision.id === review.revision_id &&
  /^[0-9a-f]{64}$/.test(revision.manifest_digest) &&
  revision.manifest?.metadata?.id === review.bundle_id &&
  `${revision.manifest.metadata.id}@${revision.manifest.metadata.revision}` ===
    revision.id;

export function WorkspaceBundleSaveDialog({
  open,
  onOpenChange,
  spaceId,
  identity,
  draft,
  onApplyRequirements,
  onApplyMcpSecretSlots,
  onPublished,
}: WorkspaceBundleSaveDialogProps) {
  const [review, setReview] = useState<WorkspaceConfigurationSaveReview | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibility, setVisibility] =
    useState<PublishableWorkspaceBundleVisibility>('private');
  const [knownCloudBundle, setKnownCloudBundle] =
    useState<CloudWorkspaceBundle | null>(null);
  const [recoverablePublishedRevision, setRecoverablePublishedRevision] =
    useState<CloudWorkspaceBundleRevision | null>(null);
  const [recoveredConcurrentEdits, setRecoveredConcurrentEdits] =
    useState(false);
  const [assetFiles, setAssetFiles] = useState<Record<string, File>>({});
  const [preparedUploadConfirmed, setPreparedUploadConfirmed] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [publishedHandle, setPublishedHandle] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadReview = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPublishedHandle(null);
    setPreparedUploadConfirmed(false);
    try {
      const response = await reviewWorkspaceConfiguration(spaceId, identity);
      if (response.draft_version !== draft.version) {
        throw new Error(
          'The local configuration changed. Close this review and wait for it to save.'
        );
      }
      const existing = await findWorkspaceBundle(response.review.bundle_id);
      if (existing) {
        if (existing.workspace_id !== spaceId) {
          throw new Error(
            'This Bundle id already belongs to a different Workspace.'
          );
        }
        if (!isPublishableVisibility(existing.visibility)) {
          throw new Error(
            'Team sharing is not available without team publishing authority. Choose a private or public Bundle instead.'
          );
        }
        setVisibility(existing.visibility);
        setKnownCloudBundle(existing);
        if (
          existing.latest_published_revision_id === response.review.revision_id
        ) {
          const published = await getWorkspaceBundleRevision(
            response.review.bundle_id,
            response.review.revision_id
          );
          if (!isVerifiedPublishedRevision(published, response.review)) {
            throw new Error('Cloud returned an invalid published revision.');
          }
          setRecoverablePublishedRevision(published);
        }
      }
      setReview(response.review);
    } catch (nextError) {
      setReview(null);
      setError(errorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }, [draft.version, identity, spaceId]);

  useEffect(() => {
    if (!open) return;
    setAssetFiles({});
    setPreparedUploadConfirmed(false);
    setReviewed(false);
    setVisibility('private');
    setKnownCloudBundle(null);
    setRecoverablePublishedRevision(null);
    setRecoveredConcurrentEdits(false);
    setCopied(false);
    void loadReview();
  }, [loadReview, open]);

  const preparedAssets = useMemo(() => review?.prepared_assets ?? [], [review]);
  const preparedAssetPaths = useMemo(
    () =>
      new Set(
        preparedAssets.map((asset) => logicalAssetPath(asset.logical_path))
      ),
    [preparedAssets]
  );
  const manualAssetPaths = useMemo(
    () =>
      review?.assets.filter(
        (path) => !preparedAssetPaths.has(logicalAssetPath(path))
      ) ?? [],
    [preparedAssetPaths, review]
  );
  const assetsReady = useMemo(
    () =>
      manualAssetPaths.every((path) => Boolean(assetFiles[path])) &&
      (preparedAssets.length === 0 || preparedUploadConfirmed),
    [
      assetFiles,
      manualAssetPaths,
      preparedAssets.length,
      preparedUploadConfirmed,
    ]
  );
  const requirementsReady =
    (review?.requirements.suggested_environment_variables.length ?? 0) === 0 &&
    (review?.requirements.suggested_mcp_secret_slots.length ?? 0) === 0;
  const selectedAssetBytes = useMemo(
    () =>
      Object.values(assetFiles).reduce((total, file) => total + file.size, 0),
    [assetFiles]
  );
  const preparedAssetBytes = useMemo(
    () => preparedAssets.reduce((total, asset) => total + asset.size_bytes, 0),
    [preparedAssets]
  );
  const totalAssetCount = manualAssetPaths.length + preparedAssets.length;
  const totalAssetBytes = selectedAssetBytes + preparedAssetBytes;
  const assetLimitError = review
    ? totalAssetCount > MAX_ASSET_COUNT
      ? `A Workforce Bundle can contain at most ${MAX_ASSET_COUNT} assets.`
      : totalAssetBytes > MAX_TOTAL_ASSET_BYTES
        ? 'Selected assets exceed the 128 MiB total Bundle limit.'
        : Object.values(assetFiles).some(
              (file) => file.size > MAX_ASSET_BYTES
            ) ||
            preparedAssets.some((asset) => asset.size_bytes > MAX_ASSET_BYTES)
          ? 'A Bundle asset exceeds the 16 MiB per-file limit.'
          : null
    : null;
  const canPublish = Boolean(
    review &&
    assetsReady &&
    requirementsReady &&
    !assetLimitError &&
    reviewed &&
    !publishing
  );

  const finishSavingLocally = async () => {
    if (!review || !recoverablePublishedRevision || publishing) return;
    setPublishing(true);
    setError(null);
    try {
      // This is a dedicated recovery action for a revision already verified as
      // published by the authenticated Cloud API. It performs no Cloud write
      // and deliberately persists the Cloud manifest digest: if the local
      // draft changed after Cloud publish, Brain rebases those edits into the
      // next revision rather than overwriting the immutable published version.
      await recordPublishedWorkspaceConfiguration(spaceId, identity, {
        expectedVersion: draft.version,
        revisionId: recoverablePublishedRevision.id,
        manifestDigest: recoverablePublishedRevision.manifest_digest,
        actorId: String(identity.userId ?? identity.email),
      });
      setRecoveredConcurrentEdits(
        recoverablePublishedRevision.manifest_digest !== review.manifest_digest
      );
      setPublishedHandle(recoverablePublishedRevision.id);
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setPublishing(false);
    }
  };

  const publish = async () => {
    if (!review || !canPublish) return;
    const targetDraft = draft;
    setPublishing(true);
    setError(null);
    try {
      if (totalAssetCount > MAX_ASSET_COUNT) {
        throw new Error(
          `A Workforce Bundle can contain at most ${MAX_ASSET_COUNT} assets.`
        );
      }
      const selected = manualAssetPaths.map((path) => {
        const file = assetFiles[path];
        if (!file) throw new Error(`Select an asset for ${path}.`);
        if (file.size > MAX_ASSET_BYTES) {
          throw new Error(
            `${file.name} exceeds the 16 MiB Bundle asset limit.`
          );
        }
        return { path, file };
      });
      if (
        selected.reduce((total, item) => total + item.file.size, 0) +
          preparedAssetBytes >
        MAX_TOTAL_ASSET_BYTES
      ) {
        throw new Error(
          'Selected assets exceed the 128 MiB total Bundle limit.'
        );
      }

      // All explicit assets are scanned and digested by the local Brain before
      // the first Cloud request. A failed scan cannot create or mutate Cloud
      // Bundle state.
      const preflightedAssets: Array<{
        path: string;
        file: File;
        preflight: WorkspaceConfigurationAssetPreflight;
      }> = [];
      for (const item of selected) {
        const preflight = await preflightWorkspaceConfigurationAsset(
          spaceId,
          identity,
          item.path,
          item.file
        );
        if (
          preflight.logical_path !== logicalAssetPath(item.path) ||
          preflight.size_bytes !== item.file.size
        ) {
          throw new Error(`Local asset preflight mismatch for ${item.path}.`);
        }
        preflightedAssets.push({ ...item, preflight });
      }

      // Prepared Agent Plugin bytes remain in Brain-owned SQLite. Renderer
      // receives and compares bounded descriptors only; all bytes are checked
      // before the first Cloud mutation.
      let preflightedPreparedAssets: WorkspaceConfigurationPreparedAsset[] = [];
      if (preparedAssets.length > 0) {
        const preparedPreflight =
          await preflightPreparedWorkspaceConfigurationAssets(
            spaceId,
            identity,
            {
              expectedVersion: targetDraft.version,
              expectedManifestDigest: review.manifest_digest,
              expectedReviewDigest: review.review_digest,
            }
          );
        const expectedDescriptors = preparedAssets
          .map(assetDescriptorKey)
          .sort();
        const actualDescriptors = preparedPreflight.assets
          .map(assetDescriptorKey)
          .sort();
        if (
          preparedPreflight.space_id !== spaceId ||
          preparedPreflight.draft_version !== targetDraft.version ||
          preparedPreflight.manifest_digest !== review.manifest_digest ||
          preparedPreflight.review_digest !== review.review_digest ||
          expectedDescriptors.length !== actualDescriptors.length ||
          expectedDescriptors.some(
            (descriptor, index) => descriptor !== actualDescriptors[index]
          )
        ) {
          throw new Error(
            'Prepared Agent Plugin assets changed after this review.'
          );
        }
        preflightedPreparedAssets = preparedPreflight.assets;
      }

      const bundle = await ensureWorkspaceBundle({
        bundleId: review.bundle_id,
        workspaceId: spaceId,
        name: review.name,
        visibility,
        existing: knownCloudBundle,
      });
      if (bundle.latest_published_revision_id === review.revision_id) {
        const recovered = await getWorkspaceBundleRevision(
          review.bundle_id,
          review.revision_id
        );
        if (!isVerifiedPublishedRevision(recovered, review)) {
          throw new Error(
            'The published Cloud revision does not match this local review.'
          );
        }
        await recordPublishedWorkspaceConfiguration(spaceId, identity, {
          expectedVersion: targetDraft.version,
          revisionId: recovered.id,
          manifestDigest: recovered.manifest_digest,
          actorId: String(identity.userId ?? identity.email),
        });
        setRecoveredConcurrentEdits(
          recovered.manifest_digest !== review.manifest_digest
        );
        setPublishedHandle(recovered.id);
        return;
      }

      const validated = await validateWorkspaceBundleRevision(
        review.bundle_id,
        targetDraft.document
      );
      if (
        validated.id !== review.revision_id ||
        validated.manifest_digest !== review.manifest_digest
      ) {
        throw new Error(
          'Cloud validation does not match the reviewed local configuration.'
        );
      }
      if (validated.status === 'published') {
        await recordPublishedWorkspaceConfiguration(spaceId, identity, {
          expectedVersion: targetDraft.version,
          revisionId: validated.id,
          manifestDigest: validated.manifest_digest,
          actorId: String(identity.userId ?? identity.email),
        });
        setPublishedHandle(validated.id);
        return;
      }
      const selectedAssetReceipts: WorkspaceBundleSelectedAsset[] = [];
      for (const item of preflightedAssets) {
        const existingAsset = validated.assets.find(
          (asset) => asset.logical_path === item.preflight.logical_path
        );
        const uploaded = await uploadWorkspaceBundleAsset({
          bundleId: review.bundle_id,
          revisionId: review.revision_id,
          logicalPath: item.path,
          file: item.file,
          expectedOldDigest: existingAsset?.content_digest,
        });
        if (
          uploaded.logical_path !== item.preflight.logical_path ||
          uploaded.content_digest !== item.preflight.content_digest ||
          uploaded.size_bytes !== item.preflight.size_bytes ||
          uploaded.provenance !== 'bundle_author' ||
          uploaded.executable
        ) {
          throw new Error(`Cloud asset receipt mismatch for ${item.path}.`);
        }
        selectedAssetReceipts.push({
          logical_path: uploaded.logical_path,
          content_digest: uploaded.content_digest,
          media_type: uploaded.media_type,
          size_bytes: uploaded.size_bytes,
          provenance: uploaded.provenance,
          executable: uploaded.executable,
        });
      }
      for (const prepared of preflightedPreparedAssets) {
        const normalizedPath = logicalAssetPath(prepared.logical_path);
        const existingAsset = validated.assets.find(
          (asset) => asset.logical_path === normalizedPath
        );
        const { asset: uploaded } =
          await uploadPreparedWorkspaceConfigurationAsset(spaceId, identity, {
            expectedVersion: targetDraft.version,
            expectedManifestDigest: review.manifest_digest,
            expectedReviewDigest: review.review_digest,
            logicalPath: prepared.logical_path,
            contentDigest: prepared.content_digest,
            expectedOldDigest: existingAsset?.content_digest,
          });
        if (
          uploaded.logical_path !== normalizedPath ||
          uploaded.content_digest !== prepared.content_digest ||
          uploaded.media_type !== prepared.media_type ||
          uploaded.size_bytes !== prepared.size_bytes ||
          uploaded.provenance !== prepared.provenance ||
          uploaded.executable !== prepared.executable
        ) {
          throw new Error(
            `Cloud prepared asset receipt mismatch for ${prepared.logical_path}.`
          );
        }
        selectedAssetReceipts.push({
          logical_path: uploaded.logical_path,
          content_digest: uploaded.content_digest,
          media_type: uploaded.media_type,
          size_bytes: uploaded.size_bytes,
          provenance: uploaded.provenance,
          executable: uploaded.executable,
        });
      }
      const authorReview = await buildWorkspaceBundleAuthorReview({
        presentedReviewDigest: review.review_digest,
        manifestDigest: review.manifest_digest,
        visibility,
        selectedAssets: selectedAssetReceipts,
      });
      const published = await publishWorkspaceBundleRevision({
        bundleId: review.bundle_id,
        revisionId: review.revision_id,
        manifestDigest: review.manifest_digest,
        authorReview,
      });
      if (
        published.status !== 'published' ||
        published.id !== review.revision_id ||
        published.manifest_digest !== review.manifest_digest
      ) {
        throw new Error('Cloud returned an invalid publish receipt.');
      }
      await recordPublishedWorkspaceConfiguration(spaceId, identity, {
        expectedVersion: targetDraft.version,
        revisionId: review.revision_id,
        manifestDigest: review.manifest_digest,
        actorId: String(identity.userId ?? identity.email),
      });
      setPublishedHandle(review.revision_id);
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setPublishing(false);
    }
  };

  const copyHandle = async () => {
    if (!publishedHandle) return;
    await navigator.clipboard.writeText(publishedHandle);
    setCopied(true);
  };

  const closeDialog = () => {
    if (publishing) return;
    onOpenChange(false);
    if (publishedHandle) {
      void Promise.resolve(onPublished()).catch((nextError) => {
        console.error(
          'Failed to refresh the published working copy',
          nextError
        );
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) onOpenChange(true);
        else closeDialog();
      }}
    >
      <DialogContent
        size="lg"
        overlayVariant="dimmed"
        showCloseButton={!publishing}
        onEscapeKeyDown={(event) => {
          if (publishing) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (publishing) event.preventDefault();
        }}
      >
        <DialogHeader
          title="Save Workforce Bundle"
          subtitle="Review the portable configuration before creating an immutable version."
        />
        <DialogContentSection className="space-y-4 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-body-sm text-ds-text-neutral-muted-default">
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
              Preparing a secret-free review…
            </div>
          ) : null}

          {error ? (
            <div className="rounded-xl border border-ds-border-error-default-default bg-ds-bg-error-subtle-default p-3 text-body-sm text-ds-text-error-strong-default">
              {error}
            </div>
          ) : null}

          {review ? (
            <>
              {recoverablePublishedRevision && !publishedHandle ? (
                <div className="rounded-xl border border-ds-border-information-default-default bg-ds-bg-information-subtle-default p-4">
                  <p className="text-body-sm font-bold">
                    This version is already published
                  </p>
                  <p className="mt-1 text-body-xs text-ds-text-neutral-muted-default">
                    Cloud has the immutable version, but the local publish
                    receipt was not saved. Finish saving locally without
                    selecting or uploading the assets again.
                  </p>
                </div>
              ) : null}
              <div className="rounded-xl border border-ds-border-success-default-default bg-ds-bg-success-subtle-default p-4">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5" aria-hidden />
                  <div>
                    <p className="text-body-sm font-bold">
                      Values stay on this device
                    </p>
                    <p className="mt-1 text-body-xs text-ds-text-neutral-muted-default">
                      {review.local_values_excluded} configured local value
                      fields were excluded. Imported Agent Plugin package files
                      listed below are reviewed upload candidates and may
                      contain public configuration literals; local secret slot
                      values are never included.
                    </p>
                  </div>
                </div>
              </div>

              <section className="space-y-2">
                <h3 className="text-body-sm font-bold">
                  Environment and secret requirements
                </h3>
                {review.requirements.environment_variables.length === 0 &&
                review.requirements.secret_slots.length === 0 ? (
                  <p className="text-body-xs text-ds-text-neutral-muted-default">
                    No secret or environment input is required.
                  </p>
                ) : (
                  <div className="grid gap-2 md:grid-cols-2">
                    {review.requirements.environment_variables.map((item) => (
                      <div
                        key={item.name}
                        className="rounded-xl bg-ds-bg-neutral-subtle-default p-3"
                      >
                        <p className="font-mono text-body-sm">{item.name}</p>
                        <p className="mt-1 text-body-xs text-ds-text-neutral-muted-default">
                          {item.sensitive ? 'Sensitive' : 'Non-sensitive'} ·{' '}
                          {item.required ? 'Required' : 'Optional'}
                        </p>
                      </div>
                    ))}
                    {review.requirements.secret_slots.map((slot) => (
                      <div
                        key={slot}
                        className="rounded-xl bg-ds-bg-neutral-subtle-default p-3"
                      >
                        <p className="font-mono text-body-sm">{slot}</p>
                        <p className="mt-1 text-body-xs text-ds-text-neutral-muted-default">
                          Local secret slot
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                {!requirementsReady ? (
                  <div className="rounded-xl border border-ds-border-warning-default-default bg-ds-bg-warning-subtle-default p-3 text-body-sm">
                    <p>
                      Local configuration revealed undeclared or insufficiently
                      protected environment requirements. Add these names to the
                      draft before publishing.
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="mt-3"
                      onClick={() => {
                        onApplyRequirements(
                          review.requirements.suggested_environment_variables
                        );
                        onApplyMcpSecretSlots(
                          review.requirements.suggested_mcp_secret_slots
                        );
                        onOpenChange(false);
                      }}
                    >
                      Add safe requirements to configuration
                    </Button>
                  </div>
                ) : null}
              </section>

              <section className="space-y-2">
                <h3 className="text-body-sm font-bold">
                  Bundle assets ({totalAssetCount})
                </h3>
                {recoverablePublishedRevision ? (
                  <p className="rounded-xl bg-ds-bg-neutral-subtle-default p-3 text-body-xs text-ds-text-neutral-muted-default">
                    Assets are already verified in Cloud. No re-selection or
                    upload is required to finish saving locally.
                  </p>
                ) : (
                  <p className="text-body-xs text-ds-text-neutral-muted-default">
                    Eigent does not scan or upload ordinary Workspace files
                    automatically. Choose each manually referenced asset;
                    explicitly imported Agent Plugin files are reviewed
                    separately below.
                  </p>
                )}
                {!recoverablePublishedRevision && assetLimitError ? (
                  <div className="rounded-xl border border-ds-border-error-default-default bg-ds-bg-error-subtle-default p-3 text-body-sm text-ds-text-error-strong-default">
                    {assetLimitError}
                  </div>
                ) : null}
                {recoverablePublishedRevision ? null : totalAssetCount === 0 ? (
                  <p className="rounded-xl bg-ds-bg-neutral-subtle-default p-3 text-body-xs text-ds-text-neutral-muted-default">
                    This Bundle has no file assets.
                  </p>
                ) : manualAssetPaths.length > 0 ? (
                  manualAssetPaths.map((path) => (
                    <label
                      key={path}
                      className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-ds-border-neutral-subtle-default p-3"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-body-sm">
                          {logicalAssetPath(path)}
                        </span>
                        <span className="block truncate text-body-xs text-ds-text-neutral-muted-default">
                          {assetFiles[path]?.name || 'Choose a local file'}
                        </span>
                      </span>
                      <FileUp className="h-4 w-4 shrink-0" aria-hidden />
                      <input
                        className="sr-only"
                        type="file"
                        disabled={publishing || Boolean(publishedHandle)}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (!file) return;
                          if (file.size > MAX_ASSET_BYTES) {
                            setAssetFiles((current) => {
                              const next = { ...current };
                              delete next[path];
                              return next;
                            });
                            setReviewed(false);
                            setError(
                              `${file.name} exceeds the 16 MiB Bundle asset limit.`
                            );
                            return;
                          }
                          setError(null);
                          setReviewed(false);
                          setAssetFiles((current) => ({
                            ...current,
                            [path]: file,
                          }));
                        }}
                      />
                    </label>
                  ))
                ) : null}

                {preparedAssets.length > 0 ? (
                  <div className="space-y-3 rounded-xl border border-ds-border-neutral-subtle-default p-3">
                    <div>
                      <p className="text-body-sm font-bold">
                        Imported Agent Plugin package files (
                        {preparedAssets.length})
                      </p>
                      <p className="mt-1 text-body-xs text-ds-text-neutral-muted-default">
                        {formatBytes(preparedAssetBytes)} was persisted by Brain
                        when you explicitly imported this package. File bytes
                        stay outside the renderer and ordinary Workspace files
                        are not included.
                      </p>
                    </div>
                    <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                      {preparedAssets.map((asset) => (
                        <div
                          key={assetDescriptorKey(asset)}
                          className="rounded-lg bg-ds-bg-neutral-subtle-default p-2"
                        >
                          <p className="truncate font-mono text-body-xs">
                            {logicalAssetPath(asset.logical_path)}
                          </p>
                          <p className="text-caption mt-1 truncate text-ds-text-neutral-muted-default">
                            {formatBytes(asset.size_bytes)} · {asset.media_type}
                            {asset.executable ? ' · executable' : ''} ·{' '}
                            {asset.provenance} · sha256:
                            {asset.content_digest.slice(0, 12)}…
                          </p>
                        </div>
                      ))}
                    </div>
                    {!recoverablePublishedRevision ? (
                      <label className="flex items-start gap-3 rounded-lg bg-ds-bg-warning-subtle-default p-3 text-body-sm">
                        <Switch
                          size="sm"
                          checked={preparedUploadConfirmed}
                          onCheckedChange={(checked) => {
                            setPreparedUploadConfirmed(checked);
                            setReviewed(false);
                          }}
                          disabled={publishing || Boolean(publishedHandle)}
                          aria-label="Confirm imported package upload"
                        />
                        <span>
                          Upload these {preparedAssets.length} imported package
                          files ({formatBytes(preparedAssetBytes)}) to this{' '}
                          {visibility} Bundle.
                        </span>
                      </label>
                    ) : null}
                  </div>
                ) : null}
              </section>

              <section className="space-y-2">
                <h3 className="text-body-sm font-bold">Sharing</h3>
                <div className="grid gap-2 md:grid-cols-2">
                  {(['private', 'public'] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={`rounded-xl border p-3 text-left ${
                        visibility === option
                          ? 'border-ds-border-brand-default-default bg-ds-bg-brand-subtle-default'
                          : 'border-ds-border-neutral-subtle-default'
                      }`}
                      disabled={publishing || Boolean(publishedHandle)}
                      onClick={() => {
                        if (visibility === option) return;
                        setVisibility(option);
                        setReviewed(false);
                        setPreparedUploadConfirmed(false);
                      }}
                    >
                      <span className="text-body-sm font-bold capitalize">
                        {option}
                      </span>
                      <span className="mt-1 block text-body-xs text-ds-text-neutral-muted-default">
                        {option === 'private'
                          ? 'Only you can install this version.'
                          : 'Anyone with access to the Bundle can review and install it.'}
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              {review.warnings.map((warning) => (
                <div
                  key={warning.code}
                  className="rounded-xl border border-ds-border-warning-default-default bg-ds-bg-warning-subtle-default p-3 text-body-sm"
                >
                  {warning.message}
                </div>
              ))}

              <label className="flex items-start gap-3 rounded-xl bg-ds-bg-neutral-subtle-default p-3 text-body-sm">
                <Switch
                  size="sm"
                  checked={reviewed}
                  onCheckedChange={setReviewed}
                  disabled={publishing || Boolean(publishedHandle)}
                  aria-label="Confirm secret-free review"
                />
                <span>
                  I reviewed the requirements, permissions, sharing scope, and
                  selected assets. No local secret value is included.
                </span>
              </label>

              {publishedHandle ? (
                <div className="rounded-xl border border-ds-border-success-default-default bg-ds-bg-success-subtle-default p-4">
                  <p className="flex items-center gap-2 text-body-sm font-bold">
                    <Check className="h-4 w-4" aria-hidden /> Published
                  </p>
                  <p className="mt-2 text-body-xs font-medium text-ds-text-neutral-muted-default">
                    Shareable install handle
                  </p>
                  <p
                    className="mt-1 font-mono text-body-sm"
                    aria-label="Published Workforce Bundle handle"
                  >
                    {publishedHandle}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="mt-3"
                    onClick={() => void copyHandle()}
                  >
                    <Copy className="h-4 w-4" aria-hidden />
                    {copied ? 'Copied' : 'Copy share handle'}
                  </Button>
                  <p className="mt-2 text-body-xs text-ds-text-neutral-muted-default">
                    Share this exact <code>bundle_id@revision</code> handle.
                    Recipients can paste it into Import Workforce Bundle to
                    review and install this immutable version.
                  </p>
                  <p className="mt-2 text-body-xs text-ds-text-neutral-muted-default">
                    {recoveredConcurrentEdits
                      ? 'The Cloud version was recovered. Your newer local edits continue in the next version.'
                      : 'Publishing does not silently replace the environment used by current Runs. Installation and local bindings are a separate reviewed step.'}
                  </p>
                </div>
              ) : null}
            </>
          ) : null}
        </DialogContentSection>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={closeDialog}
            disabled={publishing}
          >
            {publishedHandle ? 'Done' : 'Cancel'}
          </Button>
          {!publishedHandle && recoverablePublishedRevision ? (
            <Button
              type="button"
              size="sm"
              onClick={() => void finishSavingLocally()}
              disabled={publishing}
            >
              {publishing ? 'Saving locally…' : 'Finish saving locally'}
            </Button>
          ) : !publishedHandle ? (
            <Button
              type="button"
              size="sm"
              onClick={() => void publish()}
              disabled={!canPublish}
            >
              {publishing ? 'Publishing…' : 'Publish version'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
