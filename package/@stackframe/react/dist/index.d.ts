import { KnownErrors } from '@stackframe/stack-shared';
import { CurrentUserCrud } from '@stackframe/stack-shared/dist/interface/crud/current-user';
import { Result } from '@stackframe/stack-shared/dist/utils/results';
import { ProviderType } from '@stackframe/stack-shared/dist/utils/oauth';
import { ProductionModeError } from '@stackframe/stack-shared/dist/helpers/production-mode';
import { EmailTemplateType } from '@stackframe/stack-shared/dist/interface/crud/email-templates';
import { InternalSession } from '@stackframe/stack-shared/dist/sessions';
import { InternalApiKeysCrud } from '@stackframe/stack-shared/dist/interface/crud/internal-api-keys';
import { ReadonlyJson } from '@stackframe/stack-shared/dist/utils/json';
import { PrettifyType, IfAndOnlyIf } from '@stackframe/stack-shared/dist/utils/types';
import { GeoInfo } from '@stackframe/stack-shared/dist/utils/geo';
import * as react_jsx_runtime from 'react/jsx-runtime';
import { icons } from 'lucide-react';
import React$1 from 'react';

type RedirectToOptions = {
    replace?: boolean;
    noRedirectBack?: boolean;
};
type AsyncStoreProperty<Name extends string, Args extends any[], Value, IsMultiple extends boolean> = {
    [key in `${IsMultiple extends true ? "list" : "get"}${Capitalize<Name>}`]: (...args: Args) => Promise<Value>;
} & {
    [key in `use${Capitalize<Name>}`]: (...args: Args) => Value;
};
type EmailConfig = {
    host: string;
    port: number;
    username: string;
    password: string;
    senderEmail: string;
    senderName: string;
};
type RedirectMethod = "window" | "none" | {
    useNavigate: () => (to: string) => void;
    navigate?: (to: string) => void;
};
type GetUserOptions$1<HasTokenStore> = {
    or?: 'redirect' | 'throw' | 'return-null' | 'anonymous' | 'anonymous-if-exists';
    tokenStore?: TokenStoreInit;
} & (HasTokenStore extends false ? {
    tokenStore: TokenStoreInit;
} : {});
type RequestLike = {
    headers: {
        get: (name: string) => string | null;
    };
};
type TokenStoreInit<HasTokenStore extends boolean = boolean> = HasTokenStore extends true ? ("cookie" | "nextjs-cookie" | "memory" | RequestLike | {
    accessToken: string;
    refreshToken: string;
}) : HasTokenStore extends false ? null : TokenStoreInit<true> | TokenStoreInit<false>;
type HandlerUrls = {
    handler: string;
    signIn: string;
    signUp: string;
    afterSignIn: string;
    afterSignUp: string;
    signOut: string;
    afterSignOut: string;
    emailVerification: string;
    passwordReset: string;
    forgotPassword: string;
    home: string;
    oauthCallback: string;
    magicLinkCallback: string;
    accountSettings: string;
    teamInvitation: string;
    error: string;
};
type OAuthScopesOnSignIn = {
    [key in ProviderType]: string[];
};
/** @internal */
declare const stackAppInternalsSymbol: unique symbol;

type AdminSentEmail = {
    id: string;
    to: string[];
    subject: string;
    recipient: string;
    sentAt: Date;
    error?: unknown;
};

type AdminEmailTemplate = {
    type: EmailTemplateType;
    subject: string;
    content: any;
    isDefault: boolean;
};
type AdminEmailTemplateUpdateOptions = {
    subject?: string;
    content?: any;
};

type InternalApiKeyBase = {
    id: string;
    description: string;
    expiresAt: Date;
    manuallyRevokedAt: Date | null;
    createdAt: Date;
    isValid(): boolean;
    whyInvalid(): "expired" | "manually-revoked" | null;
    revoke(): Promise<void>;
};
type InternalApiKeyBaseCrudRead = Pick<InternalApiKeysCrud["Admin"]["Read"], "id" | "created_at_millis" | "description" | "expires_at_millis" | "manually_revoked_at_millis">;
type InternalApiKeyFirstView = {
    publishableClientKey?: string;
    secretServerKey?: string;
    superSecretAdminKey?: string;
} & InternalApiKeyBase;
type InternalApiKey = {
    publishableClientKey: null | {
        lastFour: string;
    };
    secretServerKey: null | {
        lastFour: string;
    };
    superSecretAdminKey: null | {
        lastFour: string;
    };
} & InternalApiKeyBase;
type InternalApiKeyCreateOptions = {
    description: string;
    expiresAt: Date;
    hasPublishableClientKey: boolean;
    hasSecretServerKey: boolean;
    hasSuperSecretAdminKey: boolean;
};

type TeamPermission = {
    id: string;
};
type AdminTeamPermission = TeamPermission;
type AdminTeamPermissionDefinition = {
    id: string;
    description?: string;
    containedPermissionIds: string[];
    isDefaultUserPermission?: boolean;
};
type AdminTeamPermissionDefinitionCreateOptions = {
    id: string;
    description?: string;
    containedPermissionIds: string[];
    isDefaultUserPermission?: boolean;
};
type AdminTeamPermissionDefinitionUpdateOptions = Pick<Partial<AdminTeamPermissionDefinitionCreateOptions>, "description" | "containedPermissionIds">;
type ProjectPermission = {
    id: string;
};
type AdminProjectPermission = ProjectPermission;
type AdminProjectPermissionDefinition = {
    id: string;
    description?: string;
    containedPermissionIds: string[];
};
type AdminProjectPermissionDefinitionCreateOptions = {
    id: string;
    description?: string;
    containedPermissionIds: string[];
};
type AdminProjectPermissionDefinitionUpdateOptions = Pick<Partial<AdminProjectPermissionDefinitionCreateOptions>, "description" | "containedPermissionIds">;

type ApiKeyType = "user" | "team";
type ApiKey<Type extends ApiKeyType = ApiKeyType, IsFirstView extends boolean = false> = {
    id: string;
    description: string;
    expiresAt?: Date;
    manuallyRevokedAt?: Date | null;
    createdAt: Date;
    value: IfAndOnlyIf<IsFirstView, true, string, {
        lastFour: string;
    }>;
    update(options: ApiKeyUpdateOptions<Type>): Promise<void>;
    revoke: () => Promise<void>;
    isValid: () => boolean;
    whyInvalid: () => "manually-revoked" | "expired" | null;
} & (("user" extends Type ? {
    type: "user";
    userId: string;
} : never) | ("team" extends Type ? {
    type: "team";
    teamId: string;
} : never));
type UserApiKeyFirstView = PrettifyType<ApiKey<"user", true>>;
type UserApiKey = PrettifyType<ApiKey<"user", false>>;
type TeamApiKeyFirstView = PrettifyType<ApiKey<"team", true>>;
type TeamApiKey = PrettifyType<ApiKey<"team", false>>;
type ApiKeyCreationOptions<Type extends ApiKeyType = ApiKeyType> = {
    description: string;
    expiresAt: Date | null;
    /**
     * Whether the API key should be considered public. A public API key will not be detected by the secret scanner, which
     * automatically revokes API keys when it detects that they may have been exposed to the public.
     */
    isPublic?: boolean;
};
type ApiKeyUpdateOptions<Type extends ApiKeyType = ApiKeyType> = {
    description?: string;
    expiresAt?: Date | null;
    revoked?: boolean;
};

type Connection = {
    id: string;
};
type OAuthConnection = {
    getAccessToken(): Promise<{
        accessToken: string;
    }>;
    useAccessToken(): {
        accessToken: string;
    };
} & Connection;

type ContactChannel = {
    id: string;
    value: string;
    type: 'email';
    isPrimary: boolean;
    isVerified: boolean;
    usedForAuth: boolean;
    sendVerificationEmail(): Promise<void>;
    update(data: ContactChannelUpdateOptions): Promise<void>;
    delete(): Promise<void>;
};
type ContactChannelCreateOptions = {
    value: string;
    type: 'email';
    usedForAuth: boolean;
    isPrimary?: boolean;
};
type ContactChannelUpdateOptions = {
    usedForAuth?: boolean;
    value?: string;
    isPrimary?: boolean;
};
type ServerContactChannel = ContactChannel & {
    update(data: ServerContactChannelUpdateOptions): Promise<void>;
};
type ServerContactChannelUpdateOptions = ContactChannelUpdateOptions & {
    isVerified?: boolean;
};
type ServerContactChannelCreateOptions = ContactChannelCreateOptions & {
    isVerified?: boolean;
};

type Session = {
    getTokens(): Promise<{
        accessToken: string | null;
        refreshToken: string | null;
    }>;
};
/**
 * Contains everything related to the current user session.
 */
type Auth = {
    readonly _internalSession: InternalSession;
    readonly currentSession: Session;
    signOut(options?: {
        redirectUrl?: URL | string;
    }): Promise<void>;
    /**
     * Returns headers for sending authenticated HTTP requests to external servers. Most commonly used in cross-origin
     * requests. Similar to `getAuthJson`, but specifically for HTTP requests.
     *
     * If you are using `tokenStore: "cookie"`, you don't need this for same-origin requests. However, most
     * browsers now disable third-party cookies by default, so we must pass authentication tokens by header instead
     * if the client and server are on different origins.
     *
     * This function returns a header object that can be used with `fetch` or other HTTP request libraries to send
     * authenticated requests.
     *
     * On the server, you can then pass in the `Request` object to the `tokenStore` option
     * of your Stack app. Please note that CORS does not allow most headers by default, so you
     * must include `x-stack-auth` in the [`Access-Control-Allow-Headers` header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Allow-Headers)
     * of the CORS preflight response.
     *
     * If you are not using HTTP (and hence cannot set headers), you will need to use the `getAuthJson()` function
     * instead.
     *
     * Example:
     *
     * ```ts
     * // client
     * const res = await fetch("https://api.example.com", {
     *   headers: {
     *     ...await stackApp.getAuthHeaders()
     *     // you can also add your own headers here
     *   },
     * });
     *
     * // server
     * function handleRequest(req: Request) {
     *   const user = await stackServerApp.getUser({ tokenStore: req });
     *   return new Response("Welcome, " + user.displayName);
     * }
     * ```
     */
    getAuthHeaders(): Promise<{
        "x-stack-auth": string;
    }>;
    /**
     * Creates a JSON-serializable object containing the information to authenticate a user on an external server.
     * Similar to `getAuthHeaders`, but returns an object that can be sent over any protocol instead of just
     * HTTP headers.
     *
     * While `getAuthHeaders` is the recommended way to send authentication tokens over HTTP, your app may use
     * a different protocol, for example WebSockets or gRPC. This function returns a token object that can be JSON-serialized and sent to the server in any way you like.
     *
     * On the server, you can pass in this token object into the `tokenStore` option to fetch user details.
     *
     * Example:
     *
     * ```ts
     * // client
     * const res = await rpcCall(rpcEndpoint, {
     *   data: {
     *     auth: await stackApp.getAuthJson(),
     *   },
     * });
     *
     * // server
     * function handleRequest(data) {
     *   const user = await stackServerApp.getUser({ tokenStore: data.auth });
     *   return new Response("Welcome, " + user.displayName);
     * }
     * ```
     */
    getAuthJson(): Promise<{
        accessToken: string | null;
        refreshToken: string | null;
    }>;
    registerPasskey(options?: {
        hostname?: string;
    }): Promise<Result<undefined, KnownErrors["PasskeyRegistrationFailed"] | KnownErrors["PasskeyWebAuthnError"]>>;
};
/**
 * ```
 * +----------+-------------+-------------------+
 * |    \     |   !Server   |      Server       |
 * +----------+-------------+-------------------+
 * | !Session | User        | ServerUser        |
 * | Session  | CurrentUser | CurrentServerUser |
 * +----------+-------------+-------------------+
 * ```
 *
 * The fields on each of these types are available iff:
 * BaseUser: true
 * Auth: Session
 * ServerBaseUser: Server
 * UserExtra: Session OR Server
 *
 * The types are defined as follows (in the typescript manner):
 * User = BaseUser
 * CurrentUser = BaseUser & Auth & UserExtra
 * ServerUser = BaseUser & ServerBaseUser & UserExtra
 * CurrentServerUser = BaseUser & ServerBaseUser & Auth & UserExtra
 **/
type BaseUser = {
    readonly id: string;
    readonly displayName: string | null;
    /**
     * The user's email address.
     *
     * Note: This might NOT be unique across multiple users, so always use `id` for unique identification.
     */
    readonly primaryEmail: string | null;
    readonly primaryEmailVerified: boolean;
    readonly profileImageUrl: string | null;
    readonly signedUpAt: Date;
    readonly clientMetadata: any;
    readonly clientReadOnlyMetadata: any;
    /**
     * Whether the user has a password set.
     */
    readonly hasPassword: boolean;
    readonly otpAuthEnabled: boolean;
    readonly passkeyAuthEnabled: boolean;
    readonly isMultiFactorRequired: boolean;
    readonly isAnonymous: boolean;
    toClientJson(): CurrentUserCrud["Client"]["Read"];
    /**
     * @deprecated, use contact channel's usedForAuth instead
     */
    readonly emailAuthEnabled: boolean;
    /**
     * @deprecated
     */
    readonly oauthProviders: readonly {
        id: string;
    }[];
};
type UserExtra = {
    setDisplayName(displayName: string): Promise<void>;
    /** @deprecated Use contact channel's sendVerificationEmail instead */
    sendVerificationEmail(): Promise<KnownErrors["EmailAlreadyVerified"] | void>;
    setClientMetadata(metadata: any): Promise<void>;
    updatePassword(options: {
        oldPassword: string;
        newPassword: string;
    }): Promise<KnownErrors["PasswordConfirmationMismatch"] | KnownErrors["PasswordRequirementsNotMet"] | void>;
    setPassword(options: {
        password: string;
    }): Promise<KnownErrors["PasswordRequirementsNotMet"] | void>;
    /**
     * A shorthand method to update multiple fields of the user at once.
     */
    update(update: UserUpdateOptions): Promise<void>;
    useContactChannels(): ContactChannel[];
    listContactChannels(): Promise<ContactChannel[]>;
    createContactChannel(data: ContactChannelCreateOptions): Promise<ContactChannel>;
    delete(): Promise<void>;
    getConnectedAccount(id: ProviderType, options: {
        or: 'redirect';
        scopes?: string[];
    }): Promise<OAuthConnection>;
    getConnectedAccount(id: ProviderType, options?: {
        or?: 'redirect' | 'throw' | 'return-null';
        scopes?: string[];
    }): Promise<OAuthConnection | null>;
    useConnectedAccount(id: ProviderType, options: {
        or: 'redirect';
        scopes?: string[];
    }): OAuthConnection;
    useConnectedAccount(id: ProviderType, options?: {
        or?: 'redirect' | 'throw' | 'return-null';
        scopes?: string[];
    }): OAuthConnection | null;
    hasPermission(scope: Team, permissionId: string): Promise<boolean>;
    hasPermission(permissionId: string): Promise<boolean>;
    getPermission(scope: Team, permissionId: string): Promise<TeamPermission | null>;
    getPermission(permissionId: string): Promise<TeamPermission | null>;
    listPermissions(scope: Team, options?: {
        recursive?: boolean;
    }): Promise<TeamPermission[]>;
    listPermissions(options?: {
        recursive?: boolean;
    }): Promise<TeamPermission[]>;
    usePermissions(scope: Team, options?: {
        recursive?: boolean;
    }): TeamPermission[];
    usePermissions(options?: {
        recursive?: boolean;
    }): TeamPermission[];
    usePermission(scope: Team, permissionId: string): TeamPermission | null;
    usePermission(permissionId: string): TeamPermission | null;
    readonly selectedTeam: Team | null;
    setSelectedTeam(team: Team | null): Promise<void>;
    createTeam(data: TeamCreateOptions): Promise<Team>;
    leaveTeam(team: Team): Promise<void>;
    getActiveSessions(): Promise<ActiveSession[]>;
    revokeSession(sessionId: string): Promise<void>;
    getTeamProfile(team: Team): Promise<EditableTeamMemberProfile>;
    useTeamProfile(team: Team): EditableTeamMemberProfile;
    createApiKey(options: ApiKeyCreationOptions<"user">): Promise<UserApiKeyFirstView>;
} & AsyncStoreProperty<"apiKeys", [], UserApiKey[], true> & AsyncStoreProperty<"team", [id: string], Team | null, false> & AsyncStoreProperty<"teams", [], Team[], true> & AsyncStoreProperty<"permission", [scope: Team, permissionId: string, options?: {
    recursive?: boolean;
}], TeamPermission | null, false> & AsyncStoreProperty<"permissions", [scope: Team, options?: {
    recursive?: boolean;
}], TeamPermission[], true>;
type InternalUserExtra = {
    createProject(newProject: AdminProjectUpdateOptions & {
        displayName: string;
    }): Promise<AdminOwnedProject>;
} & AsyncStoreProperty<"ownedProjects", [], AdminOwnedProject[], true>;
type User = BaseUser;
type CurrentUser = BaseUser & Auth & UserExtra;
type CurrentInternalUser = CurrentUser & InternalUserExtra;
type ProjectCurrentUser<ProjectId> = ProjectId extends "internal" ? CurrentInternalUser : CurrentUser;
type ActiveSession = {
    id: string;
    userId: string;
    createdAt: Date;
    isImpersonation: boolean;
    lastUsedAt: Date | undefined;
    isCurrentSession: boolean;
    geoInfo?: GeoInfo;
};
type UserUpdateOptions = {
    displayName?: string;
    clientMetadata?: ReadonlyJson;
    selectedTeamId?: string | null;
    totpMultiFactorSecret?: Uint8Array | null;
    profileImageUrl?: string | null;
    otpAuthEnabled?: boolean;
    passkeyAuthEnabled?: boolean;
};
type ServerBaseUser = {
    setPrimaryEmail(email: string | null, options?: {
        verified?: boolean | undefined;
    }): Promise<void>;
    readonly lastActiveAt: Date;
    readonly serverMetadata: any;
    setServerMetadata(metadata: any): Promise<void>;
    setClientReadOnlyMetadata(metadata: any): Promise<void>;
    createTeam(data: Omit<ServerTeamCreateOptions, "creatorUserId">): Promise<ServerTeam>;
    useContactChannels(): ServerContactChannel[];
    listContactChannels(): Promise<ServerContactChannel[]>;
    createContactChannel(data: ServerContactChannelCreateOptions): Promise<ServerContactChannel>;
    update(user: ServerUserUpdateOptions): Promise<void>;
    grantPermission(scope: Team, permissionId: string): Promise<void>;
    grantPermission(permissionId: string): Promise<void>;
    revokePermission(scope: Team, permissionId: string): Promise<void>;
    revokePermission(permissionId: string): Promise<void>;
    getPermission(scope: Team, permissionId: string): Promise<TeamPermission | null>;
    getPermission(permissionId: string): Promise<TeamPermission | null>;
    hasPermission(scope: Team, permissionId: string): Promise<boolean>;
    hasPermission(permissionId: string): Promise<boolean>;
    listPermissions(scope: Team, options?: {
        recursive?: boolean;
    }): Promise<TeamPermission[]>;
    listPermissions(options?: {
        recursive?: boolean;
    }): Promise<TeamPermission[]>;
    usePermissions(scope: Team, options?: {
        recursive?: boolean;
    }): TeamPermission[];
    usePermissions(options?: {
        recursive?: boolean;
    }): TeamPermission[];
    usePermission(scope: Team, permissionId: string): TeamPermission | null;
    usePermission(permissionId: string): TeamPermission | null;
    /**
     * Creates a new session object with a refresh token for this user. Can be used to impersonate them.
     */
    createSession(options?: {
        expiresInMillis?: number;
        isImpersonation?: boolean;
    }): Promise<Session>;
} & AsyncStoreProperty<"team", [id: string], ServerTeam | null, false> & AsyncStoreProperty<"teams", [], ServerTeam[], true> & AsyncStoreProperty<"permission", [scope: Team, permissionId: string, options?: {
    direct?: boolean;
}], AdminTeamPermission | null, false> & AsyncStoreProperty<"permissions", [scope: Team, options?: {
    direct?: boolean;
}], AdminTeamPermission[], true>;
/**
 * A user including sensitive fields that should only be used on the server, never sent to the client
 * (such as sensitive information and serverMetadata).
 */
type ServerUser = ServerBaseUser & BaseUser & UserExtra;
type CurrentServerUser = Auth & ServerUser;
type CurrentInternalServerUser = CurrentServerUser & InternalUserExtra;
type ProjectCurrentServerUser<ProjectId> = ProjectId extends "internal" ? CurrentInternalServerUser : CurrentServerUser;
type ServerUserUpdateOptions = {
    primaryEmail?: string | null;
    primaryEmailVerified?: boolean;
    primaryEmailAuthEnabled?: boolean;
    clientReadOnlyMetadata?: ReadonlyJson;
    serverMetadata?: ReadonlyJson;
    password?: string;
} & UserUpdateOptions;
type ServerUserCreateOptions = {
    primaryEmail?: string | null;
    primaryEmailAuthEnabled?: boolean;
    password?: string;
    otpAuthEnabled?: boolean;
    displayName?: string;
    primaryEmailVerified?: boolean;
    clientMetadata?: any;
    clientReadOnlyMetadata?: any;
    serverMetadata?: any;
};

type TeamMemberProfile = {
    displayName: string | null;
    profileImageUrl: string | null;
};
type TeamMemberProfileUpdateOptions = {
    displayName?: string;
    profileImageUrl?: string | null;
};
type EditableTeamMemberProfile = TeamMemberProfile & {
    update(update: TeamMemberProfileUpdateOptions): Promise<void>;
};
type TeamUser = {
    id: string;
    teamProfile: TeamMemberProfile;
};
type TeamInvitation$1 = {
    id: string;
    recipientEmail: string | null;
    expiresAt: Date;
    revoke(): Promise<void>;
};
type Team = {
    id: string;
    displayName: string;
    profileImageUrl: string | null;
    clientMetadata: any;
    clientReadOnlyMetadata: any;
    inviteUser(options: {
        email: string;
        callbackUrl?: string;
    }): Promise<void>;
    listUsers(): Promise<TeamUser[]>;
    useUsers(): TeamUser[];
    listInvitations(): Promise<TeamInvitation$1[]>;
    useInvitations(): TeamInvitation$1[];
    update(update: TeamUpdateOptions): Promise<void>;
    delete(): Promise<void>;
    createApiKey(options: ApiKeyCreationOptions<"team">): Promise<TeamApiKeyFirstView>;
} & AsyncStoreProperty<"apiKeys", [], TeamApiKey[], true>;
type TeamUpdateOptions = {
    displayName?: string;
    profileImageUrl?: string | null;
    clientMetadata?: ReadonlyJson;
};
type TeamCreateOptions = {
    displayName: string;
    profileImageUrl?: string;
};
type ServerTeamMemberProfile = TeamMemberProfile;
type ServerTeamUser = ServerUser & {
    teamProfile: ServerTeamMemberProfile;
};
type ServerTeam = {
    createdAt: Date;
    serverMetadata: any;
    listUsers(): Promise<ServerTeamUser[]>;
    useUsers(): ServerUser[];
    update(update: ServerTeamUpdateOptions): Promise<void>;
    delete(): Promise<void>;
    addUser(userId: string): Promise<void>;
    inviteUser(options: {
        email: string;
        callbackUrl?: string;
    }): Promise<void>;
    removeUser(userId: string): Promise<void>;
} & Team;
type ServerListUsersOptions = {
    cursor?: string;
    limit?: number;
    orderBy?: 'signedUpAt';
    desc?: boolean;
    query?: string;
};
type ServerTeamCreateOptions = TeamCreateOptions & {
    creatorUserId?: string;
};
type ServerTeamUpdateOptions = TeamUpdateOptions & {
    clientReadOnlyMetadata?: ReadonlyJson;
    serverMetadata?: ReadonlyJson;
};

type StackServerAppConstructorOptions<HasTokenStore extends boolean, ProjectId extends string> = StackClientAppConstructorOptions<HasTokenStore, ProjectId> & {
    secretServerKey?: string;
};
type StackServerAppConstructor = {
    new <TokenStoreType extends string, HasTokenStore extends (TokenStoreType extends {} ? true : boolean), ProjectId extends string>(options: StackServerAppConstructorOptions<HasTokenStore, ProjectId>): StackServerApp<HasTokenStore, ProjectId>;
    new (options: StackServerAppConstructorOptions<boolean, string>): StackServerApp<boolean, string>;
};
type StackServerApp<HasTokenStore extends boolean = boolean, ProjectId extends string = string> = ({
    createTeam(data: ServerTeamCreateOptions): Promise<ServerTeam>;
    /**
     * @deprecated use `getUser()` instead
     */
    getServerUser(): Promise<ProjectCurrentServerUser<ProjectId> | null>;
    createUser(options: ServerUserCreateOptions): Promise<ServerUser>;
    useUser(options: GetUserOptions$1<HasTokenStore> & {
        or: 'redirect';
    }): ProjectCurrentServerUser<ProjectId>;
    useUser(options: GetUserOptions$1<HasTokenStore> & {
        or: 'throw';
    }): ProjectCurrentServerUser<ProjectId>;
    useUser(options: GetUserOptions$1<HasTokenStore> & {
        or: 'anonymous';
    }): ProjectCurrentServerUser<ProjectId>;
    useUser(options?: GetUserOptions$1<HasTokenStore>): ProjectCurrentServerUser<ProjectId> | null;
    useUser(id: string): ServerUser | null;
    useUser(options: {
        apiKey: string;
    }): ServerUser | null;
    getUser(options: GetUserOptions$1<HasTokenStore> & {
        or: 'redirect';
    }): Promise<ProjectCurrentServerUser<ProjectId>>;
    getUser(options: GetUserOptions$1<HasTokenStore> & {
        or: 'throw';
    }): Promise<ProjectCurrentServerUser<ProjectId>>;
    getUser(options: GetUserOptions$1<HasTokenStore> & {
        or: 'anonymous';
    }): Promise<ProjectCurrentServerUser<ProjectId>>;
    getUser(options?: GetUserOptions$1<HasTokenStore>): Promise<ProjectCurrentServerUser<ProjectId> | null>;
    getUser(id: string): Promise<ServerUser | null>;
    getUser(options: {
        apiKey: string;
    }): Promise<ServerUser | null>;
    useTeam(id: string): ServerTeam | null;
    useTeam(options: {
        apiKey: string;
    }): ServerTeam | null;
    getTeam(id: string): Promise<ServerTeam | null>;
    getTeam(options: {
        apiKey: string;
    }): Promise<ServerTeam | null>;
    useUsers(options?: ServerListUsersOptions): ServerUser[] & {
        nextCursor: string | null;
    };
    listUsers(options?: ServerListUsersOptions): Promise<ServerUser[] & {
        nextCursor: string | null;
    }>;
} & AsyncStoreProperty<"user", [id: string], ServerUser | null, false> & Omit<AsyncStoreProperty<"users", [], ServerUser[], true>, "listUsers" | "useUsers"> & AsyncStoreProperty<"teams", [], ServerTeam[], true> & StackClientApp<HasTokenStore, ProjectId>);
declare const StackServerApp: StackServerAppConstructor;

