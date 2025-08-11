"use client";
"use strict";
"use client";
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

// src/components-page/team-invitation.tsx
var team_invitation_exports = {};
__export(team_invitation_exports, {
  TeamInvitation: () => TeamInvitation
});
module.exports = __toCommonJS(team_invitation_exports);
var import_stack_shared = require("@stackframe/stack-shared");
var import_caches = require("@stackframe/stack-shared/dist/utils/caches");
var import_promises = require("@stackframe/stack-shared/dist/utils/promises");
var import_stack_ui = require("@stackframe/stack-ui");
var import_react = __toESM(require("react"));
var import__ = require("..");
var import_predefined_message_card = require("../components/message-cards/predefined-message-card");
var import_translations = require("../lib/translations");
var import_jsx_runtime = require("react/jsx-runtime");
var cachedVerifyInvitation = (0, import_caches.cacheFunction)(async (stackApp, code) => {
  return await stackApp.verifyTeamInvitationCode(code);
});
var cachedGetInvitationDetails = (0, import_caches.cacheFunction)(async (stackApp, code) => {
  return await stackApp.getTeamInvitationDetails(code);
});
function TeamInvitationInner(props) {
  const { t } = (0, import_translations.useTranslation)();
  const stackApp = (0, import__.useStackApp)();
  const [success, setSuccess] = import_react.default.useState(false);
  const [errorMessage, setErrorMessage] = import_react.default.useState(null);
  const details = import_react.default.use(cachedGetInvitationDetails(stackApp, props.searchParams.code || ""));
  if (errorMessage || details.status === "error") {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_predefined_message_card.PredefinedMessageCard, { type: "unknownError", fullPage: props.fullPage });
  }
  if (success) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import__.MessageCard,
      {
        title: t("Team invitation"),
        fullPage: props.fullPage,
        primaryButtonText: "Go home",
        primaryAction: () => stackApp.redirectToHome(),
        children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_stack_ui.Typography, { children: [
          "You have successfully joined ",
          details.data.teamDisplayName
        ] })
      }
    );
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    import__.MessageCard,
    {
      title: t("Team invitation"),
      fullPage: props.fullPage,
      primaryButtonText: t("Join"),
      primaryAction: () => (0, import_promises.runAsynchronouslyWithAlert)(async () => {
        const result = await stackApp.acceptTeamInvitation(props.searchParams.code || "");
        if (result.status === "error") {
          setErrorMessage(result.error.message);
        } else {
          setSuccess(true);
        }
      }),
      secondaryButtonText: t("Ignore"),
      secondaryAction: () => stackApp.redirectToHome(),
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_stack_ui.Typography, { children: [
        "You are invited to join ",
        details.data.teamDisplayName
      ] })
    }
  );
}
function TeamInvitation({ fullPage = false, searchParams }) {
  const { t } = (0, import_translations.useTranslation)();
  const user = (0, import__.useUser)();
  const stackApp = (0, import__.useStackApp)();
  const invalidJsx = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import__.MessageCard, { title: t("Invalid Team Invitation Link"), fullPage, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { children: t("Please double check if you have the correct team invitation link.") }) });
  const expiredJsx = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import__.MessageCard, { title: t("Expired Team Invitation Link"), fullPage, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { children: t("Your team invitation link has expired. Please request a new team invitation link ") }) });
  const usedJsx = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import__.MessageCard, { title: t("Used Team Invitation Link"), fullPage, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { children: t("This team invitation link has already been used.") }) });
  const code = searchParams.code;
  if (!code) {
    return invalidJsx;
  }
  if (!user) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import__.MessageCard,
      {
        title: t("Team invitation"),
        fullPage,
        primaryButtonText: t("Sign in"),
        primaryAction: () => stackApp.redirectToSignIn(),
        secondaryButtonText: t("Cancel"),
        secondaryAction: () => stackApp.redirectToHome(),
        children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { children: t("Sign in or create an account to join the team.") })
      }
    );
  }
  const verificationResult = import_react.default.use(cachedVerifyInvitation(stackApp, searchParams.code || ""));
  if (verificationResult.status === "error") {
    const error = verificationResult.error;
    if (import_stack_shared.KnownErrors.VerificationCodeNotFound.isInstance(error)) {
      return invalidJsx;
    } else if (import_stack_shared.KnownErrors.VerificationCodeExpired.isInstance(error)) {
      return expiredJsx;
    } else if (import_stack_shared.KnownErrors.VerificationCodeAlreadyUsed.isInstance(error)) {
      return usedJsx;
    } else {
      throw error;
    }
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TeamInvitationInner, { fullPage, searchParams });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TeamInvitation
});
//# sourceMappingURL=team-invitation.js.map