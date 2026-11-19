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

import { ReplayTimeline } from '@/components/Session/SessionReplay/ReplayTimeline';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { DsText } from '@/components/ui/ds-text';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { selectProjectWorkspaceRoot } from '@/lib/projectWorkspaceRoot';
import {
  buildSharedSession,
  listShareableFiles,
  sharedSnapshotToEvents,
  type ShareOptions,
} from '@/lib/sessionShare/buildSharedSession';
import {
  loadSessionReplayData,
  type SessionReplayData,
} from '@/service/sessionReplayEvents';
import {
  createSharedSessionLink,
  deleteSharedSessionLink,
  listSharedSessionLinks,
  SHARE_EXPIRY_OPTIONS,
  SharedSessionUnavailableError,
  stopSharedSessionLink,
  type SharedSessionLink,
  type ShareExpiry,
} from '@/service/sharedSessionApi';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';
import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

/** Preview events use a fixed id so they never mix with the live Session. */
const PREVIEW_PROJECT_ID = 'shared-session-preview';

type Step = 'choose' | 'preview';

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: SessionReplayData };

type LinksState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'error' }
  | { status: 'ready'; links: SharedSessionLink[] };

function expiryKey(expiry: ShareExpiry): string {
  return expiry === null ? 'never' : String(expiry);
}

const EXPIRY_LABEL_KEYS: Record<string, string> = {
  '1': 'chat.session-share.expiry-1',
  '7': 'chat.session-share.expiry-7',
  '30': 'chat.session-share.expiry-30',
  never: 'chat.session-share.expiry-never',
};

async function copyLink(url: string, t: (key: string) => string) {
  try {
    await navigator.clipboard.writeText(url);
    toast.success(t('chat.session-share.link-copied'));
  } catch {
    toast.error(t('chat.session-share.copy-failed'));
  }
}