type StackAdminAppConstructorOptions<HasTokenStore extends boolean, ProjectId extends string> = ((StackServerAppConstructorOptions<HasTokenStore, ProjectId> & {
    superSecretAdminKey?: string;
}) | (Omit<StackServerAppConstructorOptions<HasTokenStore, ProjectId>, "publishableClientKey" | "secretServerKey"> & {
    projectOwnerSession: InternalSession;
}));
type StackAdminAppConstructor = {
    new <HasTokenStore extends boolean, ProjectId extends string>(options: StackAdminAppConstructorOptions<HasTokenStore, ProjectId>): StackAdminApp<HasTokenStore, ProjectId>;
    new (options: StackAdminAppConstructorOptions<boolean, string>): StackAdminApp<boolean, string>;
};
type StackAdminApp<HasTokenStore extends boolean = boolean, ProjectId extends string = string> = (AsyncStoreProperty<"project", [], AdminProject, false> & AsyncStoreProperty<"internalApiKeys", [], InternalApiKey[], true> & AsyncStoreProperty<"teamPermissionDefinitions", [], AdminTeamPermissionDefinition[], true> & AsyncStoreProperty<"projectPermissionDefinitions", [], AdminProjectPermissionDefinition[], true> & {
    useEmailTemplates(): AdminEmailTemplate[];
    listEmailTemplates(): Promise<AdminEmailTemplate[]>;
    updateEmailTemplate(type: EmailTemplateType, data: AdminEmailTemplateUpdateOptions): Promise<void>;
    resetEmailTemplate(type: EmailTemplateType): Promise<void>;
    createInternalApiKey(options: InternalApiKeyCreateOptions): Promise<InternalApiKeyFirstView>;
    createTeamPermissionDefinition(data: AdminTeamPermissionDefinitionCreateOptions): Promise<AdminTeamPermission>;
    updateTeamPermissionDefinition(permissionId: string, data: AdminTeamPermissionDefinitionUpdateOptions): Promise<void>;
    deleteTeamPermissionDefinition(permissionId: string): Promise<void>;
    createProjectPermissionDefinition(data: AdminProjectPermissionDefinitionCreateOptions): Promise<AdminProjectPermission>;
    updateProjectPermissionDefinition(permissionId: string, data: AdminProjectPermissionDefinitionUpdateOptions): Promise<void>;
    deleteProjectPermissionDefinition(permissionId: string): Promise<void>;
    useSvixToken(): string;
    sendTestEmail(options: {
        recipientEmail: string;
        emailConfig: EmailConfig;
    }): Promise<Result<undefined, {
        errorMessage: string;
    }>>;
    listSentEmails(): Promise<AdminSentEmail[]>;
} & StackServerApp<HasTokenStore, ProjectId>);
declare const StackAdminApp: StackAdminAppConstructor;

type ProjectConfig = {
    readonly signUpEnabled: boolean;
    readonly credentialEnabled: boolean;
    readonly magicLinkEnabled: boolean;
    readonly passkeyEnabled: boolean;
    readonly clientTeamCreationEnabled: boolean;
    readonly clientUserDeletionEnabled: boolean;
    readonly oauthProviders: OAuthProviderConfig[];
    readonly allowUserApiKeys: boolean;
    readonly allowTeamApiKeys: boolean;
};
type OAuthProviderConfig = {
    readonly id: string;
};
type AdminProjectConfig = {
    readonly signUpEnabled: boolean;
    readonly credentialEnabled: boolean;
    readonly magicLinkEnabled: boolean;
    readonly passkeyEnabled: boolean;
    readonly clientTeamCreationEnabled: boolean;
    readonly clientUserDeletionEnabled: boolean;
    readonly allowLocalhost: boolean;
    readonly oauthProviders: AdminOAuthProviderConfig[];
    readonly emailConfig?: AdminEmailConfig;
    readonly domains: AdminDomainConfig[];
    readonly createTeamOnSignUp: boolean;
    readonly teamCreatorDefaultPermissions: AdminTeamPermission[];
    readonly teamMemberDefaultPermissions: AdminTeamPermission[];
    readonly userDefaultPermissions: AdminTeamPermission[];
    readonly oauthAccountMergeStrategy: 'link_method' | 'raise_error' | 'allow_duplicates';
    readonly allowUserApiKeys: boolean;
    readonly allowTeamApiKeys: boolean;
};
type AdminEmailConfig = ({
    type: "standard";
    senderName: string;
    senderEmail: string;
    host: string;
    port: number;
    username: string;
    password: string;
} | {
    type: "shared";
});
type AdminDomainConfig = {
    domain: string;
    handlerPath: string;
};
type AdminOAuthProviderConfig = {
    id: string;
} & ({
    type: 'shared';
} | {
    type: 'standard';
    clientId: string;
    clientSecret: string;
    facebookConfigId?: string;
    microsoftTenantId?: string;
}) & OAuthProviderConfig;
type AdminProjectConfigUpdateOptions = {
    domains?: {
        domain: string;
        handlerPath: string;
    }[];
    oauthProviders?: AdminOAuthProviderConfig[];
    signUpEnabled?: boolean;
    credentialEnabled?: boolean;
    magicLinkEnabled?: boolean;
    passkeyEnabled?: boolean;
    clientTeamCreationEnabled?: boolean;
    clientUserDeletionEnabled?: boolean;
    allowLocalhost?: boolean;
    createTeamOnSignUp?: boolean;
    emailConfig?: AdminEmailConfig;
    teamCreatorDefaultPermissions?: {
        id: string;
    }[];
    teamMemberDefaultPermissions?: {
        id: string;
    }[];
    userDefaultPermissions?: {
        id: string;
    }[];
    oauthAccountMergeStrategy?: 'link_method' | 'raise_error' | 'allow_duplicates';
    allowUserApiKeys?: boolean;
    allowTeamApiKeys?: boolean;
};

type Project = {
    readonly id: string;
    readonly displayName: string;
    readonly config: ProjectConfig;
};
type AdminProject = {
    readonly id: string;
    readonly displayName: string;
    readonly description: string | null;
    readonly createdAt: Date;
    readonly userCount: number;
    readonly isProductionMode: boolean;
    readonly config: AdminProjectConfig;
    update(this: AdminProject, update: AdminProjectUpdateOptions): Promise<void>;
    delete(this: AdminProject): Promise<void>;
    getProductionModeErrors(this: AdminProject): Promise<ProductionModeError[]>;
    useProductionModeErrors(this: AdminProject): ProductionModeError[];
} & Project;
type AdminOwnedProject = {
    readonly app: StackAdminApp<false>;
} & AdminProject;
type AdminProjectUpdateOptions = {
    displayName?: string;
    description?: string;
    isProductionMode?: boolean;
    config?: AdminProjectConfigUpdateOptions;
};
type AdminProjectCreateOptions = Omit<AdminProjectUpdateOptions, 'displayName'> & {
    displayName: string;
};

type StackClientAppConstructorOptions<HasTokenStore extends boolean, ProjectId extends string> = {
    baseUrl?: string | {
        browser: string;
        server: string;
    };
    extraRequestHeaders?: Record<string, string>;
    projectId?: ProjectId;
    publishableClientKey?: string;
    urls?: Partial<HandlerUrls>;
    oauthScopesOnSignIn?: Partial<OAuthScopesOnSignIn>;
    tokenStore: TokenStoreInit<HasTokenStore>;
    redirectMethod?: RedirectMethod;
    /**
     * By default, the Stack app will automatically prefetch some data from Stack's server when this app is first
     * constructed. This improves the performance of your app, but will create network requests that are unnecessary if
     * the app is never used or disposed of immediately. To disable this behavior, set this option to true.
     */
    noAutomaticPrefetch?: boolean;
};
type StackClientAppJson<HasTokenStore extends boolean, ProjectId extends string> = StackClientAppConstructorOptions<HasTokenStore, ProjectId> & {
    uniqueIdentifier: string;
};
type StackClientAppConstructor = {
    new <TokenStoreType extends string, HasTokenStore extends (TokenStoreType extends {} ? true : boolean), ProjectId extends string>(options: StackClientAppConstructorOptions<HasTokenStore, ProjectId>): StackClientApp<HasTokenStore, ProjectId>;
    new (options: StackClientAppConstructorOptions<boolean, string>): StackClientApp<boolean, string>;
    [stackAppInternalsSymbol]: {
        fromClientJson<HasTokenStore extends boolean, ProjectId extends string>(json: StackClientAppJson<HasTokenStore, ProjectId>): StackClientApp<HasTokenStore, ProjectId>;
    };
};
type StackClientApp<HasTokenStore extends boolean = boolean, ProjectId extends string = string> = ({
    readonly projectId: ProjectId;
    readonly urls: Readonly<HandlerUrls>;
    signInWithOAuth(provider: string): Promise<void>;
    signInWithCredential(options: {
        email: string;
        password: string;
        noRedirect?: boolean;
    }): Promise<Result<undefined, KnownErrors["EmailPasswordMismatch"] | KnownErrors["InvalidTotpCode"]>>;
    signUpWithCredential(options: {
        email: string;
        password: string;
        noRedirect?: boolean;
        verificationCallbackUrl?: string;
    }): Promise<Result<undefined, KnownErrors["UserWithEmailAlreadyExists"] | KnownErrors["PasswordRequirementsNotMet"]>>;
    signInWithPasskey(): Promise<Result<undefined, KnownErrors["PasskeyAuthenticationFailed"] | KnownErrors["InvalidTotpCode"] | KnownErrors["PasskeyWebAuthnError"]>>;
    callOAuthCallback(): Promise<boolean>;
    promptCliLogin(options: {
        appUrl: string;
        expiresInMillis?: number;
    }): Promise<Result<string, KnownErrors["CliAuthError"] | KnownErrors["CliAuthExpiredError"] | KnownErrors["CliAuthUsedError"]>>;
    sendForgotPasswordEmail(email: string, options?: {
        callbackUrl?: string;
    }): Promise<Result<undefined, KnownErrors["UserNotFound"]>>;
    sendMagicLinkEmail(email: string, options?: {
        callbackUrl?: string;
    }): Promise<Result<{
        nonce: string;
    }, KnownErrors["RedirectUrlNotWhitelisted"]>>;
    resetPassword(options: {
        code: string;
        password: string;
    }): Promise<Result<undefined, KnownErrors["VerificationCodeError"]>>;
    verifyPasswordResetCode(code: string): Promise<Result<undefined, KnownErrors["VerificationCodeError"]>>;
    verifyTeamInvitationCode(code: string): Promise<Result<undefined, KnownErrors["VerificationCodeError"]>>;
    acceptTeamInvitation(code: string): Promise<Result<undefined, KnownErrors["VerificationCodeError"]>>;
    getTeamInvitationDetails(code: string): Promise<Result<{
        teamDisplayName: string;
    }, KnownErrors["VerificationCodeError"]>>;
    verifyEmail(code: string): Promise<Result<undefined, KnownErrors["VerificationCodeError"]>>;
    signInWithMagicLink(code: string, options?: {
        noRedirect?: boolean;
    }): Promise<Result<undefined, KnownErrors["VerificationCodeError"] | KnownErrors["InvalidTotpCode"]>>;
    redirectToOAuthCallback(): Promise<void>;
    useUser(options: GetUserOptions$1<HasTokenStore> & {
        or: 'redirect';
    }): ProjectCurrentUser<ProjectId>;
    useUser(options: GetUserOptions$1<HasTokenStore> & {
        or: 'throw';
    }): ProjectCurrentUser<ProjectId>;
    useUser(options: GetUserOptions$1<HasTokenStore> & {
        or: 'anonymous';
    }): ProjectCurrentUser<ProjectId>;
    useUser(options?: GetUserOptions$1<HasTokenStore>): ProjectCurrentUser<ProjectId> | null;
    getUser(options: GetUserOptions$1<HasTokenStore> & {
        or: 'redirect';
    }): Promise<ProjectCurrentUser<ProjectId>>;
    getUser(options: GetUserOptions$1<HasTokenStore> & {
        or: 'throw';
    }): Promise<ProjectCurrentUser<ProjectId>>;
    getUser(options: GetUserOptions$1<HasTokenStore> & {
        or: 'anonymous';
    }): Promise<ProjectCurrentUser<ProjectId>>;
    getUser(options?: GetUserOptions$1<HasTokenStore>): Promise<ProjectCurrentUser<ProjectId> | null>;
    useNavigate(): (to: string) => void;
    [stackAppInternalsSymbol]: {
        toClientJson(): StackClientAppJson<HasTokenStore, ProjectId>;
        setCurrentUser(userJsonPromise: Promise<CurrentUserCrud['Client']['Read'] | null>): void;
    };
} & AsyncStoreProperty<"project", [], Project, false> & {
    [K in `redirectTo${Capitalize<keyof Omit<HandlerUrls, 'handler' | 'oauthCallback'>>}`]: (options?: RedirectToOptions) => Promise<void>;
});
declare const StackClientApp: StackClientAppConstructor;

declare function AccountSettings(props: {
    fullPage?: boolean;
    extraItems?: ({
        title: string;
        content: React$1.ReactNode;
        id: string;
    } & ({
        icon?: React$1.ReactNode;
    } | {
        iconName?: keyof typeof icons;
    }))[];
}): react_jsx_runtime.JSX.Element;

declare function CliAuthConfirmation({ fullPage }: {
    fullPage?: boolean;
}): react_jsx_runtime.JSX.Element;

declare function EmailVerification(props: {
    searchParams?: Record<string, string>;
    fullPage?: boolean;
}): react_jsx_runtime.JSX.Element;

declare function ErrorPage(props: {
    fullPage?: boolean;
    searchParams: Record<string, string>;
}): react_jsx_runtime.JSX.Element;

declare function ForgotPassword(props: {
    fullPage?: boolean;
}): react_jsx_runtime.JSX.Element;

declare function MagicLinkCallback(props: {
    searchParams?: Record<string, string>;
    fullPage?: boolean;
}): react_jsx_runtime.JSX.Element;

declare function OAuthCallback({ fullPage }: {
    fullPage?: boolean;
}): react_jsx_runtime.JSX.Element;

declare function PasswordReset({ searchParams, fullPage, }: {
    searchParams: Record<string, string>;
    fullPage?: boolean;
}): react_jsx_runtime.JSX.Element;

declare function SignOut(props: {
    fullPage?: boolean;
}): react_jsx_runtime.JSX.Element;

declare function TeamInvitation({ fullPage, searchParams }: {
    fullPage?: boolean;
    searchParams: Record<string, string>;
}): react_jsx_runtime.JSX.Element;

type Components = {
    SignIn: typeof SignIn;
    SignUp: typeof SignUp;
    EmailVerification: typeof EmailVerification;
    PasswordReset: typeof PasswordReset;
    ForgotPassword: typeof ForgotPassword;
    SignOut: typeof SignOut;
    OAuthCallback: typeof OAuthCallback;
    MagicLinkCallback: typeof MagicLinkCallback;
    TeamInvitation: typeof TeamInvitation;
    ErrorPage: typeof ErrorPage;
    AccountSettings: typeof AccountSettings;
    CliAuthConfirmation: typeof CliAuthConfirmation;
};
type BaseHandlerProps = {
    fullPage: boolean;
    componentProps?: {
        [K in keyof Components]?: Parameters<Components[K]>[0];
    };
};
declare function ReactStackHandler<HasTokenStore extends boolean>(props: BaseHandlerProps & {
    app: StackClientApp<HasTokenStore>;
    location: string;
}): react_jsx_runtime.JSX.Element | null;

type GetUserOptions = GetUserOptions$1<true> & {
    projectIdMustMatch?: string;
};
/**
 * Returns the current user object. Equivalent to `useStackApp().useUser()`.
 *
 * @returns the current user
 */
declare function useUser(options: GetUserOptions & {
    or: 'redirect' | 'throw';
    projectIdMustMatch: "internal";
}): CurrentInternalUser;
declare function useUser(options: GetUserOptions & {
    or: 'redirect' | 'throw';
}): CurrentUser;
declare function useUser(options: GetUserOptions & {
    projectIdMustMatch: "internal";
}): CurrentInternalUser | null;
declare function useUser(options?: GetUserOptions): CurrentUser | CurrentInternalUser | null;
/**
 * Returns the current Stack app associated with the StackProvider.
 *
 * @returns the current Stack app
 */
declare function useStackApp<ProjectId extends string>(options?: {
    projectIdMustMatch?: ProjectId;
}): StackClientApp<true, ProjectId>;

