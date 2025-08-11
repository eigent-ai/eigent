"use strict";
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

// src/known-errors.tsx
var known_errors_exports = {};
__export(known_errors_exports, {
  KnownError: () => KnownError,
  KnownErrors: () => KnownErrors
});
module.exports = __toCommonJS(known_errors_exports);
var import_errors = require("./utils/errors");
var import_functions = require("./utils/functions");
var import_strings = require("./utils/strings");
var KnownError = class extends import_errors.StatusError {
  constructor(statusCode, humanReadableMessage, details) {
    super(
      statusCode,
      humanReadableMessage
    );
    this.statusCode = statusCode;
    this.humanReadableMessage = humanReadableMessage;
    this.details = details;
    this.__stackKnownErrorBrand = "stack-known-error-brand-sentinel";
    this.name = "KnownError";
  }
  static isKnownError(error) {
    return typeof error === "object" && error !== null && "__stackKnownErrorBrand" in error && error.__stackKnownErrorBrand === "stack-known-error-brand-sentinel";
  }
  getBody() {
    return new TextEncoder().encode(JSON.stringify(this.toDescriptiveJson(), void 0, 2));
  }
  getHeaders() {
    return {
      "Content-Type": ["application/json; charset=utf-8"],
      "X-Stack-Known-Error": [this.errorCode]
    };
  }
  toDescriptiveJson() {
    return {
      code: this.errorCode,
      ...this.details ? { details: this.details } : {},
      error: this.humanReadableMessage
    };
  }
  get errorCode() {
    return this.constructor.errorCode ?? (0, import_errors.throwErr)(`Can't find error code for this KnownError. Is its constructor a KnownErrorConstructor? ${this}`);
  }
  static constructorArgsFromJson(json) {
    return [
      400,
      json.message,
      json
    ];
  }
  static fromJson(json) {
    for (const [_, KnownErrorType] of Object.entries(KnownErrors)) {
      if (json.code === KnownErrorType.prototype.errorCode) {
        const constructorArgs = KnownErrorType.constructorArgsFromJson(json);
        return new KnownErrorType(
          ...constructorArgs
        );
      }
    }
    throw new Error(`Unknown KnownError code. You may need to update your version of Stack to see more detailed information. ${json.code}: ${json.message}`);
  }
};
var knownErrorConstructorErrorCodeSentinel = Symbol("knownErrorConstructorErrorCodeSentinel");
function createKnownErrorConstructor(SuperClass, errorCode, create, constructorArgsFromJson) {
  const createFn = create === "inherit" ? import_functions.identityArgs : create;
  const constructorArgsFromJsonFn = constructorArgsFromJson === "inherit" ? SuperClass.constructorArgsFromJson : constructorArgsFromJson;
  class KnownErrorImpl extends SuperClass {
    constructor(...args) {
      super(...createFn(...args));
      this.name = `KnownError<${errorCode}>`;
      this.constructorArgs = args;
    }
    static constructorArgsFromJson(json) {
      return constructorArgsFromJsonFn(json.details);
    }
    static isInstance(error) {
      if (!KnownError.isKnownError(error)) return false;
      let current = error;
      while (true) {
        current = Object.getPrototypeOf(current);
        if (!current) break;
        if ("errorCode" in current.constructor && current.constructor.errorCode === errorCode) return true;
      }
      return false;
    }
  }
  KnownErrorImpl.errorCode = errorCode;
  ;
  return KnownErrorImpl;
}
var UnsupportedError = createKnownErrorConstructor(
  KnownError,
  "UNSUPPORTED_ERROR",
  (originalErrorCode) => [
    500,
    `An error occurred that is not currently supported (possibly because it was added in a version of Stack that is newer than this client). The original unsupported error code was: ${originalErrorCode}`,
    {
      originalErrorCode
    }
  ],
  (json) => [
    json?.originalErrorCode ?? (0, import_errors.throwErr)("originalErrorCode not found in UnsupportedError details")
  ]
);
var BodyParsingError = createKnownErrorConstructor(
  KnownError,
  "BODY_PARSING_ERROR",
  (message) => [
    400,
    message
  ],
  (json) => [json.message]
);
var SchemaError = createKnownErrorConstructor(
  KnownError,
  "SCHEMA_ERROR",
  (message) => [
    400,
    message || (0, import_errors.throwErr)("SchemaError requires a message"),
    {
      message
    }
  ],
  (json) => [json.message]
);
var AllOverloadsFailed = createKnownErrorConstructor(
  KnownError,
  "ALL_OVERLOADS_FAILED",
  (overloadErrors) => [
    400,
    import_strings.deindent`
      This endpoint has multiple overloads, but they all failed to process the request.

        ${overloadErrors.map((e, i) => import_strings.deindent`
          Overload ${i + 1}: ${JSON.stringify(e, void 0, 2)}
        `).join("\n\n")}
    `,
    {
      overload_errors: overloadErrors
    }
  ],
  (json) => [
    json?.overload_errors ?? (0, import_errors.throwErr)("overload_errors not found in AllOverloadsFailed details")
  ]
);
var ProjectAuthenticationError = createKnownErrorConstructor(
  KnownError,
  "PROJECT_AUTHENTICATION_ERROR",
  "inherit",
  "inherit"
);
var InvalidProjectAuthentication = createKnownErrorConstructor(
  ProjectAuthenticationError,
  "INVALID_PROJECT_AUTHENTICATION",
  "inherit",
  "inherit"
);
var ProjectKeyWithoutAccessType = createKnownErrorConstructor(
  InvalidProjectAuthentication,
  "PROJECT_KEY_WITHOUT_ACCESS_TYPE",
  () => [
    400,
    "Either an API key or an admin access token was provided, but the x-stack-access-type header is missing. Set it to 'client', 'server', or 'admin' as appropriate."
  ],
  () => []
);
var InvalidAccessType = createKnownErrorConstructor(
  InvalidProjectAuthentication,
  "INVALID_ACCESS_TYPE",
  (accessType) => [
    400,
    `The x-stack-access-type header must be 'client', 'server', or 'admin', but was '${accessType}'.`
  ],
  (json) => [
    json?.accessType ?? (0, import_errors.throwErr)("accessType not found in InvalidAccessType details")
  ]
);
var AccessTypeWithoutProjectId = createKnownErrorConstructor(
  InvalidProjectAuthentication,
  "ACCESS_TYPE_WITHOUT_PROJECT_ID",
  (accessType) => [
    400,
    import_strings.deindent`
      The x-stack-access-type header was '${accessType}', but the x-stack-project-id header was not provided.
      
      For more information, see the docs on REST API authentication: https://docs.stack-auth.com/rest-api/overview#authentication
    `,
    {
      request_type: accessType
    }
  ],
  (json) => [json.request_type]
);
var AccessTypeRequired = createKnownErrorConstructor(
  InvalidProjectAuthentication,
  "ACCESS_TYPE_REQUIRED",
  () => [
    400,
    import_strings.deindent`
      You must specify an access level for this Stack project. Make sure project API keys are provided (eg. x-stack-publishable-client-key) and you set the x-stack-access-type header to 'client', 'server', or 'admin'.
      
      For more information, see the docs on REST API authentication: https://docs.stack-auth.com/rest-api/overview#authentication
    `
  ],
  () => []
);
var InsufficientAccessType = createKnownErrorConstructor(
  InvalidProjectAuthentication,
  "INSUFFICIENT_ACCESS_TYPE",
  (actualAccessType, allowedAccessTypes) => [
    401,
    `The x-stack-access-type header must be ${allowedAccessTypes.map((s) => `'${s}'`).join(" or ")}, but was '${actualAccessType}'.`,
    {
      actual_access_type: actualAccessType,
      allowed_access_types: allowedAccessTypes
    }
  ],
  (json) => [
    json.actual_access_type,
    json.allowed_access_types
  ]
);
var InvalidPublishableClientKey = createKnownErrorConstructor(
  InvalidProjectAuthentication,
  "INVALID_PUBLISHABLE_CLIENT_KEY",
  (projectId) => [
    401,
    `The publishable key is not valid for the project ${JSON.stringify(projectId)}. Does the project and/or the key exist?`,
    {
      project_id: projectId
    }
  ],
  (json) => [json.project_id]
);
var InvalidSecretServerKey = createKnownErrorConstructor(
  InvalidProjectAuthentication,
  "INVALID_SECRET_SERVER_KEY",
  (projectId) => [
    401,
    `The secret server key is not valid for the project ${JSON.stringify(projectId)}. Does the project and/or the key exist?`,
    {
      project_id: projectId
    }
  ],
  (json) => [json.project_id]
);
var InvalidSuperSecretAdminKey = createKnownErrorConstructor(
  InvalidProjectAuthentication,
  "INVALID_SUPER_SECRET_ADMIN_KEY",
  (projectId) => [
    401,
    `The super secret admin key is not valid for the project ${JSON.stringify(projectId)}. Does the project and/or the key exist?`,
    {
      project_id: projectId
    }
  ],
  (json) => [json.project_id]
);
var InvalidAdminAccessToken = createKnownErrorConstructor(
  InvalidProjectAuthentication,
  "INVALID_ADMIN_ACCESS_TOKEN",
  "inherit",
  "inherit"
);
var UnparsableAdminAccessToken = createKnownErrorConstructor(
  InvalidAdminAccessToken,
  "UNPARSABLE_ADMIN_ACCESS_TOKEN",
  () => [
    401,
    "Admin access token is not parsable."
  ],
  () => []
);
var AdminAccessTokenExpired = createKnownErrorConstructor(
  InvalidAdminAccessToken,
  "ADMIN_ACCESS_TOKEN_EXPIRED",
  (expiredAt) => [
    401,
    `Admin access token has expired. Please refresh it and try again.${expiredAt ? ` (The access token expired at ${expiredAt.toISOString()}.)` : ""}`,
    { expired_at_millis: expiredAt?.getTime() ?? null }
  ],
  (json) => [json.expired_at_millis ?? void 0]
);
var InvalidProjectForAdminAccessToken = createKnownErrorConstructor(
  InvalidAdminAccessToken,
  "INVALID_PROJECT_FOR_ADMIN_ACCESS_TOKEN",
  () => [
    401,
    "Admin access tokens must be created on the internal project."
  ],
  () => []
);
var AdminAccessTokenIsNotAdmin = createKnownErrorConstructor(
  InvalidAdminAccessToken,
  "ADMIN_ACCESS_TOKEN_IS_NOT_ADMIN",
  () => [
    401,
    "Admin access token does not have the required permissions to access this project."
  ],
  () => []
);
var ProjectAuthenticationRequired = createKnownErrorConstructor(
  ProjectAuthenticationError,
  "PROJECT_AUTHENTICATION_REQUIRED",
  "inherit",
  "inherit"
);
var ClientAuthenticationRequired = createKnownErrorConstructor(
  ProjectAuthenticationRequired,
  "CLIENT_AUTHENTICATION_REQUIRED",
  () => [
    401,
    "The publishable client key must be provided."
  ],
  () => []
);
var ServerAuthenticationRequired = createKnownErrorConstructor(
  ProjectAuthenticationRequired,
  "SERVER_AUTHENTICATION_REQUIRED",
  () => [
    401,
    "The secret server key must be provided."
  ],
  () => []
);
var ClientOrServerAuthenticationRequired = createKnownErrorConstructor(
  ProjectAuthenticationRequired,
  "CLIENT_OR_SERVER_AUTHENTICATION_REQUIRED",
  () => [
    401,
    "Either the publishable client key or the secret server key must be provided."
  ],
  () => []
);
var ClientOrAdminAuthenticationRequired = createKnownErrorConstructor(
  ProjectAuthenticationRequired,
  "CLIENT_OR_ADMIN_AUTHENTICATION_REQUIRED",
  () => [
    401,
    "Either the publishable client key or the super secret admin key must be provided."
  ],
  () => []
);
var ClientOrServerOrAdminAuthenticationRequired = createKnownErrorConstructor(
  ProjectAuthenticationRequired,
  "CLIENT_OR_SERVER_OR_ADMIN_AUTHENTICATION_REQUIRED",
  () => [
    401,
    "Either the publishable client key, the secret server key, or the super secret admin key must be provided."
  ],
  () => []
);
var AdminAuthenticationRequired = createKnownErrorConstructor(
  ProjectAuthenticationRequired,
  "ADMIN_AUTHENTICATION_REQUIRED",
  () => [
    401,
    "The super secret admin key must be provided."
  ],
  () => []
);
var ExpectedInternalProject = createKnownErrorConstructor(
  ProjectAuthenticationError,
  "EXPECTED_INTERNAL_PROJECT",
  () => [
    401,
    "The project ID is expected to be internal."
  ],
  () => []
);
var SessionAuthenticationError = createKnownErrorConstructor(
  KnownError,
  "SESSION_AUTHENTICATION_ERROR",
  "inherit",
  "inherit"
);
var InvalidSessionAuthentication = createKnownErrorConstructor(
  SessionAuthenticationError,
  "INVALID_SESSION_AUTHENTICATION",
  "inherit",
  "inherit"
);
var InvalidAccessToken = createKnownErrorConstructor(
  InvalidSessionAuthentication,
  "INVALID_ACCESS_TOKEN",
  "inherit",
  "inherit"
);
var UnparsableAccessToken = createKnownErrorConstructor(
  InvalidAccessToken,
  "UNPARSABLE_ACCESS_TOKEN",
  () => [
    401,
    "Access token is not parsable."
  ],
  () => []
);
var AccessTokenExpired = createKnownErrorConstructor(
  InvalidAccessToken,
  "ACCESS_TOKEN_EXPIRED",
  (expiredAt) => [
    401,
    `Access token has expired. Please refresh it and try again.${expiredAt ? ` (The access token expired at ${expiredAt.toISOString()}.)` : ""}`,
    { expired_at_millis: expiredAt?.getTime() ?? null }
  ],
  (json) => [json.expired_at_millis ? new Date(json.expired_at_millis) : void 0]
);
var InvalidProjectForAccessToken = createKnownErrorConstructor(
  InvalidAccessToken,
  "INVALID_PROJECT_FOR_ACCESS_TOKEN",
  (expectedProjectId, actualProjectId) => [
    401,
    `Access token not valid for this project. Expected project ID ${JSON.stringify(expectedProjectId)}, but the token is for project ID ${JSON.stringify(actualProjectId)}.`,
    {
      expected_project_id: expectedProjectId,
      actual_project_id: actualProjectId
    }
  ],
  (json) => [json.expected_project_id, json.actual_project_id]
);
var RefreshTokenError = createKnownErrorConstructor(
  KnownError,
  "REFRESH_TOKEN_ERROR",
  "inherit",
  "inherit"
);
var RefreshTokenNotFoundOrExpired = createKnownErrorConstructor(
  RefreshTokenError,
  "REFRESH_TOKEN_NOT_FOUND_OR_EXPIRED",
  () => [
    401,
    "Refresh token not found for this project, or the session has expired/been revoked."
  ],
  () => []
);
var CannotDeleteCurrentSession = createKnownErrorConstructor(
  RefreshTokenError,
  "CANNOT_DELETE_CURRENT_SESSION",
  () => [
    400,
    "Cannot delete the current session."
  ],
  () => []
);
var ProviderRejected = createKnownErrorConstructor(
  RefreshTokenError,
  "PROVIDER_REJECTED",
  () => [
    401,
    "The provider refused to refresh their token. This usually means that the provider used to authenticate the user no longer regards this session as valid, and the user must re-authenticate."
  ],
  () => []
);
var UserWithEmailAlreadyExists = createKnownErrorConstructor(
  KnownError,
  "USER_EMAIL_ALREADY_EXISTS",
  (email) => [
    409,
    `A user with email ${JSON.stringify(email)} already exists.`,
    {
      email
    }
  ],
  (json) => [json.email]
);
var EmailNotVerified = createKnownErrorConstructor(
  KnownError,
  "EMAIL_NOT_VERIFIED",
  () => [
    400,
    "The email is not verified."
  ],
  () => []
);
var CannotGetOwnUserWithoutUser = createKnownErrorConstructor(
  KnownError,
  "CANNOT_GET_OWN_USER_WITHOUT_USER",
  () => [
    400,
    "You have specified 'me' as a userId, but did not provide authentication for a user."
  ],
  () => []
);
var UserIdDoesNotExist = createKnownErrorConstructor(
  KnownError,
  "USER_ID_DOES_NOT_EXIST",
  (userId) => [
    400,
    `The given user with the ID ${userId} does not exist.`,
    {
      user_id: userId
    }
  ],
  (json) => [json.user_id]
);
var UserNotFound = createKnownErrorConstructor(
  KnownError,
  "USER_NOT_FOUND",
  () => [
    404,
    "User not found."
  ],
  () => []
);
var ProjectNotFound = createKnownErrorConstructor(
  KnownError,
  "PROJECT_NOT_FOUND",
  (projectId) => {
    if (typeof projectId !== "string") throw new import_errors.StackAssertionError("projectId of KnownErrors.ProjectNotFound must be a string");
    return [
      404,
      `Project ${projectId} not found or is not accessible with the current user.`,
      {
        project_id: projectId
      }
    ];
  },
  (json) => [json.project_id]
);
var BranchDoesNotExist = createKnownErrorConstructor(
  KnownError,
  "BRANCH_DOES_NOT_EXIST",
  (branchId) => [
    400,
    `The branch with ID ${branchId} does not exist.`,
    {
      branch_id: branchId
    }
  ],
  (json) => [json.branch_id]
);
var SignUpNotEnabled = createKnownErrorConstructor(
  KnownError,
  "SIGN_UP_NOT_ENABLED",
  () => [
    400,
    "Creation of new accounts is not enabled for this project. Please ask the project owner to enable it."
  ],
  () => []
);
var PasswordAuthenticationNotEnabled = createKnownErrorConstructor(
  KnownError,
  "PASSWORD_AUTHENTICATION_NOT_ENABLED",
  () => [
    400,
    "Password authentication is not enabled for this project."
  ],
  () => []
);
var PasskeyAuthenticationNotEnabled = createKnownErrorConstructor(
  KnownError,
  "PASSKEY_AUTHENTICATION_NOT_ENABLED",
  () => [
    400,
    "Passkey authentication is not enabled for this project."
  ],
  () => []
);
var AnonymousAccountsNotEnabled = createKnownErrorConstructor(
  KnownError,
  "ANONYMOUS_ACCOUNTS_NOT_ENABLED",
  () => [
    400,
    "Anonymous accounts are not enabled for this project."
  ],
  () => []
);
var EmailPasswordMismatch = createKnownErrorConstructor(
  KnownError,
  "EMAIL_PASSWORD_MISMATCH",
  () => [
    400,
    "Wrong e-mail or password."
  ],
  () => []
);
var RedirectUrlNotWhitelisted = createKnownErrorConstructor(
  KnownError,
  "REDIRECT_URL_NOT_WHITELISTED",
  () => [
    400,
    "Redirect URL not whitelisted. Did you forget to add this domain to the trusted domains list on the Stack Auth dashboard?"
  ],
  () => []
);
var PasswordRequirementsNotMet = createKnownErrorConstructor(
  KnownError,
  "PASSWORD_REQUIREMENTS_NOT_MET",
  "inherit",
  "inherit"
);
var PasswordTooShort = createKnownErrorConstructor(
  PasswordRequirementsNotMet,
  "PASSWORD_TOO_SHORT",
  (minLength) => [
    400,
    `Password too short. Minimum length is ${minLength}.`,
    {
      min_length: minLength
    }
  ],
  (json) => [
    json?.min_length ?? (0, import_errors.throwErr)("min_length not found in PasswordTooShort details")
  ]
);
var PasswordTooLong = createKnownErrorConstructor(
  PasswordRequirementsNotMet,
  "PASSWORD_TOO_LONG",
  (maxLength) => [
    400,
    `Password too long. Maximum length is ${maxLength}.`,
    {
      maxLength
    }
  ],
  (json) => [
    json?.maxLength ?? (0, import_errors.throwErr)("maxLength not found in PasswordTooLong details")
  ]
);
var UserDoesNotHavePassword = createKnownErrorConstructor(
  KnownError,
  "USER_DOES_NOT_HAVE_PASSWORD",
  () => [
    400,
    "This user does not have password authentication enabled."
  ],
  () => []
);
var VerificationCodeError = createKnownErrorConstructor(
  KnownError,
  "VERIFICATION_ERROR",
  "inherit",
  "inherit"
);
var VerificationCodeNotFound = createKnownErrorConstructor(
  VerificationCodeError,
  "VERIFICATION_CODE_NOT_FOUND",
  () => [
    404,
    "The verification code does not exist for this project."
  ],
  () => []
);
var VerificationCodeExpired = createKnownErrorConstructor(
  VerificationCodeError,
  "VERIFICATION_CODE_EXPIRED",
  () => [
    400,
    "The verification code has expired."
  ],
  () => []
);
var VerificationCodeAlreadyUsed = createKnownErrorConstructor(
  VerificationCodeError,
  "VERIFICATION_CODE_ALREADY_USED",
  () => [
    409,
    "The verification link has already been used."
  ],
  () => []
);
var VerificationCodeMaxAttemptsReached = createKnownErrorConstructor(
  VerificationCodeError,
  "VERIFICATION_CODE_MAX_ATTEMPTS_REACHED",
  () => [
    400,
    "The verification code nonce has reached the maximum number of attempts. This code is not valid anymore."
  ],
  () => []
);
var PasswordConfirmationMismatch = createKnownErrorConstructor(
  KnownError,
  "PASSWORD_CONFIRMATION_MISMATCH",
  () => [
    400,
    "Passwords do not match."
  ],
  () => []
);
var EmailAlreadyVerified = createKnownErrorConstructor(
  KnownError,
  "EMAIL_ALREADY_VERIFIED",
  () => [
    409,
    "The e-mail is already verified."
  ],
  () => []
);
var EmailNotAssociatedWithUser = createKnownErrorConstructor(
  KnownError,
  "EMAIL_NOT_ASSOCIATED_WITH_USER",
  () => [
    400,
    "The e-mail is not associated with a user that could log in with that e-mail."
  ],
  () => []
);
var EmailIsNotPrimaryEmail = createKnownErrorConstructor(
  KnownError,
  "EMAIL_IS_NOT_PRIMARY_EMAIL",
  (email, primaryEmail) => [
    400,
    `The given e-mail (${email}) must equal the user's primary e-mail (${primaryEmail}).`,
    {
      email,
      primary_email: primaryEmail
    }
  ],
  (json) => [json.email, json.primary_email]
);
var PasskeyRegistrationFailed = createKnownErrorConstructor(
  KnownError,
  "PASSKEY_REGISTRATION_FAILED",
  (message) => [
    400,
    message
  ],
  (json) => [json.message]
);
var PasskeyWebAuthnError = createKnownErrorConstructor(
  KnownError,
  "PASSKEY_WEBAUTHN_ERROR",
  (message, code) => [
    400,
    message,
    {
      message,
      code
    }
  ],
  (json) => [json.message, json.code]
);
var PasskeyAuthenticationFailed = createKnownErrorConstructor(
  KnownError,
  "PASSKEY_AUTHENTICATION_FAILED",
  (message) => [
    400,
    message
  ],
  (json) => [json.message]
);
var PermissionNotFound = createKnownErrorConstructor(
  KnownError,
  "PERMISSION_NOT_FOUND",
  (permissionId) => [
    404,
    `Permission "${permissionId}" not found. Make sure you created it on the dashboard.`,
    {
      permission_id: permissionId
    }
  ],
  (json) => [json.permission_id]
);
var PermissionScopeMismatch = createKnownErrorConstructor(
  KnownError,
  "WRONG_PERMISSION_SCOPE",
  (permissionId, expectedScope, actualScope) => [
    404,
    `Permission ${JSON.stringify(permissionId)} not found. (It was found for a different scope ${JSON.stringify(actualScope)}, but scope ${JSON.stringify(expectedScope)} was expected.)`,
    {
      permission_id: permissionId,
      expected_scope: expectedScope,
      actual_scope: actualScope
    }
  ],
  (json) => [json.permission_id, json.expected_scope, json.actual_scope]
);
var ContainedPermissionNotFound = createKnownErrorConstructor(
  KnownError,
  "CONTAINED_PERMISSION_NOT_FOUND",
  (permissionId) => [
    400,
    `Contained permission with ID "${permissionId}" not found. Make sure you created it on the dashboard.`,
    {
      permission_id: permissionId
    }
  ],
  (json) => [json.permission_id]
);
var TeamNotFound = createKnownErrorConstructor(
  KnownError,
  "TEAM_NOT_FOUND",
  (teamId) => [
    404,
    `Team ${teamId} not found.`,
    {
      team_id: teamId
    }
  ],
  (json) => [json.team_id]
);
var TeamAlreadyExists = createKnownErrorConstructor(
  KnownError,
  "TEAM_ALREADY_EXISTS",
  (teamId) => [
    409,
    `Team ${teamId} already exists.`,
    {
      team_id: teamId
    }
  ],
  (json) => [json.team_id]
);
var TeamMembershipNotFound = createKnownErrorConstructor(
  KnownError,
  "TEAM_MEMBERSHIP_NOT_FOUND",
  (teamId, userId) => [
    404,
    `User ${userId} is not found in team ${teamId}.`,
    {
      team_id: teamId,
      user_id: userId
    }
  ],
  (json) => [json.team_id, json.user_id]
);
var EmailTemplateAlreadyExists = createKnownErrorConstructor(
  KnownError,
  "EMAIL_TEMPLATE_ALREADY_EXISTS",
  () => [
    409,
    "Email template already exists."
  ],
  () => []
);
var OAuthConnectionNotConnectedToUser = createKnownErrorConstructor(
  KnownError,
  "OAUTH_CONNECTION_NOT_CONNECTED_TO_USER",
  () => [
    400,
    "The OAuth connection is not connected to any user."
  ],
  () => []
);
var OAuthConnectionAlreadyConnectedToAnotherUser = createKnownErrorConstructor(
  KnownError,
  "OAUTH_CONNECTION_ALREADY_CONNECTED_TO_ANOTHER_USER",
  () => [
    409,
    "The OAuth connection is already connected to another user."
  ],
  () => []
);
var OAuthConnectionDoesNotHaveRequiredScope = createKnownErrorConstructor(
  KnownError,
  "OAUTH_CONNECTION_DOES_NOT_HAVE_REQUIRED_SCOPE",
  () => [
    400,
    "The OAuth connection does not have the required scope."
  ],
  () => []
);
var OAuthExtraScopeNotAvailableWithSharedOAuthKeys = createKnownErrorConstructor(
  KnownError,
  "OAUTH_EXTRA_SCOPE_NOT_AVAILABLE_WITH_SHARED_OAUTH_KEYS",
  () => [
    400,
    "Extra scopes are not available with shared OAuth keys. Please add your own OAuth keys on the Stack dashboard to use extra scopes."
  ],
  () => []
);
var OAuthAccessTokenNotAvailableWithSharedOAuthKeys = createKnownErrorConstructor(
  KnownError,
  "OAUTH_ACCESS_TOKEN_NOT_AVAILABLE_WITH_SHARED_OAUTH_KEYS",
  () => [
    400,
    "Access tokens are not available with shared OAuth keys. Please add your own OAuth keys on the Stack dashboard to use access tokens."
  ],
  () => []
);
var InvalidOAuthClientIdOrSecret = createKnownErrorConstructor(
  KnownError,
  "INVALID_OAUTH_CLIENT_ID_OR_SECRET",
  (clientId) => [
    400,
    "The OAuth client ID or secret is invalid. The client ID must be equal to the project ID (potentially with a hash and a branch ID), and the client secret must be a publishable client key.",
    {
      client_id: clientId ?? null
    }
  ],
  (json) => [json.client_id ?? void 0]
);
var InvalidScope = createKnownErrorConstructor(
  KnownError,
  "INVALID_SCOPE",
  (scope) => [
    400,
    `The scope "${scope}" is not a valid OAuth scope for Stack.`
  ],
  (json) => [json.scope]
);
var UserAlreadyConnectedToAnotherOAuthConnection = createKnownErrorConstructor(
  KnownError,
  "USER_ALREADY_CONNECTED_TO_ANOTHER_OAUTH_CONNECTION",
  () => [
    409,
    "The user is already connected to another OAuth account. Did you maybe selected the wrong account?"
  ],
  () => []
);
var OuterOAuthTimeout = createKnownErrorConstructor(
  KnownError,
  "OUTER_OAUTH_TIMEOUT",
  () => [
    408,
    "The OAuth flow has timed out. Please sign in again."
  ],
  () => []
);
var OAuthProviderNotFoundOrNotEnabled = createKnownErrorConstructor(
  KnownError,
  "OAUTH_PROVIDER_NOT_FOUND_OR_NOT_ENABLED",
  () => [
    400,
    "The OAuth provider is not found or not enabled."
  ],
  () => []
);
var MultiFactorAuthenticationRequired = createKnownErrorConstructor(
  KnownError,
  "MULTI_FACTOR_AUTHENTICATION_REQUIRED",
  (attemptCode) => [
    400,
    `Multi-factor authentication is required for this user.`,
    {
      attempt_code: attemptCode
    }
  ],
  (json) => [json.attempt_code]
);
var InvalidTotpCode = createKnownErrorConstructor(
  KnownError,
  "INVALID_TOTP_CODE",
  () => [
    400,
    "The TOTP code is invalid. Please try again."
  ],
  () => []
);
var UserAuthenticationRequired = createKnownErrorConstructor(
  KnownError,
  "USER_AUTHENTICATION_REQUIRED",
  () => [
    401,
    "User authentication required for this endpoint."
  ],
  () => []
);
var TeamMembershipAlreadyExists = createKnownErrorConstructor(
  KnownError,
  "TEAM_MEMBERSHIP_ALREADY_EXISTS",
  () => [
    409,
    "Team membership already exists."
  ],
  () => []
);
var ProjectPermissionRequired = createKnownErrorConstructor(
  KnownError,
  "PROJECT_PERMISSION_REQUIRED",
  (userId, permissionId) => [
    401,
    `User ${userId} does not have permission ${permissionId}.`,
    {
      user_id: userId,
      permission_id: permissionId
    }
  ],
  (json) => [json.user_id, json.permission_id]
);
var TeamPermissionRequired = createKnownErrorConstructor(
  KnownError,
  "TEAM_PERMISSION_REQUIRED",
  (teamId, userId, permissionId) => [
    401,
    `User ${userId} does not have permission ${permissionId} in team ${teamId}.`,
    {
      team_id: teamId,
      user_id: userId,
      permission_id: permissionId
    }
  ],
  (json) => [json.team_id, json.user_id, json.permission_id]
);
var TeamPermissionNotFound = createKnownErrorConstructor(
  KnownError,
  "TEAM_PERMISSION_NOT_FOUND",
  (teamId, userId, permissionId) => [
    401,
    `User ${userId} does not have permission ${permissionId} in team ${teamId}.`,
    {
      team_id: teamId,
      user_id: userId,
      permission_id: permissionId
    }
  ],
  (json) => [json.team_id, json.user_id, json.permission_id]
);
var InvalidSharedOAuthProviderId = createKnownErrorConstructor(
  KnownError,
  "INVALID_SHARED_OAUTH_PROVIDER_ID",
  (providerId) => [
    400,
    `The shared OAuth provider with ID ${providerId} is not valid.`,
    {
      provider_id: providerId
    }
  ],
  (json) => [json.provider_id]
);
var InvalidStandardOAuthProviderId = createKnownErrorConstructor(
  KnownError,
  "INVALID_STANDARD_OAUTH_PROVIDER_ID",
  (providerId) => [
    400,
    `The standard OAuth provider with ID ${providerId} is not valid.`,
    {
      provider_id: providerId
    }
  ],
  (json) => [json.provider_id]
);
var InvalidAuthorizationCode = createKnownErrorConstructor(
  KnownError,
  "INVALID_AUTHORIZATION_CODE",
  () => [
    400,
    "The given authorization code is invalid."
  ],
  () => []
);
var OAuthProviderAccessDenied = createKnownErrorConstructor(
  KnownError,
  "OAUTH_PROVIDER_ACCESS_DENIED",
  () => [
    400,
    "The OAuth provider denied access to the user."
  ],
  () => []
);
var ContactChannelAlreadyUsedForAuthBySomeoneElse = createKnownErrorConstructor(
  KnownError,
  "CONTACT_CHANNEL_ALREADY_USED_FOR_AUTH_BY_SOMEONE_ELSE",
  (type, contactChannelValue) => [
    409,
    contactChannelValue ? `The ${type} (${contactChannelValue}) is already used for authentication by another account.` : `This ${type} is already used for authentication by another account.`,
    { type, contact_channel_value: contactChannelValue ?? null }
  ],
  (json) => [json.type, json.contact_channel_value]
);
var InvalidPollingCodeError = createKnownErrorConstructor(
  KnownError,
  "INVALID_POLLING_CODE",
  (details) => [
    400,
    "The polling code is invalid or does not exist.",
    details
  ],
  (json) => [json]
);
var CliAuthError = createKnownErrorConstructor(
  KnownError,
  "CLI_AUTH_ERROR",
  (message) => [
    400,
    message
  ],
  (json) => [json.message]
);
var CliAuthExpiredError = createKnownErrorConstructor(
  KnownError,
  "CLI_AUTH_EXPIRED_ERROR",
  (message = "CLI authentication request expired. Please try again.") => [
    400,
    message
  ],
  (json) => [json.message]
);
var CliAuthUsedError = createKnownErrorConstructor(
  KnownError,
  "CLI_AUTH_USED_ERROR",
  (message = "This authentication token has already been used.") => [
    400,
    message
  ],
  (json) => [json.message]
);
var ApiKeyNotValid = createKnownErrorConstructor(
  KnownError,
  "API_KEY_NOT_VALID",
  "inherit",
  "inherit"
);
var ApiKeyExpired = createKnownErrorConstructor(
  ApiKeyNotValid,
  "API_KEY_EXPIRED",
  () => [
    401,
    "API key has expired."
  ],
  () => []
);
var ApiKeyRevoked = createKnownErrorConstructor(
  ApiKeyNotValid,
  "API_KEY_REVOKED",
  () => [
    401,
    "API key has been revoked."
  ],
  () => []
);
var WrongApiKeyType = createKnownErrorConstructor(
  ApiKeyNotValid,
  "WRONG_API_KEY_TYPE",
  (expectedType, actualType) => [
    400,
    `This endpoint is for ${expectedType} API keys, but a ${actualType} API key was provided.`,
    { expected_type: expectedType, actual_type: actualType }
  ],
  (json) => [json.expected_type, json.actual_type]
);
var ApiKeyNotFound = createKnownErrorConstructor(
  ApiKeyNotValid,
  "API_KEY_NOT_FOUND",
  () => [
    404,
    "API key not found."
  ],
  () => []
);
var PublicApiKeyCannotBeRevoked = createKnownErrorConstructor(
  ApiKeyNotValid,
  "PUBLIC_API_KEY_CANNOT_BE_REVOKED",
  () => [
    400,
    "Public API keys cannot be revoked by the secretscanner endpoint."
  ],
  () => []
);
var PermissionIdAlreadyExists = createKnownErrorConstructor(
  KnownError,
  "PERMISSION_ID_ALREADY_EXISTS",
  (permissionId) => [
    400,
    `Permission with ID "${permissionId}" already exists. Choose a different ID.`,
    {
      permission_id: permissionId
    }
  ],
  (json) => [json.permission_id]
);
var KnownErrors = {
  CannotDeleteCurrentSession,
  UnsupportedError,
  BodyParsingError,
  SchemaError,
  AllOverloadsFailed,
  ProjectAuthenticationError,
  PermissionIdAlreadyExists,
  CliAuthError,
  CliAuthExpiredError,
  CliAuthUsedError,
  InvalidProjectAuthentication,
  ProjectKeyWithoutAccessType,
  InvalidAccessType,
  AccessTypeWithoutProjectId,
  AccessTypeRequired,
  CannotGetOwnUserWithoutUser,
  InsufficientAccessType,
  InvalidPublishableClientKey,
  InvalidSecretServerKey,
  InvalidSuperSecretAdminKey,
  InvalidAdminAccessToken,
  UnparsableAdminAccessToken,
  AdminAccessTokenExpired,
  InvalidProjectForAdminAccessToken,
  AdminAccessTokenIsNotAdmin,
  ProjectAuthenticationRequired,
  ClientAuthenticationRequired,
  ServerAuthenticationRequired,
  ClientOrServerAuthenticationRequired,
  ClientOrAdminAuthenticationRequired,
  ClientOrServerOrAdminAuthenticationRequired,
  AdminAuthenticationRequired,
  ExpectedInternalProject,
  SessionAuthenticationError,
  InvalidSessionAuthentication,
  InvalidAccessToken,
  UnparsableAccessToken,
  AccessTokenExpired,
  InvalidProjectForAccessToken,
  RefreshTokenError,
  ProviderRejected,
  RefreshTokenNotFoundOrExpired,
  UserWithEmailAlreadyExists,
  EmailNotVerified,
  UserIdDoesNotExist,
  UserNotFound,
  ApiKeyNotFound,
  PublicApiKeyCannotBeRevoked,
  ProjectNotFound,
  BranchDoesNotExist,
  SignUpNotEnabled,
  PasswordAuthenticationNotEnabled,
  PasskeyAuthenticationNotEnabled,
  AnonymousAccountsNotEnabled,
  EmailPasswordMismatch,
  RedirectUrlNotWhitelisted,
  PasswordRequirementsNotMet,
  PasswordTooShort,
  PasswordTooLong,
  UserDoesNotHavePassword,
  VerificationCodeError,
  VerificationCodeNotFound,
  VerificationCodeExpired,
  VerificationCodeAlreadyUsed,
  VerificationCodeMaxAttemptsReached,
  PasswordConfirmationMismatch,
  EmailAlreadyVerified,
  EmailNotAssociatedWithUser,
  EmailIsNotPrimaryEmail,
  PasskeyRegistrationFailed,
  PasskeyWebAuthnError,
  PasskeyAuthenticationFailed,
  PermissionNotFound,
  PermissionScopeMismatch,
  ContainedPermissionNotFound,
  TeamNotFound,
  TeamMembershipNotFound,
  EmailTemplateAlreadyExists,
  OAuthConnectionNotConnectedToUser,
  OAuthConnectionAlreadyConnectedToAnotherUser,
  OAuthConnectionDoesNotHaveRequiredScope,
  OAuthExtraScopeNotAvailableWithSharedOAuthKeys,
  OAuthAccessTokenNotAvailableWithSharedOAuthKeys,
  InvalidOAuthClientIdOrSecret,
  InvalidScope,
  UserAlreadyConnectedToAnotherOAuthConnection,
  OuterOAuthTimeout,
  OAuthProviderNotFoundOrNotEnabled,
  MultiFactorAuthenticationRequired,
  InvalidTotpCode,
  UserAuthenticationRequired,
  TeamMembershipAlreadyExists,
  ProjectPermissionRequired,
  TeamPermissionRequired,
  InvalidSharedOAuthProviderId,
  InvalidStandardOAuthProviderId,
  InvalidAuthorizationCode,
  TeamPermissionNotFound,
  OAuthProviderAccessDenied,
  ContactChannelAlreadyUsedForAuthBySomeoneElse,
  InvalidPollingCodeError,
  ApiKeyNotValid,
  ApiKeyExpired,
  ApiKeyRevoked,
  WrongApiKeyType
};
var knownErrorCodes = /* @__PURE__ */ new Set();
for (const [_, KnownError2] of Object.entries(KnownErrors)) {
  if (knownErrorCodes.has(KnownError2.errorCode)) {
    throw new Error(`Duplicate known error code: ${KnownError2.errorCode}`);
  }
  knownErrorCodes.add(KnownError2.errorCode);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  KnownError,
  KnownErrors
});
//# sourceMappingURL=known-errors.js.map