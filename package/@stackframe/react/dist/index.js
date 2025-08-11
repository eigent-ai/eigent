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
var __reExport = (target, mod, secondTarget) => (__copyProps(target, mod, "default"), secondTarget && __copyProps(secondTarget, mod, "default"));
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  AccountSettings: () => import_account_settings.AccountSettings,
  AuthPage: () => import_auth_page.AuthPage,
  CliAuthConfirmation: () => import_cli_auth_confirm.CliAuthConfirmation,
  CredentialSignIn: () => import_credential_sign_in.CredentialSignIn,
  CredentialSignUp: () => import_credential_sign_up.CredentialSignUp,
  EmailVerification: () => import_email_verification.EmailVerification,
  ForgotPassword: () => import_forgot_password.ForgotPassword,
  MagicLinkSignIn: () => import_magic_link_sign_in.MagicLinkSignIn,
  MessageCard: () => import_message_card.MessageCard,
  OAuthButton: () => import_oauth_button.OAuthButton,
  OAuthButtonGroup: () => import_oauth_button_group.OAuthButtonGroup,
  PasswordReset: () => import_password_reset.PasswordReset,
  SelectedTeamSwitcher: () => import_selected_team_switcher.SelectedTeamSwitcher,
  SignIn: () => import_sign_in.SignIn,
  SignUp: () => import_sign_up.SignUp,
  StackHandler: () => import_stack_handler.default,
  StackProvider: () => import_stack_provider.default,
  StackTheme: () => import_theme_provider.StackTheme,
  UserAvatar: () => import_user_avatar.UserAvatar,
  UserButton: () => import_user_button.UserButton,
  useStackApp: () => import_hooks.useStackApp,
  useUser: () => import_hooks.useUser
});
module.exports = __toCommonJS(index_exports);
__reExport(index_exports, require("./lib/stack-app"), module.exports);
var import_stack_handler = __toESM(require("./components-page/stack-handler"));
var import_hooks = require("./lib/hooks");
var import_stack_provider = __toESM(require("./providers/stack-provider"));
var import_theme_provider = require("./providers/theme-provider");
var import_account_settings = require("./components-page/account-settings");
var import_auth_page = require("./components-page/auth-page");
var import_email_verification = require("./components-page/email-verification");
var import_forgot_password = require("./components-page/forgot-password");
var import_password_reset = require("./components-page/password-reset");
var import_sign_in = require("./components-page/sign-in");
var import_sign_up = require("./components-page/sign-up");
var import_credential_sign_in = require("./components/credential-sign-in");
var import_credential_sign_up = require("./components/credential-sign-up");
var import_user_avatar = require("./components/elements/user-avatar");
var import_magic_link_sign_in = require("./components/magic-link-sign-in");
var import_message_card = require("./components/message-cards/message-card");
var import_oauth_button = require("./components/oauth-button");
var import_oauth_button_group = require("./components/oauth-button-group");
var import_selected_team_switcher = require("./components/selected-team-switcher");
var import_user_button = require("./components/user-button");
var import_cli_auth_confirm = require("./components-page/cli-auth-confirm");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AccountSettings,
  AuthPage,
  CliAuthConfirmation,
  CredentialSignIn,
  CredentialSignUp,
  EmailVerification,
  ForgotPassword,
  MagicLinkSignIn,
  MessageCard,
  OAuthButton,
  OAuthButtonGroup,
  PasswordReset,
  SelectedTeamSwitcher,
  SignIn,
  SignUp,
  StackHandler,
  StackProvider,
  StackTheme,
  UserAvatar,
  UserButton,
  useStackApp,
  useUser,
  ...require("./lib/stack-app")
});
//# sourceMappingURL=index.js.map