declare const quetzalLocales: Map<"de-DE" | "en-US" | "es-419" | "es-ES" | "fr-CA" | "fr-FR" | "it-IT" | "pt-BR" | "pt-PT" | "zh-CN" | "zh-TW", Map<"__stack-auto-translation-0" | "__stack-auto-translation-1" | "__stack-auto-translation-2" | "__stack-auto-translation-3" | "__stack-auto-translation-4" | "__stack-auto-translation-5" | "__stack-auto-translation-6" | "__stack-auto-translation-7" | "__stack-auto-translation-8" | "__stack-auto-translation-9" | "__stack-auto-translation-10" | "__stack-auto-translation-11" | "__stack-auto-translation-12" | "__stack-auto-translation-13" | "__stack-auto-translation-14" | "__stack-auto-translation-15" | "__stack-auto-translation-16" | "__stack-auto-translation-17" | "__stack-auto-translation-18" | "__stack-auto-translation-19" | "__stack-auto-translation-20" | "__stack-auto-translation-21" | "__stack-auto-translation-22" | "__stack-auto-translation-23" | "__stack-auto-translation-24" | "__stack-auto-translation-25" | "__stack-auto-translation-26" | "__stack-auto-translation-27" | "__stack-auto-translation-28" | "__stack-auto-translation-29" | "__stack-auto-translation-30" | "__stack-auto-translation-31" | "__stack-auto-translation-32" | "__stack-auto-translation-33" | "__stack-auto-translation-34" | "__stack-auto-translation-35" | "__stack-auto-translation-36" | "__stack-auto-translation-37" | "__stack-auto-translation-38" | "__stack-auto-translation-39" | "__stack-auto-translation-40" | "__stack-auto-translation-41" | "__stack-auto-translation-42" | "__stack-auto-translation-43" | "__stack-auto-translation-44" | "__stack-auto-translation-45" | "__stack-auto-translation-46" | "__stack-auto-translation-47" | "__stack-auto-translation-48" | "__stack-auto-translation-49" | "__stack-auto-translation-50" | "__stack-auto-translation-51" | "__stack-auto-translation-52" | "__stack-auto-translation-53" | "__stack-auto-translation-54" | "__stack-auto-translation-55" | "__stack-auto-translation-56" | "__stack-auto-translation-57" | "__stack-auto-translation-58" | "__stack-auto-translation-59" | "__stack-auto-translation-60" | "__stack-auto-translation-61" | "__stack-auto-translation-62" | "__stack-auto-translation-63" | "__stack-auto-translation-64" | "__stack-auto-translation-65" | "__stack-auto-translation-66" | "__stack-auto-translation-67" | "__stack-auto-translation-68" | "__stack-auto-translation-69" | "__stack-auto-translation-70" | "__stack-auto-translation-71" | "__stack-auto-translation-72" | "__stack-auto-translation-73" | "__stack-auto-translation-74" | "__stack-auto-translation-75" | "__stack-auto-translation-76" | "__stack-auto-translation-77" | "__stack-auto-translation-78" | "__stack-auto-translation-79" | "__stack-auto-translation-80" | "__stack-auto-translation-81" | "__stack-auto-translation-82" | "__stack-auto-translation-83" | "__stack-auto-translation-84" | "__stack-auto-translation-85" | "__stack-auto-translation-86" | "__stack-auto-translation-87" | "__stack-auto-translation-88" | "__stack-auto-translation-89" | "__stack-auto-translation-90" | "__stack-auto-translation-91" | "__stack-auto-translation-92" | "__stack-auto-translation-93" | "__stack-auto-translation-94" | "__stack-auto-translation-95" | "__stack-auto-translation-96" | "__stack-auto-translation-97" | "__stack-auto-translation-98" | "__stack-auto-translation-99" | "__stack-auto-translation-100" | "__stack-auto-translation-101" | "__stack-auto-translation-102" | "__stack-auto-translation-103" | "__stack-auto-translation-104" | "__stack-auto-translation-105" | "__stack-auto-translation-106" | "__stack-auto-translation-107" | "__stack-auto-translation-108" | "__stack-auto-translation-109" | "__stack-auto-translation-110" | "__stack-auto-translation-111" | "__stack-auto-translation-112" | "__stack-auto-translation-113" | "__stack-auto-translation-114" | "__stack-auto-translation-115" | "__stack-auto-translation-116" | "__stack-auto-translation-117" | "__stack-auto-translation-118" | "__stack-auto-translation-119" | "__stack-auto-translation-120" | "__stack-auto-translation-121" | "__stack-auto-translation-122" | "__stack-auto-translation-123" | "__stack-auto-translation-124" | "__stack-auto-translation-125" | "__stack-auto-translation-126" | "__stack-auto-translation-127" | "__stack-auto-translation-128" | "__stack-auto-translation-129" | "__stack-auto-translation-130" | "__stack-auto-translation-131" | "__stack-auto-translation-132" | "__stack-auto-translation-133" | "__stack-auto-translation-134" | "__stack-auto-translation-135" | "__stack-auto-translation-136" | "__stack-auto-translation-137" | "__stack-auto-translation-138" | "__stack-auto-translation-139" | "__stack-auto-translation-140" | "__stack-auto-translation-141" | "__stack-auto-translation-142" | "__stack-auto-translation-143" | "__stack-auto-translation-144" | "__stack-auto-translation-145" | "__stack-auto-translation-146" | "__stack-auto-translation-147" | "__stack-auto-translation-148" | "__stack-auto-translation-149" | "__stack-auto-translation-150" | "__stack-auto-translation-151" | "__stack-auto-translation-152" | "__stack-auto-translation-153" | "__stack-auto-translation-154" | "__stack-auto-translation-155" | "__stack-auto-translation-156" | "__stack-auto-translation-157" | "__stack-auto-translation-158" | "__stack-auto-translation-159" | "__stack-auto-translation-160" | "__stack-auto-translation-161" | "__stack-auto-translation-162" | "__stack-auto-translation-163" | "__stack-auto-translation-164" | "__stack-auto-translation-165" | "__stack-auto-translation-166" | "__stack-auto-translation-167" | "__stack-auto-translation-168" | "__stack-auto-translation-169" | "__stack-auto-translation-170" | "__stack-auto-translation-171" | "__stack-auto-translation-172" | "__stack-auto-translation-173" | "__stack-auto-translation-174" | "__stack-auto-translation-175" | "__stack-auto-translation-176" | "__stack-auto-translation-177" | "__stack-auto-translation-178" | "__stack-auto-translation-179" | "__stack-auto-translation-180" | "__stack-auto-translation-181" | "__stack-auto-translation-182" | "__stack-auto-translation-183" | "__stack-auto-translation-184" | "__stack-auto-translation-185" | "__stack-auto-translation-186" | "__stack-auto-translation-187" | "__stack-auto-translation-188" | "__stack-auto-translation-189" | "__stack-auto-translation-190" | "__stack-auto-translation-191" | "__stack-auto-translation-192" | "__stack-auto-translation-193" | "__stack-auto-translation-194" | "__stack-auto-translation-195" | "__stack-auto-translation-196", "Teams" | "Passkey" | "Name" | "Kontoeinstellungen" | "Sind Sie sicher, dass Sie das Team verlassen möchten?" | "Passkey-Anmeldung ist aktiviert und kann nicht deaktiviert werden, da es derzeit die einzige Anmeldemethode ist" | "Passwort" | "Passwort erfolgreich zurückgesetzt!" | "Passwörter stimmen nicht überein" | "Löschen Sie Ihr Konto und alle zugehörigen Daten dauerhaft" | "Bitte überprüfen Sie, ob Sie den richtigen Link haben. Wenn weiterhin Probleme auftreten, kontaktieren Sie bitte den Support." | "Bitte überprüfen Sie, ob Sie den richtigen Link zum Zurücksetzen des Passworts haben." | "Bitte überprüfen Sie, ob Sie den korrekten Team-Einladungslink haben." | "Bitte geben Sie einen Teamnamen ein" | "Bitte geben Sie eine gültige E-Mail-Adresse ein" | "Abbrechen" | "Bitte geben Sie eine E-Mail-Adresse ein" | "Bitte geben Sie Ihre E-Mail-Adresse ein" | "Bitte geben Sie Ihr altes Passwort ein" | "Bitte geben Sie Ihr Passwort ein" | "Bitte wiederholen Sie Ihr Passwort" | "Bitte versuchen Sie es erneut und kontaktieren Sie den Support, falls das Problem weiterhin besteht." | "Bitte verifizieren Sie zuerst Ihre E-Mail-Adresse" | "Primär" | "Profilbild" | "Ändern Sie den Anzeigenamen Ihres Teams" | "Passkey registrieren" | "Entfernen" | "Neues Passwort wiederholen" | "Passwort wiederholen" | "Passwort zurücksetzen" | "Speichern" | "Scannen Sie diesen QR-Code mit Ihrer Authentifizierungs-App:" | "E-Mail senden" | "hier klicken" | "E-Mail-Verifizierung senden" | "Legen Sie ein Passwort für Ihr Konto fest" | "Als Primär festlegen" | "Passwort festlegen" | "Einstellungen" | "Anmelden" | "Erneut anmelden" | "Erstellen" | "Melden Sie sich an oder erstellen Sie ein Konto, um dem Team beizutreten." | "Melden Sie sich in Ihrem Konto an" | "Mit Passkey anmelden" | "Mit {provider} anmelden" | "Abmelden" | "Registrieren" | "Die Registrierung für neue Benutzer ist derzeit nicht aktiviert." | "Mit Passkey registrieren" | "Mit {provider} registrieren" | "Ein neues Konto erstellen" | "Erfolgreich angemeldet!" | "Bei der Verarbeitung des OAuth-Callbacks ist etwas schiefgelaufen:" | "Nicht mehr zur Anmeldung verwenden" | "Teamerstellung ist nicht aktiviert" | "Team-Anzeigename" | "Teameinladung" | "Teamprofilbild" | "Teamnutzername" | "Der Magic-Link wurde bereits verwendet. Der Link kann nur einmal benutzt werden. Bitte fordern Sie einen neuen Magic-Link an, wenn Sie sich erneut anmelden müssen." | "Erstellen Sie ein Team" | "Der Anmeldevorgang wurde abgebrochen. Bitte versuchen Sie es erneut. [access_denied]" | "Der Benutzer ist bereits mit einem anderen OAuth-Konto verbunden. Haben Sie möglicherweise das falsche Konto auf der Seite des OAuth-Anbieters ausgewählt?" | "Geben Sie dann Ihren sechsstelligen MFA-Code ein:" | "Dieses Konto ist bereits mit einem anderen Benutzer verbunden. Bitte verbinden Sie ein anderes Konto." | "Diese E-Mail wird bereits von einem anderen Benutzer für die Anmeldung verwendet." | "Dies ist ein Anzeigename und wird nicht für die Authentifizierung verwendet" | "Dies ist höchstwahrscheinlich ein Fehler in Stack. Bitte melden Sie ihn." | "Dieser Link zum Zurücksetzen des Passworts wurde bereits verwendet. Falls Sie Ihr Passwort erneut zurücksetzen müssen, fordern Sie bitte einen neuen Link zum Zurücksetzen des Passworts auf der Anmeldeseite an." | "Dieser Teameinladungslink wurde bereits verwendet." | "Um die OTP-Anmeldung zu aktivieren, fügen Sie bitte eine verifizierte Anmelde-E-Mail hinzu." | "Ein Team erstellen" | "Um die Passkey-Anmeldung zu aktivieren, fügen Sie bitte eine verifizierte Anmelde-E-Mail hinzu." | "Um ein Passwort festzulegen, fügen Sie bitte eine Anmelde-E-Mail hinzu." | "Theme umschalten" | "TOTP-Mehrfaktor-Authentifizierungs-QR-Code" | "Nicht verifiziert" | "Passwort aktualisieren" | "Aktualisieren Sie Ihr Passwort" | "Laden Sie ein Bild für Ihr Team hoch" | "Laden Sie Ihr eigenes Bild als Avatar hoch" | "Aktuelles Team" | "Für die Anmeldung verwenden" | "Für die Anmeldung verwendet" | "Verwendeter Link zum Zurücksetzen des Passworts" | "Verwendeter Team-Einladungslink" | "Benutzer" | "Benutzername" | "Bestätigen" | "Sie sind bereits angemeldet" | "Sie sind derzeit nicht angemeldet." | "Sie können Ihre letzte Anmelde-E-Mail nicht entfernen" | "Gefahrenzone" | "Ihre E-Mail wurde verifiziert!" | "Ihre E-Mail-Adresse" | "Ihr E-Mail-Bestätigungslink ist abgelaufen. Bitte fordern Sie in Ihren Kontoeinstellungen einen neuen Bestätigungslink an." | "Ihr Magic Link ist abgelaufen. Bitte fordern Sie einen neuen Magic Link an, wenn Sie sich anmelden müssen." | "Ihr Passwort wurde zurückgesetzt. Sie können sich jetzt mit Ihrem neuen Passwort anmelden." | "Ihr Link zum Zurücksetzen des Passworts ist abgelaufen. Bitte fordern Sie einen neuen Link zum Zurücksetzen des Passworts von der Anmeldeseite an." | "Ihr Team-Einladungslink ist abgelaufen. Bitte fordern Sie einen neuen Team-Einladungslink an " | "Hinzufügen" | "Konto löschen" | "Passkey löschen" | "Deaktivieren" | "MFA deaktivieren" | "OTP deaktivieren" | "Anzeigename" | "Möchten Sie sich anmelden?" | "Möchten Sie Ihre E-Mail-Adresse bestätigen?" | "Noch kein Konto?" | "Eine E-Mail-Adresse hinzufügen" | "Kein Zurücksetzen nötig?" | "E-Mail" | "E-Mail & Passwort" | "E-Mail existiert bereits" | "E-Mail ist erforderlich" | "E-Mail gesendet!" | "E-Mails" | "E-Mails & Authentifizierung" | "MFA aktivieren" | "OTP aktivieren" | "Neue Passkey hinzufügen" | "Aktivieren Sie die Anmeldung über einen magischen Link oder OTP, die an Ihre Anmelde-E-Mails gesendet werden." | "Beenden Sie Ihre aktuelle Sitzung" | "Geben Sie einen Anzeigenamen für Ihr neues Team ein" | "E-Mail-Adresse eingeben" | "Geben Sie den Code aus Ihrer E-Mail ein" | "Abgelaufener Magic Link" | "Abgelaufener Link zum Zurücksetzen des Passworts" | "Abgelaufener Team-Einladungslink" | "Abgelaufener Verifizierungslink" | "Läuft ab" | "Haben Sie bereits ein Konto?" | "Verbindung des Kontos fehlgeschlagen" | "Passwort konnte nicht zurückgesetzt werden" | "Passwort konnte nicht zurückgesetzt werden. Bitte fordern Sie einen neuen Link zum Zurücksetzen des Passworts an" | "Passwort vergessen?" | "Zur Startseite" | "Wenn der Benutzer mit dieser E-Mail-Adresse existiert, wurde eine E-Mail an Ihren Posteingang gesendet. Überprüfen Sie auch Ihren Spam-Ordner." | "Wenn Sie nicht automatisch weitergeleitet werden, " | "Ignorieren" | "Falscher Code. Bitte versuchen Sie es erneut." | "Ein unbekannter Fehler ist aufgetreten" | "Falsches Passwort" | "Ungültiger Code" | "Ungültiges Bild" | "Ungültiger Magic Link" | "Ungültiger Link zum Zurücksetzen des Passworts" | "Ungültiger Team-Einladungslink" | "Ungültiger TOTP-Code" | "Ungültiger Verifizierungslink" | "Laden Sie einen Benutzer per E-Mail in Ihr Team ein" | "Mitglied einladen" | "Sind Sie sicher, dass Sie Ihr Konto löschen möchten? Diese Aktion ist UNWIDERRUFLICH und löscht ALLE zugehörigen Daten." | "Benutzer einladen" | "Beitreten" | "Verlassen" | "Team verlassen" | "dieses Team verlassen und Ihr Teamprofil entfernen" | "Bereits verwendeter Magic-Link" | "Mitglieder" | "Mehr-Faktor-Authentifizierung" | "Zwei-Faktor-Authentifizierung ist derzeit deaktiviert." | "Sind Sie sicher, dass Sie die OTP-Anmeldung deaktivieren möchten? Sie können sich dann nicht mehr nur mit E-Mails anmelden." | "Mehrfaktor-Authentifizierung ist derzeit aktiviert." | "Mein Profil" | "Neue Kontoregistrierung ist nicht erlaubt" | "Neues Passwort" | "Keine Authentifizierungsmethode aktiviert." | "Noch keine Teams" | "Nicht angemeldet" | "OAuth-Anbieter-Zugriff verweigert" | "Möchten Sie die Passkey-Anmeldung wirklich deaktivieren? Sie können sich dann nicht mehr mit Ihrem Passkey anmelden." | "Altes Passwort" | "Oder fortfahren mit" | "Andere Teams" | "OTP-Anmeldung" | "OTP-Anmeldung ist aktiviert und kann nicht deaktiviert werden, da es derzeit die einzige Anmeldemethode ist" | "Die Anmeldung per OTP/magischem Link ist derzeit aktiviert." | "Ausstehende Einladungen" | "Überschreiben Sie Ihren Benutzeranzeigenamen in diesem Team" | "Passkey registriert"> | Map<"__stack-auto-translation-0" | "__stack-auto-translation-1" | "__stack-auto-translation-2" | "__stack-auto-translation-3" | "__stack-auto-translation-4" | "__stack-auto-translation-5" | "__stack-auto-translation-6" | "__stack-auto-translation-7" | "__stack-auto-translation-8" | "__stack-auto-translation-9" | "__stack-auto-translation-10" | "__stack-auto-translation-11" | "__stack-auto-translation-12" | "__stack-auto-translation-13" | "__stack-auto-translation-14" | "__stack-auto-translation-15" | "__stack-auto-translation-16" | "__stack-auto-translation-17" | "__stack-auto-translation-18" | "__stack-auto-translation-19" | "__stack-auto-translation-20" | "__stack-auto-translation-21" | "__stack-auto-translation-22" | "__stack-auto-translation-23" | "__stack-auto-translation-24" | "__stack-auto-translation-25" | "__stack-auto-translation-26" | "__stack-auto-translation-27" | "__stack-auto-translation-28" | "__stack-auto-translation-29" | "__stack-auto-translation-30" | "__stack-auto-translation-31" | "__stack-auto-translation-32" | "__stack-auto-translation-33" | "__stack-auto-translation-34" | "__stack-auto-translation-35" | "__stack-auto-translation-36" | "__stack-auto-translation-37" | "__stack-auto-translation-38" | "__stack-auto-translation-39" | "__stack-auto-translation-40" | "__stack-auto-translation-41" | "__stack-auto-translation-42" | "__stack-auto-translation-43" | "__stack-auto-translation-44" | "__stack-auto-translation-45" | "__stack-auto-translation-46" | "__stack-auto-translation-47" | "__stack-auto-translation-48" | "__stack-auto-translation-49" | "__stack-auto-translation-50" | "__stack-auto-translation-51" | "__stack-auto-translation-52" | "__stack-auto-translation-53" | "__stack-auto-translation-54" | "__stack-auto-translation-55" | "__stack-auto-translation-56" | "__stack-auto-translation-57" | "__stack-auto-translation-58" | "__stack-auto-translation-59" | "__stack-auto-translation-60" | "__stack-auto-translation-61" | "__stack-auto-translation-62" | "__stack-auto-translation-63" | "__stack-auto-translation-64" | "__stack-auto-translation-65" | "__stack-auto-translation-66" | "__stack-auto-translation-67" | "__stack-auto-translation-68" | "__stack-auto-translation-69" | "__stack-auto-translation-70" | "__stack-auto-translation-71" | "__stack-auto-translation-72" | "__stack-auto-translation-73" | "__stack-auto-translation-74" | "__stack-auto-translation-75" | "__stack-auto-translation-76" | "__stack-auto-translation-77" | "__stack-auto-translation-78" | "__stack-auto-translation-79" | "__stack-auto-translation-80" | "__stack-auto-translation-81" | "__stack-auto-translation-82" | "__stack-auto-translation-83" | "__stack-auto-translation-84" | "__stack-auto-translation-85" | "__stack-auto-translation-86" | "__stack-auto-translation-87" | "__stack-auto-translation-88" | "__stack-auto-translation-89" | "__stack-auto-translation-90" | "__stack-auto-translation-91" | "__stack-auto-translation-92" | "__stack-auto-translation-93" | "__stack-auto-translation-94" | "__stack-auto-translation-95" | "__stack-auto-translation-96" | "__stack-auto-translation-97" | "__stack-auto-translation-98" | "__stack-auto-translation-99" | "__stack-auto-translation-100" | "__stack-auto-translation-101" | "__stack-auto-translation-102" | "__stack-auto-translation-103" | "__stack-auto-translation-104" | "__stack-auto-translation-105" | "__stack-auto-translation-106" | "__stack-auto-translation-107" | "__stack-auto-translation-108" | "__stack-auto-translation-109" | "__stack-auto-translation-110" | "__stack-auto-translation-111" | "__stack-auto-translation-112" | "__stack-auto-translation-113" | "__stack-auto-translation-114" | "__stack-auto-translation-115" | "__stack-auto-translation-116" | "__stack-auto-translation-117" | "__stack-auto-translation-118" | "__stack-auto-translation-119" | "__stack-auto-translation-120" | "__stack-auto-translation-121" | "__stack-auto-translation-122" | "__stack-auto-translation-123" | "__stack-auto-translation-124" | "__stack-auto-translation-125" | "__stack-auto-translation-126" | "__stack-auto-translation-127" | "__stack-auto-translation-128" | "__stack-auto-translation-129" | "__stack-auto-translation-130" | "__stack-auto-translation-131" | "__stack-auto-translation-132" | "__stack-auto-translation-133" | "__stack-auto-translation-134" | "__stack-auto-translation-135" | "__stack-auto-translation-136" | "__stack-auto-translation-137" | "__stack-auto-translation-138" | "__stack-auto-translation-139" | "__stack-auto-translation-140" | "__stack-auto-translation-141" | "__stack-auto-translation-142" | "__stack-auto-translation-143" | "__stack-auto-translation-144" | "__stack-auto-translation-145" | "__stack-auto-translation-146" | "__stack-auto-translation-147" | "__stack-auto-translation-148" | "__stack-auto-translation-149" | "__stack-auto-translation-150" | "__stack-auto-translation-151" | "__stack-auto-translation-152" | "__stack-auto-translation-153" | "__stack-auto-translation-154" | "__stack-auto-translation-155" | "__stack-auto-translation-156" | "__stack-auto-translation-157" | "__stack-auto-translation-158" | "__stack-auto-translation-159" | "__stack-auto-translation-160" | "__stack-auto-translation-161" | "__stack-auto-translation-162" | "__stack-auto-translation-163" | "__stack-auto-translation-164" | "__stack-auto-translation-165" | "__stack-auto-translation-166" | "__stack-auto-translation-167" | "__stack-auto-translation-168" | "__stack-auto-translation-169" | "__stack-auto-translation-170" | "__stack-auto-translation-171" | "__stack-auto-translation-172" | "__stack-auto-translation-173" | "__stack-auto-translation-174" | "__stack-auto-translation-175" | "__stack-auto-translation-176" | "__stack-auto-translation-177" | "__stack-auto-translation-178" | "__stack-auto-translation-179" | "__stack-auto-translation-180" | "__stack-auto-translation-181" | "__stack-auto-translation-182" | "__stack-auto-translation-183" | "__stack-auto-translation-184" | "__stack-auto-translation-185" | "__stack-auto-translation-186" | "__stack-auto-translation-187" | "__stack-auto-translation-188" | "__stack-auto-translation-189" | "__stack-auto-translation-190" | "__stack-auto-translation-191" | "__stack-auto-translation-192" | "__stack-auto-translation-193" | "__stack-auto-translation-194" | "__stack-auto-translation-195" | "__stack-auto-translation-196", "Create" | "Teams" | "User" | "Cancel" | "Please enter a valid email address" | "Email already exists" | "Email is required" | "Emails" | "Add an email" | "Enter email" | "Add" | "Send verification email" | "Set as primary" | "Please verify your email first" | "Use for sign-in" | "Stop using for sign-in" | "You can not remove your last sign-in email" | "Remove" | "This email is already used for sign-in by another user." | "Primary" | "Unverified" | "Used for sign-in" | "Multi-factor authentication" | "Multi-factor authentication is currently enabled." | "Multi-factor authentication is currently disabled." | "Scan this QR code with your authenticator app:" | "TOTP multi-factor authentication QR code" | "Then, enter your six-digit MFA code:" | "Incorrect code. Please try again." | "Disable MFA" | "Enable MFA" | "OTP sign-in" | "OTP/magic link sign-in is currently enabled." | "Enable sign-in via magic link or OTP sent to your sign-in emails." | "Disable OTP" | "OTP sign-in is enabled and cannot be disabled as it is currently the only sign-in method" | "Enable OTP" | "To enable OTP sign-in, please add a verified sign-in email." | "Are you sure you want to disable OTP sign-in? You will not be able to sign in with only emails anymore." | "Disable" | "Passkey" | "Passkey registered" | "Register a passkey" | "To enable Passkey sign-in, please add a verified sign-in email." | "Passkey sign-in is enabled and cannot be disabled as it is currently the only sign-in method" | "Delete Passkey" | "Add new passkey" | "Are you sure you want to disable Passkey sign-in? You will not be able to sign in with your passkey anymore." | "Please enter your old password" | "Please enter your password" | "Passwords do not match" | "Please repeat your password" | "Incorrect password" | "Password" | "Update your password" | "Set a password for your account" | "Update password" | "Set password" | "To set a password, please add a sign-in email." | "Old password" | "New password" | "Repeat new password" | "Update Password" | "Set Password" | "Invalid image" | "Save" | "User name" | "This is a display name and is not used for authentication" | "Profile image" | "Upload your own image as your avatar" | "Delete Account" | "Permanently remove your account and all associated data" | "Danger zone" | "Delete account" | "Are you sure you want to delete your account? This action is IRREVERSIBLE and will delete ALL associated data." | "Sign out" | "End your current session" | "Please enter a team name" | "Team creation is not enabled" | "Create a Team" | "Enter a display name for your new team" | "Leave Team" | "leave this team and remove your team profile" | "Leave team" | "Are you sure you want to leave the team?" | "Leave" | "Team display name" | "Change the display name of your team" | "Please enter an email address" | "Invite member" | "Invite a user to your team through email" | "Outstanding invitations" | "Expires" | "Email" | "Invite User" | "Members" | "Name" | "Team profile image" | "Upload an image for your team" | "Team user name" | "Overwrite your user display name in this team" | "Settings" | "My Profile" | "Emails & Auth" | "Create a team" | "Account Settings" | "Invalid Verification Link" | "Expired Verification Link" | "Do you want to verify your email?" | "Verify" | "You email has been verified!" | "Go home" | "Please check if you have the correct link. If you continue to have issues, please contact support." | "Your email verification link has expired. Please request a new verification link from your account settings." | "Go Home" | "You are already signed in" | "You are not currently signed in." | "Sign in" | "Sign up for new users is not enabled at the moment." | "Email sent!" | "If the user with this e-mail address exists, an e-mail was sent to your inbox. Make sure to check your spam folder." | "Password reset successfully!" | "Your password has been reset. You can now sign in with your new password." | "An unknown error occurred" | "Please try again and if the problem persists, contact support." | "Failed to connect account" | "OAuth provider access denied" | "Sign in again" | "This account is already connected to another user. Please connect a different account." | "The user is already connected to another OAuth account. Did you maybe selected the wrong account on the OAuth provider page?" | "The sign-in operation has been cancelled. Please try again. [access_denied]" | "Please enter a valid email" | "Please enter your email" | "Your Email" | "Send Email" | "Reset Your Password" | "Don't need to reset?" | "Invalid Magic Link" | "Do you want to sign in?" | "Expired Magic Link" | "Magic Link Already Used" | "Signed in successfully!" | "Your magic link has expired. Please request a new magic link if you need to sign-in." | "The magic link has already been used. The link can only be used once. Please request a new magic link if you need to sign-in again." | "If you are not redirected automatically, " | "click here" | "Something went wrong while processing the OAuth callback:" | "This is most likely an error in Stack. Please report it." | "Failed to reset password" | "Failed to reset password. Please request a new password reset link" | "Invalid Password Reset Link" | "Expired Password Reset Link" | "Used Password Reset Link" | "Please double check if you have the correct password reset link." | "Your password reset link has expired. Please request a new password reset link from the login page." | "This password reset link has already been used. If you need to reset your password again, please request a new password reset link from the login page." | "New Password" | "Repeat New Password" | "Reset Password" | "Team invitation" | "Join" | "Ignore" | "Invalid Team Invitation Link" | "Expired Team Invitation Link" | "Used Team Invitation Link" | "Please double check if you have the correct team invitation link." | "Your team invitation link has expired. Please request a new team invitation link " | "This team invitation link has already been used." | "Sign in or create an account to join the team." | "Account settings" | "Already have an account?" | "Create a new account" | "Current team" | "Display name" | "Don't have an account?" | "Email & Password" | "Enter the code from your email" | "Forgot password?" | "Invalid code" | "Invalid TOTP code" | "New account registration is not allowed" | "No authentication method enabled." | "No teams yet" | "Not signed in" | "Or continue with" | "Other teams" | "Repeat Password" | "Send email" | "Sign In" | "Sign in to your account" | "Sign in with Passkey" | "Sign in with {provider}" | "Sign up" | "Sign Up" | "Sign up with Passkey" | "Sign up with {provider}" | "Toggle theme"> | Map<"__stack-auto-translation-0" | "__stack-auto-translation-1" | "__stack-auto-translation-2" | "__stack-auto-translation-3" | "__stack-auto-translation-4" | "__stack-auto-translation-5" | "__stack-auto-translation-6" | "__stack-auto-translation-7" | "__stack-auto-translation-8" | "__stack-auto-translation-9" | "__stack-auto-translation-10" | "__stack-auto-translation-11" | "__stack-auto-translation-12" | "__stack-auto-translation-13" | "__stack-auto-translation-14" | "__stack-auto-translation-15" | "__stack-auto-translation-16" | "__stack-auto-translation-17" | "__stack-auto-translation-18" | "__stack-auto-translation-19" | "__stack-auto-translation-20" | "__stack-auto-translation-21" | "__stack-auto-translation-22" | "__stack-auto-translation-23" | "__stack-auto-translation-24" | "__stack-auto-translation-25" | "__stack-auto-translation-26" | "__stack-auto-translation-27" | "__stack-auto-translation-28" | "__stack-auto-translation-29" | "__stack-auto-translation-30" | "__stack-auto-translation-31" | "__stack-auto-translation-32" | "__stack-auto-translation-33" | "__stack-auto-translation-34" | "__stack-auto-translation-35" | "__stack-auto-translation-36" | "__stack-auto-translation-37" | "__stack-auto-translation-38" | "__stack-auto-translation-39" | "__stack-auto-translation-40" | "__stack-auto-translation-41" | "__stack-auto-translation-42" | "__stack-auto-translation-43" | "__stack-auto-translation-44" | "__stack-auto-translation-45" | "__stack-auto-translation-46" | "__stack-auto-translation-47" | "__stack-auto-translation-48" | "__stack-auto-translation-49" | "__stack-auto-translation-50" | "__stack-auto-translation-51" | "__stack-auto-translation-52" | "__stack-auto-translation-53" | "__stack-auto-translation-54" | "__stack-auto-translation-55" | "__stack-auto-translation-56" | "__stack-auto-translation-57" | "__stack-auto-translation-58" | "__stack-auto-translation-59" | "__stack-auto-translation-60" | "__stack-auto-translation-61" | "__stack-auto-translation-62" | "__stack-auto-translation-63" | "__stack-auto-translation-64" | "__stack-auto-translation-65" | "__stack-auto-translation-66" | "__stack-auto-translation-67" | "__stack-auto-translation-68" | "__stack-auto-translation-69" | "__stack-auto-translation-70" | "__stack-auto-translation-71" | "__stack-auto-translation-72" | "__stack-auto-translation-73" | "__stack-auto-translation-74" | "__stack-auto-translation-75" | "__stack-auto-translation-76" | "__stack-auto-translation-77" | "__stack-auto-translation-78" | "__stack-auto-translation-79" | "__stack-auto-translation-80" | "__stack-auto-translation-81" | "__stack-auto-translation-82" | "__stack-auto-translation-83" | "__stack-auto-translation-84" | "__stack-auto-translation-85" | "__stack-auto-translation-86" | "__stack-auto-translation-87" | "__stack-auto-translation-88" | "__stack-auto-translation-89" | "__stack-auto-translation-90" | "__stack-auto-translation-91" | "__stack-auto-translation-92" | "__stack-auto-translation-93" | "__stack-auto-translation-94" | "__stack-auto-translation-95" | "__stack-auto-translation-96" | "__stack-auto-translation-97" | "__stack-auto-translation-98" | "__stack-auto-translation-99" | "__stack-auto-translation-100" | "__stack-auto-translation-101" | "__stack-auto-translation-102" | "__stack-auto-translation-103" | "__stack-auto-translation-104" | "__stack-auto-translation-105" | "__stack-auto-translation-106" | "__stack-auto-translation-107" | "__stack-auto-translation-108" | "__stack-auto-translation-109" | "__stack-auto-translation-110" | "__stack-auto-translation-111" | "__stack-auto-translation-112" | "__stack-auto-translation-113" | "__stack-auto-translation-114" | "__stack-auto-translation-115" | "__stack-auto-translation-116" | "__stack-auto-translation-117" | "__stack-auto-translation-118" | "__stack-auto-translation-119" | "__stack-auto-translation-120" | "__stack-auto-translation-121" | "__stack-auto-translation-122" | "__stack-auto-translation-123" | "__stack-auto-translation-124" | "__stack-auto-translation-125" | "__stack-auto-translation-126" | "__stack-auto-translation-127" | "__stack-auto-translation-128" | "__stack-auto-translation-129" | "__stack-auto-translation-130" | "__stack-auto-translation-131" | "__stack-auto-translation-132" | "__stack-auto-translation-133" | "__stack-auto-translation-134" | "__stack-auto-translation-135" | "__stack-auto-translation-136" | "__stack-auto-translation-137" | "__stack-auto-translation-138" | "__stack-auto-translation-139" | "__stack-auto-translation-140" | "__stack-auto-translation-141" | "__stack-auto-translation-142" | "__stack-auto-translation-143" | "__stack-auto-translation-144" | "__stack-auto-translation-145" | "__stack-auto-translation-146" | "__stack-auto-translation-147" | "__stack-auto-translation-148" | "__stack-auto-translation-149" | "__stack-auto-translation-150" | "__stack-auto-translation-151" | "__stack-auto-translation-152" | "__stack-auto-translation-153" | "__stack-auto-translation-154" | "__stack-auto-translation-155" | "__stack-auto-translation-156" | "__stack-auto-translation-157" | "__stack-auto-translation-158" | "__stack-auto-translation-159" | "__stack-auto-translation-160" | "__stack-auto-translation-161" | "__stack-auto-translation-162" | "__stack-auto-translation-163" | "__stack-auto-translation-164" | "__stack-auto-translation-165" | "__stack-auto-translation-166" | "__stack-auto-translation-167" | "__stack-auto-translation-168" | "__stack-auto-translation-169" | "__stack-auto-translation-170" | "__stack-auto-translation-171" | "__stack-auto-translation-172" | "__stack-auto-translation-173" | "__stack-auto-translation-174" | "__stack-auto-translation-175" | "__stack-auto-translation-176" | "__stack-auto-translation-177" | "__stack-auto-translation-178" | "__stack-auto-translation-179" | "__stack-auto-translation-180" | "__stack-auto-translation-181" | "__stack-auto-translation-182" | "__stack-auto-translation-183" | "__stack-auto-translation-184" | "__stack-auto-translation-185" | "__stack-auto-translation-186" | "__stack-auto-translation-187" | "__stack-auto-translation-188" | "__stack-auto-translation-189" | "__stack-auto-translation-190" | "__stack-auto-translation-191" | "__stack-auto-translation-192" | "__stack-auto-translation-193" | "__stack-auto-translation-194" | "__stack-auto-translation-195" | "__stack-auto-translation-196", "Configuración de cuenta" | "Configuración de la cuenta" | "¿Estás seguro de que quieres abandonar el equipo?" | "El inicio de sesión con clave de acceso está activado y no se puede desactivar ya que es el único método de inicio de sesión actual" | "Contraseña" | "¡Contraseña restablecida con éxito!" | "Las contraseñas no coinciden" | "Elimina permanentemente tu cuenta y todos los datos asociados" | "Por favor, verifique si tiene el enlace correcto. Si continúa teniendo problemas, comuníquese con soporte." | "Por favor, verifica que tengas el enlace correcto para restablecer la contraseña." | "Por favor, verifique si tiene el enlace de invitación al equipo correcto." | "Por favor, ingrese un nombre de equipo" | "Por favor, ingrese un correo electrónico válido" | "Cancelar" | "Por favor, ingrese una dirección de correo electrónico válida" | "Por favor, ingrese una dirección de correo electrónico" | "Por favor ingrese su correo electrónico" | "Por favor, ingrese su contraseña antigua" | "Por favor ingrese su contraseña" | "Por favor repita su contraseña" | "Inténtelo de nuevo y si el problema persiste, comuníquese con soporte." | "Por favor, verifique su correo electrónico primero" | "Principal" | "Imagen de perfil" | "Cambiar el nombre visible de tu equipo" | "Registrar una clave de acceso" | "Eliminar" | "Repetir nueva contraseña" | "Repetir Nueva Contraseña" | "Repetir contraseña" | "Restablecer Contraseña" | "Restablecer su contraseña" | "Guardar" | "Escanea este código QR con tu aplicación de autenticación:" | "Enviar correo electrónico" | "haga clic aquí" | "Enviar Correo" | "Enviar correo electrónico de verificación" | "Establezca una contraseña para su cuenta" | "Establecer como principal" | "Establecer contraseña" | "Establecer Contraseña" | "Configuración" | "Iniciar sesión" | "Iniciar sesión de nuevo" | "Crear" | "Inicie sesión o cree una cuenta para unirse al equipo." | "Inicia sesión en tu cuenta" | "Iniciar sesión con Passkey" | "Iniciar sesión con {provider}" | "Cerrar sesión" | "Registrarse" | "En este momento no está habilitado el registro para nuevos usuarios." | "Registrarse con clave de acceso" | "Registrarse con {provider}" | "Crear una cuenta nueva" | "¡Sesión iniciada con éxito!" | "Algo salió mal al procesar la devolución de llamada de OAuth:" | "Dejar de usar para iniciar sesión" | "La creación de equipos no está habilitada" | "Nombre de visualización del equipo" | "Invitación al equipo" | "Imagen de perfil del equipo" | "Nombre de usuario del equipo" | "Equipos" | "El enlace mágico ya ha sido utilizado. El enlace solo puede usarse una vez. Por favor, solicita un nuevo enlace mágico si necesitas iniciar sesión nuevamente." | "Crear un equipo" | "La operación de inicio de sesión ha sido cancelada. Por favor, inténtelo de nuevo. [access_denied]" | "El usuario ya está conectado a otra cuenta de OAuth. ¿Quizás seleccionaste la cuenta incorrecta en la página del proveedor de OAuth?" | "Luego, ingrese su código MFA de seis dígitos:" | "Esta cuenta ya está conectada a otro usuario. Por favor, conecta una cuenta diferente." | "Este correo electrónico ya está siendo usado para iniciar sesión por otro usuario." | "Este es un nombre para mostrar y no se usa para autenticación" | "Es muy probable que esto sea un error en Stack. Por favor, repórtelo." | "Este enlace para restablecer la contraseña ya ha sido utilizado. Si necesita restablecer su contraseña nuevamente, solicite un nuevo enlace para restablecer la contraseña desde la página de inicio de sesión." | "Este enlace de invitación al equipo ya ha sido utilizado." | "Para activar el inicio de sesión con OTP, agregue un correo electrónico de inicio de sesión verificado." | "Para activar el inicio de sesión con clave de acceso, agregue un correo electrónico de inicio de sesión verificado." | "Para establecer una contraseña, agregue un correo electrónico de inicio de sesión." | "Cambiar tema" | "Código QR de autenticación multifactor TOTP" | "No verificado" | "Actualizar contraseña" | "Actualizar Contraseña" | "Actualiza tu contraseña" | "Sube una imagen para tu equipo" | "Sube tu propia imagen como tu avatar" | "Equipo actual" | "Usar para iniciar sesión" | "Usado para iniciar sesión" | "Enlace de Restablecimiento de Contraseña Usado" | "Enlace de Invitación de Equipo Utilizado" | "Usuario" | "Nombre de usuario" | "Verificar" | "Ya has iniciado sesión" | "No estás conectado actualmente." | "No puedes eliminar tu último correo electrónico de inicio de sesión" | "Zona de peligro" | "¡Tu correo electrónico ha sido verificado!" | "Tu correo electrónico" | "Su enlace de verificación de correo electrónico ha expirado. Por favor, solicite un nuevo enlace de verificación desde la configuración de su cuenta." | "Su enlace mágico ha expirado. Por favor, solicite un nuevo enlace mágico si necesita iniciar sesión." | "Tu contraseña ha sido restablecida. Ahora puedes iniciar sesión con tu nueva contraseña." | "Su enlace para restablecer la contraseña ha expirado. Por favor, solicite un nuevo enlace para restablecer la contraseña desde la página de inicio de sesión." | "Su enlace de invitación al equipo ha expirado. Por favor, solicite un nuevo enlace de invitación al equipo " | "Agregar" | "Eliminar cuenta" | "Eliminar clave de acceso" | "Deshabilitar" | "Deshabilitar MFA" | "Deshabilitar OTP" | "Nombre para mostrar" | "¿Desea iniciar sesión?" | "¿Quieres verificar tu correo electrónico?" | "¿No tienes una cuenta?" | "Agregar un correo electrónico" | "¿No necesitas restablecer?" | "Correo electrónico" | "Correo y contraseña" | "El correo electrónico ya existe" | "El correo electrónico es obligatorio" | "¡Correo enviado!" | "Correos electrónicos" | "Correos electrónicos y autenticación" | "Activar MFA" | "Activar OTP" | "Agregar nueva clave de acceso" | "Activar inicio de sesión mediante enlace mágico o OTP enviado a sus correos electrónicos de inicio de sesión." | "Finalizar su sesión actual" | "Ingrese un nombre para mostrar para su nuevo equipo" | "Ingrese correo electrónico" | "Ingrese el código de su correo electrónico" | "Enlace mágico caducado" | "Enlace de Restablecimiento de Contraseña Expirado" | "Enlace de invitación del equipo caducado" | "Enlace de verificación caducado" | "Vence" | "¿Ya tienes una cuenta?" | "Error al conectar la cuenta" | "Fallo al restablecer la contraseña" | "No se pudo restablecer la contraseña. Por favor, solicite un nuevo enlace para restablecer la contraseña" | "¿Olvidaste tu contraseña?" | "Ir a inicio" | "Si el usuario con esta dirección de correo electrónico existe, se envió un correo electrónico a su bandeja de entrada. Asegúrese de revisar su carpeta de spam." | "Si no se le redirige automáticamente, " | "Ignorar" | "Código incorrecto. Inténtelo de nuevo." | "Se produjo un error desconocido" | "Contraseña incorrecta" | "Código no válido" | "Imagen no válida" | "Enlace mágico no válido" | "Enlace de restablecimiento de contraseña no válido" | "Enlace de invitación de equipo inválido" | "Código TOTP inválido" | "Enlace de verificación inválido" | "Invita a un usuario a tu equipo por correo electrónico" | "Invitar miembro" | "¿Está seguro de que desea eliminar su cuenta? Esta acción es IRREVERSIBLE y eliminará TODOS los datos asociados." | "Invitar Usuario" | "Unirse" | "Salir" | "Abandonar equipo" | "Salir del equipo" | "abandona este equipo y elimina tu perfil de equipo" | "Enlace Mágico Ya Utilizado" | "Miembros" | "Autenticación de múltiples factores" | "La autenticación de múltiples factores está actualmente desactivada." | "¿Está seguro de que desea deshabilitar el inicio de sesión con OTP? Ya no podrá iniciar sesión solo con correos electrónicos." | "La autenticación de múltiples factores está actualmente habilitada." | "Mi perfil" | "Nombre" | "No se permite el registro de nuevas cuentas" | "Nueva contraseña" | "Nueva Contraseña" | "Ningún método de autenticación habilitado." | "Sin equipos aún" | "No ha iniciado sesión" | "Acceso denegado por el proveedor de OAuth" | "¿Estás seguro de que quieres deshabilitar el inicio de sesión con clave de acceso? Ya no podrás iniciar sesión con tu clave de acceso." | "Contraseña anterior" | "O continuar con" | "Otros equipos" | "Inicio de sesión con OTP" | "El inicio de sesión con OTP está activado y no se puede deshabilitar ya que actualmente es el único método de inicio de sesión" | "El inicio de sesión por OTP/enlace mágico está actualmente activado." | "Invitaciones pendientes" | "Sobrescribe tu nombre de usuario en este equipo" | "Clave de acceso" | "Clave de acceso registrada"> | Map<"__stack-auto-translation-0" | "__stack-auto-translation-1" | "__stack-auto-translation-2" | "__stack-auto-translation-3" | "__stack-auto-translation-4" | "__stack-auto-translation-5" | "__stack-auto-translation-6" | "__stack-auto-translation-7" | "__stack-auto-translation-8" | "__stack-auto-translation-9" | "__stack-auto-translation-10" | "__stack-auto-translation-11" | "__stack-auto-translation-12" | "__stack-auto-translation-13" | "__stack-auto-translation-14" | "__stack-auto-translation-15" | "__stack-auto-translation-16" | "__stack-auto-translation-17" | "__stack-auto-translation-18" | "__stack-auto-translation-19" | "__stack-auto-translation-20" | "__stack-auto-translation-21" | "__stack-auto-translation-22" | "__stack-auto-translation-23" | "__stack-auto-translation-24" | "__stack-auto-translation-25" | "__stack-auto-translation-26" | "__stack-auto-translation-27" | "__stack-auto-translation-28" | "__stack-auto-translation-29" | "__stack-auto-translation-30" | "__stack-auto-translation-31" | "__stack-auto-translation-32" | "__stack-auto-translation-33" | "__stack-auto-translation-34" | "__stack-auto-translation-35" | "__stack-auto-translation-36" | "__stack-auto-translation-37" | "__stack-auto-translation-38" | "__stack-auto-translation-39" | "__stack-auto-translation-40" | "__stack-auto-translation-41" | "__stack-auto-translation-42" | "__stack-auto-translation-43" | "__stack-auto-translation-44" | "__stack-auto-translation-45" | "__stack-auto-translation-46" | "__stack-auto-translation-47" | "__stack-auto-translation-48" | "__stack-auto-translation-49" | "__stack-auto-translation-50" | "__stack-auto-translation-51" | "__stack-auto-translation-52" | "__stack-auto-translation-53" | "__stack-auto-translation-54" | "__stack-auto-translation-55" | "__stack-auto-translation-56" | "__stack-auto-translation-57" | "__stack-auto-translation-58" | "__stack-auto-translation-59" | "__stack-auto-translation-60" | "__stack-auto-translation-61" | "__stack-auto-translation-62" | "__stack-auto-translation-63" | "__stack-auto-translation-64" | "__stack-auto-translation-65" | "__stack-auto-translation-66" | "__stack-auto-translation-67" | "__stack-auto-translation-68" | "__stack-auto-translation-69" | "__stack-auto-translation-70" | "__stack-auto-translation-71" | "__stack-auto-translation-72" | "__stack-auto-translation-73" | "__stack-auto-translation-74" | "__stack-auto-translation-75" | "__stack-auto-translation-76" | "__stack-auto-translation-77" | "__stack-auto-translation-78" | "__stack-auto-translation-79" | "__stack-auto-translation-80" | "__stack-auto-translation-81" | "__stack-auto-translation-82" | "__stack-auto-translation-83" | "__stack-auto-translation-84" | "__stack-auto-translation-85" | "__stack-auto-translation-86" | "__stack-auto-translation-87" | "__stack-auto-translation-88" | "__stack-auto-translation-89" | "__stack-auto-translation-90" | "__stack-auto-translation-91" | "__stack-auto-translation-92" | "__stack-auto-translation-93" | "__stack-auto-translation-94" | "__stack-auto-translation-95" | "__stack-auto-translation-96" | "__stack-auto-translation-97" | "__stack-auto-translation-98" | "__stack-auto-translation-99" | "__stack-auto-translation-100" | "__stack-auto-translation-101" | "__stack-auto-translation-102" | "__stack-auto-translation-103" | "__stack-auto-translation-104" | "__stack-auto-translation-105" | "__stack-auto-translation-106" | "__stack-auto-translation-107" | "__stack-auto-translation-108" | "__stack-auto-translation-109" | "__stack-auto-translation-110" | "__stack-auto-translation-111" | "__stack-auto-translation-112" | "__stack-auto-translation-113" | "__stack-auto-translation-114" | "__stack-auto-translation-115" | "__stack-auto-translation-116" | "__stack-auto-translation-117" | "__stack-auto-translation-118" | "__stack-auto-translation-119" | "__stack-auto-translation-120" | "__stack-auto-translation-121" | "__stack-auto-translation-122" | "__stack-auto-translation-123" | "__stack-auto-translation-124" | "__stack-auto-translation-125" | "__stack-auto-translation-126" | "__stack-auto-translation-127" | "__stack-auto-translation-128" | "__stack-auto-translation-129" | "__stack-auto-translation-130" | "__stack-auto-translation-131" | "__stack-auto-translation-132" | "__stack-auto-translation-133" | "__stack-auto-translation-134" | "__stack-auto-translation-135" | "__stack-auto-translation-136" | "__stack-auto-translation-137" | "__stack-auto-translation-138" | "__stack-auto-translation-139" | "__stack-auto-translation-140" | "__stack-auto-translation-141" | "__stack-auto-translation-142" | "__stack-auto-translation-143" | "__stack-auto-translation-144" | "__stack-auto-translation-145" | "__stack-auto-translation-146" | "__stack-auto-translation-147" | "__stack-auto-translation-148" | "__stack-auto-translation-149" | "__stack-auto-translation-150" | "__stack-auto-translation-151" | "__stack-auto-translation-152" | "__stack-auto-translation-153" | "__stack-auto-translation-154" | "__stack-auto-translation-155" | "__stack-auto-translation-156" | "__stack-auto-translation-157" | "__stack-auto-translation-158" | "__stack-auto-translation-159" | "__stack-auto-translation-160" | "__stack-auto-translation-161" | "__stack-auto-translation-162" | "__stack-auto-translation-163" | "__stack-auto-translation-164" | "__stack-auto-translation-165" | "__stack-auto-translation-166" | "__stack-auto-translation-167" | "__stack-auto-translation-168" | "__stack-auto-translation-169" | "__stack-auto-translation-170" | "__stack-auto-translation-171" | "__stack-auto-translation-172" | "__stack-auto-translation-173" | "__stack-auto-translation-174" | "__stack-auto-translation-175" | "__stack-auto-translation-176" | "__stack-auto-translation-177" | "__stack-auto-translation-178" | "__stack-auto-translation-179" | "__stack-auto-translation-180" | "__stack-auto-translation-181" | "__stack-auto-translation-182" | "__stack-auto-translation-183" | "__stack-auto-translation-184" | "__stack-auto-translation-185" | "__stack-auto-translation-186" | "__stack-auto-translation-187" | "__stack-auto-translation-188" | "__stack-auto-translation-189" | "__stack-auto-translation-190" | "__stack-auto-translation-191" | "__stack-auto-translation-192" | "__stack-auto-translation-193" | "__stack-auto-translation-194" | "__stack-auto-translation-195" | "__stack-auto-translation-196", "Configuración de la cuenta" | "Contraseña" | "Las contraseñas no coinciden" | "Cancelar" | "Principal" | "Imagen de perfil" | "Cambiar el nombre visible de tu equipo" | "Registrar una clave de acceso" | "Eliminar" | "Restablecer Contraseña" | "Guardar" | "Escanea este código QR con tu aplicación de autenticación:" | "Enviar correo electrónico" | "haga clic aquí" | "Establecer como principal" | "Establecer contraseña" | "Configuración" | "Iniciar sesión" | "Iniciar sesión de nuevo" | "Crear" | "Iniciar sesión con Passkey" | "Iniciar sesión con {provider}" | "Cerrar sesión" | "Registrarse" | "Registrarse con {provider}" | "¡Sesión iniciada con éxito!" | "Algo salió mal al procesar la devolución de llamada de OAuth:" | "Dejar de usar para iniciar sesión" | "La creación de equipos no está habilitada" | "Invitación al equipo" | "Imagen de perfil del equipo" | "Nombre de usuario del equipo" | "Equipos" | "Crear un equipo" | "La operación de inicio de sesión ha sido cancelada. Por favor, inténtelo de nuevo. [access_denied]" | "Luego, ingrese su código MFA de seis dígitos:" | "Esta cuenta ya está conectada a otro usuario. Por favor, conecta una cuenta diferente." | "Este enlace para restablecer la contraseña ya ha sido utilizado. Si necesita restablecer su contraseña nuevamente, solicite un nuevo enlace para restablecer la contraseña desde la página de inicio de sesión." | "Este enlace de invitación al equipo ya ha sido utilizado." | "Cambiar tema" | "Código QR de autenticación multifactor TOTP" | "Actualizar contraseña" | "Actualizar Contraseña" | "Actualiza tu contraseña" | "Sube una imagen para tu equipo" | "Equipo actual" | "Usar para iniciar sesión" | "Usado para iniciar sesión" | "Usuario" | "Nombre de usuario" | "Verificar" | "Ya has iniciado sesión" | "No puedes eliminar tu último correo electrónico de inicio de sesión" | "Zona de peligro" | "Tu contraseña ha sido restablecida. Ahora puedes iniciar sesión con tu nueva contraseña." | "Eliminar cuenta" | "Eliminar clave de acceso" | "Deshabilitar" | "Deshabilitar MFA" | "Deshabilitar OTP" | "¿No tienes una cuenta?" | "¿No necesitas restablecer?" | "Correo electrónico" | "Correo y contraseña" | "El correo electrónico ya existe" | "El correo electrónico es obligatorio" | "¡Correo enviado!" | "Correos electrónicos" | "Correos electrónicos y autenticación" | "Finalizar su sesión actual" | "Ingrese un nombre para mostrar para su nuevo equipo" | "Ingrese el código de su correo electrónico" | "Enlace mágico caducado" | "Enlace de verificación caducado" | "¿Ya tienes una cuenta?" | "Error al conectar la cuenta" | "No se pudo restablecer la contraseña. Por favor, solicite un nuevo enlace para restablecer la contraseña" | "¿Olvidaste tu contraseña?" | "Ir a inicio" | "Ignorar" | "Se produjo un error desconocido" | "Contraseña incorrecta" | "Código no válido" | "Imagen no válida" | "Enlace de restablecimiento de contraseña no válido" | "Invita a un usuario a tu equipo por correo electrónico" | "Invitar miembro" | "¿Está seguro de que desea eliminar su cuenta? Esta acción es IRREVERSIBLE y eliminará TODOS los datos asociados." | "Unirse" | "Salir" | "Abandonar equipo" | "Miembros" | "Autenticación de múltiples factores" | "La autenticación de múltiples factores está actualmente desactivada." | "La autenticación de múltiples factores está actualmente habilitada." | "Mi perfil" | "Nombre" | "No se permite el registro de nuevas cuentas" | "Nueva contraseña" | "Ningún método de autenticación habilitado." | "Sin equipos aún" | "Contraseña anterior" | "O continuar con" | "Otros equipos" | "Invitaciones pendientes" | "Sobrescribe tu nombre de usuario en este equipo" | "Clave de acceso" | "Clave de acceso registrada" | "¿Está seguro de que desea abandonar el equipo?" | "El inicio de sesión con clave de acceso está habilitado y no se puede deshabilitar ya que es el único método de inicio de sesión actual" | "Contraseña restablecida correctamente" | "Eliminar permanentemente tu cuenta y todos los datos asociados" | "Por favor, verifique si tiene el enlace correcto. Si continúa teniendo problemas, comuníquese con el soporte técnico." | "Por favor, verifique si tiene el enlace correcto para restablecer la contraseña." | "Por favor, verifica si tienes el enlace de invitación de equipo correcto." | "Por favor, introduce un nombre de equipo" | "Por favor, introduce un correo electrónico válido" | "Por favor, introduzca una dirección de correo electrónico válida" | "Por favor, introduzca una dirección de correo electrónico" | "Por favor, introduzca su correo electrónico" | "Por favor, introduce tu contraseña antigua" | "Por favor, ingrese su contraseña" | "Por favor, repita su contraseña" | "Inténtelo de nuevo y, si el problema persiste, póngase en contacto con el soporte." | "Por favor, verifica tu email primero" | "Repita la nueva contraseña" | "Repetir Contraseña" | "Restablecer tu contraseña" | "Enviar correo de verificación" | "Establece una contraseña para tu cuenta" | "Inicia sesión o crea una cuenta para unirte al equipo." | "Iniciar sesión en tu cuenta" | "El registro de nuevos usuarios no está habilitado en este momento." | "Registrarse con Passkey" | "Crear una nueva cuenta" | "Nombre visible del equipo" | "El enlace mágico ya ha sido utilizado. El enlace solo se puede usar una vez. Por favor, solicita un nuevo enlace mágico si necesitas iniciar sesión de nuevo." | "El usuario ya está conectado a otra cuenta OAuth. ¿Quizás seleccionó la cuenta equivocada en la página del proveedor OAuth?" | "Este email ya está siendo usado para iniciar sesión por otro usuario." | "Este es un nombre visible y no se utiliza para la autenticación" | "Es muy probable que se trate de un error en Stack. Por favor, informe de ello." | "Para habilitar el inicio de sesión por OTP, añada un correo electrónico de inicio de sesión verificado." | "Para habilitar el inicio de sesión con clave de acceso, añada un email de inicio de sesión verificado." | "Para establecer una contraseña, añade un email de inicio de sesión." | "Sin verificar" | "Sube tu propia imagen como avatar" | "Enlace de restablecimiento de contraseña utilizado" | "Enlace de invitación al equipo utilizado" | "No está registrado actualmente." | "¡Tu email ha sido verificado!" | "Tu email" | "Su enlace de verificación de correo electrónico ha caducado. Por favor, solicite un nuevo enlace de verificación desde la configuración de su cuenta." | "Su enlace mágico ha caducado. Por favor, solicite un nuevo enlace mágico si necesita iniciar sesión." | "Tu enlace para restablecer la contraseña ha caducado. Solicita un nuevo enlace para restablecer la contraseña desde la página de inicio de sesión." | "Tu enlace de invitación al equipo ha caducado. Por favor, solicita un nuevo enlace de invitación al equipo " | "Añadir" | "Nombre visible" | "¿Quieres iniciar sesión?" | "¿Quieres verificar tu email?" | "Añadir un correo electrónico" | "Habilitar MFA" | "Habilitar OTP" | "Añadir nueva clave de acceso" | "Habilitar el inicio de sesión mediante enlace mágico o OTP enviado a tus correos electrónicos de inicio de sesión." | "Introducir correo electrónico" | "Enlace de restablecimiento de contraseña caducado" | "Enlace de invitación al equipo caducado" | "Caduca" | "Error al restablecer la contraseña" | "Si el usuario con esta dirección de correo electrónico existe, se ha enviado un correo electrónico a su bandeja de entrada. Asegúrese de revisar su carpeta de spam." | "Si no es redirigido automáticamente, " | "Código incorrecto. Por favor, inténtelo de nuevo." | "Enlace Mágico No Válido" | "Enlace de invitación al equipo no válido" | "Código TOTP no válido" | "Enlace de verificación no válido" | "Invitar usuario" | "abandonar este equipo y eliminar tu perfil de equipo" | "Enlace mágico ya utilizado" | "¿Está seguro de que desea deshabilitar el inicio de sesión por OTP? Ya no podrá iniciar sesión solo con correos electrónicos." | "No registrado" | "Acceso denegado al proveedor de OAuth" | "¿Está seguro de que desea deshabilitar el inicio de sesión con clave de acceso? Ya no podrá iniciar sesión con su clave de acceso." | "Inicio de sesión por OTP" | "El inicio de sesión por OTP está habilitado y no se puede deshabilitar ya que actualmente es el único método de inicio de sesión" | "El inicio de sesión por OTP/enlace mágico está actualmente habilitado."> | Map<"__stack-auto-translation-0" | "__stack-auto-translation-1" | "__stack-auto-translation-2" | "__stack-auto-translation-3" | "__stack-auto-translation-4" | "__stack-auto-translation-5" | "__stack-auto-translation-6" | "__stack-auto-translation-7" | "__stack-auto-translation-8" | "__stack-auto-translation-9" | "__stack-auto-translation-10" | "__stack-auto-translation-11" | "__stack-auto-translation-12" | "__stack-auto-translation-13" | "__stack-auto-translation-14" | "__stack-auto-translation-15" | "__stack-auto-translation-16" | "__stack-auto-translation-17" | "__stack-auto-translation-18" | "__stack-auto-translation-19" | "__stack-auto-translation-20" | "__stack-auto-translation-21" | "__stack-auto-translation-22" | "__stack-auto-translation-23" | "__stack-auto-translation-24" | "__stack-auto-translation-25" | "__stack-auto-translation-26" | "__stack-auto-translation-27" | "__stack-auto-translation-28" | "__stack-auto-translation-29" | "__stack-auto-translation-30" | "__stack-auto-translation-31" | "__stack-auto-translation-32" | "__stack-auto-translation-33" | "__stack-auto-translation-34" | "__stack-auto-translation-35" | "__stack-auto-translation-36" | "__stack-auto-translation-37" | "__stack-auto-translation-38" | "__stack-auto-translation-39" | "__stack-auto-translation-40" | "__stack-auto-translation-41" | "__stack-auto-translation-42" | "__stack-auto-translation-43" | "__stack-auto-translation-44" | "__stack-auto-translation-45" | "__stack-auto-translation-46" | "__stack-auto-translation-47" | "__stack-auto-translation-48" | "__stack-auto-translation-49" | "__stack-auto-translation-50" | "__stack-auto-translation-51" | "__stack-auto-translation-52" | "__stack-auto-translation-53" | "__stack-auto-translation-54" | "__stack-auto-translation-55" | "__stack-auto-translation-56" | "__stack-auto-translation-57" | "__stack-auto-translation-58" | "__stack-auto-translation-59" | "__stack-auto-translation-60" | "__stack-auto-translation-61" | "__stack-auto-translation-62" | "__stack-auto-translation-63" | "__stack-auto-translation-64" | "__stack-auto-translation-65" | "__stack-auto-translation-66" | "__stack-auto-translation-67" | "__stack-auto-translation-68" | "__stack-auto-translation-69" | "__stack-auto-translation-70" | "__stack-auto-translation-71" | "__stack-auto-translation-72" | "__stack-auto-translation-73" | "__stack-auto-translation-74" | "__stack-auto-translation-75" | "__stack-auto-translation-76" | "__stack-auto-translation-77" | "__stack-auto-translation-78" | "__stack-auto-translation-79" | "__stack-auto-translation-80" | "__stack-auto-translation-81" | "__stack-auto-translation-82" | "__stack-auto-translation-83" | "__stack-auto-translation-84" | "__stack-auto-translation-85" | "__stack-auto-translation-86" | "__stack-auto-translation-87" | "__stack-auto-translation-88" | "__stack-auto-translation-89" | "__stack-auto-translation-90" | "__stack-auto-translation-91" | "__stack-auto-translation-92" | "__stack-auto-translation-93" | "__stack-auto-translation-94" | "__stack-auto-translation-95" | "__stack-auto-translation-96" | "__stack-auto-translation-97" | "__stack-auto-translation-98" | "__stack-auto-translation-99" | "__stack-auto-translation-100" | "__stack-auto-translation-101" | "__stack-auto-translation-102" | "__stack-auto-translation-103" | "__stack-auto-translation-104" | "__stack-auto-translation-105" | "__stack-auto-translation-106" | "__stack-auto-translation-107" | "__stack-auto-translation-108" | "__stack-auto-translation-109" | "__stack-auto-translation-110" | "__stack-auto-translation-111" | "__stack-auto-translation-112" | "__stack-auto-translation-113" | "__stack-auto-translation-114" | "__stack-auto-translation-115" | "__stack-auto-translation-116" | "__stack-auto-translation-117" | "__stack-auto-translation-118" | "__stack-auto-translation-119" | "__stack-auto-translation-120" | "__stack-auto-translation-121" | "__stack-auto-translation-122" | "__stack-auto-translation-123" | "__stack-auto-translation-124" | "__stack-auto-translation-125" | "__stack-auto-translation-126" | "__stack-auto-translation-127" | "__stack-auto-translation-128" | "__stack-auto-translation-129" | "__stack-auto-translation-130" | "__stack-auto-translation-131" | "__stack-auto-translation-132" | "__stack-auto-translation-133" | "__stack-auto-translation-134" | "__stack-auto-translation-135" | "__stack-auto-translation-136" | "__stack-auto-translation-137" | "__stack-auto-translation-138" | "__stack-auto-translation-139" | "__stack-auto-translation-140" | "__stack-auto-translation-141" | "__stack-auto-translation-142" | "__stack-auto-translation-143" | "__stack-auto-translation-144" | "__stack-auto-translation-145" | "__stack-auto-translation-146" | "__stack-auto-translation-147" | "__stack-auto-translation-148" | "__stack-auto-translation-149" | "__stack-auto-translation-150" | "__stack-auto-translation-151" | "__stack-auto-translation-152" | "__stack-auto-translation-153" | "__stack-auto-translation-154" | "__stack-auto-translation-155" | "__stack-auto-translation-156" | "__stack-auto-translation-157" | "__stack-auto-translation-158" | "__stack-auto-translation-159" | "__stack-auto-translation-160" | "__stack-auto-translation-161" | "__stack-auto-translation-162" | "__stack-auto-translation-163" | "__stack-auto-translation-164" | "__stack-auto-translation-165" | "__stack-auto-translation-166" | "__stack-auto-translation-167" | "__stack-auto-translation-168" | "__stack-auto-translation-169" | "__stack-auto-translation-170" | "__stack-auto-translation-171" | "__stack-auto-translation-172" | "__stack-auto-translation-173" | "__stack-auto-translation-174" | "__stack-auto-translation-175" | "__stack-auto-translation-176" | "__stack-auto-translation-177" | "__stack-auto-translation-178" | "__stack-auto-translation-179" | "__stack-auto-translation-180" | "__stack-auto-translation-181" | "__stack-auto-translation-182" | "__stack-auto-translation-183" | "__stack-auto-translation-184" | "__stack-auto-translation-185" | "__stack-auto-translation-186" | "__stack-auto-translation-187" | "__stack-auto-translation-188" | "__stack-auto-translation-189" | "__stack-auto-translation-190" | "__stack-auto-translation-191" | "__stack-auto-translation-192" | "__stack-auto-translation-193" | "__stack-auto-translation-194" | "__stack-auto-translation-195" | "__stack-auto-translation-196", "Principal" | "Paramètres du compte" | "Êtes-vous sûr de vouloir quitter l'équipe?" | "La connexion par clé d'accès est activée et ne peut être désactivée car c'est actuellement la seule méthode de connexion" | "Mot de passe" | "Réinitialisation du mot de passe réussie !" | "Les mots de passe ne correspondent pas" | "Supprimer définitivement votre compte et toutes les données associées" | "Veuillez vérifier si vous avez le bon lien. Si vous continuez à avoir des problèmes, veuillez contacter le support." | "Veuillez vérifier si vous avez le bon lien de réinitialisation du mot de passe." | "Veuillez vérifier si vous avez le bon lien d'invitation d'équipe." | "Veuillez saisir un nom d'équipe" | "Veuillez saisir une adresse courriel valide" | "Annuler" | "Veuillez saisir une adresse courriel" | "Veuillez saisir votre adresse courriel" | "Veuillez entrer votre ancien mot de passe" | "Veuillez entrer votre mot de passe" | "Veuillez répéter votre mot de passe" | "Veuillez réessayer et si le problème persiste, contactez le support." | "Veuillez d'abord vérifier votre courriel" | "Image de profil" | "Modifier le nom d'affichage de votre équipe" | "Enregistrer une clé d'accès" | "Supprimer" | "Répétez le nouveau mot de passe" | "Répéter le mot de passe" | "Réinitialiser le mot de passe" | "Réinitialisez votre mot de passe" | "Enregistrer" | "Scannez ce code QR avec votre application d'authentification :" | "Envoyer le courriel" | "cliquez ici" | "Envoyer un courriel de vérification" | "Définir un mot de passe pour votre compte" | "Définir comme principal" | "Définir le mot de passe" | "Paramètres" | "Connexion" | "Se connecter" | "Se connecter à nouveau" | "Créer" | "Connectez-vous ou créez un compte pour rejoindre l'équipe." | "Connectez-vous à votre compte" | "Se connecter avec clé d'accès" | "Connexion avec {provider}" | "Se déconnecter" | "S'inscrire" | "L'inscription de nouveaux utilisateurs n'est pas activée pour le moment." | "S'inscrire avec Passkey" | "S'inscrire avec {provider}" | "Créer un nouveau compte" | "Connexion réussie !" | "Une erreur s'est produite lors du traitement du rappel OAuth :" | "Cesser d'utiliser pour la connexion" | "La création d'équipe n'est pas activée" | "Nom d'affichage de l'équipe" | "Invitation d'équipe" | "Image de profil d'équipe" | "Nom d'utilisateur d'équipe" | "Équipes" | "Le lien magique a déjà été utilisé. Le lien ne peut être utilisé qu'une seule fois. Veuillez demander un nouveau lien magique si vous devez vous reconnecter." | "Créer une équipe" | "L'opération de connexion a été annulée. Veuillez réessayer. [access_denied]" | "L'utilisateur est déjà connecté à un autre compte OAuth. Avez-vous peut-être sélectionné le mauvais compte sur la page du fournisseur OAuth ?" | "Ensuite, saisissez votre code MFA à six chiffres :" | "Ce compte est déjà associé à un autre utilisateur. Veuillez connecter un compte différent." | "Ce courriel est déjà utilisé pour la connexion par un autre utilisateur." | "Il s'agit d'un nom d'affichage et il n'est pas utilisé pour l'authentification" | "Il s'agit probablement d'une erreur dans Stack. Veuillez la signaler." | "Ce lien de réinitialisation de mot de passe a déjà été utilisé. Si vous devez à nouveau réinitialiser votre mot de passe, veuillez demander un nouveau lien de réinitialisation depuis la page de connexion." | "Ce lien d'invitation d'équipe a déjà été utilisé." | "Pour activer la connexion par OTP, veuillez ajouter un courriel de connexion vérifié." | "Pour activer la connexion par clé d'accès, veuillez ajouter un courriel de connexion vérifié." | "Pour définir un mot de passe, veuillez ajouter un courriel de connexion." | "Changer de thème" | "Code QR d'authentification à plusieurs facteurs TOTP" | "Non vérifié" | "Mettre à jour le mot de passe" | "Mettre à jour votre mot de passe" | "Téléversez une image pour votre équipe" | "Téléversez votre propre image comme avatar" | "Équipe actuelle" | "Utiliser pour la connexion" | "Utilisé pour la connexion" | "Lien de réinitialisation de mot de passe utilisé" | "Lien d'invitation d'équipe utilisé" | "Utilisateur" | "Nom d'utilisateur" | "Vérifier" | "Vous êtes déjà connecté" | "Vous n'êtes pas connecté actuellement." | "Vous ne pouvez pas supprimer votre dernier courriel de connexion" | "Zone dangereuse" | "Votre courriel a été vérifié !" | "Votre courriel" | "Votre lien de vérification de courriel a expiré. Veuillez demander un nouveau lien de vérification dans les paramètres de votre compte." | "Votre lien magique a expiré. Veuillez demander un nouveau lien magique si vous avez besoin de vous connecter." | "Votre mot de passe a été réinitialisé. Vous pouvez maintenant vous connecter avec votre nouveau mot de passe." | "Votre lien de réinitialisation du mot de passe a expiré. Veuillez demander un nouveau lien de réinitialisation du mot de passe à partir de la page de connexion." | "Votre lien d'invitation à l'équipe a expiré. Veuillez demander un nouveau lien d'invitation à l'équipe " | "Ajouter" | "Supprimer le compte" | "Supprimer la clé d'accès" | "Désactiver" | "Désactiver l'AMF" | "Désactiver OTP" | "Nom d'affichage" | "Voulez-vous vous connecter ?" | "Voulez-vous vérifier votre courriel ?" | "Vous n'avez pas de compte ?" | "Ajouter un courriel" | "Pas besoin de réinitialiser ?" | "Courriel" | "Courriel et mot de passe" | "Le courriel existe déjà" | "Le courriel est requis" | "Courriel envoyé !" | "Courriels" | "Courriels et authentification" | "Activer l'AMF" | "Activer l'OTP" | "Ajouter une nouvelle clé d'accès" | "Activer la connexion par lien magique ou OTP envoyé à vos courriels de connexion." | "Terminez votre session actuelle" | "Entrez un nom d'affichage pour votre nouvelle équipe" | "Saisir le courriel" | "Entrez le code reçu par courriel" | "Lien magique expiré" | "Lien de réinitialisation de mot de passe expiré" | "Lien d'invitation d'équipe expiré" | "Lien de vérification expiré" | "Expire" | "Vous avez déjà un compte?" | "Échec de connexion du compte" | "Échec de la réinitialisation du mot de passe" | "Échec de la réinitialisation du mot de passe. Veuillez demander un nouveau lien de réinitialisation du mot de passe" | "Mot de passe oublié ?" | "Accueil" | "Si l'utilisateur avec cette adresse courriel existe, un courriel a été envoyé à votre boîte de réception. Assurez-vous de vérifier votre dossier de courrier indésirable." | "Si vous n'êtes pas redirigé automatiquement, " | "Ignorer" | "Code incorrect. Veuillez réessayer." | "Une erreur inconnue s'est produite" | "Mot de passe incorrect" | "Code invalide" | "Image non valide" | "Lien magique invalide" | "Lien de réinitialisation du mot de passe invalide" | "Lien d'invitation d'équipe invalide" | "Code TOTP non valide" | "Lien de vérification invalide" | "Invitez un utilisateur à votre équipe par courriel" | "Inviter un membre" | "Êtes-vous sûr de vouloir supprimer votre compte ? Cette action est IRRÉVERSIBLE et supprimera TOUTES les données associées." | "Inviter l'utilisateur" | "Joindre" | "Quitter" | "Quitter l'équipe" | "quitter cette équipe et supprimer votre profil d'équipe" | "Lien magique déjà utilisé" | "Membres" | "Authentification à plusieurs facteurs" | "L'authentification à deux facteurs est actuellement désactivée." | "Êtes-vous sûr de vouloir désactiver la connexion par OTP ? Vous ne pourrez plus vous connecter uniquement avec des courriels." | "L'authentification multifactorielle est actuellement activée." | "Mon profil" | "Nom" | "L'inscription de nouveaux comptes n'est pas autorisée" | "Nouveau mot de passe" | "Aucune méthode d'authentification activée." | "Aucune équipe pour l'instant" | "Non connecté" | "Accès au fournisseur OAuth refusé" | "Êtes-vous sûr de vouloir désactiver la connexion par clé d'accès ? Vous ne pourrez plus vous connecter avec votre clé d'accès." | "Ancien mot de passe" | "Ou continuer avec" | "Autres équipes" | "Connexion par OTP" | "La connexion par OTP est activée et ne peut pas être désactivée car c'est actuellement la seule méthode de connexion" | "La connexion par OTP/lien magique est actuellement activée." | "Invitations en attente" | "Remplacez votre nom d'affichage d'utilisateur dans cette équipe" | "Clé d'accès" | "Clé d'accès enregistrée"> | Map<"__stack-auto-translation-0" | "__stack-auto-translation-1" | "__stack-auto-translation-2" | "__stack-auto-translation-3" | "__stack-auto-translation-4" | "__stack-auto-translation-5" | "__stack-auto-translation-6" | "__stack-auto-translation-7" | "__stack-auto-translation-8" | "__stack-auto-translation-9" | "__stack-auto-translation-10" | "__stack-auto-translation-11" | "__stack-auto-translation-12" | "__stack-auto-translation-13" | "__stack-auto-translation-14" | "__stack-auto-translation-15" | "__stack-auto-translation-16" | "__stack-auto-translation-17" | "__stack-auto-translation-18" | "__stack-auto-translation-19" | "__stack-auto-translation-20" | "__stack-auto-translation-21" | "__stack-auto-translation-22" | "__stack-auto-translation-23" | "__stack-auto-translation-24" | "__stack-auto-translation-25" | "__stack-auto-translation-26" | "__stack-auto-translation-27" | "__stack-auto-translation-28" | "__stack-auto-translation-29" | "__stack-auto-translation-30" | "__stack-auto-translation-31" | "__stack-auto-translation-32" | "__stack-auto-translation-33" | "__stack-auto-translation-34" | "__stack-auto-translation-35" | "__stack-auto-translation-36" | "__stack-auto-translation-37" | "__stack-auto-translation-38" | "__stack-auto-translation-39" | "__stack-auto-translation-40" | "__stack-auto-translation-41" | "__stack-auto-translation-42" | "__stack-auto-translation-43" | "__stack-auto-translation-44" | "__stack-auto-translation-45" | "__stack-auto-translation-46" | "__stack-auto-translation-47" | "__stack-auto-translation-48" | "__stack-auto-translation-49" | "__stack-auto-translation-50" | "__stack-auto-translation-51" | "__stack-auto-translation-52" | "__stack-auto-translation-53" | "__stack-auto-translation-54" | "__stack-auto-translation-55" | "__stack-auto-translation-56" | "__stack-auto-translation-57" | "__stack-auto-translation-58" | "__stack-auto-translation-59" | "__stack-auto-translation-60" | "__stack-auto-translation-61" | "__stack-auto-translation-62" | "__stack-auto-translation-63" | "__stack-auto-translation-64" | "__stack-auto-translation-65" | "__stack-auto-translation-66" | "__stack-auto-translation-67" | "__stack-auto-translation-68" | "__stack-auto-translation-69" | "__stack-auto-translation-70" | "__stack-auto-translation-71" | "__stack-auto-translation-72" | "__stack-auto-translation-73" | "__stack-auto-translation-74" | "__stack-auto-translation-75" | "__stack-auto-translation-76" | "__stack-auto-translation-77" | "__stack-auto-translation-78" | "__stack-auto-translation-79" | "__stack-auto-translation-80" | "__stack-auto-translation-81" | "__stack-auto-translation-82" | "__stack-auto-translation-83" | "__stack-auto-translation-84" | "__stack-auto-translation-85" | "__stack-auto-translation-86" | "__stack-auto-translation-87" | "__stack-auto-translation-88" | "__stack-auto-translation-89" | "__stack-auto-translation-90" | "__stack-auto-translation-91" | "__stack-auto-translation-92" | "__stack-auto-translation-93" | "__stack-auto-translation-94" | "__stack-auto-translation-95" | "__stack-auto-translation-96" | "__stack-auto-translation-97" | "__stack-auto-translation-98" | "__stack-auto-translation-99" | "__stack-auto-translation-100" | "__stack-auto-translation-101" | "__stack-auto-translation-102" | "__stack-auto-translation-103" | "__stack-auto-translation-104" | "__stack-auto-translation-105" | "__stack-auto-translation-106" | "__stack-auto-translation-107" | "__stack-auto-translation-108" | "__stack-auto-translation-109" | "__stack-auto-translation-110" | "__stack-auto-translation-111" | "__stack-auto-translation-112" | "__stack-auto-translation-113" | "__stack-auto-translation-114" | "__stack-auto-translation-115" | "__stack-auto-translation-116" | "__stack-auto-translation-117" | "__stack-auto-translation-118" | "__stack-auto-translation-119" | "__stack-auto-translation-120" | "__stack-auto-translation-121" | "__stack-auto-translation-122" | "__stack-auto-translation-123" | "__stack-auto-translation-124" | "__stack-auto-translation-125" | "__stack-auto-translation-126" | "__stack-auto-translation-127" | "__stack-auto-translation-128" | "__stack-auto-translation-129" | "__stack-auto-translation-130" | "__stack-auto-translation-131" | "__stack-auto-translation-132" | "__stack-auto-translation-133" | "__stack-auto-translation-134" | "__stack-auto-translation-135" | "__stack-auto-translation-136" | "__stack-auto-translation-137" | "__stack-auto-translation-138" | "__stack-auto-translation-139" | "__stack-auto-translation-140" | "__stack-auto-translation-141" | "__stack-auto-translation-142" | "__stack-auto-translation-143" | "__stack-auto-translation-144" | "__stack-auto-translation-145" | "__stack-auto-translation-146" | "__stack-auto-translation-147" | "__stack-auto-translation-148" | "__stack-auto-translation-149" | "__stack-auto-translation-150" | "__stack-auto-translation-151" | "__stack-auto-translation-152" | "__stack-auto-translation-153" | "__stack-auto-translation-154" | "__stack-auto-translation-155" | "__stack-auto-translation-156" | "__stack-auto-translation-157" | "__stack-auto-translation-158" | "__stack-auto-translation-159" | "__stack-auto-translation-160" | "__stack-auto-translation-161" | "__stack-auto-translation-162" | "__stack-auto-translation-163" | "__stack-auto-translation-164" | "__stack-auto-translation-165" | "__stack-auto-translation-166" | "__stack-auto-translation-167" | "__stack-auto-translation-168" | "__stack-auto-translation-169" | "__stack-auto-translation-170" | "__stack-auto-translation-171" | "__stack-auto-translation-172" | "__stack-auto-translation-173" | "__stack-auto-translation-174" | "__stack-auto-translation-175" | "__stack-auto-translation-176" | "__stack-auto-translation-177" | "__stack-auto-translation-178" | "__stack-auto-translation-179" | "__stack-auto-translation-180" | "__stack-auto-translation-181" | "__stack-auto-translation-182" | "__stack-auto-translation-183" | "__stack-auto-translation-184" | "__stack-auto-translation-185" | "__stack-auto-translation-186" | "__stack-auto-translation-187" | "__stack-auto-translation-188" | "__stack-auto-translation-189" | "__stack-auto-translation-190" | "__stack-auto-translation-191" | "__stack-auto-translation-192" | "__stack-auto-translation-193" | "__stack-auto-translation-194" | "__stack-auto-translation-195" | "__stack-auto-translation-196", "Principal" | "Paramètres du compte" | "Mot de passe" | "Réinitialisation du mot de passe réussie !" | "Les mots de passe ne correspondent pas" | "Veuillez saisir un nom d'équipe" | "Annuler" | "Veuillez répéter votre mot de passe" | "Veuillez réessayer et si le problème persiste, contactez le support." | "Image de profil" | "Enregistrer une clé d'accès" | "Supprimer" | "Répéter le mot de passe" | "Réinitialiser le mot de passe" | "Réinitialisez votre mot de passe" | "Enregistrer" | "Scannez ce code QR avec votre application d'authentification :" | "cliquez ici" | "Définir comme principal" | "Définir le mot de passe" | "Paramètres" | "Se connecter" | "Se connecter à nouveau" | "Créer" | "Connectez-vous ou créez un compte pour rejoindre l'équipe." | "Connectez-vous à votre compte" | "Se déconnecter" | "S'inscrire" | "S'inscrire avec Passkey" | "S'inscrire avec {provider}" | "Créer un nouveau compte" | "Connexion réussie !" | "La création d'équipe n'est pas activée" | "Nom d'affichage de l'équipe" | "Invitation d'équipe" | "Image de profil d'équipe" | "Équipes" | "Le lien magique a déjà été utilisé. Le lien ne peut être utilisé qu'une seule fois. Veuillez demander un nouveau lien magique si vous devez vous reconnecter." | "Créer une équipe" | "L'opération de connexion a été annulée. Veuillez réessayer. [access_denied]" | "L'utilisateur est déjà connecté à un autre compte OAuth. Avez-vous peut-être sélectionné le mauvais compte sur la page du fournisseur OAuth ?" | "Ensuite, saisissez votre code MFA à six chiffres :" | "Il s'agit probablement d'une erreur dans Stack. Veuillez la signaler." | "Ce lien de réinitialisation de mot de passe a déjà été utilisé. Si vous devez à nouveau réinitialiser votre mot de passe, veuillez demander un nouveau lien de réinitialisation depuis la page de connexion." | "Ce lien d'invitation d'équipe a déjà été utilisé." | "Changer de thème" | "Non vérifié" | "Mettre à jour le mot de passe" | "Équipe actuelle" | "Utiliser pour la connexion" | "Utilisé pour la connexion" | "Lien de réinitialisation de mot de passe utilisé" | "Utilisateur" | "Nom d'utilisateur" | "Vérifier" | "Vous êtes déjà connecté" | "Vous n'êtes pas connecté actuellement." | "Zone dangereuse" | "Votre lien magique a expiré. Veuillez demander un nouveau lien magique si vous avez besoin de vous connecter." | "Votre mot de passe a été réinitialisé. Vous pouvez maintenant vous connecter avec votre nouveau mot de passe." | "Votre lien de réinitialisation du mot de passe a expiré. Veuillez demander un nouveau lien de réinitialisation du mot de passe à partir de la page de connexion." | "Ajouter" | "Supprimer le compte" | "Supprimer la clé d'accès" | "Désactiver" | "Nom d'affichage" | "Voulez-vous vous connecter ?" | "Vous n'avez pas de compte ?" | "Pas besoin de réinitialiser ?" | "Activer l'AMF" | "Activer l'OTP" | "Ajouter une nouvelle clé d'accès" | "Entrez un nom d'affichage pour votre nouvelle équipe" | "Lien magique expiré" | "Lien de réinitialisation de mot de passe expiré" | "Lien d'invitation d'équipe expiré" | "Lien de vérification expiré" | "Expire" | "Échec de la réinitialisation du mot de passe" | "Échec de la réinitialisation du mot de passe. Veuillez demander un nouveau lien de réinitialisation du mot de passe" | "Mot de passe oublié ?" | "Accueil" | "Si vous n'êtes pas redirigé automatiquement, " | "Ignorer" | "Code incorrect. Veuillez réessayer." | "Une erreur inconnue s'est produite" | "Mot de passe incorrect" | "Code invalide" | "Lien magique invalide" | "Lien de vérification invalide" | "Inviter un membre" | "Êtes-vous sûr de vouloir supprimer votre compte ? Cette action est IRRÉVERSIBLE et supprimera TOUTES les données associées." | "Inviter l'utilisateur" | "Quitter" | "Quitter l'équipe" | "quitter cette équipe et supprimer votre profil d'équipe" | "Lien magique déjà utilisé" | "Membres" | "Authentification à plusieurs facteurs" | "L'authentification à deux facteurs est actuellement désactivée." | "Mon profil" | "Nom" | "L'inscription de nouveaux comptes n'est pas autorisée" | "Nouveau mot de passe" | "Aucune méthode d'authentification activée." | "Aucune équipe pour l'instant" | "Non connecté" | "Êtes-vous sûr de vouloir désactiver la connexion par clé d'accès ? Vous ne pourrez plus vous connecter avec votre clé d'accès." | "Ancien mot de passe" | "Ou continuer avec" | "Autres équipes" | "La connexion par OTP/lien magique est actuellement activée." | "Invitations en attente" | "Remplacez votre nom d'affichage d'utilisateur dans cette équipe" | "Clé d'accès" | "Clé d'accès enregistrée" | "Êtes-vous sûr de vouloir quitter l'équipe ?" | "La connexion par clé d'accès est activée et ne peut pas être désactivée car c'est actuellement la seule méthode de connexion" | "Supprimez définitivement votre compte et toutes les données associées" | "Veuillez vérifier si vous avez le bon lien. Si vous continuez à rencontrer des problèmes, veuillez contacter le support." | "Veuillez vérifier si vous avez le bon lien de réinitialisation de mot de passe." | "Veuillez vérifier que vous disposez du bon lien d'invitation d'équipe." | "Veuillez saisir une adresse e-mail valide" | "Veuillez saisir une adresse e-mail" | "Veuillez saisir votre adresse e-mail" | "Veuillez saisir votre ancien mot de passe" | "Veuillez saisir votre mot de passe" | "Veuillez d'abord vérifier votre adresse e-mail" | "Modifiez le nom d'affichage de votre équipe" | "Répéter le nouveau mot de passe" | "Envoyer l'e-mail" | "Envoyer un e-mail de vérification" | "Définissez un mot de passe pour votre compte" | "Se connecter avec Passkey" | "Se connecter avec {provider}" | "L'inscription pour les nouveaux utilisateurs n'est pas activée pour le moment." | "Une erreur est survenue lors du traitement de la réponse OAuth :" | "Ne plus utiliser pour la connexion" | "Nom d'utilisateur de l'équipe" | "Ce compte est déjà connecté à un autre utilisateur. Veuillez connecter un compte différent." | "Cet e-mail est déjà utilisé pour la connexion par un autre utilisateur." | "Il s'agit d'un nom d'affichage et n'est pas utilisé pour l'authentification" | "Pour activer la connexion OTP, veuillez ajouter une adresse e-mail de connexion vérifiée." | "Pour activer la connexion par clé d'accès, veuillez ajouter une adresse e-mail de connexion vérifiée." | "Pour définir un mot de passe, veuillez ajouter une adresse e-mail de connexion." | "TOTP Code QR d'authentification à plusieurs facteurs" | "Mettez à jour votre mot de passe" | "Téléchargez une image pour votre équipe" | "Téléchargez votre propre image comme avatar" | "Lien d'invitation d'équipe déjà utilisé" | "Vous ne pouvez pas supprimer votre dernière adresse e-mail de connexion" | "Votre email a été vérifié !" | "Votre e-mail" | "Votre lien de vérification d'e-mail a expiré. Veuillez demander un nouveau lien de vérification dans les paramètres de votre compte." | "Votre lien d'invitation d'équipe a expiré. Veuillez demander un nouveau lien d'invitation d'équipe " | "Désactiver MFA" | "Désactiver l'OTP" | "Voulez-vous vérifier votre e-mail ?" | "Ajouter un e-mail" | "Adresse e-mail" | "Email et mot de passe" | "Cet email existe déjà" | "L'adresse e-mail est requise" | "Email envoyé !" | "E-mails" | "E-mails et authentification" | "Activer la connexion via un lien magique ou un OTP envoyé à vos e-mails de connexion." | "Mettre fin à votre session actuelle" | "Saisir l'adresse e-mail" | "Saisissez le code reçu par e-mail" | "Vous avez déjà un compte ?" | "Échec de la connexion du compte" | "Si l'utilisateur avec cette adresse e-mail existe, un e-mail a été envoyé dans votre boîte de réception. Assurez-vous de vérifier votre dossier de courrier indésirable." | "Image invalide" | "Lien de réinitialisation de mot de passe non valide" | "Lien d'invitation d'équipe non valide" | "Code TOTP invalide" | "Invitez un utilisateur à rejoindre votre équipe par e-mail" | "Rejoindre" | "Êtes-vous sûr de vouloir désactiver la connexion OTP ? Vous ne pourrez plus vous connecter uniquement avec des e-mails." | "L'authentification à plusieurs facteurs est actuellement activée." | "Accès refusé par le fournisseur OAuth" | "Connexion OTP" | "La connexion OTP est activée et ne peut pas être désactivée car c'est actuellement la seule méthode de connexion"> | Map<"__stack-auto-translation-0" | "__stack-auto-translation-1" | "__stack-auto-translation-2" | "__stack-auto-translation-3" | "__stack-auto-translation-4" | "__stack-auto-translation-5" | "__stack-auto-translation-6" | "__stack-auto-translation-7" | "__stack-auto-translation-8" | "__stack-auto-translation-9" | "__stack-auto-translation-10" | "__stack-auto-translation-11" | "__stack-auto-translation-12" | "__stack-auto-translation-13" | "__stack-auto-translation-14" | "__stack-auto-translation-15" | "__stack-auto-translation-16" | "__stack-auto-translation-17" | "__stack-auto-translation-18" | "__stack-auto-translation-19" | "__stack-auto-translation-20" | "__stack-auto-translation-21" | "__stack-auto-translation-22" | "__stack-auto-translation-23" | "__stack-auto-translation-24" | "__stack-auto-translation-25" | "__stack-auto-translation-26" | "__stack-auto-translation-27" | "__stack-auto-translation-28" | "__stack-auto-translation-29" | "__stack-auto-translation-30" | "__stack-auto-translation-31" | "__stack-auto-translation-32" | "__stack-auto-translation-33" | "__stack-auto-translation-34" | "__stack-auto-translation-35" | "__stack-auto-translation-36" | "__stack-auto-translation-37" | "__stack-auto-translation-38" | "__stack-auto-translation-39" | "__stack-auto-translation-40" | "__stack-auto-translation-41" | "__stack-auto-translation-42" | "__stack-auto-translation-43" | "__stack-auto-translation-44" | "__stack-auto-translation-45" | "__stack-auto-translation-46" | "__stack-auto-translation-47" | "__stack-auto-translation-48" | "__stack-auto-translation-49" | "__stack-auto-translation-50" | "__stack-auto-translation-51" | "__stack-auto-translation-52" | "__stack-auto-translation-53" | "__stack-auto-translation-54" | "__stack-auto-translation-55" | "__stack-auto-translation-56" | "__stack-auto-translation-57" | "__stack-auto-translation-58" | "__stack-auto-translation-59" | "__stack-auto-translation-60" | "__stack-auto-translation-61" | "__stack-auto-translation-62" | "__stack-auto-translation-63" | "__stack-auto-translation-64" | "__stack-auto-translation-65" | "__stack-auto-translation-66" | "__stack-auto-translation-67" | "__stack-auto-translation-68" | "__stack-auto-translation-69" | "__stack-auto-translation-70" | "__stack-auto-translation-71" | "__stack-auto-translation-72" | "__stack-auto-translation-73" | "__stack-auto-translation-74" | "__stack-auto-translation-75" | "__stack-auto-translation-76" | "__stack-auto-translation-77" | "__stack-auto-translation-78" | "__stack-auto-translation-79" | "__stack-auto-translation-80" | "__stack-auto-translation-81" | "__stack-auto-translation-82" | "__stack-auto-translation-83" | "__stack-auto-translation-84" | "__stack-auto-translation-85" | "__stack-auto-translation-86" | "__stack-auto-translation-87" | "__stack-auto-translation-88" | "__stack-auto-translation-89" | "__stack-auto-translation-90" | "__stack-auto-translation-91" | "__stack-auto-translation-92" | "__stack-auto-translation-93" | "__stack-auto-translation-94" | "__stack-auto-translation-95" | "__stack-auto-translation-96" | "__stack-auto-translation-97" | "__stack-auto-translation-98" | "__stack-auto-translation-99" | "__stack-auto-translation-100" | "__stack-auto-translation-101" | "__stack-auto-translation-102" | "__stack-auto-translation-103" | "__stack-auto-translation-104" | "__stack-auto-translation-105" | "__stack-auto-translation-106" | "__stack-auto-translation-107" | "__stack-auto-translation-108" | "__stack-auto-translation-109" | "__stack-auto-translation-110" | "__stack-auto-translation-111" | "__stack-auto-translation-112" | "__stack-auto-translation-113" | "__stack-auto-translation-114" | "__stack-auto-translation-115" | "__stack-auto-translation-116" | "__stack-auto-translation-117" | "__stack-auto-translation-118" | "__stack-auto-translation-119" | "__stack-auto-translation-120" | "__stack-auto-translation-121" | "__stack-auto-translation-122" | "__stack-auto-translation-123" | "__stack-auto-translation-124" | "__stack-auto-translation-125" | "__stack-auto-translation-126" | "__stack-auto-translation-127" | "__stack-auto-translation-128" | "__stack-auto-translation-129" | "__stack-auto-translation-130" | "__stack-auto-translation-131" | "__stack-auto-translation-132" | "__stack-auto-translation-133" | "__stack-auto-translation-134" | "__stack-auto-translation-135" | "__stack-auto-translation-136" | "__stack-auto-translation-137" | "__stack-auto-translation-138" | "__stack-auto-translation-139" | "__stack-auto-translation-140" | "__stack-auto-translation-141" | "__stack-auto-translation-142" | "__stack-auto-translation-143" | "__stack-auto-translation-144" | "__stack-auto-translation-145" | "__stack-auto-translation-146" | "__stack-auto-translation-147" | "__stack-auto-translation-148" | "__stack-auto-translation-149" | "__stack-auto-translation-150" | "__stack-auto-translation-151" | "__stack-auto-translation-152" | "__stack-auto-translation-153" | "__stack-auto-translation-154" | "__stack-auto-translation-155" | "__stack-auto-translation-156" | "__stack-auto-translation-157" | "__stack-auto-translation-158" | "__stack-auto-translation-159" | "__stack-auto-translation-160" | "__stack-auto-translation-161" | "__stack-auto-translation-162" | "__stack-auto-translation-163" | "__stack-auto-translation-164" | "__stack-auto-translation-165" | "__stack-auto-translation-166" | "__stack-auto-translation-167" | "__stack-auto-translation-168" | "__stack-auto-translation-169" | "__stack-auto-translation-170" | "__stack-auto-translation-171" | "__stack-auto-translation-172" | "__stack-auto-translation-173" | "__stack-auto-translation-174" | "__stack-auto-translation-175" | "__stack-auto-translation-176" | "__stack-auto-translation-177" | "__stack-auto-translation-178" | "__stack-auto-translation-179" | "__stack-auto-translation-180" | "__stack-auto-translation-181" | "__stack-auto-translation-182" | "__stack-auto-translation-183" | "__stack-auto-translation-184" | "__stack-auto-translation-185" | "__stack-auto-translation-186" | "__stack-auto-translation-187" | "__stack-auto-translation-188" | "__stack-auto-translation-189" | "__stack-auto-translation-190" | "__stack-auto-translation-191" | "__stack-auto-translation-192" | "__stack-auto-translation-193" | "__stack-auto-translation-194" | "__stack-auto-translation-195" | "__stack-auto-translation-196", "Team" | "Passkey" | "Password" | "Email" | "Impostazioni account" | "Impostazioni Account" | "Sei sicuro di voler lasciare il team?" | "L'accesso con Passkey è attivo e non può essere disattivato poiché è attualmente l'unico metodo di accesso" | "Password reimpostata con successo!" | "Le password non corrispondono" | "Rimuovi permanentemente il tuo account e tutti i dati associati" | "Verificare di avere il link corretto. Se continui ad avere problemi, contatta l'assistenza." | "Si prega di verificare di avere il link corretto per il ripristino della password." | "Verifica di avere il link di invito al team corretto." | "Inserisci un nome per il team" | "Inserisci un indirizzo email valido" | "Annulla" | "Si prega di inserire un indirizzo email" | "Inserisci il tuo indirizzo email" | "Inserisci la tua vecchia password" | "Inserisci la tua password" | "Per favore ripeti la tua password" | "Si prega di riprovare e se il problema persiste, contattare l'assistenza." | "Per favore verifica prima la tua email" | "Principale" | "Immagine del profilo" | "Modifica il nome visualizzato del tuo team" | "Registra una passkey" | "Rimuovi" | "Ripeti nuova password" | "Ripeti Nuova Password" | "Ripeti Password" | "Reimposta Password" | "Reimposta la tua password" | "Salva" | "Scansiona questo codice QR con la tua app di autenticazione:" | "Invia email" | "clicca qui" | "Invia Email" | "Invia email di verifica" | "Imposta una password per il tuo account" | "Imposta come principale" | "Imposta password" | "Imposta Password" | "Impostazioni" | "Accedi" | "Accedi di nuovo" | "Crea" | "Accedi o crea un account per unirti al team." | "Accedi al tuo account" | "Accedi con Passkey" | "Accedi con {provider}" | "Esci" | "Registrati" | "L'iscrizione per i nuovi utenti non è attualmente abilitata." | "Registrati con Passkey" | "Registrati con {provider}" | "Crea un nuovo account" | "Accesso effettuato con successo!" | "Qualcosa è andato storto durante l'elaborazione del callback OAuth:" | "Interrompi l'utilizzo per l'accesso" | "La creazione del team non è abilitata" | "Nome visualizzato del team" | "Invito di squadra" | "Immagine del profilo del team" | "Nome utente del team" | "Il link magico è già stato utilizzato. Il link può essere usato una sola volta. Si prega di richiedere un nuovo link magico se è necessario accedere nuovamente." | "Crea un team" | "L'operazione di accesso è stata annullata. Si prega di riprovare. [access_denied]" | "L'utente è già collegato a un altro account OAuth. Hai forse selezionato l'account sbagliato nella pagina del provider OAuth?" | "Quindi, inserisci il tuo codice MFA a sei cifre:" | "Questo account è già collegato a un altro utente. Si prega di collegare un account diverso." | "Questa email è già utilizzata per l'accesso da un altro utente." | "Questo è un nome visualizzato e non viene utilizzato per l'autenticazione" | "Questo è molto probabilmente un errore in Stack. Si prega di segnalarlo." | "Questo link per il ripristino della password è già stato utilizzato. Se hai bisogno di reimpostare nuovamente la tua password, richiedi un nuovo link per il ripristino dalla pagina di accesso." | "Questo link di invito al team è già stato utilizzato." | "Per abilitare l'accesso con OTP, aggiungi un'email di accesso verificata." | "Crea un Team" | "Per abilitare l'accesso con Passkey, aggiungi un'email di accesso verificata." | "Per impostare una password, aggiungi un'email di accesso." | "Cambia tema" | "Codice QR per l'autenticazione a più fattori TOTP" | "Non verificato" | "Aggiorna password" | "Aggiorna Password" | "Aggiorna la tua password" | "Carica un'immagine per il tuo team" | "Carica la tua immagine come avatar" | "Team attuale" | "Usa per l'accesso" | "Usato per l'accesso" | "Link per il ripristino della password già utilizzato" | "Link di invito al team già utilizzato" | "Utente" | "Nome utente" | "Verifica" | "Hai già effettuato l'accesso" | "Non sei attualmente autenticato." | "Non puoi rimuovere la tua ultima email di accesso" | "Zona pericolosa" | "La tua email è stata verificata!" | "La tua email" | "Il tuo link di verifica dell'email è scaduto. Richiedi un nuovo link di verifica dalle impostazioni del tuo account." | "Il tuo link magico è scaduto. Richiedi un nuovo link magico se hai bisogno di accedere." | "La tua password è stata reimpostata. Ora puoi accedere con la tua nuova password." | "Il tuo link per il reset della password è scaduto. Ti preghiamo di richiedere un nuovo link per il reset della password dalla pagina di accesso." | "Il tuo link di invito al team è scaduto. Per favore richiedi un nuovo link di invito al team " | "Aggiungi" | "Elimina account" | "Elimina Account" | "Elimina Passkey" | "Disattiva" | "Disattiva MFA" | "Disattiva OTP" | "Nome visualizzato" | "Vuoi accedere?" | "Vuoi verificare la tua email?" | "Non hai un account?" | "Aggiungi un'email" | "Non hai bisogno di reimpostare?" | "Email e password" | "L'indirizzo email esiste già" | "L'indirizzo email è obbligatorio" | "Email inviato!" | "Email e Autenticazione" | "Abilita MFA" | "Abilita OTP" | "Aggiungi nuova passkey" | "Abilita l'accesso tramite link magico o OTP inviato alle tue email di accesso." | "Termina la sessione corrente" | "Inserisci un nome visualizzato per il tuo nuovo team" | "Inserisci email" | "Inserti il codice ricevuto via email" | "Link magico scaduto" | "Link per il Reset della Password Scaduto" | "Link di invito al team scaduto" | "Link di verifica scaduto" | "Scade" | "Hai già un account?" | "Impossibile connettere l'account" | "Impossibile reimpostare la password" | "Impossibile reimpostare la password. Si prega di richiedere un nuovo link per il reset della password" | "Password dimenticata?" | "Vai alla home" | "Se l'utente con questo indirizzo e-mail esiste, un'e-mail è stata inviata alla tua casella di posta. Assicurati di controllare la cartella dello spam." | "Se non vieni reindirizzato automaticamente, " | "Ignora" | "Codice errato. Per favore riprova." | "Si è verificato un errore sconosciuto" | "Password non corretta" | "Codice non valido" | "Immagine non valida" | "Link Magico Non Valido" | "Link di Reimpostazione Password Non Valido" | "Link di invito al team non valido" | "Codice TOTP non valido" | "Link di verifica non valido" | "Invita un utente al tuo team tramite email" | "Invita membro" | "Sei sicuro di voler eliminare il tuo account? Questa azione è IRREVERSIBILE e cancellerà TUTTI i dati associati." | "Invita Utente" | "Unisciti" | "Abbandona" | "Lascia il team" | "Lascia il Team" | "lasciare questa squadra e rimuovere il tuo profilo di team" | "Il link magico è già stato utilizzato" | "Membri" | "Autenticazione a più fattori" | "L'autenticazione a più fattori è attualmente disabilitata." | "Sei sicuro di voler disattivare l'accesso con OTP? Non potrai più accedere solo con le email." | "L'autenticazione a più fattori è attualmente attiva." | "Il mio profilo" | "Nome" | "La registrazione di nuovi account non è consentita" | "Nuova password" | "Nuova Password" | "Nessun metodo di autenticazione abilitato." | "Nessun team ancora" | "Non hai effettuato l'accesso" | "Accesso al provider OAuth negato" | "Sei sicuro di voler disattivare l'accesso con Passkey? Non potrai più accedere utilizzando la tua passkey." | "Vecchia password" | "Oppure continua con" | "Altri team" | "Accesso con OTP" | "L'accesso con OTP è abilitato e non può essere disattivato poiché è attualmente l'unico metodo di accesso disponibile" | "L'accesso tramite OTP/link magico è attualmente abilitato." | "Inviti in sospeso" | "Sovrascrivi il tuo nome utente visualizzato in questo team" | "Passkey registrata"> | Map<"__stack-auto-translation-0" | "__stack-auto-translation-1" | "__stack-auto-translation-2" | "__stack-auto-translation-3" | "__stack-auto-translation-4" | "__stack-auto-translation-5" | "__stack-auto-translation-6" | "__stack-auto-translation-7" | "__stack-auto-translation-8" | "__stack-auto-translation-9" | "__stack-auto-translation-10" | "__stack-auto-translation-11" | "__stack-auto-translation-12" | "__stack-auto-translation-13" | "__stack-auto-translation-14" | "__stack-auto-translation-15" | "__stack-auto-translation-16" | "__stack-auto-translation-17" | "__stack-auto-translation-18" | "__stack-auto-translation-19" | "__stack-auto-translation-20" | "__stack-auto-translation-21" | "__stack-auto-translation-22" | "__stack-auto-translation-23" | "__stack-auto-translation-24" | "__stack-auto-translation-25" | "__stack-auto-translation-26" | "__stack-auto-translation-27" | "__stack-auto-translation-28" | "__stack-auto-translation-29" | "__stack-auto-translation-30" | "__stack-auto-translation-31" | "__stack-auto-translation-32" | "__stack-auto-translation-33" | "__stack-auto-translation-34" | "__stack-auto-translation-35" | "__stack-auto-translation-36" | "__stack-auto-translation-37" | "__stack-auto-translation-38" | "__stack-auto-translation-39" | "__stack-auto-translation-40" | "__stack-auto-translation-41" | "__stack-auto-translation-42" | "__stack-auto-translation-43" | "__stack-auto-translation-44" | "__stack-auto-translation-45" | "__stack-auto-translation-46" | "__stack-auto-translation-47" | "__stack-auto-translation-48" | "__stack-auto-translation-49" | "__stack-auto-translation-50" | "__stack-auto-translation-51" | "__stack-auto-translation-52" | "__stack-auto-translation-53" | "__stack-auto-translation-54" | "__stack-auto-translation-55" | "__stack-auto-translation-56" | "__stack-auto-translation-57" | "__stack-auto-translation-58" | "__stack-auto-translation-59" | "__stack-auto-translation-60" | "__stack-auto-translation-61" | "__stack-auto-translation-62" | "__stack-auto-translation-63" | "__stack-auto-translation-64" | "__stack-auto-translation-65" | "__stack-auto-translation-66" | "__stack-auto-translation-67" | "__stack-auto-translation-68" | "__stack-auto-translation-69" | "__stack-auto-translation-70" | "__stack-auto-translation-71" | "__stack-auto-translation-72" | "__stack-auto-translation-73" | "__stack-auto-translation-74" | "__stack-auto-translation-75" | "__stack-auto-translation-76" | "__stack-auto-translation-77" | "__stack-auto-translation-78" | "__stack-auto-translation-79" | "__stack-auto-translation-80" | "__stack-auto-translation-81" | "__stack-auto-translation-82" | "__stack-auto-translation-83" | "__stack-auto-translation-84" | "__stack-auto-translation-85" | "__stack-auto-translation-86" | "__stack-auto-translation-87" | "__stack-auto-translation-88" | "__stack-auto-translation-89" | "__stack-auto-translation-90" | "__stack-auto-translation-91" | "__stack-auto-translation-92" | "__stack-auto-translation-93" | "__stack-auto-translation-94" | "__stack-auto-translation-95" | "__stack-auto-translation-96" | "__stack-auto-translation-97" | "__stack-auto-translation-98" | "__stack-auto-translation-99" | "__stack-auto-translation-100" | "__stack-auto-translation-101" | "__stack-auto-translation-102" | "__stack-auto-translation-103" | "__stack-auto-translation-104" | "__stack-auto-translation-105" | "__stack-auto-translation-106" | "__stack-auto-translation-107" | "__stack-auto-translation-108" | "__stack-auto-translation-109" | "__stack-auto-translation-110" | "__stack-auto-translation-111" | "__stack-auto-translation-112" | "__stack-auto-translation-113" | "__stack-auto-translation-114" | "__stack-auto-translation-115" | "__stack-auto-translation-116" | "__stack-auto-translation-117" | "__stack-auto-translation-118" | "__stack-auto-translation-119" | "__stack-auto-translation-120" | "__stack-auto-translation-121" | "__stack-auto-translation-122" | "__stack-auto-translation-123" | "__stack-auto-translation-124" | "__stack-auto-translation-125" | "__stack-auto-translation-126" | "__stack-auto-translation-127" | "__stack-auto-translation-128" | "__stack-auto-translation-129" | "__stack-auto-translation-130" | "__stack-auto-translation-131" | "__stack-auto-translation-132" | "__stack-auto-translation-133" | "__stack-auto-translation-134" | "__stack-auto-translation-135" | "__stack-auto-translation-136" | "__stack-auto-translation-137" | "__stack-auto-translation-138" | "__stack-auto-translation-139" | "__stack-auto-translation-140" | "__stack-auto-translation-141" | "__stack-auto-translation-142" | "__stack-auto-translation-143" | "__stack-auto-translation-144" | "__stack-auto-translation-145" | "__stack-auto-translation-146" | "__stack-auto-translation-147" | "__stack-auto-translation-148" | "__stack-auto-translation-149" | "__stack-auto-translation-150" | "__stack-auto-translation-151" | "__stack-auto-translation-152" | "__stack-auto-translation-153" | "__stack-auto-translation-154" | "__stack-auto-translation-155" | "__stack-auto-translation-156" | "__stack-auto-translation-157" | "__stack-auto-translation-158" | "__stack-auto-translation-159" | "__stack-auto-translation-160" | "__stack-auto-translation-161" | "__stack-auto-translation-162" | "__stack-auto-translation-163" | "__stack-auto-translation-164" | "__stack-auto-translation-165" | "__stack-auto-translation-166" | "__stack-auto-translation-167" | "__stack-auto-translation-168" | "__stack-auto-translation-169" | "__stack-auto-translation-170" | "__stack-auto-translation-171" | "__stack-auto-translation-172" | "__stack-auto-translation-173" | "__stack-auto-translation-174" | "__stack-auto-translation-175" | "__stack-auto-translation-176" | "__stack-auto-translation-177" | "__stack-auto-translation-178" | "__stack-auto-translation-179" | "__stack-auto-translation-180" | "__stack-auto-translation-181" | "__stack-auto-translation-182" | "__stack-auto-translation-183" | "__stack-auto-translation-184" | "__stack-auto-translation-185" | "__stack-auto-translation-186" | "__stack-auto-translation-187" | "__stack-auto-translation-188" | "__stack-auto-translation-189" | "__stack-auto-translation-190" | "__stack-auto-translation-191" | "__stack-auto-translation-192" | "__stack-auto-translation-193" | "__stack-auto-translation-194" | "__stack-auto-translation-195" | "__stack-auto-translation-196", "Email" | "Cancelar" | "Verificar" | "Ignorar" | "Código TOTP inválido" | "Habilitar MFA" | "Habilitar OTP" | "E-mails" | "Nome" | "Configurações da conta" | "Configurações da Conta" | "Tem certeza de que deseja sair da equipe?" | "O acesso por chave de acesso está habilitado e não pode ser desativado, pois é atualmente o único método de acesso" | "Senha" | "Senha redefinida com sucesso!" | "As senhas não coincidem" | "Remover permanentemente sua conta e todos os dados associados" | "Verifique se você tem o link correto. Se continuar tendo problemas, entre em contato com o suporte." | "Verifique novamente se você tem o link correto para redefinição de senha." | "Por favor, verifique se você tem o link de convite para a equipe correto." | "Por favor, insira um nome para a equipe" | "Por favor, insira um e-mail válido" | "Insira um endereço de e-mail válido" | "Por favor, insira um endereço de e-mail" | "Por favor, insira seu e-mail" | "Por favor, digite sua senha antiga" | "Insira sua senha" | "Por favor, repita sua senha" | "Por favor, tente novamente e, se o problema persistir, entre em contato com o suporte." | "Por favor, verifique seu email primeiro" | "Primário" | "Imagem de perfil" | "Alterar o nome de exibição da sua equipe" | "Registrar uma chave de acesso" | "Remover" | "Repita a nova senha" | "Repita a Nova Senha" | "Repetir Senha" | "Redefinir Senha" | "Redefina Sua Senha" | "Salvar" | "Escaneie este código QR com seu aplicativo autenticador:" | "Enviar e-mail" | "clique aqui" | "Enviar Email" | "Enviar email de verificação" | "Defina uma senha para sua conta" | "Definir como primário" | "Definir senha" | "Definir Senha" | "Configurações" | "Entrar" | "Entrar novamente" | "Criar" | "Faça login ou crie uma conta para se juntar à equipe." | "Entrar na sua conta" | "Entrar com Passkey" | "Entrar com {provider}" | "Sair" | "Cadastrar-se" | "O cadastro para novos usuários não está disponível no momento." | "Cadastre-se com Passkey" | "Cadastre-se com o {provider}" | "Criar uma nova conta" | "Login realizado com sucesso!" | "Algo deu errado ao processar o retorno de chamada OAuth:" | "Parar de usar para login" | "Criação de equipe não está habilitada" | "Nome de exibição da equipe" | "Convite para equipe" | "Imagem de perfil da equipe" | "Nome de usuário na equipe" | "Equipes" | "O link mágico já foi utilizado. O link só pode ser usado uma vez. Por favor, solicite um novo link mágico se precisar fazer login novamente." | "Criar uma equipe" | "A operação de login foi cancelada. Por favor, tente novamente. [access_denied]" | "O usuário já está conectado a outra conta OAuth. Você pode ter selecionado a conta errada na página do provedor OAuth?" | "Em seguida, insira seu código MFA de seis dígitos:" | "Esta conta já está conectada a outro usuário. Por favor, conecte uma conta diferente." | "Este email já está sendo usado para login por outro usuário." | "Este é um nome de exibição e não é usado para autenticação" | "Isto é provavelmente um erro no Stack. Por favor, reporte-o." | "Este link de redefinição de senha já foi utilizado. Se você precisar redefinir sua senha novamente, solicite um novo link de redefinição de senha na página de login." | "Este link de convite para a equipe já foi utilizado." | "Para habilitar a autenticação por OTP, adicione um email de login verificado." | "Criar uma Equipe" | "Para habilitar o login por chave de acesso, adicione um email de login verificado." | "Para definir uma senha, adicione um email de login." | "Alternar tema" | "Código QR de autenticação de dois fatores TOTP" | "Não verificado" | "Atualizar senha" | "Atualizar Senha" | "Atualize sua senha" | "Envie uma imagem para sua equipe" | "Envie sua própria imagem como seu avatar" | "Equipe atual" | "Usar para login" | "Usado para login" | "Link de Redefinição de Senha Utilizado" | "Link de Convite de Equipe Usado" | "Usuário" | "Nome de usuário" | "Você já está conectado" | "Você não está atualmente conectado." | "Você não pode remover seu último email de login" | "Zona de perigo" | "Seu email foi verificado!" | "Seu E-mail" | "Seu link de verificação de e-mail expirou. Por favor, solicite um novo link de verificação nas configurações da sua conta." | "Seu link mágico expirou. Por favor, solicite um novo link mágico se precisar fazer login." | "Sua senha foi redefinida. Agora você pode fazer login com sua nova senha." | "Seu link de redefinição de senha expirou. Por favor, solicite um novo link de redefinição de senha na página de login." | "Seu link de convite para a equipe expirou. Solicite um novo link de convite para a equipe " | "Adicionar" | "Excluir conta" | "Excluir Conta" | "Excluir Chave de acesso" | "Desativar" | "Desativar MFA" | "Desativar OTP" | "Nome de exibição" | "Deseja entrar?" | "Deseja verificar seu email?" | "Não tem uma conta?" | "Adicionar um e-mail" | "Não precisa redefinir?" | "Email e Senha" | "E-mail já existe" | "E-mail é obrigatório" | "E-mail enviado!" | "E-mails & Autenticação" | "Adicionar nova chave de acesso" | "Habilitar login via link mágico ou OTP enviado para seus e-mails de acesso." | "Encerre sua sessão atual" | "Insira um nome de exibição para sua nova equipe" | "Inserir email" | "Digite o código do seu e-mail" | "Link Mágico Expirado" | "Link de Redefinição de Senha Expirado" | "Link de Convite de Equipe Expirado" | "Link de Verificação Expirado" | "Expira" | "Já tem uma conta?" | "Falha ao conectar conta" | "Falha ao redefinir senha" | "Falha ao redefinir a senha. Por favor, solicite um novo link de redefinição de senha" | "Esqueceu a senha?" | "Ir para início" | "Se o usuário com este endereço de e-mail existir, um e-mail foi enviado para sua caixa de entrada. Certifique-se de verificar sua pasta de spam." | "Se você não for redirecionado automaticamente, " | "Código incorreto. Por favor, tente novamente." | "Um erro desconhecido ocorreu" | "Senha incorreta" | "Código inválido" | "Imagem inválida" | "Link Mágico Inválido" | "Link de Redefinição de Senha Inválido" | "Link de Convite de Equipe Inválido" | "Link de Verificação Inválido" | "Convide um usuário para sua equipe por e-mail" | "Convidar membro" | "Tem certeza de que deseja excluir sua conta? Esta ação é IRREVERSÍVEL e excluirá TODOS os dados associados." | "Convidar Usuário" | "Sair da equipe" | "Sair da Equipe" | "sair desta equipe e remover seu perfil de equipe" | "Link Mágico Já Utilizado" | "Membros" | "Autenticação de múltiplos fatores" | "A autenticação de dois fatores está atualmente desativada." | "Tem certeza de que deseja desativar a autenticação por OTP? Você não poderá mais entrar apenas com e-mails." | "Autenticação multifator está atualmente ativada." | "Meu Perfil" | "Não é permitido o registro de novas contas" | "Nova senha" | "Nova Senha" | "Nenhum método de autenticação habilitado." | "Ainda sem equipes" | "Não conectado" | "Acesso ao provedor OAuth negado" | "Tem certeza que deseja desativar o login com chave de acesso? Você não poderá mais entrar com sua chave de acesso." | "Senha antiga" | "Ou continuar com" | "Outras equipes" | "Autenticação por OTP" | "A autenticação por OTP está habilitada e não pode ser desativada, pois atualmente é o único método de autenticação" | "O login por OTP/link mágico está atualmente habilitado." | "Convites pendentes" | "Substitua seu nome de exibição de usuário nesta equipe" | "Chave de acesso" | "Chave de acesso registrada"> | Map<"__stack-auto-translation-0" | "__stack-auto-translation-1" | "__stack-auto-translation-2" | "__stack-auto-translation-3" | "__stack-auto-translation-4" | "__stack-auto-translation-5" | "__stack-auto-translation-6" | "__stack-auto-translation-7" | "__stack-auto-translation-8" | "__stack-auto-translation-9" | "__stack-auto-translation-10" | "__stack-auto-translation-11" | "__stack-auto-translation-12" | "__stack-auto-translation-13" | "__stack-auto-translation-14" | "__stack-auto-translation-15" | "__stack-auto-translation-16" | "__stack-auto-translation-17" | "__stack-auto-translation-18" | "__stack-auto-translation-19" | "__stack-auto-translation-20" | "__stack-auto-translation-21" | "__stack-auto-translation-22" | "__stack-auto-translation-23" | "__stack-auto-translation-24" | "__stack-auto-translation-25" | "__stack-auto-translation-26" | "__stack-auto-translation-27" | "__stack-auto-translation-28" | "__stack-auto-translation-29" | "__stack-auto-translation-30" | "__stack-auto-translation-31" | "__stack-auto-translation-32" | "__stack-auto-translation-33" | "__stack-auto-translation-34" | "__stack-auto-translation-35" | "__stack-auto-translation-36" | "__stack-auto-translation-37" | "__stack-auto-translation-38" | "__stack-auto-translation-39" | "__stack-auto-translation-40" | "__stack-auto-translation-41" | "__stack-auto-translation-42" | "__stack-auto-translation-43" | "__stack-auto-translation-44" | "__stack-auto-translation-45" | "__stack-auto-translation-46" | "__stack-auto-translation-47" | "__stack-auto-translation-48" | "__stack-auto-translation-49" | "__stack-auto-translation-50" | "__stack-auto-translation-51" | "__stack-auto-translation-52" | "__stack-auto-translation-53" | "__stack-auto-translation-54" | "__stack-auto-translation-55" | "__stack-auto-translation-56" | "__stack-auto-translation-57" | "__stack-auto-translation-58" | "__stack-auto-translation-59" | "__stack-auto-translation-60" | "__stack-auto-translation-61" | "__stack-auto-translation-62" | "__stack-auto-translation-63" | "__stack-auto-translation-64" | "__stack-auto-translation-65" | "__stack-auto-translation-66" | "__stack-auto-translation-67" | "__stack-auto-translation-68" | "__stack-auto-translation-69" | "__stack-auto-translation-70" | "__stack-auto-translation-71" | "__stack-auto-translation-72" | "__stack-auto-translation-73" | "__stack-auto-translation-74" | "__stack-auto-translation-75" | "__stack-auto-translation-76" | "__stack-auto-translation-77" | "__stack-auto-translation-78" | "__stack-auto-translation-79" | "__stack-auto-translation-80" | "__stack-auto-translation-81" | "__stack-auto-translation-82" | "__stack-auto-translation-83" | "__stack-auto-translation-84" | "__stack-auto-translation-85" | "__stack-auto-translation-86" | "__stack-auto-translation-87" | "__stack-auto-translation-88" | "__stack-auto-translation-89" | "__stack-auto-translation-90" | "__stack-auto-translation-91" | "__stack-auto-translation-92" | "__stack-auto-translation-93" | "__stack-auto-translation-94" | "__stack-auto-translation-95" | "__stack-auto-translation-96" | "__stack-auto-translation-97" | "__stack-auto-translation-98" | "__stack-auto-translation-99" | "__stack-auto-translation-100" | "__stack-auto-translation-101" | "__stack-auto-translation-102" | "__stack-auto-translation-103" | "__stack-auto-translation-104" | "__stack-auto-translation-105" | "__stack-auto-translation-106" | "__stack-auto-translation-107" | "__stack-auto-translation-108" | "__stack-auto-translation-109" | "__stack-auto-translation-110" | "__stack-auto-translation-111" | "__stack-auto-translation-112" | "__stack-auto-translation-113" | "__stack-auto-translation-114" | "__stack-auto-translation-115" | "__stack-auto-translation-116" | "__stack-auto-translation-117" | "__stack-auto-translation-118" | "__stack-auto-translation-119" | "__stack-auto-translation-120" | "__stack-auto-translation-121" | "__stack-auto-translation-122" | "__stack-auto-translation-123" | "__stack-auto-translation-124" | "__stack-auto-translation-125" | "__stack-auto-translation-126" | "__stack-auto-translation-127" | "__stack-auto-translation-128" | "__stack-auto-translation-129" | "__stack-auto-translation-130" | "__stack-auto-translation-131" | "__stack-auto-translation-132" | "__stack-auto-translation-133" | "__stack-auto-translation-134" | "__stack-auto-translation-135" | "__stack-auto-translation-136" | "__stack-auto-translation-137" | "__stack-auto-translation-138" | "__stack-auto-translation-139" | "__stack-auto-translation-140" | "__stack-auto-translation-141" | "__stack-auto-translation-142" | "__stack-auto-translation-143" | "__stack-auto-translation-144" | "__stack-auto-translation-145" | "__stack-auto-translation-146" | "__stack-auto-translation-147" | "__stack-auto-translation-148" | "__stack-auto-translation-149" | "__stack-auto-translation-150" | "__stack-auto-translation-151" | "__stack-auto-translation-152" | "__stack-auto-translation-153" | "__stack-auto-translation-154" | "__stack-auto-translation-155" | "__stack-auto-translation-156" | "__stack-auto-translation-157" | "__stack-auto-translation-158" | "__stack-auto-translation-159" | "__stack-auto-translation-160" | "__stack-auto-translation-161" | "__stack-auto-translation-162" | "__stack-auto-translation-163" | "__stack-auto-translation-164" | "__stack-auto-translation-165" | "__stack-auto-translation-166" | "__stack-auto-translation-167" | "__stack-auto-translation-168" | "__stack-auto-translation-169" | "__stack-auto-translation-170" | "__stack-auto-translation-171" | "__stack-auto-translation-172" | "__stack-auto-translation-173" | "__stack-auto-translation-174" | "__stack-auto-translation-175" | "__stack-auto-translation-176" | "__stack-auto-translation-177" | "__stack-auto-translation-178" | "__stack-auto-translation-179" | "__stack-auto-translation-180" | "__stack-auto-translation-181" | "__stack-auto-translation-182" | "__stack-auto-translation-183" | "__stack-auto-translation-184" | "__stack-auto-translation-185" | "__stack-auto-translation-186" | "__stack-auto-translation-187" | "__stack-auto-translation-188" | "__stack-auto-translation-189" | "__stack-auto-translation-190" | "__stack-auto-translation-191" | "__stack-auto-translation-192" | "__stack-auto-translation-193" | "__stack-auto-translation-194" | "__stack-auto-translation-195" | "__stack-auto-translation-196", "Email" | "Cancelar" | "Principal" | "Guardar" | "Verificar" | "Ignorar" | "Código TOTP inválido" | "E-mails" | "Nome" | "As senhas não coincidem" | "Imagem de perfil" | "Remover" | "Enviar e-mail" | "clique aqui" | "Enviar Email" | "Enviar email de verificação" | "Criar" | "Sair" | "Criar uma nova conta" | "Isto é provavelmente um erro no Stack. Por favor, reporte-o." | "Alternar tema" | "Não verificado" | "Link de Redefinição de Senha Utilizado" | "Zona de perigo" | "Adicionar" | "Desativar" | "Desativar MFA" | "Desativar OTP" | "Nome de exibição" | "Não tem uma conta?" | "Não precisa redefinir?" | "Adicionar nova chave de acesso" | "Link de Redefinição de Senha Expirado" | "Link de Verificação Expirado" | "Expira" | "Já tem uma conta?" | "Falha ao conectar conta" | "Falha ao redefinir a senha. Por favor, solicite um novo link de redefinição de senha" | "Ir para início" | "Código incorreto. Por favor, tente novamente." | "Código inválido" | "Imagem inválida" | "Link de Verificação Inválido" | "Convidar membro" | "Link Mágico Já Utilizado" | "Membros" | "Acesso ao provedor OAuth negado" | "Ou continuar com" | "Convites pendentes" | "Chave de acesso" | "Definições da conta" | "Definições da Conta" | "Tem a certeza de que deseja sair da equipa?" | "O início de sessão por chave de acesso está ativo e não pode ser desativado pois é atualmente o único método de autenticação" | "Palavra-passe" | "Palavra-passe redefinida com sucesso!" | "Remover permanentemente a sua conta e todos os dados associados" | "Por favor, verifique se tem o link correto. Se continuar a ter problemas, entre em contacto com o suporte." | "Por favor, verifique novamente se tem o link correto para redefinição da palavra-passe." | "Verifique novamente se possui o link de convite para a equipa correto." | "Por favor, insira um nome para a equipa" | "Por favor, introduza um endereço de email válido" | "Introduza um endereço de e-mail válido" | "Por favor, introduza um endereço de e-mail" | "Introduza o seu email" | "Por favor, insira a sua palavra-passe antiga" | "Por favor, introduza a sua palavra-passe" | "Por favor, repita a sua palavra-passe" | "Tente novamente e, se o problema persistir, entre em contacto com o suporte." | "Por favor, verifique o seu email primeiro" | "Alterar o nome de apresentação da sua equipa" | "Registar uma chave de acesso" | "Repetir nova palavra-passe" | "Repetir Nova Palavra-passe" | "Repita a palavra-passe" | "Redefinir Palavra-passe" | "Repor a Sua Palavra-passe" | "Faça scan deste código QR com a sua aplicação de autenticação:" | "Defina uma palavra-passe para a sua conta" | "Definir como principal" | "Definir palavra-passe" | "Definir Palavra-passe" | "Definições" | "Iniciar sessão" | "Iniciar Sessão" | "Iniciar sessão novamente" | "Inicie sessão ou crie uma conta para se juntar à equipa." | "Iniciar sessão na sua conta" | "Iniciar sessão com Passkey" | "Iniciar sessão com {provider}" | "Terminar sessão" | "Inscrever-se" | "As inscrições para novos utilizadores não estão ativadas de momento." | "Registar com chave de acesso" | "Registar-se com {provider}" | "Autenticação bem-sucedida!" | "Algo correu mal durante o processamento do callback OAuth:" | "Parar de utilizar para início de sessão" | "A criação de equipas não está ativada" | "Nome de exibição da equipa" | "Convite para equipa" | "Imagem de perfil da equipa" | "Nome de utilizador da equipa" | "Equipas" | "O link mágico já foi utilizado. O link só pode ser usado uma vez. Por favor, solicite um novo link mágico se precisar de iniciar sessão novamente." | "Criar uma equipa" | "A operação de início de sessão foi cancelada. Por favor, tente novamente. [access_denied]" | "O utilizador já está conectado a outra conta OAuth. Terá selecionado a conta errada na página do provedor OAuth?" | "Em seguida, introduza o seu código MFA de seis dígitos:" | "Esta conta já está associada a outro utilizador. Por favor, associe uma conta diferente." | "Este email já é utilizado para iniciar sessão por outro utilizador." | "Este é um nome de exibição e não é utilizado para autenticação" | "Este link de redefinição de senha já foi utilizado. Se precisar redefinir a sua senha novamente, por favor solicite um novo link de redefinição de senha na página de login." | "Este link de convite para a equipa já foi utilizado." | "Para ativar a autenticação OTP, adicione um email de acesso verificado." | "Criar uma Equipa" | "Para ativar o início de sessão com chave de acesso, adicione um email de início de sessão verificado." | "Para definir uma palavra-passe, adicione um email de acesso." | "Código QR de autenticação multifator TOTP" | "Atualizar palavra-passe" | "Atualizar Palavra-passe" | "Atualize a sua palavra-passe" | "Carregar uma imagem para a sua equipa" | "Carregue a sua própria imagem como avatar" | "Equipa atual" | "Usar para iniciar sessão" | "Utilizado para iniciar sessão" | "Link de Convite para Equipa Utilizado" | "Utilizador" | "Nome de utilizador" | "Já está autenticado" | "Não tem sessão iniciada de momento." | "Não é possível remover o seu último email de início de sessão" | "O seu email foi verificado!" | "O seu email" | "O seu link de verificação de e-mail expirou. Por favor, solicite um novo link de verificação nas configurações da sua conta." | "O seu link mágico expirou. Por favor, solicite um novo link mágico se precisar de iniciar sessão." | "A sua palavra-passe foi redefinida. Agora pode iniciar sessão com a sua nova palavra-passe." | "O seu link de redefinição de palavra-passe expirou. Por favor, solicite um novo link de redefinição de palavra-passe na página de início de sessão." | "O seu link de convite para a equipa expirou. Por favor, solicite um novo link de convite para a equipa " | "Eliminar conta" | "Eliminar Conta" | "Eliminar Chave de Acesso" | "Quer iniciar sessão?" | "Pretende verificar o seu email?" | "Adicionar um email" | "Email e Palavra-passe" | "O email já existe" | "O email é obrigatório" | "Email enviado!" | "E-mails e autenticação" | "Ativar MFA" | "Ativar OTP" | "Ativar autenticação via link mágico ou OTP enviado para os seus e-mails de início de sessão." | "Terminar a sua sessão atual" | "Insira um nome de exibição para a sua nova equipa" | "Introduza o e-mail" | "Insira o código do seu e-mail" | "Link Mágica Expirada" | "Link de Convite para Equipa Expirado" | "Falha ao redefinir a palavra-passe" | "Esqueceu-se da palavra-passe?" | "Se o utilizador com este endereço de e-mail existir, foi enviado um e-mail para a sua caixa de entrada. Certifique-se de verificar a sua pasta de spam." | "Se não for redirecionado automaticamente, " | "Ocorreu um erro desconhecido" | "Palavra-passe incorreta" | "Link Mágica Inválida" | "Link Inválido de Redefinição de Senha" | "Link de Convite de Equipa Inválido" | "Convidar um utilizador para a sua equipa através de e-mail" | "Tem certeza de que deseja eliminar a sua conta? Esta ação é IRREVERSÍVEL e irá eliminar TODOS os dados associados." | "Convidar Utilizador" | "Juntar" | "Abandonar equipa" | "Sair da Equipa" | "abandonar esta equipa e remover o seu perfil de equipa" | "Autenticação de Múltiplos Fatores" | "A autenticação multifator está atualmente desativada." | "Tem certeza de que deseja desativar a autenticação OTP? Já não poderá iniciar sessão apenas com e-mails." | "A autenticação multifator está atualmente ativada." | "O Meu Perfil" | "Não é permitido registar novas contas" | "Nova palavra-passe" | "Nova Palavra-passe" | "Nenhum método de autenticação ativado." | "Ainda sem equipas" | "Não tem sessão iniciada" | "Tem a certeza de que pretende desativar o início de sessão por chave de acesso? Não poderá mais iniciar sessão com a sua chave de acesso." | "Palavra-passe antiga" | "Outras equipas" | "Autenticação OTP" | "A autenticação OTP está ativada e não pode ser desativada, pois é atualmente o único método de autenticação" | "O início de sessão por OTP/link mágico está atualmente ativado." | "Substituir o seu nome de utilizador nesta equipa" | "Chave de acesso registada"> | Map<"__stack-auto-translation-0" | "__stack-auto-translation-1" | "__stack-auto-translation-2" | "__stack-auto-translation-3" | "__stack-auto-translation-4" | "__stack-auto-translation-5" | "__stack-auto-translation-6" | "__stack-auto-translation-7" | "__stack-auto-translation-8" | "__stack-auto-translation-9" | "__stack-auto-translation-10" | "__stack-auto-translation-11" | "__stack-auto-translation-12" | "__stack-auto-translation-13" | "__stack-auto-translation-14" | "__stack-auto-translation-15" | "__stack-auto-translation-16" | "__stack-auto-translation-17" | "__stack-auto-translation-18" | "__stack-auto-translation-19" | "__stack-auto-translation-20" | "__stack-auto-translation-21" | "__stack-auto-translation-22" | "__stack-auto-translation-23" | "__stack-auto-translation-24" | "__stack-auto-translation-25" | "__stack-auto-translation-26" | "__stack-auto-translation-27" | "__stack-auto-translation-28" | "__stack-auto-translation-29" | "__stack-auto-translation-30" | "__stack-auto-translation-31" | "__stack-auto-translation-32" | "__stack-auto-translation-33" | "__stack-auto-translation-34" | "__stack-auto-translation-35" | "__stack-auto-translation-36" | "__stack-auto-translation-37" | "__stack-auto-translation-38" | "__stack-auto-translation-39" | "__stack-auto-translation-40" | "__stack-auto-translation-41" | "__stack-auto-translation-42" | "__stack-auto-translation-43" | "__stack-auto-translation-44" | "__stack-auto-translation-45" | "__stack-auto-translation-46" | "__stack-auto-translation-47" | "__stack-auto-translation-48" | "__stack-auto-translation-49" | "__stack-auto-translation-50" | "__stack-auto-translation-51" | "__stack-auto-translation-52" | "__stack-auto-translation-53" | "__stack-auto-translation-54" | "__stack-auto-translation-55" | "__stack-auto-translation-56" | "__stack-auto-translation-57" | "__stack-auto-translation-58" | "__stack-auto-translation-59" | "__stack-auto-translation-60" | "__stack-auto-translation-61" | "__stack-auto-translation-62" | "__stack-auto-translation-63" | "__stack-auto-translation-64" | "__stack-auto-translation-65" | "__stack-auto-translation-66" | "__stack-auto-translation-67" | "__stack-auto-translation-68" | "__stack-auto-translation-69" | "__stack-auto-translation-70" | "__stack-auto-translation-71" | "__stack-auto-translation-72" | "__stack-auto-translation-73" | "__stack-auto-translation-74" | "__stack-auto-translation-75" | "__stack-auto-translation-76" | "__stack-auto-translation-77" | "__stack-auto-translation-78" | "__stack-auto-translation-79" | "__stack-auto-translation-80" | "__stack-auto-translation-81" | "__stack-auto-translation-82" | "__stack-auto-translation-83" | "__stack-auto-translation-84" | "__stack-auto-translation-85" | "__stack-auto-translation-86" | "__stack-auto-translation-87" | "__stack-auto-translation-88" | "__stack-auto-translation-89" | "__stack-auto-translation-90" | "__stack-auto-translation-91" | "__stack-auto-translation-92" | "__stack-auto-translation-93" | "__stack-auto-translation-94" | "__stack-auto-translation-95" | "__stack-auto-translation-96" | "__stack-auto-translation-97" | "__stack-auto-translation-98" | "__stack-auto-translation-99" | "__stack-auto-translation-100" | "__stack-auto-translation-101" | "__stack-auto-translation-102" | "__stack-auto-translation-103" | "__stack-auto-translation-104" | "__stack-auto-translation-105" | "__stack-auto-translation-106" | "__stack-auto-translation-107" | "__stack-auto-translation-108" | "__stack-auto-translation-109" | "__stack-auto-translation-110" | "__stack-auto-translation-111" | "__stack-auto-translation-112" | "__stack-auto-translation-113" | "__stack-auto-translation-114" | "__stack-auto-translation-115" | "__stack-auto-translation-116" | "__stack-auto-translation-117" | "__stack-auto-translation-118" | "__stack-auto-translation-119" | "__stack-auto-translation-120" | "__stack-auto-translation-121" | "__stack-auto-translation-122" | "__stack-auto-translation-123" | "__stack-auto-translation-124" | "__stack-auto-translation-125" | "__stack-auto-translation-126" | "__stack-auto-translation-127" | "__stack-auto-translation-128" | "__stack-auto-translation-129" | "__stack-auto-translation-130" | "__stack-auto-translation-131" | "__stack-auto-translation-132" | "__stack-auto-translation-133" | "__stack-auto-translation-134" | "__stack-auto-translation-135" | "__stack-auto-translation-136" | "__stack-auto-translation-137" | "__stack-auto-translation-138" | "__stack-auto-translation-139" | "__stack-auto-translation-140" | "__stack-auto-translation-141" | "__stack-auto-translation-142" | "__stack-auto-translation-143" | "__stack-auto-translation-144" | "__stack-auto-translation-145" | "__stack-auto-translation-146" | "__stack-auto-translation-147" | "__stack-auto-translation-148" | "__stack-auto-translation-149" | "__stack-auto-translation-150" | "__stack-auto-translation-151" | "__stack-auto-translation-152" | "__stack-auto-translation-153" | "__stack-auto-translation-154" | "__stack-auto-translation-155" | "__stack-auto-translation-156" | "__stack-auto-translation-157" | "__stack-auto-translation-158" | "__stack-auto-translation-159" | "__stack-auto-translation-160" | "__stack-auto-translation-161" | "__stack-auto-translation-162" | "__stack-auto-translation-163" | "__stack-auto-translation-164" | "__stack-auto-translation-165" | "__stack-auto-translation-166" | "__stack-auto-translation-167" | "__stack-auto-translation-168" | "__stack-auto-translation-169" | "__stack-auto-translation-170" | "__stack-auto-translation-171" | "__stack-auto-translation-172" | "__stack-auto-translation-173" | "__stack-auto-translation-174" | "__stack-auto-translation-175" | "__stack-auto-translation-176" | "__stack-auto-translation-177" | "__stack-auto-translation-178" | "__stack-auto-translation-179" | "__stack-auto-translation-180" | "__stack-auto-translation-181" | "__stack-auto-translation-182" | "__stack-auto-translation-183" | "__stack-auto-translation-184" | "__stack-auto-translation-185" | "__stack-auto-translation-186" | "__stack-auto-translation-187" | "__stack-auto-translation-188" | "__stack-auto-translation-189" | "__stack-auto-translation-190" | "__stack-auto-translation-191" | "__stack-auto-translation-192" | "__stack-auto-translation-193" | "__stack-auto-translation-194" | "__stack-auto-translation-195" | "__stack-auto-translation-196", "账户设置" | "您确定要离开团队吗？" | "密钥登录已启用，且无法禁用，因为它目前是唯一的登录方式" | "密码" | "密码重置成功！" | "密码不匹配" | "永久删除您的帐户和所有相关数据" | "请检查您是否有正确的链接。如果您继续遇到问题，请联系支持人员。" | "请再次确认您是否有正确的密码重置链接。" | "请再次确认您是否拥有正确的团队邀请链接。" | "请输入团队名称" | "请输入有效的电子邮箱地址" | "取消" | "请输入有效的电子邮件地址" | "请输入电子邮件地址" | "请输入您的电子邮箱" | "请输入您的旧密码" | "请输入您的密码" | "请重复输入您的密码" | "请重试，如果问题仍然存在，请联系客服。" | "请先验证您的电子邮箱" | "主要" | "头像" | "更改团队显示名称" | "注册密钥" | "删除" | "重复新密码" | "重复密码" | "重置密码" | "重置您的密码" | "保存" | "使用您的身份验证器应用扫描此二维码：" | "发送电子邮件" | "点击此处" | "发送邮件" | "发送验证邮件" | "为您的账户设置密码" | "设置为主要" | "设置密码" | "设置" | "登录" | "再次登录" | "创建" | "登录或创建账户以加入团队。" | "登录您的帐户" | "使用密钥登录" | "使用{provider}登录" | "退出登录" | "注册" | "目前不允许新用户注册。" | "使用通行密钥注册" | "用 {provider} 注册" | "创建新账户" | "登录成功！" | "处理 OAuth 回调时出现错误：" | "停止使用登录" | "团队创建未启用" | "团队显示名称" | "团队邀请" | "团队头像" | "团队用户名" | "团队" | "魔法链接已被使用。该链接只能使用一次。如果需要再次登录，请重新申请一个新的魔法链接。" | "创建团队" | "登录操作已取消。请重试。[access_denied]" | "用户已连接到另一个 OAuth 账户。您是否在 OAuth 提供商页面上选择了错误的账户？" | "然后，输入您的六位数 MFA 码：" | "此帐户已与另一用户关联。请连接其他帐户。" | "此电子邮箱已被另一用户用于登录。" | "这是一个显示名称，不用于身份验证" | "这很可能是 Stack 中的错误。请报告此问题。" | "此密码重置链接已被使用。如果您需要再次重置密码，请从登录页面请求新的密码重置链接。" | "此团队邀请链接已被使用。" | "要启用 OTP 登录，请添加已验证的登录邮箱。" | "要启用通行密钥登录，请添加已验证的登录邮箱。" | "要设置密码，请先添加登录邮箱。" | "切换主题" | "TOTP 多因素认证二维码" | "未验证" | "更新密码" | "更新您的密码" | "为团队上传图片" | "上传您自己的图像作为头像" | "当前团队" | "用于登录" | "已使用的密码重置链接" | "已使用的团队邀请链接" | "用户" | "用户名" | "验证" | "您已经登录" | "您当前未登录。" | "你不能删除最后一个用于登录的电子邮箱" | "危险区域" | "您的邮箱已验证！" | "您的邮箱" | "您的电子邮件验证链接已过期。请从您的账户设置中重新请求一个新的验证链接。" | "您的魔法链接已过期。如果您需要登录，请重新申请一个新的魔法链接。" | "您的密码已重置。您现在可以使用新密码登录。" | "您的密码重置链接已过期。请从登录页面申请新的密码重置链接。" | "您的团队邀请链接已过期。请申请新的团队邀请链接 " | "添加" | "删除账户" | "删除密钥" | "禁用" | "禁用 MFA" | "禁用 OTP" | "显示名称" | "您要登录吗？" | "您想验证您的邮箱吗？" | "还没有账号？" | "添加电子邮件" | "不需要重置？" | "邮箱" | "电子邮件和密码" | "电子邮箱已存在" | "需要填写电子邮箱" | "邮件已发送！" | "电子邮件" | "电子邮件和身份验证" | "启用 MFA" | "启用 OTP" | "添加新密钥" | "启用通过魔法链接或发送到您的登录邮箱的一次性密码进行登录。" | "结束您的当前会话" | "为您的新团队输入一个显示名称" | "输入邮箱" | "输入您邮箱中收到的验证码" | "过期的魔法链接" | "密码重置链接已过期" | "过期的团队邀请链接" | "验证链接已过期" | "到期" | "已有账户？" | "无法连接帐户" | "重置密码失败" | "密码重置失败。请重新申请密码重置链接" | "忘记密码？" | "返回主页" | "如果存在使用此电子邮件地址的用户，一封电子邮件已发送到您的收件箱。请务必检查您的垃圾邮件文件夹。" | "如果您没有被自动重定向，" | "忽略" | "代码不正确。请重试。" | "发生未知错误" | "密码不正确" | "无效代码" | "无效的图片" | "无效的魔法链接" | "无效的密码重置链接" | "无效的团队邀请链接" | "无效的 TOTP 代码" | "无效的验证链接" | "通过电子邮件邀请用户加入您的团队" | "邀请成员" | "您确定要删除您的账户吗？此操作是不可逆的，将删除所有相关数据。" | "邀请用户" | "加入" | "离开" | "退出团队" | "离开团队" | "离开此团队并删除您的团队资料" | "魔法链接已使用" | "成员" | "多重身份认证" | "多重身份验证目前已禁用。" | "您确定要禁用 OTP 登录吗？禁用后，您将无法仅使用电子邮箱登录。" | "多重身份验证目前已启用。" | "我的个人资料" | "姓名" | "不允许注册新账户" | "新密码" | "未启用任何身份验证方法。" | "尚无团队" | "未登录" | "OAuth 提供商访问被拒绝" | "您确定要禁用密钥登录吗？禁用后，您将无法再使用密钥登录。" | "旧密码" | "或继续使用" | "其他团队" | "OTP 登录" | "已启用 OTP 登录，且无法禁用，因为它目前是唯一的登录方式" | "OTP/魔法链接登录目前已启用。" | "待处理邀请" | "在这个团队中覆盖你的用户显示名称" | "密钥" | "密钥已注册"> | Map<"__stack-auto-translation-0" | "__stack-auto-translation-1" | "__stack-auto-translation-2" | "__stack-auto-translation-3" | "__stack-auto-translation-4" | "__stack-auto-translation-5" | "__stack-auto-translation-6" | "__stack-auto-translation-7" | "__stack-auto-translation-8" | "__stack-auto-translation-9" | "__stack-auto-translation-10" | "__stack-auto-translation-11" | "__stack-auto-translation-12" | "__stack-auto-translation-13" | "__stack-auto-translation-14" | "__stack-auto-translation-15" | "__stack-auto-translation-16" | "__stack-auto-translation-17" | "__stack-auto-translation-18" | "__stack-auto-translation-19" | "__stack-auto-translation-20" | "__stack-auto-translation-21" | "__stack-auto-translation-22" | "__stack-auto-translation-23" | "__stack-auto-translation-24" | "__stack-auto-translation-25" | "__stack-auto-translation-26" | "__stack-auto-translation-27" | "__stack-auto-translation-28" | "__stack-auto-translation-29" | "__stack-auto-translation-30" | "__stack-auto-translation-31" | "__stack-auto-translation-32" | "__stack-auto-translation-33" | "__stack-auto-translation-34" | "__stack-auto-translation-35" | "__stack-auto-translation-36" | "__stack-auto-translation-37" | "__stack-auto-translation-38" | "__stack-auto-translation-39" | "__stack-auto-translation-40" | "__stack-auto-translation-41" | "__stack-auto-translation-42" | "__stack-auto-translation-43" | "__stack-auto-translation-44" | "__stack-auto-translation-45" | "__stack-auto-translation-46" | "__stack-auto-translation-47" | "__stack-auto-translation-48" | "__stack-auto-translation-49" | "__stack-auto-translation-50" | "__stack-auto-translation-51" | "__stack-auto-translation-52" | "__stack-auto-translation-53" | "__stack-auto-translation-54" | "__stack-auto-translation-55" | "__stack-auto-translation-56" | "__stack-auto-translation-57" | "__stack-auto-translation-58" | "__stack-auto-translation-59" | "__stack-auto-translation-60" | "__stack-auto-translation-61" | "__stack-auto-translation-62" | "__stack-auto-translation-63" | "__stack-auto-translation-64" | "__stack-auto-translation-65" | "__stack-auto-translation-66" | "__stack-auto-translation-67" | "__stack-auto-translation-68" | "__stack-auto-translation-69" | "__stack-auto-translation-70" | "__stack-auto-translation-71" | "__stack-auto-translation-72" | "__stack-auto-translation-73" | "__stack-auto-translation-74" | "__stack-auto-translation-75" | "__stack-auto-translation-76" | "__stack-auto-translation-77" | "__stack-auto-translation-78" | "__stack-auto-translation-79" | "__stack-auto-translation-80" | "__stack-auto-translation-81" | "__stack-auto-translation-82" | "__stack-auto-translation-83" | "__stack-auto-translation-84" | "__stack-auto-translation-85" | "__stack-auto-translation-86" | "__stack-auto-translation-87" | "__stack-auto-translation-88" | "__stack-auto-translation-89" | "__stack-auto-translation-90" | "__stack-auto-translation-91" | "__stack-auto-translation-92" | "__stack-auto-translation-93" | "__stack-auto-translation-94" | "__stack-auto-translation-95" | "__stack-auto-translation-96" | "__stack-auto-translation-97" | "__stack-auto-translation-98" | "__stack-auto-translation-99" | "__stack-auto-translation-100" | "__stack-auto-translation-101" | "__stack-auto-translation-102" | "__stack-auto-translation-103" | "__stack-auto-translation-104" | "__stack-auto-translation-105" | "__stack-auto-translation-106" | "__stack-auto-translation-107" | "__stack-auto-translation-108" | "__stack-auto-translation-109" | "__stack-auto-translation-110" | "__stack-auto-translation-111" | "__stack-auto-translation-112" | "__stack-auto-translation-113" | "__stack-auto-translation-114" | "__stack-auto-translation-115" | "__stack-auto-translation-116" | "__stack-auto-translation-117" | "__stack-auto-translation-118" | "__stack-auto-translation-119" | "__stack-auto-translation-120" | "__stack-auto-translation-121" | "__stack-auto-translation-122" | "__stack-auto-translation-123" | "__stack-auto-translation-124" | "__stack-auto-translation-125" | "__stack-auto-translation-126" | "__stack-auto-translation-127" | "__stack-auto-translation-128" | "__stack-auto-translation-129" | "__stack-auto-translation-130" | "__stack-auto-translation-131" | "__stack-auto-translation-132" | "__stack-auto-translation-133" | "__stack-auto-translation-134" | "__stack-auto-translation-135" | "__stack-auto-translation-136" | "__stack-auto-translation-137" | "__stack-auto-translation-138" | "__stack-auto-translation-139" | "__stack-auto-translation-140" | "__stack-auto-translation-141" | "__stack-auto-translation-142" | "__stack-auto-translation-143" | "__stack-auto-translation-144" | "__stack-auto-translation-145" | "__stack-auto-translation-146" | "__stack-auto-translation-147" | "__stack-auto-translation-148" | "__stack-auto-translation-149" | "__stack-auto-translation-150" | "__stack-auto-translation-151" | "__stack-auto-translation-152" | "__stack-auto-translation-153" | "__stack-auto-translation-154" | "__stack-auto-translation-155" | "__stack-auto-translation-156" | "__stack-auto-translation-157" | "__stack-auto-translation-158" | "__stack-auto-translation-159" | "__stack-auto-translation-160" | "__stack-auto-translation-161" | "__stack-auto-translation-162" | "__stack-auto-translation-163" | "__stack-auto-translation-164" | "__stack-auto-translation-165" | "__stack-auto-translation-166" | "__stack-auto-translation-167" | "__stack-auto-translation-168" | "__stack-auto-translation-169" | "__stack-auto-translation-170" | "__stack-auto-translation-171" | "__stack-auto-translation-172" | "__stack-auto-translation-173" | "__stack-auto-translation-174" | "__stack-auto-translation-175" | "__stack-auto-translation-176" | "__stack-auto-translation-177" | "__stack-auto-translation-178" | "__stack-auto-translation-179" | "__stack-auto-translation-180" | "__stack-auto-translation-181" | "__stack-auto-translation-182" | "__stack-auto-translation-183" | "__stack-auto-translation-184" | "__stack-auto-translation-185" | "__stack-auto-translation-186" | "__stack-auto-translation-187" | "__stack-auto-translation-188" | "__stack-auto-translation-189" | "__stack-auto-translation-190" | "__stack-auto-translation-191" | "__stack-auto-translation-192" | "__stack-auto-translation-193" | "__stack-auto-translation-194" | "__stack-auto-translation-195" | "__stack-auto-translation-196", "取消" | "主要" | "到期" | "忽略" | "加入" | "帳戶設定" | "您確定要離開團隊嗎？" | "通行金鑰登入已啟用，目前無法停用，因為這是唯一的登入方式" | "密碼" | "密碼重設成功！" | "密碼不符合" | "永久刪除您的帳戶和所有相關資料" | "請檢查您的連結是否正確。如果您繼續遇到問題，請聯絡客戶支援。" | "請再次確認您是否擁有正確的密碼重設連結。" | "請再次確認您是否有正確的團隊邀請連結。" | "請輸入團隊名稱" | "請輸入有效的電子郵件地址" | "請輸入電子郵件地址" | "請輸入您的電子郵件" | "請輸入您的舊密碼" | "請輸入您的密碼" | "請重複輸入您的密碼" | "請再試一次，如果問題仍然存在，請聯絡客戶支援。" | "請先驗證您的電子郵件" | "個人頭像" | "更改團隊的顯示名稱" | "註冊通行金鑰" | "移除" | "重複新密碼" | "重複密碼" | "重設密碼" | "重設您的密碼" | "儲存" | "請使用您的身份驗證器應用程式掃描此 QR 碼：" | "發送電子郵件" | "點擊這裡" | "發送驗證電子郵件" | "為您的帳戶設定密碼" | "設為主要" | "設定密碼" | "設定" | "登入" | "再次登入" | "建立" | "登入或建立帳戶以加入團隊。" | "登入您的帳戶" | "使用密鑰登入" | "以 {provider} 登入" | "登出" | "註冊" | "目前不開放新使用者註冊。" | "使用通行金鑰註冊" | "使用 {provider} 註冊" | "建立新帳戶" | "登入成功！" | "處理 OAuth 回調時出現錯誤：" | "停止使用於登入" | "團隊創建功能未啟用" | "團隊顯示名稱" | "團隊邀請" | "團隊頭像" | "團隊用戶名稱" | "團隊" | "該魔法連結已被使用過。此連結僅能使用一次。如果您需要再次登入，請重新申請一個新的魔法連結。" | "建立一個團隊" | "登入操作已取消。請再試一次。[access_denied]" | "使用者已經連接到另一個 OAuth 帳戶。您是否在 OAuth 提供者頁面上選擇了錯誤的帳戶？" | "然後，輸入您的六位數MFA驗證碼：" | "此帳號已與其他用戶連結。請連結不同的帳號。" | "此電子郵件已被另一位使用者用於登入。" | "這是一個顯示名稱，不用於身份驗證" | "這很可能是 Stack 的錯誤。請回報此問題。" | "此密碼重置連結已被使用。如果您需要再次重置密碼，請從登入頁面重新申請新的密碼重置連結。" | "此團隊邀請連結已被使用。" | "請新增已驗證的登入電子郵件以啟用 OTP 登入。" | "建立團隊" | "若要啟用通行金鑰登入，請新增已驗證的登入電子郵件。" | "請新增登入電子郵件以設定密碼。" | "切換主題" | "TOTP 多因素驗證 QR 碼" | "未驗證" | "更新密碼" | "更新您的密碼" | "上傳您團隊的圖像" | "上傳您自己的圖像作為頭像" | "目前團隊" | "用於登入" | "已使用的密碼重設連結" | "已使用的團隊邀請連結" | "使用者" | "使用者名稱" | "驗證" | "您已經登入" | "您目前尚未登入。" | "您無法移除最後一個用於登入的電子郵件" | "危險區域" | "您的電子郵件已驗證！" | "您的電子郵件" | "您的電子郵件驗證連結已過期。請從您的帳戶設置中重新請求新的驗證連結。" | "您的魔法連結已過期。如果您需要登入，請重新申請新的魔法連結。" | "您的密碼已重設。您現在可以使用新密碼登入。" | "您的密碼重設連結已過期。請從登入頁面重新申請新的密碼重設連結。" | "您的團隊邀請連結已過期。請重新申請新的團隊邀請連結 " | "新增" | "刪除帳號" | "刪除帳戶" | "刪除通行金鑰" | "停用" | "停用 MFA" | "停用 OTP" | "顯示名稱" | "您要登入嗎？" | "您要驗證您的電子郵件嗎？" | "還沒有帳戶嗎？" | "新增電子郵件" | "不需要重設密碼嗎？" | "電子郵件" | "電郵與密碼" | "電子郵件已存在" | "電子郵件為必填" | "電子郵件已發送！" | "電子郵件與驗證" | "啟用多重要素身份驗證" | "啟用 OTP" | "新增通行金鑰" | "啟用透過魔法連結或發送到您的登入電子郵件的一次性密碼進行登入。" | "結束您的當前會話" | "輸入您新團隊的顯示名稱" | "輸入電子郵件地址" | "輸入您電子郵件中的驗證碼" | "已過期的魔法連結" | "密碼重設連結已過期" | "已過期的團隊邀請連結" | "驗證連結已過期" | "已經有帳號了嗎？" | "帳戶連接失敗" | "重設密碼失敗" | "無法重設密碼。請重新申請密碼重設連結" | "忘記密碼？" | "回首頁" | "如果此電子郵件地址的用戶存在，一封電子郵件已發送到您的收件箱。請務必檢查您的垃圾郵件資料夾。" | "如果您沒有自動重新導向，" | "代碼不正確。請再試一次。" | "發生未知錯誤" | "密碼不正確" | "驗證碼無效" | "無效的圖片" | "無效的魔術連結" | "無效的密碼重設連結" | "無效的團隊邀請連結" | "無效的 TOTP 代碼" | "無效的驗證連結" | "透過電子郵件邀請用戶加入您的團隊" | "邀請成員" | "您確定要刪除您的帳戶嗎？此操作是不可逆的，並將刪除所有相關數據。" | "邀請用戶" | "離開" | "離開團隊" | "離開此團隊並移除您的團隊檔案" | "魔法連結已被使用" | "成員" | "多重要素驗證" | "目前已停用多重身份驗證。" | "您確定要停用 OTP 登入嗎？您將無法再僅使用電子郵件進行登入。" | "目前已啟用多重身分驗證。" | "我的個人資料" | "名稱" | "不允許註冊新帳戶" | "新密碼" | "未啟用任何身份驗證方法。" | "尚無團隊" | "未登入" | "OAuth 提供者存取遭拒" | "您確定要停用通行金鑰登入嗎？停用後您將無法再使用通行金鑰登入。" | "舊密碼" | "或繼續使用" | "其他團隊" | "OTP 登入" | "已啟用 OTP 登入，目前無法停用，因為這是唯一的登入方式" | "目前已啟用 OTP/魔法連結登入。" | "待處理邀請" | "覆寫您在此團隊中的使用者顯示名稱" | "通行金鑰" | "通行金鑰已註冊">>;

