export function parseArgsToArray(args: string): string[] {
  try {
    const arr = JSON.parse(args);
    if (Array.isArray(arr)) return arr.map(String);
  } catch { }
  return [];
}

export function arrayToArgsJson(arr: string[]): string {
  return JSON.stringify(arr.filter(v => v.trim() !== ''));
} 