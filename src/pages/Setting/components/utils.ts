export function parseArgsToArray(args: string): string[] {
  try {
    // Try parsing as JSON array first
    const arr = JSON.parse(args);
    if (Array.isArray(arr)) return arr.map(String);
  } catch { }
  
  // Handle malformed JSON by manually trimming { } and trying again
  if (args.trim().startsWith('{') && args.trim().endsWith('}')) {
    const trimmed = args.trim().slice(1, -1); // Remove { }
    try {
      // Try parsing the trimmed version as JSON array
      const arr = JSON.parse(`[${trimmed}]`);
      if (Array.isArray(arr)) return arr.map(String);
    } catch { }
    
    // If still fails, treat as comma-separated
    if (trimmed.trim()) {
      return trimmed.split(',').map(arg => arg.trim()).filter(arg => arg !== '');
    }
  }
  
  // If not JSON, treat as comma-separated string
  if (args.trim()) {
    return args.split(',').map(arg => arg.trim()).filter(arg => arg !== '');
  }
  
  return [];
}

export function arrayToArgsJson(arr: string[]): string {
  const filtered = arr.filter(v => v.trim() !== '');
  if (filtered.length === 0) return '';
  
  // Return as JSON stringified array
  return JSON.stringify(filtered);
} 