declare function TranslationProvider({ lang, translationOverrides, children }: {
    lang: Parameters<typeof quetzalLocales.get>[0] | undefined;
    translationOverrides?: Record<string, string>;
    children: React.ReactNode;
}): react_jsx_runtime.JSX.Element;

declare function ReactStackProvider({ children, app, lang, translationOverrides, }: {
    lang?: React$1.ComponentProps<typeof TranslationProvider>['lang'];
    /**
     * A mapping of English translations to translated equivalents.
     *
     * These will take priority over the translations from the language specified in the `lang` property. Note that the
     * keys are case-sensitive.
     */
    translationOverrides?: Record<string, string>;
    children: React$1.ReactNode;
    app: StackClientApp<true>;
}): react_jsx_runtime.JSX.Element;

type Colors = {
    background: string;
    foreground: string;
    card: string;
    cardForeground: string;
    popover: string;
    popoverForeground: string;
    primary: string;
    primaryForeground: string;
    secondary: string;
    secondaryForeground: string;
    muted: string;
    mutedForeground: string;
    accent: string;
    accentForeground: string;
    destructive: string;
    destructiveForeground: string;
    border: string;
    input: string;
    ring: string;
};
type Theme = {
    light: Colors;
    dark: Colors;
    radius: string;
};
type ThemeConfig = {
    light?: Partial<Colors>;
    dark?: Partial<Colors>;
} & Partial<Omit<Theme, 'light' | 'dark'>>;
declare function StackTheme({ theme, children, nonce, }: {
    theme?: ThemeConfig;
    children?: React$1.ReactNode;
    nonce?: string;
}): react_jsx_runtime.JSX.Element;

