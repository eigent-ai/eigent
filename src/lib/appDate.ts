import i18next from 'i18next';

/** Format a local date using the current app language, never the OS language. */
export function formatAppDate(
  date: Date,
  options?: Intl.DateTimeFormatOptions,
  locale?: string
): string {
  return new Intl.DateTimeFormat(
    locale || i18next.resolvedLanguage || i18next.language || 'en-US',
    options
  ).format(date);
}
