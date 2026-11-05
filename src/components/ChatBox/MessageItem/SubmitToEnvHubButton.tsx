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

import ConfirmModal from '@/components/ui/alertDialog';
import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import { useHost } from '@/host';
import {
  ENV_HUB_SERVICE,
  fetchEnvHubConversion,
  fetchEnvHubProvider,
  isEnvHubConnected,
  isEnvHubConversionDone,
  rememberEnvHubConversion,
  rememberedEnvHubConversion,
  submitRunToEnvHub,
  type EnvHubConversion,
} from '@/service/envHubApi';
import {
  bundleRunHarborTask,
  type RunHarborTaskBundle,
} from '@/service/workspaceGitApi';
import { formatFileSize } from '@/shared/filePreviewContract';
import { useAuthStore } from '@/store/authStore';
import { openSettings } from '@/store/settingsStore';
import { CloudAlert, CloudCheck, CloudUpload, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { HARBOR_TASK_FAILURE_DESCRIPTION_KEYS } from './SaveAsHarborTaskButton';
import { useRunHarborTaskAvailability } from './useRunHarborTaskAvailability';

const STATUS_POLL_MS = 20_000;
const STAGES = new Set([
  'queued',
  'checking',
  'publishing',
  'drafting',
  'gating',
  'repairing',
  'passed',
  'rejected',
  'needs_attention',
  'failed',
]);

// Whether this account's Connector Gateway offers Env Hub at all: asked once
// per app session, so cards that cannot use it show nothing.
let envHubOffered: Promise<boolean> | null = null;
function checkEnvHubOffered(): Promise<boolean> {
  envHubOffered ??= fetchEnvHubProvider()
    .then((provider) => provider !== null)
    .catch(() => {
      envHubOffered = null;
      return false;
    });
  return envHubOffered;
}

/** Test seam: the answer outlives a render tree, so suites must reset it. */
export function resetEnvHubOfferedCache(): void {
  envHubOffered = null;
}

type Phase = 'idle' | 'preparing' | 'confirming' | 'submitting';

interface SubmitToEnvHubButtonProps {
  runId?: string;
  projectId?: string | null;
  /** Availability is checked only once the Task has completed. */
  completed: boolean;
}

/**
 * Submit a completed Task to Env Hub through its connector: Env Hub writes a
 * verifier and a reference solution and keeps the conversation with the
 * environment. Shown only where the Task can be saved as a Harbor task and
 * the Connector Gateway offers Env Hub; nothing is sent before the person
 * confirms what will be uploaded.
 */
export function SubmitToEnvHubButton({
  runId,
  projectId,
  completed,
}: SubmitToEnvHubButtonProps) {
  const { t } = useTranslation();
  const electronAPI = useHost()?.electronAPI;
  const email = useAuthStore((state) => state.email);
  const userId = useAuthStore((state) => state.user_id);
  const { available, spaceId } = useRunHarborTaskAvailability({
    runId,
    projectId,
    completed,
  });
  const [offered, setOffered] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [made, setMade] = useState<RunHarborTaskBundle | null>(null);
  const [conversion, setConversion] = useState<EnvHubConversion | null>(() =>
    runId ? rememberedEnvHubConversion(runId) : null
  );
  const announced = useRef<string | null>(null);

  useEffect(() => {
    setConversion(runId ? rememberedEnvHubConversion(runId) : null);
  }, [runId]);

  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    void checkEnvHubOffered().then((value) => {
      if (!cancelled) setOffered(value);
    });
    return () => {
      cancelled = true;
    };
  }, [available]);

  const stageLabel = useCallback(
    (stage?: string | null) =>
      t(`chat.env-hub-stage-${stage && STAGES.has(stage) ? stage : 'queued'}`),
    [t]
  );

  const openEnvironment = useCallback(
    (url: string) => {
      if (electronAPI?.openExternal) void electronAPI.openExternal(url);
      else window.open(url, '_blank', 'noopener,noreferrer');
    },
    [electronAPI]
  );

  const announce = useCallback(
    (next: EnvHubConversion) => {
      if (!isEnvHubConversionDone(next)) return;
      const key = `${next.conversion_id}:${next.status}`;
      if (announced.current === key) return;
      announced.current = key;
      if (next.status === 'succeeded' && next.environment_url) {
        const url = next.environment_url;
        toast.success(t('chat.env-hub-ready'), {
          action: {
            label: t('chat.env-hub-open'),
            onClick: () => openEnvironment(url),
          },
        });
      } else if (next.status === 'failed') {
        toast.error(t('chat.env-hub-failed'), {
          description: next.error?.message || undefined,
        });
      }
    },
    [openEnvironment, t]
  );

  const track = useCallback(
    (next: EnvHubConversion) => {
      if (!runId) return;
      rememberEnvHubConversion(runId, next);
      setConversion(next);
      announce(next);
    },
    [announce, runId]
  );

  // Follow a conversion while the card is shown; it takes minutes.
  const conversionId = conversion?.conversion_id;
  const following = conversion !== null && !isEnvHubConversionDone(conversion);
  useEffect(() => {
    if (!conversionId || !following) return;
    let cancelled = false;
    const poll = setInterval(() => {
      fetchEnvHubConversion(conversionId)
        .then((next) => {
          if (!cancelled) track(next);
        })
        .catch(() => {
          // A missed poll is tried again on the next tick.
        });
    }, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [conversionId, following, track]);

  const openConnector = useCallback(() => {
    openSettings('connectors', {
      connectorTarget: `open:${ENV_HUB_SERVICE}`,
    });
  }, []);

  const prepare = useCallback(async () => {
    if (!runId || !spaceId || !email || phase !== 'idle') return;
    setPhase('preparing');
    try {
      const provider = await fetchEnvHubProvider();
      if (!isEnvHubConnected(provider)) {
        setPhase('idle');
        toast.info(t('chat.env-hub-connect-first'), {
          description: t('chat.env-hub-connect-first-description'),
          action: { label: t('chat.env-hub-connect'), onClick: openConnector },
        });
        return;
      }
      setMade(await bundleRunHarborTask(runId, spaceId, { email, userId }));
      setPhase('confirming');
    } catch (error: any) {
      setPhase('idle');
      const descriptionKey =
        HARBOR_TASK_FAILURE_DESCRIPTION_KEYS[
          error?.response?.data?.detail?.code
        ];
      toast.error(t('chat.env-hub-submit-failed'), {
        description: descriptionKey ? t(descriptionKey) : error?.message,
      });
    }
  }, [email, openConnector, phase, runId, spaceId, t, userId]);

  const submit = useCallback(async () => {
    if (!runId || !made || phase !== 'confirming') return;
    setPhase('submitting');
    try {
      const started = await submitRunToEnvHub(runId, made);
      track(started);
      toast.success(t('chat.env-hub-submitted'), {
        description: t('chat.env-hub-submitted-description'),
      });
    } catch (error: any) {
      toast.error(t('chat.env-hub-submit-failed'), {
        description: error?.message,
      });
    } finally {
      setMade(null);
      setPhase('idle');
    }
  }, [made, phase, runId, t, track]);

  const cancel = useCallback(() => {
    if (phase !== 'confirming') return;
    setMade(null);
    setPhase('idle');
  }, [phase]);

  if (!available || !offered) return null;

  const busy = phase === 'preparing' || phase === 'submitting';
  const ready =
    conversion?.status === 'succeeded' && !!conversion.environment_url;
  const converting = following && !busy;
  const failed = conversion?.status === 'failed';

  let label = t('chat.submit-to-env-hub');
  let icon = CloudUpload;
  let onClick: () => void = () => void prepare();
  if (ready) {
    label = t('chat.env-hub-open-environment');
    icon = CloudCheck;
    onClick = () => openEnvironment(conversion!.environment_url!);
  } else if (converting) {
    label = t('chat.env-hub-converting', {
      stage: stageLabel(conversion?.stage),
    });
    onClick = () =>
      toast.info(label, {
        description: t('chat.env-hub-submitted-description'),
      });
  } else if (failed) {
    label = t('chat.env-hub-submit-again');
    icon = CloudAlert;
  }

  return (
    <>
      <Button
        type="button"
        onClick={onClick}
        variant="ghost"
        size="sm"
        buttonContent="icon-only"
        aria-label={label}
        title={label}
        aria-busy={busy || converting}
        disabled={busy}
      >
        {busy || converting ? (
          <DsIcon icon={Loader2} className="animate-spin" />
        ) : (
          <DsIcon icon={icon} />
        )}
      </Button>
      <ConfirmModal
        isOpen={phase === 'confirming' || phase === 'submitting'}
        onClose={cancel}
        onConfirm={() => void submit()}
        title={t('chat.env-hub-confirm-title')}
        message={t('chat.env-hub-confirm-message', {
          size: formatFileSize(made?.bundle.size_bytes ?? null),
        })}
        confirmText={t('chat.env-hub-submit')}
        cancelText={t('layout.cancel')}
        confirmVariant="primary"
        confirmDisabled={phase === 'submitting'}
        closeOnConfirm={false}
      />
    </>
  );
}