type Props = {
    noPasswordRepeat?: boolean;
    firstTab?: 'magic-link' | 'password';
    fullPage?: boolean;
    type: 'sign-in' | 'sign-up';
    automaticRedirect?: boolean;
    extraInfo?: React.ReactNode;
    mockProject?: {
        config: {
            signUpEnabled: boolean;
            credentialEnabled: boolean;
            passkeyEnabled: boolean;
            magicLinkEnabled: boolean;
            oauthProviders: {
                id: string;
            }[];
        };
    };
};
declare function AuthPage(props: Props): react_jsx_runtime.JSX.Element;

declare function SignIn(props: {
    fullPage?: boolean;
    automaticRedirect?: boolean;
    extraInfo?: React.ReactNode;
    firstTab?: 'magic-link' | 'password';
}): react_jsx_runtime.JSX.Element;

declare function SignUp(props: {
    fullPage?: boolean;
    automaticRedirect?: boolean;
    noPasswordRepeat?: boolean;
    extraInfo?: React.ReactNode;
    firstTab?: 'magic-link' | 'password';
}): react_jsx_runtime.JSX.Element;

declare function CredentialSignIn(): react_jsx_runtime.JSX.Element;

declare function CredentialSignUp(props: {
    noPasswordRepeat?: boolean;
}): react_jsx_runtime.JSX.Element;

