// src/utils/sentry.tsx
var sentryBaseConfig = {
  ignoreErrors: [
    // React throws these errors when used with some browser extensions (eg. Google Translate)
    "NotFoundError: Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
    "NotFoundError: Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node."
  ],
  normalizeDepth: 5,
  maxValueLength: 5e3,
  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: 1,
  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,
  replaysOnErrorSampleRate: 1,
  replaysSessionSampleRate: 1
};
export {
  sentryBaseConfig
};
//# sourceMappingURL=sentry.js.map