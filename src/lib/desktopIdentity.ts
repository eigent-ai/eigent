import { createHost } from '@/host/createHost';

const DESKTOP_INSTANCE_STORAGE_KEY = 'eigent_desktop_instance_id';
let desktopInstanceIdPromise: Promise<string> | null = null;

function legacyRendererIdentity(): string {
  try {
    return localStorage.getItem(DESKTOP_INSTANCE_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export async function getDesktopInstanceId(): Promise<string> {
  const api = createHost().electronAPI;
  if (!api?.getDesktopInstanceId) {
    // Remote Web and ordinary browsers are not Desktop devices and must never
    // mint an identity that the Cloud could mistake for an installation.
    return '';
  }
  if (!desktopInstanceIdPromise) {
    desktopInstanceIdPromise = Promise.resolve(
      api.getDesktopInstanceId(legacyRendererIdentity() || undefined)
    )
      .then((identity) => {
        if (!identity) throw new Error('Electron returned an empty device id');
        try {
          localStorage.setItem(DESKTOP_INSTANCE_STORAGE_KEY, identity);
        } catch {
          // The main-process file remains authoritative.
        }
        return identity;
      })
      .catch((error) => {
        desktopInstanceIdPromise = null;
        throw error;
      });
  }
  return desktopInstanceIdPromise;
}

export const __desktopIdentityTestHooks = {
  reset: () => {
    desktopInstanceIdPromise = null;
  },
};
