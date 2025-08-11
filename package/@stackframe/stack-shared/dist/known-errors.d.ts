import { StatusError } from './utils/errors.js';
import { Json } from './utils/json.js';
import './utils/results.js';

type KnownErrorJson = {
    code: string;
    message: string;
    details?: Json;
};
type AbstractKnownErrorConstructor<Args extends any[]> = (abstract new (...args: Args) => KnownError) & {
    constructorArgsFromJson: (json: KnownErrorJson) => Args;
};
type KnownErrorConstructor<SuperInstance extends KnownError, Args extends any[]> = {
    new (...args: Args): SuperInstance & {
        constructorArgs: Args;
    };
    errorCode: string;
    constructorArgsFromJson: (json: KnownErrorJson) => Args;
    isInstance: (error: unknown) => error is SuperInstance & {
        constructorArgs: Args;
    };
};
declare abstract class KnownError extends StatusError {
    readonly statusCode: number;
    readonly humanReadableMessage: string;
    readonly details?: Json | undefined;
    private readonly __stackKnownErrorBrand;
    name: string;
    constructor(statusCode: number, humanReadableMessage: string, details?: Json | undefined);
    static isKnownError(error: unknown): error is KnownError;
    getBody(): Uint8Array;
    getHeaders(): Record<string, string[]>;
    toDescriptiveJson(): Json;
    get errorCode(): string;
    static constructorArgsFromJson(json: KnownErrorJson): ConstructorParameters<typeof KnownError>;
    static fromJson(json: KnownErrorJson): KnownError;
}
declare const knownErrorConstructorErrorCodeSentinel: unique symbol;
/**
 * Exists solely so that known errors are nominative types (ie. two KnownErrors with the same interface are not the same type)
 */
