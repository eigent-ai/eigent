import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { formatDistanceToNow, format, parseISO } from "date-fns"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Date/Time Utilities
 * All functions expect UTC ISO strings from API and convert to local timezone
 */

/**
 * Format UTC timestamp to local time (HH:mm:ss)
 * @param utcString - ISO 8601 UTC timestamp from API
 */
export function formatTime(utcString: string | null | undefined): string {
  if (!utcString) return "N/A";
  try {
    const date = parseISO(utcString.endsWith('Z') ? utcString : utcString + 'Z');
    return format(date, "HH:mm:ss");
  } catch {
    return "Invalid time";
  }
}

/**
 * Format UTC timestamp to local date and time
 * @param utcString - ISO 8601 UTC timestamp from API
 * @param formatStr - date-fns format string (default: "MMM dd, yyyy HH:mm")
 */
export function formatDateTime(utcString: string | null | undefined, formatStr: string = "MMM dd, yyyy HH:mm"): string {
  if (!utcString) return "N/A";
  try {
    const date = parseISO(utcString.endsWith('Z') ? utcString : utcString + 'Z');
    return format(date, formatStr);
  } catch {
    return "Invalid date";
  }
}

/**
 * Format UTC timestamp to local date only
 * @param utcString - ISO 8601 UTC timestamp from API
 */
export function formatDate(utcString: string | null | undefined): string {
  if (!utcString) return "N/A";
  try {
    const date = parseISO(utcString.endsWith('Z') ? utcString : utcString + 'Z');
    return format(date, "MMM dd, yyyy");
  } catch {
    return "Invalid date";
  }
}

/**
 * Format UTC timestamp as relative time (e.g., "2 hours ago")
 * @param utcString - ISO 8601 UTC timestamp from API
 */
export function formatRelativeTime(utcString: string | null | undefined): string {
  if (!utcString) return "N/A";
  try {
    const date = parseISO(utcString.endsWith('Z') ? utcString : utcString + 'Z');
    return formatDistanceToNow(date, { addSuffix: true });
  } catch {
    return "Invalid date";
  }
}
