const DESKTOP_INSTANCE_STORAGE_KEY = 'eigent_desktop_instance_id';
let memoryInstanceId = '';

function randomId(prefix: string): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) {
    return `${prefix}_${cryptoApi.randomUUID().replaceAll('-', '')}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2)}`;
}

export function getDesktopInstanceId(): string {
  if (memoryInstanceId) {
    return memoryInstanceId;
  }
  try {
    const existing = localStorage.getItem(DESKTOP_INSTANCE_STORAGE_KEY);
    if (existing) {
      memoryInstanceId = existing;
      return existing;
    }
    const next = randomId('desk');
    localStorage.setItem(DESKTOP_INSTANCE_STORAGE_KEY, next);
    memoryInstanceId = next;
    return next;
  } catch {
    memoryInstanceId = randomId('desk');
    return memoryInstanceId;
  }
}