declare function UserAvatar(props: {
    size?: number;
    user?: {
        profileImageUrl?: string | null;
        displayName?: string | null;
        primaryEmail?: string | null;
    } | null;
    border?: boolean;
}): react_jsx_runtime.JSX.Element;

declare function MagicLinkSignIn(): react_jsx_runtime.JSX.Element;

declare function MessageCard({ fullPage, ...props }: {
    children?: React$1.ReactNode;
    title: string;
    fullPage?: boolean;
    primaryButtonText?: string;
    primaryAction?: () => Promise<void> | void;
    secondaryButtonText?: string;
    secondaryAction?: () => Promise<void> | void;
}): react_jsx_runtime.JSX.Element;

declare function OAuthButton({ provider, type, isMock, }: {
    provider: string;
    type: 'sign-in' | 'sign-up';
    isMock?: boolean;
}): react_jsx_runtime.JSX.Element;

declare function OAuthButtonGroup({ type, mockProject, }: {
    type: 'sign-in' | 'sign-up';
    mockProject?: {
        config: {
            oauthProviders: {
                id: string;
            }[];
        };
    };
}): react_jsx_runtime.JSX.Element;

type SelectedTeamSwitcherProps = {
    urlMap?: (team: Team) => string;
    selectedTeam?: Team;
    noUpdateSelectedTeam?: boolean;
};
declare function SelectedTeamSwitcher(props: SelectedTeamSwitcherProps): react_jsx_runtime.JSX.Element;

