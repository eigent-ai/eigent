// src/utils/react.tsx
import React from "react";
import { isBrowserLike } from "./env";
import { neverResolve } from "./promises";
import { deindent } from "./strings";
function forwardRefIfNeeded(render) {
  const version = React.version;
  const major = parseInt(version.split(".")[0]);
  if (major < 19) {
    return React.forwardRef(render);
  } else {
    return (props) => render(props, props.ref);
  }
}
function getNodeText(node) {
  if (["number", "string"].includes(typeof node)) {
    return `${node}`;
  }
  if (!node) {
    return "";
  }
  if (Array.isArray(node)) {
    return node.map(getNodeText).join("");
  }
  if (typeof node === "object" && "props" in node) {
    return getNodeText(node.props.children);
  }
  throw new Error(`Unknown node type: ${typeof node}`);
}
function suspend() {
  React.use(neverResolve());
  throw new Error("Somehow a Promise that never resolves was resolved?");
}
var NoSuspenseBoundaryError = class extends Error {
  constructor(options) {
    super(deindent`
      ${options.caller ?? "This code path"} attempted to display a loading indicator, but didn't find a Suspense boundary above it. Please read the error message below carefully.
      
      The fix depends on which of the 3 scenarios caused it:
      
      1. You are missing a loading.tsx file in your app directory. Fix it by adding a loading.tsx file in your app directory.

      2. The component is rendered in the root (outermost) layout.tsx or template.tsx file. Next.js does not wrap those files in a Suspense boundary, even if there is a loading.tsx file in the same folder. To fix it, wrap your layout inside a route group like this:

        - app
        - - layout.tsx  // contains <html> and <body>, alongside providers and other components that don't need ${options.caller ?? "this code path"}
        - - loading.tsx  // required for suspense
        - - (main)
        - - - layout.tsx  // contains the main layout of your app, like a sidebar or a header, and can use ${options.caller ?? "this code path"}
        - - - route.tsx  // your actual main page
        - - - the rest of your app

        For more information on this approach, see Next's documentation on route groups: https://nextjs.org/docs/app/building-your-application/routing/route-groups
      
      3. You caught this error with try-catch or a custom error boundary. Fix this by rethrowing the error or not catching it in the first place.

      See: https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout

      More information on SSR and Suspense boundaries: https://react.dev/reference/react/Suspense#providing-a-fallback-for-server-errors-and-client-only-content
    `);
    this.name = "NoSuspenseBoundaryError";
    this.reason = options.caller ?? "suspendIfSsr()";
    this.digest = "BAILOUT_TO_CLIENT_SIDE_RENDERING";
  }
};
function suspendIfSsr(caller) {
  if (!isBrowserLike()) {
    throw new NoSuspenseBoundaryError({ caller });
  }
}
export {
  NoSuspenseBoundaryError,
  forwardRefIfNeeded,
  getNodeText,
  suspend,
  suspendIfSsr
};
//# sourceMappingURL=react.js.map