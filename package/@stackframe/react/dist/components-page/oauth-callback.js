"use client";
"use strict";
"use client";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/components-page/oauth-callback.tsx
var oauth_callback_exports = {};
__export(oauth_callback_exports, {
  OAuthCallback: () => OAuthCallback
});
module.exports = __toCommonJS(oauth_callback_exports);
var import_errors = require("@stackframe/stack-shared/dist/utils/errors");
var import_promises = require("@stackframe/stack-shared/dist/utils/promises");
var import_stack_ui = require("@stackframe/stack-ui");
var import_react = require("react");
var import__ = require("..");
var import_maybe_full_page = require("../components/elements/maybe-full-page");
var import_link = require("../components/link");
var import_translations = require("../lib/translations");
var import_jsx_runtime = require("react/jsx-runtime");
function OAuthCallback({ fullPage }) {
  const { t } = (0, import_translations.useTranslation)();
  const app = (0, import__.useStackApp)();
  const called = (0, import_react.useRef)(false);
  const [error, setError] = (0, import_react.useState)(null);
  const [showRedirectLink, setShowRedirectLink] = (0, import_react.useState)(false);
  (0, import_react.useEffect)(() => (0, import_promises.runAsynchronously)(async () => {
    if (called.current) return;
    called.current = true;
    let hasRedirected = false;
    try {
      hasRedirected = await app.callOAuthCallback();
    } catch (e) {
      (0, import_errors.captureError)("<OAuthCallback />", e);
      setError(e);
    }
    if (!hasRedirected && (!error || process.env.NODE_ENV === "production")) {
      await app.redirectToSignIn({ noRedirectBack: true });
    }
  }), []);
  (0, import_react.useEffect)(() => {
    setTimeout(() => setShowRedirectLink(true), 3e3);
  }, []);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    import_maybe_full_page.MaybeFullPage,
    {
      fullPage: fullPage ?? false,
      containerClassName: "flex items-center justify-center",
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "div",
        {
          className: (0, import_stack_ui.cn)(
            "text-center justify-center items-center stack-scope flex flex-col gap-4 max-w-[380px]",
            fullPage ? "p-4" : "p-0"
          ),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "flex flex-col justify-center items-center gap-4", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Spinner, { size: 20 }) }),
            showRedirectLink ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
              t("If you are not redirected automatically, "),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_link.StyledLink, { className: "whitespace-nowrap", href: app.urls.home, children: t("click here") })
            ] }) : null,
            error ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("Something went wrong while processing the OAuth callback:") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { children: JSON.stringify(error, null, 2) }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("This is most likely an error in Stack. Please report it.") })
            ] }) : null
          ]
        }
      )
    }
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  OAuthCallback
});
//# sourceMappingURL=oauth-callback.js.map