type UserButtonProps = {
    showUserInfo?: boolean;
    colorModeToggle?: () => void | Promise<void>;
    extraItems?: {
        text: string;
        icon: React$1.ReactNode;
        onClick: () => void | Promise<void>;
    }[];
};
declare function UserButton(props: UserButtonProps): react_jsx_runtime.JSX.Element;

export { AccountSettings, type AdminDomainConfig, type AdminEmailConfig, type AdminOAuthProviderConfig, type AdminOwnedProject, type AdminProject, type AdminProjectConfig, type AdminProjectConfigUpdateOptions, type AdminProjectCreateOptions, type AdminProjectPermission, type AdminProjectPermissionDefinition, type AdminProjectPermissionDefinitionCreateOptions, type AdminProjectPermissionDefinitionUpdateOptions, type AdminProjectUpdateOptions, type AdminSentEmail, type AdminTeamPermission, type AdminTeamPermissionDefinition, type AdminTeamPermissionDefinitionCreateOptions, type AdminTeamPermissionDefinitionUpdateOptions, type Auth, AuthPage, CliAuthConfirmation, type Connection, type ContactChannel, CredentialSignIn, CredentialSignUp, type CurrentInternalServerUser, type CurrentInternalUser, type CurrentServerUser, type CurrentUser, type EditableTeamMemberProfile, EmailVerification, ForgotPassword, type GetUserOptions$1 as GetUserOptions, type HandlerUrls, type InternalApiKey, type InternalApiKeyBase, type InternalApiKeyBaseCrudRead, type InternalApiKeyCreateOptions, type InternalApiKeyFirstView, MagicLinkSignIn, MessageCard, OAuthButton, OAuthButtonGroup, type OAuthConnection, type OAuthProviderConfig, type OAuthScopesOnSignIn, PasswordReset, type Project, type ProjectConfig, SelectedTeamSwitcher, type ServerContactChannel, type ServerListUsersOptions, type ServerTeam, type ServerTeamCreateOptions, type ServerTeamMemberProfile, type ServerTeamUpdateOptions, type ServerTeamUser, type ServerUser, type Session, SignIn, SignUp, StackAdminApp, type StackAdminAppConstructor, type StackAdminAppConstructorOptions, StackClientApp, type StackClientAppConstructor, type StackClientAppConstructorOptions, type StackClientAppJson, ReactStackHandler as StackHandler, ReactStackProvider as StackProvider, StackServerApp, type StackServerAppConstructor, type StackServerAppConstructorOptions, StackTheme, type Team, type TeamCreateOptions, type TeamInvitation$1 as TeamInvitation, type TeamMemberProfile, type TeamUpdateOptions, type TeamUser, type User, UserAvatar, UserButton, stackAppInternalsSymbol, useStackApp, useUser };
