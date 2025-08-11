import * as yup from 'yup';
import { KnownErrors } from '../known-errors.js';
import { InternalSession, RefreshToken, AccessToken } from '../sessions.js';
import { ReadonlyJson } from '../utils/json.js';
import { PublicKeyCredentialCreationOptionsJSON, RegistrationResponseJSON, PublicKeyCredentialRequestOptionsJSON, AuthenticationResponseJSON } from '@simplewebauthn/types';
import { Result } from '../utils/results.js';
import { ContactChannelsCrud } from './crud/contact-channels.js';
import { CurrentUserCrud } from './crud/current-user.js';
import { ConnectedAccountAccessTokenCrud } from './crud/oauth.js';
import { UserApiKeysCrud, TeamApiKeysCrud, userApiKeysCreateInputSchema, userApiKeysCreateOutputSchema, teamApiKeysCreateInputSchema, teamApiKeysCreateOutputSchema } from './crud/project-api-keys.js';
import { ProjectPermissionsCrud } from './crud/project-permissions.js';
import { ClientProjectsCrud, AdminUserProjectsCrud } from './crud/projects.js';
import { SessionsCrud } from './crud/sessions.js';
import { TeamInvitationCrud } from './crud/team-invitation.js';
import { TeamMemberProfilesCrud } from './crud/team-member-profiles.js';
import { TeamPermissionsCrud } from './crud/team-permissions.js';
import { TeamsCrud } from './crud/teams.js';
import '../utils/errors.js';
import 'jose';
import '../crud.js';
import '../utils/types.js';

