export class ProjectorDecodeError extends Error {}

export function decodeTransportMessage(raw: unknown): Record<string, unknown> {
  let decoded = raw;
  if (typeof raw === 'string') {
    try {
      decoded = JSON.parse(raw);
    } catch (error) {
      throw new ProjectorDecodeError(
        `Transport message is not valid JSON: ${String(error)}`
      );
    }
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new ProjectorDecodeError('Transport message must be an object');
  }
  return decoded as Record<string, unknown>;
}