export function ShareSessionDialog({
  projectId,
  title,
  open,
  onOpenChange,
}: {
  projectId: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const idPrefix = useId();
  const runtimeSpaceId = useProjectRuntimeStore(
    (state) => state.projects[projectId]?.spaceId
  );
  const spaceRoot = useSpaceStore((state) =>
    selectProjectWorkspaceRoot(state, projectId, runtimeSpaceId)
  );

  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [links, setLinks] = useState<LinksState>({ status: 'loading' });
  const [step, setStep] = useState<Step>('choose');
  const [runIds, setRunIds] = useState<string[]>([]);
  const [includeToolCalls, setIncludeToolCalls] = useState(true);
  const [includeThinking, setIncludeThinking] = useState(false);
  const [includedFiles, setIncludedFiles] = useState<string[]>([]);
  const [expiry, setExpiry] = useState<ShareExpiry>(7);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setStep('choose');
    setLoad({ status: 'loading' });
    setLinks({ status: 'loading' });
    setIncludedFiles([]);
    loadSessionReplayData(projectId, { signal: controller.signal }).then(
      (data) => {
        if (controller.signal.aborted) return;
        setLoad({ status: 'ready', data });
        setRunIds(data.runs.map((run) => run.runId));
      },
      () => {
        if (!controller.signal.aborted) setLoad({ status: 'error' });
      }
    );
    listSharedSessionLinks(projectId).then(
      (items) => {
        if (!controller.signal.aborted)
          setLinks({ status: 'ready', links: items });
      },
      (error) => {
        if (controller.signal.aborted) return;
        setLinks({
          status:
            error instanceof SharedSessionUnavailableError
              ? 'unavailable'
              : 'error',
        });
      }
    );
    return () => controller.abort();
  }, [open, projectId]);

  const runs = useMemo(
    () => (load.status === 'ready' ? load.data.runs : []),
    [load]
  );
  const files = useMemo(
    () => listShareableFiles(runs, spaceRoot),
    [runs, spaceRoot]
  );
  const options: ShareOptions = useMemo(
    () => ({ runIds, includeToolCalls, includeThinking, includedFiles }),
    [includeThinking, includeToolCalls, includedFiles, runIds]
  );
  const snapshot = useMemo(
    () => buildSharedSession({ title, runs, spaceRoot, options }),
    [options, runs, spaceRoot, title]
  );
  const previewEvents = useMemo(
    () =>
      step === 'preview'
        ? sharedSnapshotToEvents(snapshot, PREVIEW_PROJECT_ID)
        : [],
    [snapshot, step]
  );

  const toggle = (list: string[], value: string, checked: boolean) =>
    checked
      ? [...new Set([...list, value])]
      : list.filter((item) => item !== value);

  const create = async () => {
    setCreating(true);
    try {
      const link = await createSharedSessionLink({
        projectId,
        snapshot,
        expiresInDays: expiry,
      });
      await copyLink(link.url, t);
      setLinks((current) =>
        current.status === 'ready'
          ? { status: 'ready', links: [link, ...current.links] }
          : { status: 'ready', links: [link] }
      );
      setStep('choose');
    } catch (error) {
      toast.error(
        error instanceof SharedSessionUnavailableError
          ? t('chat.session-share.unavailable')
          : t('chat.session-share.create-failed')
      );
    } finally {
      setCreating(false);
    }
  };

  const replaceLink = (next: SharedSessionLink) =>
    setLinks((current) =>
      current.status === 'ready'
        ? {
            status: 'ready',
            links: current.links.map((link) =>
              link.shareId === next.shareId ? next : link
            ),
          }
        : current
    );

  const stop = async (link: SharedSessionLink) => {
    try {
      replaceLink(await stopSharedSessionLink(link.shareId));
    } catch {
      toast.error(t('chat.session-share.manage-failed'));
    }
  };

  const remove = async (link: SharedSessionLink) => {
    try {
      await deleteSharedSessionLink(link.shareId);
      setLinks((current) =>
        current.status === 'ready'
          ? {
              status: 'ready',
              links: current.links.filter(
                (item) => item.shareId !== link.shareId
              ),
            }
          : current
      );
    } catch {
      toast.error(t('chat.session-share.manage-failed'));
    }
  };

  const nothingChosen = runIds.length === 0 || snapshot.runs.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size={step === 'preview' ? 'lg' : 'md'}>
        <DialogHeader
          title={
            step === 'preview'
              ? t('chat.session-share.preview-title')
              : t('chat.session-share.title')
          }
          subtitle={
            step === 'preview'
              ? t('chat.session-share.preview-subtitle')
              : t('chat.session-share.subtitle')
          }
          showBackButton={step === 'preview'}
          onBackClick={() => setStep('choose')}
        />
        <DialogContentSection className="scrollbar-always-visible flex flex-col gap-ds-stack-section overflow-y-auto">
          {load.status === 'loading' ? (
            <DsText as="p" role="base" className="text-ds-ink-muted-default">
              {t('chat.session-share.loading')}
            </DsText>
          ) : load.status === 'error' ? (
            <DsText as="p" role="base" className="text-ds-ink-muted-default">
              {t('chat.session-share.load-failed')}
            </DsText>
          ) : runs.length === 0 ? (
            <DsText as="p" role="base" className="text-ds-ink-muted-default">
              {t('chat.session-share.no-finished-runs')}
            </DsText>
          ) : step === 'preview' ? (
            <div data-share-preview>
              <ReplayTimeline
                projectId={PREVIEW_PROJECT_ID}
                events={previewEvents}
                position={previewEvents.length}
                detailLevel="narrative"
              />
            </div>
          ) : (
            <>
              <fieldset className="flex flex-col gap-ds-stack-related">
                <DsText as="legend" role="base" weight="semibold">
                  {t('chat.session-share.runs-heading')}
                </DsText>
                {runs.map((run, index) => {
                  const id = `${idPrefix}-run-${index}`;
                  return (
                    <label
                      key={run.runId}
                      htmlFor={id}
                      className="flex items-center gap-ds-control-gap"
                    >
                      <Checkbox
                        id={id}
                        checked={runIds.includes(run.runId)}
                        onCheckedChange={(checked) =>
                          setRunIds((current) =>
                            toggle(current, run.runId, checked === true)
                          )
                        }
                      />
                      <DsText as="span" role="base">
                        {t('chat.session-share.run-label', {
                          index: index + 1,
                        })}
                      </DsText>
                    </label>
                  );
                })}
              </fieldset>
              <fieldset className="flex flex-col gap-ds-stack-related">
                <DsText as="legend" role="base" weight="semibold">
                  {t('chat.session-share.include-heading')}
                </DsText>
                <DsText
                  as="p"
                  role="meta"
                  className="text-ds-ink-muted-default"
                >
                  {t('chat.session-share.messages-always')}
                </DsText>
                <ShareSwitch
                  id={`${idPrefix}-tools`}
                  label={t('chat.session-share.include-tool-calls')}
                  checked={includeToolCalls}
                  onCheckedChange={setIncludeToolCalls}
                />
                <ShareSwitch
                  id={`${idPrefix}-thinking`}
                  label={t('chat.session-share.include-thinking')}
                  checked={includeThinking}
                  onCheckedChange={setIncludeThinking}
                />
              </fieldset>
              {files.length > 0 ? (
                <fieldset className="flex flex-col gap-ds-stack-related">
                  <DsText as="legend" role="base" weight="semibold">
                    {t('chat.session-share.files-heading')}
                  </DsText>
                  <DsText
                    as="p"
                    role="meta"
                    className="text-ds-ink-muted-default"
                  >
                    {t('chat.session-share.files-hint')}
                  </DsText>
                  {files.map((path, index) => {
                    const id = `${idPrefix}-file-${index}`;
                    return (
                      <label
                        key={path}
                        htmlFor={id}
                        className="flex min-w-0 items-center gap-ds-control-gap"
                      >
                        <Checkbox
                          id={id}
                          checked={includedFiles.includes(path)}
                          onCheckedChange={(checked) =>
                            setIncludedFiles((current) =>
                              toggle(current, path, checked === true)
                            )
                          }
                        />
                        <DsText
                          as="span"
                          role="base"
                          channel="code"
                          className="min-w-0 truncate"
                          title={path}
                        >
                          {path}
                        </DsText>
                      </label>
                    );
                  })}
                </fieldset>
              ) : null}
              <div className="flex items-center justify-between gap-ds-control-gap">
                <DsText as="span" role="base" weight="semibold">
                  {t('chat.session-share.expiry-label')}
                </DsText>
                <Select
                  value={expiryKey(expiry)}
                  onValueChange={(value) =>
                    setExpiry(
                      value === 'never' ? null : (Number(value) as ShareExpiry)
                    )
                  }
                >
                  <SelectTrigger
                    size="sm"
                    aria-label={t('chat.session-share.expiry-label')}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SHARE_EXPIRY_OPTIONS.map((option) => (
                      <SelectItem
                        key={expiryKey(option)}
                        value={expiryKey(option)}
                      >
                        {t(EXPIRY_LABEL_KEYS[expiryKey(option)])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <SharedLinks links={links} onStop={stop} onDelete={remove} />
            </>
          )}
        </DialogContentSection>
        <DialogFooter>
          {step === 'choose' ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                {t('layout.cancel')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={load.status !== 'ready' || nothingChosen}
                onClick={() => setStep('preview')}
              >
                {t('chat.session-share.preview')}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep('choose')}
              >
                {t('chat.session-share.back')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={creating || nothingChosen}
                onClick={() => void create()}
              >
                {creating
                  ? t('chat.session-share.creating')
                  : t('chat.session-share.create-link')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShareSwitch({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-ds-control-gap">
      <DsText as="label" role="base" htmlFor={id}>
        {label}
      </DsText>
      <Switch
        id={id}
        size="sm"
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

function SharedLinks({
  links,
  onStop,
  onDelete,
}: {
  links: LinksState;
  onStop: (link: SharedSessionLink) => void;
  onDelete: (link: SharedSessionLink) => void;
}) {
  const { t } = useTranslation();
  if (links.status === 'loading') return null;
  return (
    <section className="flex flex-col gap-ds-stack-related">
      <DsText as="h3" role="base" weight="semibold">
        {t('chat.session-share.links-heading')}
      </DsText>
      {links.status === 'unavailable' ? (
        <DsText as="p" role="meta" className="text-ds-ink-muted-default">
          {t('chat.session-share.unavailable')}
        </DsText>
      ) : links.status === 'error' ? (
        <DsText as="p" role="meta" className="text-ds-ink-muted-default">
          {t('chat.session-share.links-failed')}
        </DsText>
      ) : links.links.length === 0 ? (
        <DsText as="p" role="meta" className="text-ds-ink-muted-default">
          {t('chat.session-share.links-empty')}
        </DsText>
      ) : (
        <ul className="flex flex-col gap-ds-stack-related">
          {links.links.map((link) => (
            <li
              key={link.shareId}
              className="flex min-w-0 items-center gap-ds-control-gap"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <DsText
                  as="span"
                  role="base"
                  channel="code"
                  className="min-w-0 truncate"
                  title={link.url}
                >
                  {link.url}
                </DsText>
                <DsText
                  as="span"
                  role="meta"
                  className="text-ds-ink-muted-default"
                >
                  {link.stopped
                    ? t('chat.session-share.link-stopped')
                    : link.expiresAt
                      ? t('chat.session-share.link-expires', {
                          date: new Date(link.expiresAt).toLocaleDateString(),
                        })
                      : t('chat.session-share.link-no-expiry')}
                </DsText>
              </div>
              {link.stopped ? null : (
                <>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => void copyLink(link.url, t)}
                  >
                    {t('chat.session-share.copy')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => onStop(link)}
                  >
                    {t('chat.session-share.stop')}
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="xs"
                tone="error"
                onClick={() => onDelete(link)}
              >
                {t('chat.session-share.delete')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