type ClientInterfaceOptions = {
    clientVersion: string;
    getBaseUrl: () => string;
    extraRequestHeaders: Record<string, string>;
    projectId: string;
    prepareRequest?: () => Promise<void>;
} & ({
    publishableClientKey: string;
} | {
    projectOwnerSession: InternalSession;
});
declare class StackClientInterface {
    readonly options: ClientInterfaceOptions;
    constructor(options: ClientInterfaceOptions);
    get projectId(): string;
    getApiUrl(): string;
    runNetworkDiagnostics(session?: InternalSession | null, requestType?: "client" | "server" | "admin"): Promise<{
        "navigator?.onLine": any;
        cfTrace: string;
        apiRoot: string;
        baseUrlBackend: string;
        prodDashboard: string;
        prodBackend: string;
    }>;
    protected _createNetworkError(cause: Error, session?: InternalSession | null, requestType?: "client" | "server" | "admin"): Promise<Error>;
    protected _networkRetry<T>(cb: () => Promise<Result<T, any>>, session?: InternalSession | null, requestType?: "client" | "server" | "admin"): Promise<T>;
    protected _networkRetryException<T>(cb: () => Promise<T>, session?: InternalSession | null, requestType?: "client" | "server" | "admin"): Promise<T>;
    fetchNewAccessToken(refreshToken: RefreshToken): Promise<AccessToken | null>;
    sendClientRequest(path: string, requestOptions: RequestInit, session: InternalSession | null, requestType?: "client" | "server" | "admin"): Promise<Response & {
        usedTokens: {
            accessToken: AccessToken;
            refreshToken: RefreshToken | null;
        } | null;
    }>;
    createSession(options: Omit<ConstructorParameters<typeof InternalSession>[0], "refreshAccessTokenCallback">): InternalSession;
    protected sendClientRequestAndCatchKnownError<E extends typeof KnownErrors[keyof KnownErrors]>(path: string, requestOptions: RequestInit, tokenStoreOrNull: InternalSession | null, errorsToCatch: readonly E[]): Promise<Result<Response & {
        usedTokens: {
            accessToken: AccessToken;
            refreshToken: RefreshToken | null;
        } | null;
    }, InstanceType<E>>>;
    private sendClientRequestInner;
    private _processResponse;
    checkFeatureSupport(options: {
        featureName?: string;
    } & ReadonlyJson): Promise<never>;
    sendForgotPasswordEmail(email: string, callbackUrl: string): Promise<Result<undefined, KnownErrors["UserNotFound"]>>;
    sendVerificationEmail(email: string, callbackUrl: string, session: InternalSession): Promise<KnownErrors["EmailAlreadyVerified"] | undefined>;
    sendMagicLinkEmail(email: string, callbackUrl: string): Promise<Result<{
        nonce: string;
    }, KnownErrors["RedirectUrlNotWhitelisted"]>>;
    resetPassword(options: {
        code: string;
    } & ({
        password: string;
    } | {
        onlyVerifyCode: true;
    })): Promise<Result<undefined, KnownErrors["VerificationCodeError"]>>;
    updatePassword(options: {
        oldPassword: string;
        newPassword: string;
    }, session: InternalSession): Promise<KnownErrors["PasswordConfirmationMismatch"] | KnownErrors["PasswordRequirementsNotMet"] | undefined>;
    setPassword(options: {
        password: string;
    }, session: InternalSession): Promise<KnownErrors["PasswordRequirementsNotMet"] | undefined>;
    verifyPasswordResetCode(code: string): Promise<Result<undefined, KnownErrors["VerificationCodeError"]>>;
    verifyEmail(code: string): Promise<Result<undefined, KnownErrors["VerificationCodeError"]>>;
    initiatePasskeyRegistration(options: {}, session: InternalSession): Promise<Result<{
        options_json: PublicKeyCredentialCreationOptionsJSON;
        code: string;
    }, KnownErrors[]>>;
    registerPasskey(options: {
        credential: RegistrationResponseJSON;
        code: string;
    }, session: InternalSession): Promise<Result<undefined, KnownErrors["PasskeyRegistrationFailed"]>>;
    initiatePasskeyAuthentication(options: {}, session: InternalSession): Promise<Result<{
        options_json: PublicKeyCredentialRequestOptionsJSON;
        code: string;
    }, KnownErrors[]>>;
    sendTeamInvitation(options: {
        email: string;
        teamId: string;
        callbackUrl: string;
        session: InternalSession;
    }): Promise<void>;
    acceptTeamInvitation<T extends 'use' | 'details' | 'check'>(options: {
        code: string;
        session: InternalSession;
        type: T;
    }): Promise<Result<T extends 'details' ? {
        team_display_name: string;
    } : undefined, KnownErrors["VerificationCodeError"]>>;
    totpMfa(attemptCode: string, totp: string, session: InternalSession): Promise<{
        accessToken: any;
        refreshToken: any;
        newUser: any;
    }>;
    signInWithCredential(email: string, password: string, session: InternalSession): Promise<Result<{
        accessToken: string;
        refreshToken: string;
    }, KnownErrors["EmailPasswordMismatch"]>>;
    signUpWithCredential(email: string, password: string, emailVerificationRedirectUrl: string, session: InternalSession): Promise<Result<{
        accessToken: string;
        refreshToken: string;
    }, KnownErrors["UserWithEmailAlreadyExists"] | KnownErrors["PasswordRequirementsNotMet"]>>;
    signUpAnonymously(session: InternalSession): Promise<Result<{
        accessToken: string;
        refreshToken: string;
    }, never>>;
    signInWithMagicLink(code: string): Promise<Result<{
        newUser: boolean;
        accessToken: string;
        refreshToken: string;
    }, KnownErrors["VerificationCodeError"]>>;
    signInWithPasskey(body: {
        authentication_response: AuthenticationResponseJSON;
        code: string;
    }): Promise<Result<{
        accessToken: string;
        refreshToken: string;
    }, KnownErrors["PasskeyAuthenticationFailed"]>>;
    getOAuthUrl(options: {
        provider: string;
        redirectUrl: string;
        errorRedirectUrl: string;
        afterCallbackRedirectUrl?: string;
        codeChallenge: string;
        state: string;
        type: "authenticate" | "link";
        providerScope?: string;
    } & ({
        type: "authenticate";
    } | {
        type: "link";
        session: InternalSession;
    })): Promise<string>;
    callOAuthCallback(options: {
        oauthParams: URLSearchParams;
        redirectUri: string;
        codeVerifier: string;
        state: string;
    }): Promise<{
        newUser: boolean;
        afterCallbackRedirectUrl?: string;
        accessToken: string;
        refreshToken: string;
    }>;
    signOut(session: InternalSession): Promise<void>;
    getClientUserByToken(session: InternalSession): Promise<CurrentUserCrud["Client"]["Read"] | null>;
    listTeamInvitations(options: {
        teamId: string;
    }, session: InternalSession): Promise<TeamInvitationCrud['Client']['Read'][]>;
    revokeTeamInvitation(invitationId: string, teamId: string, session: InternalSession): Promise<void>;
    listTeamMemberProfiles(options: {
        teamId?: string;
        userId?: string;
    }, session: InternalSession): Promise<TeamMemberProfilesCrud['Client']['Read'][]>;
    getTeamMemberProfile(options: {
        teamId: string;
        userId: string;
    }, session: InternalSession): Promise<TeamMemberProfilesCrud['Client']['Read']>;
    leaveTeam(teamId: string, session: InternalSession): Promise<void>;
    updateTeamMemberProfile(options: {
        teamId: string;
        userId: string;
        profile: TeamMemberProfilesCrud['Client']['Update'];
    }, session: InternalSession): Promise<void>;
    updateTeam(options: {
        teamId: string;
        data: TeamsCrud['Client']['Update'];
    }, session: InternalSession): Promise<void>;
    listCurrentUserTeamPermissions(options: {
        teamId: string;
        recursive: boolean;
    }, session: InternalSession): Promise<TeamPermissionsCrud['Client']['Read'][]>;
    listCurrentUserProjectPermissions(options: {
        recursive: boolean;
    }, session: InternalSession): Promise<ProjectPermissionsCrud['Client']['Read'][]>;
    listCurrentUserTeams(session: InternalSession): Promise<TeamsCrud["Client"]["Read"][]>;
    getClientProject(): Promise<Result<ClientProjectsCrud['Client']['Read'], KnownErrors["ProjectNotFound"]>>;
    updateClientUser(update: CurrentUserCrud["Client"]["Update"], session: InternalSession): Promise<void>;
    listProjects(session: InternalSession): Promise<AdminUserProjectsCrud['Client']['Read'][]>;
    createProject(project: AdminUserProjectsCrud['Client']['Create'], session: InternalSession): Promise<AdminUserProjectsCrud['Client']['Read']>;
    createProviderAccessToken(provider: string, scope: string, session: InternalSession): Promise<ConnectedAccountAccessTokenCrud['Client']['Read']>;
    createClientTeam(data: TeamsCrud['Client']['Create'], session: InternalSession): Promise<TeamsCrud['Client']['Read']>;
    deleteTeam(teamId: string, session: InternalSession): Promise<void>;
    deleteCurrentUser(session: InternalSession): Promise<void>;
    createClientContactChannel(data: ContactChannelsCrud['Client']['Create'], session: InternalSession): Promise<ContactChannelsCrud['Client']['Read']>;
    updateClientContactChannel(id: string, data: ContactChannelsCrud['Client']['Update'], session: InternalSession): Promise<ContactChannelsCrud['Client']['Read']>;
    deleteClientContactChannel(id: string, session: InternalSession): Promise<void>;
    deleteSession(sessionId: string, session: InternalSession): Promise<void>;
    listSessions(session: InternalSession): Promise<SessionsCrud['Client']['List']>;
    listClientContactChannels(session: InternalSession): Promise<ContactChannelsCrud['Client']['Read'][]>;
    sendCurrentUserContactChannelVerificationEmail(contactChannelId: string, callbackUrl: string, session: InternalSession): Promise<Result<undefined, KnownErrors["EmailAlreadyVerified"]>>;
    cliLogin(loginCode: string, refreshToken: string, session: InternalSession): Promise<Result<undefined, KnownErrors["SchemaError"]>>;
    private _getApiKeyRequestInfo;
    listProjectApiKeys(options: {
        user_id: string;
    }, session: InternalSession | null, requestType: "client" | "server" | "admin"): Promise<UserApiKeysCrud['Client']['Read'][]>;
    listProjectApiKeys(options: {
        team_id: string;
    }, session: InternalSession | null, requestType: "client" | "server" | "admin"): Promise<TeamApiKeysCrud['Client']['Read'][]>;
    listProjectApiKeys(options: {
        user_id: string;
    } | {
        team_id: string;
    }, session: InternalSession | null, requestType: "client" | "server" | "admin"): Promise<(UserApiKeysCrud['Client']['Read'] | TeamApiKeysCrud['Client']['Read'])[]>;
    createProjectApiKey(data: yup.InferType<typeof userApiKeysCreateInputSchema>, session: InternalSession | null, requestType: "client" | "server" | "admin"): Promise<yup.InferType<typeof userApiKeysCreateOutputSchema>>;
    createProjectApiKey(data: yup.InferType<typeof teamApiKeysCreateInputSchema>, session: InternalSession | null, requestType: "client" | "server" | "admin"): Promise<yup.InferType<typeof teamApiKeysCreateOutputSchema>>;
    createProjectApiKey(data: yup.InferType<typeof userApiKeysCreateInputSchema> | yup.InferType<typeof teamApiKeysCreateInputSchema>, session: InternalSession | null, requestType: "client" | "server" | "admin"): Promise<yup.InferType<typeof userApiKeysCreateOutputSchema> | yup.InferType<typeof teamApiKeysCreateOutputSchema>>;
    getProjectApiKey(options: {
        user_id: string | null;
    }, keyId: string, session: InternalSession | null, requestType: "client" | "server" | "admin"): Promise<UserApiKeysCrud['Client']['Read']>;
    getProjectApiKey(options: {
        team_id: string;
    }, keyId: string, session: InternalSession | null, requestType: "client" | "server" | "admin"): Promise<TeamApiKeysCrud['Client']['Read']>;
    getProjectApiKey(options: {
        user_id: string | null;
    } | {
        team_id: string;
    }, keyId: string, session: InternalSession | null, requestType: "client" | "server" | "admin"): Promise<UserApiKeysCrud['Client']['Read'] | TeamApiKeysCrud['Client']['Read']>;
    updateProjectApiKey(options: {
        user_id: string;
    }, keyId: string, data: UserApiKeysCrud['Client']['Update'], session: InternalSession | null, requestType: "client" | "server" | "admin"): Promise<UserApiKeysCrud['Client']['Read']>;
    updateProjectApiKey(options: {
        team_id: string;
    }, keyId: string, data: TeamApiKeysCrud['Client']['Update'], session: InternalSession | null, requestType: "client" | "server" | "admin"): Promise<TeamApiKeysCrud['Client']['Read']>;
    updateProjectApiKey(options: {
        user_id: string;
    } | {
        team_id: string;
    }, keyId: string, data: UserApiKeysCrud['Client']['Update'] | TeamApiKeysCrud['Client']['Update'], session: InternalSession | null, requestType: "client" | "server" | "admin"): Promise<UserApiKeysCrud['Client']['Read'] | TeamApiKeysCrud['Client']['Read']>;
    checkProjectApiKey(type: "user", apiKey: string, session: InternalSession | null, requestType: "client" | "server" | "admin"): Promise<UserApiKeysCrud['Client']['Read'] | null>;
    checkProjectApiKey(type: "team", apiKey: string, session: InternalSession | null, requestType: "client" | "server" | "admin"): Promise<TeamApiKeysCrud['Client']['Read'] | null>;
    checkProjectApiKey(type: "user" | "team", apiKey: string, session: InternalSession | null, requestType: "client" | "server" | "admin"): Promise<UserApiKeysCrud['Client']['Read'] | TeamApiKeysCrud['Client']['Read'] | null>;
}

export { type ClientInterfaceOptions, StackClientInterface };
