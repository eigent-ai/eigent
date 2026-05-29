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

/** Display labels with only the first character capitalized. */
export function capitalizeLabel(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

export function formatHubCreatedTime(value?: string | number | null): string {
  if (value === null || value === undefined || value === '') return '';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(Math.abs(diffMs) / (1000 * 60));
  const diffHours = Math.floor(diffMinutes / 60);

  if (diffMinutes < 1) {
    return 'just now';
  }
  if (diffHours < 1) {
    return `${diffMinutes}m`;
  }
  if (diffHours < 24) {
    return `${diffHours}h`;
  }

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  });
}

export function formatHubRelativeAgo(
  value: string | number | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (value === null || value === undefined || value === '') return '';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(Math.abs(diffMs) / (1000 * 60));
  const diffHours = Math.floor(diffMinutes / 60);

  if (diffMinutes < 1) {
    return t('layout.home-relative-just-now');
  }
  if (diffHours < 1) {
    return t('layout.home-relative-minutes-ago', { count: diffMinutes });
  }
  if (diffHours < 24) {
    return t('layout.home-relative-hours-ago', { count: diffHours });
  }

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  });
}

export function formatHubDate(value?: string | number | null): string {
  if (value === null || value === undefined || value === '') return '';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  });
}

const compactCountFormatter = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function formatCompactCount(value?: number): string {
  return compactCountFormatter.format(value || 0).replace('.0', '');
}

export function matchesHubNameSearch(
  query: string,
  name: string | undefined | null
): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return (name ?? '').toLowerCase().includes(normalized);
}

export type HomeViewMode = 'grid' | 'list' | 'board';
export type HomeSortBy = 'created' | 'updated' | 'name';
export type HomeSortDirection = 'asc' | 'desc';

const HOME_VIEW_MODE_STORAGE_KEY = 'eigent-home-hub-view-mode';

export function readStoredHomeViewMode(): HomeViewMode {
  if (typeof window === 'undefined') return 'grid';
  try {
    const raw = window.localStorage.getItem(HOME_VIEW_MODE_STORAGE_KEY);
    if (raw === 'grid' || raw === 'list' || raw === 'board') return raw;
  } catch {
    // ignore storage read failures
  }
  return 'grid';
}

export function persistHomeViewMode(mode: HomeViewMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(HOME_VIEW_MODE_STORAGE_KEY, mode);
  } catch {
    // ignore storage write failures
  }
}

export function timestampFromHubValue(value?: string | number | null): number {
  if (value === null || value === undefined || value === '') return 0;
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
}

export function compareHubByName(
  aName: string | undefined | null,
  bName: string | undefined | null,
  direction: HomeSortDirection
): number {
  const result = (aName ?? '').localeCompare(bName ?? '', undefined, {
    sensitivity: 'base',
  });
  return direction === 'asc' ? result : -result;
}

export function compareHubByTimestamp(
  aValue: string | number | null | undefined,
  bValue: string | number | null | undefined,
  direction: HomeSortDirection
): number {
  const result = timestampFromHubValue(aValue) - timestampFromHubValue(bValue);
  return direction === 'asc' ? result : -result;
}

export function defaultSortDirectionForField(
  sortBy: HomeSortBy
): HomeSortDirection {
  return sortBy === 'name' ? 'asc' : 'desc';
}
