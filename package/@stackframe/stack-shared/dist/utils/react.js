"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/utils/react.tsx
var react_exports = {};
__export(react_exports, {
  NoSuspenseBoundaryError: () => NoSuspenseBoundaryError,
  forwardRefIfNeeded: () => forwardRefIfNeeded,
  getNodeText: () => getNodeText,
  suspend: () => suspend,
  suspendIfSsr: () => suspendIfSsr
});
module.exports = __toCommonJS(react_exports);
var import_react = __toESM(require("react"));
var import_env = require("./env");
var import_promises = require("./promises");
var import_strings = require("./strings");
function forwardRefIfNeeded(render) {
  const version = import_react.default.version;
  const major = parseInt(version.split(".")[0]);
  if (major < 19) {
    return import_react.default.forwardRef(render);
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
  import_react.default.use((0, import_promises.neverResolve)());
  throw new Error("Somehow a Promise that never resolves was resolved?");
}
var NoSuspenseBoundaryError = class extends Error {
  constructor(options) {
    super(import_strings.deindent`
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
  if (!(0, import_env.isBrowserLike)()) {
    throw new NoSuspenseBoundaryError({ caller });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  NoSuspenseBoundaryError,
  forwardRefIfNeeded,
  getNodeText,
  suspend,
  suspendIfSsr
});
//# sourceMappingURL=react.js.map