type KnownErrorBrand<ErrorCode extends string> = {
    /**
     * Does not exist at runtime
     *
     * Must be an object because it may be true for multiple error codes (it's true for all parents)
     */
    [knownErrorConstructorErrorCodeSentinel]: {
        [K in ErrorCode]: true;
    };
};
type KnownErrors = {
    [K in keyof typeof KnownErrors]: InstanceType<typeof KnownErrors[K]>;
};
declare const KnownErrors: {
    CannotDeleteCurrentSession: KnownErrorConstructor<KnownError & KnownErrorBrand<"REFRESH_TOKEN_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"CANNOT_DELETE_CURRENT_SESSION">, []> & {
        errorCode: "CANNOT_DELETE_CURRENT_SESSION";
    };
    UnsupportedError: KnownErrorConstructor<KnownError & KnownErrorBrand<"UNSUPPORTED_ERROR">, [originalErrorCode: string]> & {
        errorCode: "UNSUPPORTED_ERROR";
    };
    BodyParsingError: KnownErrorConstructor<KnownError & KnownErrorBrand<"BODY_PARSING_ERROR">, [message: string]> & {
        errorCode: "BODY_PARSING_ERROR";
    };
    SchemaError: KnownErrorConstructor<KnownError & KnownErrorBrand<"SCHEMA_ERROR">, [message: string]> & {
        errorCode: "SCHEMA_ERROR";
    };
    AllOverloadsFailed: KnownErrorConstructor<KnownError & KnownErrorBrand<"ALL_OVERLOADS_FAILED">, [overloadErrors: Json[]]> & {
        errorCode: "ALL_OVERLOADS_FAILED";
    };
    ProjectAuthenticationError: KnownErrorConstructor<KnownError & KnownErrorBrand<"PROJECT_AUTHENTICATION_ERROR">, [statusCode: number, humanReadableMessage: string, details?: Json | undefined]> & {
        errorCode: "PROJECT_AUTHENTICATION_ERROR";
    };
    PermissionIdAlreadyExists: KnownErrorConstructor<KnownError & KnownErrorBrand<"PERMISSION_ID_ALREADY_EXISTS">, [permissionId: string]> & {
        errorCode: "PERMISSION_ID_ALREADY_EXISTS";
    };
    CliAuthError: KnownErrorConstructor<KnownError & KnownErrorBrand<"CLI_AUTH_ERROR">, [message: string]> & {
        errorCode: "CLI_AUTH_ERROR";
    };
    CliAuthExpiredError: KnownErrorConstructor<KnownError & KnownErrorBrand<"CLI_AUTH_EXPIRED_ERROR">, [message?: string | undefined]> & {
        errorCode: "CLI_AUTH_EXPIRED_ERROR";
    };
    CliAuthUsedError: KnownErrorConstructor<KnownError & KnownErrorBrand<"CLI_AUTH_USED_ERROR">, [message?: string | undefined]> & {
        errorCode: "CLI_AUTH_USED_ERROR";
    };
    InvalidProjectAuthentication: KnownErrorConstructor<KnownError & KnownErrorBrand<"PROJECT_AUTHENTICATION_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"INVALID_PROJECT_AUTHENTICATION">, [statusCode: number, humanReadableMessage: string, details?: Json | undefined]> & {
        errorCode: "INVALID_PROJECT_AUTHENTICATION";
    };
    ProjectKeyWithoutAccessType: KnownErrorConstructor<KnownError & KnownErrorBrand<"PROJECT_AUTHENTICATION_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"INVALID_PROJECT_AUTHENTICATION"> & KnownErrorBrand<"PROJECT_KEY_WITHOUT_ACCESS_TYPE">, []> & {
        errorCode: "PROJECT_KEY_WITHOUT_ACCESS_TYPE";
    };
    InvalidAccessType: KnownErrorConstructor<KnownError & KnownErrorBrand<"PROJECT_AUTHENTICATION_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"INVALID_PROJECT_AUTHENTICATION"> & KnownErrorBrand<"INVALID_ACCESS_TYPE">, [accessType: string]> & {
        errorCode: "INVALID_ACCESS_TYPE";
    };
    AccessTypeWithoutProjectId: KnownErrorConstructor<KnownError & KnownErrorBrand<"PROJECT_AUTHENTICATION_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"INVALID_PROJECT_AUTHENTICATION"> & KnownErrorBrand<"ACCESS_TYPE_WITHOUT_PROJECT_ID">, [accessType: "client" | "server" | "admin"]> & {
        errorCode: "ACCESS_TYPE_WITHOUT_PROJECT_ID";
    };
    AccessTypeRequired: KnownErrorConstructor<KnownError & KnownErrorBrand<"PROJECT_AUTHENTICATION_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"INVALID_PROJECT_AUTHENTICATION"> & KnownErrorBrand<"ACCESS_TYPE_REQUIRED">, []> & {
        errorCode: "ACCESS_TYPE_REQUIRED";
    };
    CannotGetOwnUserWithoutUser: KnownErrorConstructor<KnownError & KnownErrorBrand<"CANNOT_GET_OWN_USER_WITHOUT_USER">, []> & {
        errorCode: "CANNOT_GET_OWN_USER_WITHOUT_USER";
    };
    InsufficientAccessType: KnownErrorConstructor<KnownError & KnownErrorBrand<"PROJECT_AUTHENTICATION_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"INVALID_PROJECT_AUTHENTICATION"> & KnownErrorBrand<"INSUFFICIENT_ACCESS_TYPE">, [actualAccessType: "client" | "server" | "admin", allowedAccessTypes: ("client" | "server" | "admin")[]]> & {
        errorCode: "INSUFFICIENT_ACCESS_TYPE";
    };
    InvalidPublishableClientKey: KnownErrorConstructor<KnownError & KnownErrorBrand<"PROJECT_AUTHENTICATION_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"INVALID_PROJECT_AUTHENTICATION"> & KnownErrorBrand<"INVALID_PUBLISHABLE_CLIENT_KEY">, [projectId: string]> & {
        errorCode: "INVALID_PUBLISHABLE_CLIENT_KEY";
    };
    InvalidSecretServerKey: KnownErrorConstructor<KnownError & KnownErrorBrand<"PROJECT_AUTHENTICATION_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"INVALID_PROJECT_AUTHENTICATION"> & KnownErrorBrand<"INVALID_SECRET_SERVER_KEY">, [projectId: string]> & {
        errorCode: "INVALID_SECRET_SERVER_KEY";
    };
    InvalidSuperSecretAdminKey: KnownErrorConstructor<KnownError & KnownErrorBrand<"PROJECT_AUTHENTICATION_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"INVALID_PROJECT_AUTHENTICATION"> & KnownErrorBrand<"INVALID_SUPER_SECRET_ADMIN_KEY">, [projectId: string]> & {
        errorCode: "INVALID_SUPER_SECRET_ADMIN_KEY";
    };
    InvalidAdminAccessToken: KnownErrorConstructor<KnownError & KnownErrorBrand<"PROJECT_AUTHENTICATION_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"INVALID_PROJECT_AUTHENTICATION"> & KnownErrorBrand<"INVALID_ADMIN_ACCESS_TOKEN">, [statusCode: number, humanReadableMessage: string, details?: Json | undefined]> & {
        errorCode: "INVALID_ADMIN_ACCESS_TOKEN";
    };
    UnparsableAdminAccessToken: KnownErrorConstructor<KnownError & KnownErrorBrand<"PROJECT_AUTHENTICATION_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"INVALID_PROJECT_AUTHENTICATION"> & KnownErrorBrand<"INVALID_ADMIN_ACCESS_TOKEN"> & KnownErrorBrand<"UNPARSABLE_ADMIN_ACCESS_TOKEN">, []> & {
        errorCode: "UNPARSABLE_ADMIN_ACCESS_TOKEN";
    };
    AdminAccessTokenExpired: KnownErrorConstructor<KnownError & KnownErrorBrand<"PROJECT_AUTHENTICATION_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"INVALID_PROJECT_AUTHENTICATION"> & KnownErrorBrand<"INVALID_ADMIN_ACCESS_TOKEN"> & KnownErrorBrand<"ADMIN_ACCESS_TOKEN_EXPIRED">, [expiredAt: Date | undefined]> & {
        errorCode: "ADMIN_ACCESS_TOKEN_EXPIRED";
    };
    InvalidProjectForAdminAccessToken: KnownErrorConstructor<KnownError & KnownErrorBrand<"PROJECT_AUTHENTICATION_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"INVALID_PROJECT_AUTHENTICATION"> & KnownErrorBrand<"INVALID_ADMIN_ACCESS_TOKEN"> & KnownErrorBrand<"INVALID_PROJECT_FOR_ADMIN_ACCESS_TOKEN">, []> & {
        errorCode: "INVALID_PROJECT_FOR_ADMIN_ACCESS_TOKEN";
    };
    AdminAccessTokenIsNotAdmin: KnownErrorConstructor<KnownError & KnownErrorBrand<"PROJECT_AUTHENTICATION_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"INVALID_PROJECT_AUTHENTICATION"> & KnownErrorBrand<"INVALID_ADMIN_ACCESS_TOKEN"> & KnownErrorBrand<"ADMIN_ACCESS_TOKEN_IS_NOT_ADMIN">, []> & {
        errorCode: "ADMIN_ACCESS_TOKEN_IS_NOT_ADMIN";
    };
    ProjectAuthenticationRequired: KnownErrorConstructor<KnownError & KnownErrorBrand<"PROJECT_AUTHENTICATION_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"PROJECT_AUTHENTICATION_REQUIRED">, [statusCode: number, humanReadableMessage: string, details?: Json | undefined]> & {
        errorCode: "PROJECT_AUTHENTICATION_REQUIRED";
    };
    ClientAuthenticationRequired: KnownErrorConstructor<KnownError & KnownErrorBrand<"PROJECT_AUTHENTICATION_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"PROJECT_AUTHENTICATION_REQUIRED"> & KnownErrorBrand<"CLIENT_AUTHENTICATION_REQUIRED">, []> & {
        errorCode: "CLIENT_AUTHENTICATION_REQUIRED";
    };
    ServerAuthenticationRequired: KnownErrorConstructor<KnownError & KnownErrorBrand<"PROJECT_AUTHENTICATION_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"PROJECT_AUTHENTICATION_REQUIRED"> & KnownErrorBrand<"SERVER_AUTHENTICATION_REQUIRED">, []> & {
        errorCode: "SERVER_AUTHENTICATION_REQUIRED";
    };
    ClientOrServerAuthenticationRequired: KnownErrorConstructor<KnownError & KnownErrorBrand<"PROJECT_AUTHENTICATION_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"PROJECT_AUTHENTICATION_REQUIRED"> & KnownErrorBrand<"CLIENT_OR_SERVER_AUTHENTICATION_REQUIRED">, []> & {
        errorCode: "CLIENT_OR_SERVER_AUTHENTICATION_REQUIRED";
    };
    ClientOrAdminAuthenticationRequired: KnownErrorConstructor<KnownError & KnownErrorBrand<"PROJECT_AUTHENTICATION_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"PROJECT_AUTHENTICATION_REQUIRED"> & KnownErrorBrand<"CLIENT_OR_ADMIN_AUTHENTICATION_REQUIRED">, []> & {
        errorCode: "CLIENT_OR_ADMIN_AUTHENTICATION_REQUIRED";
    };
    ClientOrServerOrAdminAuthenticationRequired: KnownErrorConstructor<KnownError & KnownErrorBrand<"PROJECT_AUTHENTICATION_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"PROJECT_AUTHENTICATION_REQUIRED"> & KnownErrorBrand<"CLIENT_OR_SERVER_OR_ADMIN_AUTHENTICATION_REQUIRED">, []> & {
        errorCode: "CLIENT_OR_SERVER_OR_ADMIN_AUTHENTICATION_REQUIRED";
    };
    AdminAuthenticationRequired: KnownErrorConstructor<KnownError & KnownErrorBrand<"PROJECT_AUTHENTICATION_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"PROJECT_AUTHENTICATION_REQUIRED"> & KnownErrorBrand<"ADMIN_AUTHENTICATION_REQUIRED">, []> & {
        errorCode: "ADMIN_AUTHENTICATION_REQUIRED";
    };
    ExpectedInternalProject: KnownErrorConstructor<KnownError & KnownErrorBrand<"PROJECT_AUTHENTICATION_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"EXPECTED_INTERNAL_PROJECT">, []> & {
        errorCode: "EXPECTED_INTERNAL_PROJECT";
    };
    SessionAuthenticationError: KnownErrorConstructor<KnownError & KnownErrorBrand<"SESSION_AUTHENTICATION_ERROR">, [statusCode: number, humanReadableMessage: string, details?: Json | undefined]> & {
        errorCode: "SESSION_AUTHENTICATION_ERROR";
    };
    InvalidSessionAuthentication: KnownErrorConstructor<KnownError & KnownErrorBrand<"SESSION_AUTHENTICATION_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"INVALID_SESSION_AUTHENTICATION">, [statusCode: number, humanReadableMessage: string, details?: Json | undefined]> & {
        errorCode: "INVALID_SESSION_AUTHENTICATION";
    };
    InvalidAccessToken: KnownErrorConstructor<KnownError & KnownErrorBrand<"SESSION_AUTHENTICATION_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"INVALID_SESSION_AUTHENTICATION"> & KnownErrorBrand<"INVALID_ACCESS_TOKEN">, [statusCode: number, humanReadableMessage: string, details?: Json | undefined]> & {
        errorCode: "INVALID_ACCESS_TOKEN";
    };
    UnparsableAccessToken: KnownErrorConstructor<KnownError & KnownErrorBrand<"SESSION_AUTHENTICATION_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"INVALID_SESSION_AUTHENTICATION"> & KnownErrorBrand<"INVALID_ACCESS_TOKEN"> & KnownErrorBrand<"UNPARSABLE_ACCESS_TOKEN">, []> & {
        errorCode: "UNPARSABLE_ACCESS_TOKEN";
    };
    AccessTokenExpired: KnownErrorConstructor<KnownError & KnownErrorBrand<"SESSION_AUTHENTICATION_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"INVALID_SESSION_AUTHENTICATION"> & KnownErrorBrand<"INVALID_ACCESS_TOKEN"> & KnownErrorBrand<"ACCESS_TOKEN_EXPIRED">, [Date | undefined]> & {
        errorCode: "ACCESS_TOKEN_EXPIRED";
    };
    InvalidProjectForAccessToken: KnownErrorConstructor<KnownError & KnownErrorBrand<"SESSION_AUTHENTICATION_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"INVALID_SESSION_AUTHENTICATION"> & KnownErrorBrand<"INVALID_ACCESS_TOKEN"> & KnownErrorBrand<"INVALID_PROJECT_FOR_ACCESS_TOKEN">, [expectedProjectId: string, actualProjectId: string]> & {
        errorCode: "INVALID_PROJECT_FOR_ACCESS_TOKEN";
    };
    RefreshTokenError: KnownErrorConstructor<KnownError & KnownErrorBrand<"REFRESH_TOKEN_ERROR">, [statusCode: number, humanReadableMessage: string, details?: Json | undefined]> & {
        errorCode: "REFRESH_TOKEN_ERROR";
    };
    ProviderRejected: KnownErrorConstructor<KnownError & KnownErrorBrand<"REFRESH_TOKEN_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"PROVIDER_REJECTED">, []> & {
        errorCode: "PROVIDER_REJECTED";
    };
    RefreshTokenNotFoundOrExpired: KnownErrorConstructor<KnownError & KnownErrorBrand<"REFRESH_TOKEN_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"REFRESH_TOKEN_NOT_FOUND_OR_EXPIRED">, []> & {
        errorCode: "REFRESH_TOKEN_NOT_FOUND_OR_EXPIRED";
    };
    UserWithEmailAlreadyExists: KnownErrorConstructor<KnownError & KnownErrorBrand<"USER_EMAIL_ALREADY_EXISTS">, [email: string]> & {
        errorCode: "USER_EMAIL_ALREADY_EXISTS";
    };
    EmailNotVerified: KnownErrorConstructor<KnownError & KnownErrorBrand<"EMAIL_NOT_VERIFIED">, []> & {
        errorCode: "EMAIL_NOT_VERIFIED";
    };
    UserIdDoesNotExist: KnownErrorConstructor<KnownError & KnownErrorBrand<"USER_ID_DOES_NOT_EXIST">, [userId: string]> & {
        errorCode: "USER_ID_DOES_NOT_EXIST";
    };
    UserNotFound: KnownErrorConstructor<KnownError & KnownErrorBrand<"USER_NOT_FOUND">, []> & {
        errorCode: "USER_NOT_FOUND";
    };
    ApiKeyNotFound: KnownErrorConstructor<KnownError & KnownErrorBrand<"API_KEY_NOT_VALID"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"API_KEY_NOT_FOUND">, []> & {
        errorCode: "API_KEY_NOT_FOUND";
    };
    PublicApiKeyCannotBeRevoked: KnownErrorConstructor<KnownError & KnownErrorBrand<"API_KEY_NOT_VALID"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"PUBLIC_API_KEY_CANNOT_BE_REVOKED">, []> & {
        errorCode: "PUBLIC_API_KEY_CANNOT_BE_REVOKED";
    };
    ProjectNotFound: KnownErrorConstructor<KnownError & KnownErrorBrand<"PROJECT_NOT_FOUND">, [projectId: string]> & {
        errorCode: "PROJECT_NOT_FOUND";
    };
    BranchDoesNotExist: KnownErrorConstructor<KnownError & KnownErrorBrand<"BRANCH_DOES_NOT_EXIST">, [branchId: string]> & {
        errorCode: "BRANCH_DOES_NOT_EXIST";
    };
    SignUpNotEnabled: KnownErrorConstructor<KnownError & KnownErrorBrand<"SIGN_UP_NOT_ENABLED">, []> & {
        errorCode: "SIGN_UP_NOT_ENABLED";
    };
    PasswordAuthenticationNotEnabled: KnownErrorConstructor<KnownError & KnownErrorBrand<"PASSWORD_AUTHENTICATION_NOT_ENABLED">, []> & {
        errorCode: "PASSWORD_AUTHENTICATION_NOT_ENABLED";
    };
    PasskeyAuthenticationNotEnabled: KnownErrorConstructor<KnownError & KnownErrorBrand<"PASSKEY_AUTHENTICATION_NOT_ENABLED">, []> & {
        errorCode: "PASSKEY_AUTHENTICATION_NOT_ENABLED";
    };
    AnonymousAccountsNotEnabled: KnownErrorConstructor<KnownError & KnownErrorBrand<"ANONYMOUS_ACCOUNTS_NOT_ENABLED">, []> & {
        errorCode: "ANONYMOUS_ACCOUNTS_NOT_ENABLED";
    };
    EmailPasswordMismatch: KnownErrorConstructor<KnownError & KnownErrorBrand<"EMAIL_PASSWORD_MISMATCH">, []> & {
        errorCode: "EMAIL_PASSWORD_MISMATCH";
    };
    RedirectUrlNotWhitelisted: KnownErrorConstructor<KnownError & KnownErrorBrand<"REDIRECT_URL_NOT_WHITELISTED">, []> & {
        errorCode: "REDIRECT_URL_NOT_WHITELISTED";
    };
    PasswordRequirementsNotMet: KnownErrorConstructor<KnownError & KnownErrorBrand<"PASSWORD_REQUIREMENTS_NOT_MET">, [statusCode: number, humanReadableMessage: string, details?: Json | undefined]> & {
        errorCode: "PASSWORD_REQUIREMENTS_NOT_MET";
    };
    PasswordTooShort: KnownErrorConstructor<KnownError & KnownErrorBrand<"PASSWORD_REQUIREMENTS_NOT_MET"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"PASSWORD_TOO_SHORT">, [minLength: number]> & {
        errorCode: "PASSWORD_TOO_SHORT";
    };
    PasswordTooLong: KnownErrorConstructor<KnownError & KnownErrorBrand<"PASSWORD_REQUIREMENTS_NOT_MET"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"PASSWORD_TOO_LONG">, [maxLength: number]> & {
        errorCode: "PASSWORD_TOO_LONG";
    };
    UserDoesNotHavePassword: KnownErrorConstructor<KnownError & KnownErrorBrand<"USER_DOES_NOT_HAVE_PASSWORD">, []> & {
        errorCode: "USER_DOES_NOT_HAVE_PASSWORD";
    };
    VerificationCodeError: KnownErrorConstructor<KnownError & KnownErrorBrand<"VERIFICATION_ERROR">, [statusCode: number, humanReadableMessage: string, details?: Json | undefined]> & {
        errorCode: "VERIFICATION_ERROR";
    };
    VerificationCodeNotFound: KnownErrorConstructor<KnownError & KnownErrorBrand<"VERIFICATION_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"VERIFICATION_CODE_NOT_FOUND">, []> & {
        errorCode: "VERIFICATION_CODE_NOT_FOUND";
    };
    VerificationCodeExpired: KnownErrorConstructor<KnownError & KnownErrorBrand<"VERIFICATION_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"VERIFICATION_CODE_EXPIRED">, []> & {
        errorCode: "VERIFICATION_CODE_EXPIRED";
    };
    VerificationCodeAlreadyUsed: KnownErrorConstructor<KnownError & KnownErrorBrand<"VERIFICATION_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"VERIFICATION_CODE_ALREADY_USED">, []> & {
        errorCode: "VERIFICATION_CODE_ALREADY_USED";
    };
    VerificationCodeMaxAttemptsReached: KnownErrorConstructor<KnownError & KnownErrorBrand<"VERIFICATION_ERROR"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"VERIFICATION_CODE_MAX_ATTEMPTS_REACHED">, []> & {
        errorCode: "VERIFICATION_CODE_MAX_ATTEMPTS_REACHED";
    };
    PasswordConfirmationMismatch: KnownErrorConstructor<KnownError & KnownErrorBrand<"PASSWORD_CONFIRMATION_MISMATCH">, []> & {
        errorCode: "PASSWORD_CONFIRMATION_MISMATCH";
    };
    EmailAlreadyVerified: KnownErrorConstructor<KnownError & KnownErrorBrand<"EMAIL_ALREADY_VERIFIED">, []> & {
        errorCode: "EMAIL_ALREADY_VERIFIED";
    };
    EmailNotAssociatedWithUser: KnownErrorConstructor<KnownError & KnownErrorBrand<"EMAIL_NOT_ASSOCIATED_WITH_USER">, []> & {
        errorCode: "EMAIL_NOT_ASSOCIATED_WITH_USER";
    };
    EmailIsNotPrimaryEmail: KnownErrorConstructor<KnownError & KnownErrorBrand<"EMAIL_IS_NOT_PRIMARY_EMAIL">, [email: string, primaryEmail: string | null]> & {
        errorCode: "EMAIL_IS_NOT_PRIMARY_EMAIL";
    };
    PasskeyRegistrationFailed: KnownErrorConstructor<KnownError & KnownErrorBrand<"PASSKEY_REGISTRATION_FAILED">, [message: string]> & {
        errorCode: "PASSKEY_REGISTRATION_FAILED";
    };
    PasskeyWebAuthnError: KnownErrorConstructor<KnownError & KnownErrorBrand<"PASSKEY_WEBAUTHN_ERROR">, [message: string, code: string]> & {
        errorCode: "PASSKEY_WEBAUTHN_ERROR";
    };
    PasskeyAuthenticationFailed: KnownErrorConstructor<KnownError & KnownErrorBrand<"PASSKEY_AUTHENTICATION_FAILED">, [message: string]> & {
        errorCode: "PASSKEY_AUTHENTICATION_FAILED";
    };
    PermissionNotFound: KnownErrorConstructor<KnownError & KnownErrorBrand<"PERMISSION_NOT_FOUND">, [permissionId: string]> & {
        errorCode: "PERMISSION_NOT_FOUND";
    };
    PermissionScopeMismatch: KnownErrorConstructor<KnownError & KnownErrorBrand<"WRONG_PERMISSION_SCOPE">, [permissionId: string, expectedScope: "project" | "team", actualScope: "project" | "team" | null]> & {
        errorCode: "WRONG_PERMISSION_SCOPE";
    };
    ContainedPermissionNotFound: KnownErrorConstructor<KnownError & KnownErrorBrand<"CONTAINED_PERMISSION_NOT_FOUND">, [permissionId: string]> & {
        errorCode: "CONTAINED_PERMISSION_NOT_FOUND";
    };
    TeamNotFound: KnownErrorConstructor<KnownError & KnownErrorBrand<"TEAM_NOT_FOUND">, [teamId: string]> & {
        errorCode: "TEAM_NOT_FOUND";
    };
    TeamMembershipNotFound: KnownErrorConstructor<KnownError & KnownErrorBrand<"TEAM_MEMBERSHIP_NOT_FOUND">, [teamId: string, userId: string]> & {
        errorCode: "TEAM_MEMBERSHIP_NOT_FOUND";
    };
    EmailTemplateAlreadyExists: KnownErrorConstructor<KnownError & KnownErrorBrand<"EMAIL_TEMPLATE_ALREADY_EXISTS">, []> & {
        errorCode: "EMAIL_TEMPLATE_ALREADY_EXISTS";
    };
    OAuthConnectionNotConnectedToUser: KnownErrorConstructor<KnownError & KnownErrorBrand<"OAUTH_CONNECTION_NOT_CONNECTED_TO_USER">, []> & {
        errorCode: "OAUTH_CONNECTION_NOT_CONNECTED_TO_USER";
    };
    OAuthConnectionAlreadyConnectedToAnotherUser: KnownErrorConstructor<KnownError & KnownErrorBrand<"OAUTH_CONNECTION_ALREADY_CONNECTED_TO_ANOTHER_USER">, []> & {
        errorCode: "OAUTH_CONNECTION_ALREADY_CONNECTED_TO_ANOTHER_USER";
    };
    OAuthConnectionDoesNotHaveRequiredScope: KnownErrorConstructor<KnownError & KnownErrorBrand<"OAUTH_CONNECTION_DOES_NOT_HAVE_REQUIRED_SCOPE">, []> & {
        errorCode: "OAUTH_CONNECTION_DOES_NOT_HAVE_REQUIRED_SCOPE";
    };
    OAuthExtraScopeNotAvailableWithSharedOAuthKeys: KnownErrorConstructor<KnownError & KnownErrorBrand<"OAUTH_EXTRA_SCOPE_NOT_AVAILABLE_WITH_SHARED_OAUTH_KEYS">, []> & {
        errorCode: "OAUTH_EXTRA_SCOPE_NOT_AVAILABLE_WITH_SHARED_OAUTH_KEYS";
    };
    OAuthAccessTokenNotAvailableWithSharedOAuthKeys: KnownErrorConstructor<KnownError & KnownErrorBrand<"OAUTH_ACCESS_TOKEN_NOT_AVAILABLE_WITH_SHARED_OAUTH_KEYS">, []> & {
        errorCode: "OAUTH_ACCESS_TOKEN_NOT_AVAILABLE_WITH_SHARED_OAUTH_KEYS";
    };
    InvalidOAuthClientIdOrSecret: KnownErrorConstructor<KnownError & KnownErrorBrand<"INVALID_OAUTH_CLIENT_ID_OR_SECRET">, [clientId?: string | undefined]> & {
        errorCode: "INVALID_OAUTH_CLIENT_ID_OR_SECRET";
    };
    InvalidScope: KnownErrorConstructor<KnownError & KnownErrorBrand<"INVALID_SCOPE">, [scope: string]> & {
        errorCode: "INVALID_SCOPE";
    };
    UserAlreadyConnectedToAnotherOAuthConnection: KnownErrorConstructor<KnownError & KnownErrorBrand<"USER_ALREADY_CONNECTED_TO_ANOTHER_OAUTH_CONNECTION">, []> & {
        errorCode: "USER_ALREADY_CONNECTED_TO_ANOTHER_OAUTH_CONNECTION";
    };
    OuterOAuthTimeout: KnownErrorConstructor<KnownError & KnownErrorBrand<"OUTER_OAUTH_TIMEOUT">, []> & {
        errorCode: "OUTER_OAUTH_TIMEOUT";
    };
    OAuthProviderNotFoundOrNotEnabled: KnownErrorConstructor<KnownError & KnownErrorBrand<"OAUTH_PROVIDER_NOT_FOUND_OR_NOT_ENABLED">, []> & {
        errorCode: "OAUTH_PROVIDER_NOT_FOUND_OR_NOT_ENABLED";
    };
    MultiFactorAuthenticationRequired: KnownErrorConstructor<KnownError & KnownErrorBrand<"MULTI_FACTOR_AUTHENTICATION_REQUIRED">, [attemptCode: string]> & {
        errorCode: "MULTI_FACTOR_AUTHENTICATION_REQUIRED";
    };
    InvalidTotpCode: KnownErrorConstructor<KnownError & KnownErrorBrand<"INVALID_TOTP_CODE">, []> & {
        errorCode: "INVALID_TOTP_CODE";
    };
    UserAuthenticationRequired: KnownErrorConstructor<KnownError & KnownErrorBrand<"USER_AUTHENTICATION_REQUIRED">, []> & {
        errorCode: "USER_AUTHENTICATION_REQUIRED";
    };
    TeamMembershipAlreadyExists: KnownErrorConstructor<KnownError & KnownErrorBrand<"TEAM_MEMBERSHIP_ALREADY_EXISTS">, []> & {
        errorCode: "TEAM_MEMBERSHIP_ALREADY_EXISTS";
    };
    ProjectPermissionRequired: KnownErrorConstructor<KnownError & KnownErrorBrand<"PROJECT_PERMISSION_REQUIRED">, [any, any]> & {
        errorCode: "PROJECT_PERMISSION_REQUIRED";
    };
    TeamPermissionRequired: KnownErrorConstructor<KnownError & KnownErrorBrand<"TEAM_PERMISSION_REQUIRED">, [any, any, any]> & {
        errorCode: "TEAM_PERMISSION_REQUIRED";
    };
    InvalidSharedOAuthProviderId: KnownErrorConstructor<KnownError & KnownErrorBrand<"INVALID_SHARED_OAUTH_PROVIDER_ID">, [any]> & {
        errorCode: "INVALID_SHARED_OAUTH_PROVIDER_ID";
    };
    InvalidStandardOAuthProviderId: KnownErrorConstructor<KnownError & KnownErrorBrand<"INVALID_STANDARD_OAUTH_PROVIDER_ID">, [any]> & {
        errorCode: "INVALID_STANDARD_OAUTH_PROVIDER_ID";
    };
    InvalidAuthorizationCode: KnownErrorConstructor<KnownError & KnownErrorBrand<"INVALID_AUTHORIZATION_CODE">, []> & {
        errorCode: "INVALID_AUTHORIZATION_CODE";
    };
    TeamPermissionNotFound: KnownErrorConstructor<KnownError & KnownErrorBrand<"TEAM_PERMISSION_NOT_FOUND">, [any, any, any]> & {
        errorCode: "TEAM_PERMISSION_NOT_FOUND";
    };
    OAuthProviderAccessDenied: KnownErrorConstructor<KnownError & KnownErrorBrand<"OAUTH_PROVIDER_ACCESS_DENIED">, []> & {
        errorCode: "OAUTH_PROVIDER_ACCESS_DENIED";
    };
    ContactChannelAlreadyUsedForAuthBySomeoneElse: KnownErrorConstructor<KnownError & KnownErrorBrand<"CONTACT_CHANNEL_ALREADY_USED_FOR_AUTH_BY_SOMEONE_ELSE">, [type: "email", contactChannelValue?: string | undefined]> & {
        errorCode: "CONTACT_CHANNEL_ALREADY_USED_FOR_AUTH_BY_SOMEONE_ELSE";
    };
    InvalidPollingCodeError: KnownErrorConstructor<KnownError & KnownErrorBrand<"INVALID_POLLING_CODE">, [details?: Json | undefined]> & {
        errorCode: "INVALID_POLLING_CODE";
    };
    ApiKeyNotValid: KnownErrorConstructor<KnownError & KnownErrorBrand<"API_KEY_NOT_VALID">, [statusCode: number, humanReadableMessage: string, details?: Json | undefined]> & {
        errorCode: "API_KEY_NOT_VALID";
    };
    ApiKeyExpired: KnownErrorConstructor<KnownError & KnownErrorBrand<"API_KEY_NOT_VALID"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"API_KEY_EXPIRED">, []> & {
        errorCode: "API_KEY_EXPIRED";
    };
    ApiKeyRevoked: KnownErrorConstructor<KnownError & KnownErrorBrand<"API_KEY_NOT_VALID"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"API_KEY_REVOKED">, []> & {
        errorCode: "API_KEY_REVOKED";
    };
    WrongApiKeyType: KnownErrorConstructor<KnownError & KnownErrorBrand<"API_KEY_NOT_VALID"> & {
        constructorArgs: [statusCode: number, humanReadableMessage: string, details?: Json | undefined];
    } & KnownErrorBrand<"WRONG_API_KEY_TYPE">, [expectedType: string, actualType: string]> & {
        errorCode: "WRONG_API_KEY_TYPE";
    };
};

export { type AbstractKnownErrorConstructor, KnownError, type KnownErrorConstructor, type KnownErrorJson, KnownErrors };
