import * as Sentry from '@sentry/nextjs';

declare const sentryBaseConfig: Sentry.BrowserOptions & Sentry.NodeOptions & Sentry.VercelEdgeOptions;

export { sentryBaseConfig };
