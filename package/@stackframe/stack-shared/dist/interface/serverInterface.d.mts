import { KnownErrors } from '../known-errors.mjs';
import { InternalSession, AccessToken, RefreshToken } from '../sessions.mjs';
import { Result } from '../utils/results.mjs';
import { ClientInterfaceOptions, StackClientInterface } from './clientInterface.mjs';
import { ContactChannelsCrud } from './crud/contact-channels.mjs';
import { CurrentUserCrud } from './crud/current-user.mjs';
import { ConnectedAccountAccessTokenCrud } from './crud/oauth.mjs';
import { ProjectPermissionsCrud } from './crud/project-permissions.mjs';
import { SessionsCrud } from './crud/sessions.mjs';
import { TeamInvitationCrud } from './crud/team-invitation.mjs';
import { TeamMemberProfilesCrud } from './crud/team-member-profiles.mjs';
import { TeamMembershipsCrud } from './crud/team-memberships.mjs';
import { TeamPermissionsCrud } from './crud/team-permissions.mjs';
import { TeamsCrud } from './crud/teams.mjs';
import { UsersCrud } from './crud/users.mjs';
import '../utils/errors.mjs';
import '../utils/json.mjs';
import 'jose';
import 'yup';
import '@simplewebauthn/types';
import './crud/project-api-keys.mjs';
import '../crud.mjs';
import '../utils/types.mjs';
import './crud/projects.mjs';

type ServerAuthApplicationOptions = (ClientInterfaceOptions & ({
    readonly secretServerKey: string;
} | {
    readonly projectOwnerSession: InternalSession;
}));
declare class StackServerInterface extends StackClientInterface {
    options: ServerAuthApplicationOptions;
    constructor(options: ServerAuthApplicationOptions);
    protected sendServerRequest(path: string, options: RequestInit, session: InternalSession | null, requestType?: "server" | "admin"): Promise<Response & {
        usedTokens: {
            accessToken: AccessToken;
            refreshToken: RefreshToken | null;
        } | null;
    }>;
    protected sendServerRequestAndCatchKnownError<E extends typeof KnownErrors[keyof KnownErrors]>(path: string, requestOptions: RequestInit, tokenStoreOrNull: InternalSession | null, errorsToCatch: readonly E[]): Promise<Result<Response & {
        usedTokens: {
            accessToken: AccessToken;
            refreshToken: RefreshToken | null;
        } | null;
    }, InstanceType<E>>>;
    createServerUser(data: UsersCrud['Server']['Create']): Promise<UsersCrud['Server']['Read']>;
    getServerUserByToken(session: InternalSession): Promise<CurrentUserCrud['Server']['Read'] | null>;
    getServerUserById(userId: string): Promise<Result<UsersCrud['Server']['Read']>>;
    listServerTeamInvitations(options: {
        teamId: string;
    }): Promise<TeamInvitationCrud['Server']['Read'][]>;
    revokeServerTeamInvitation(invitationId: string, teamId: string): Promise<void>;
    listServerTeamMemberProfiles(options: {
        teamId: string;
    }): Promise<TeamMemberProfilesCrud['Server']['Read'][]>;
    getServerTeamMemberProfile(options: {
        teamId: string;
        userId: string;
    }): Promise<TeamMemberProfilesCrud['Client']['Read']>;
    listServerTeamPermissions(options: {
        userId?: string;
        teamId?: string;
        recursive: boolean;
    }, session: InternalSession | null): Promise<TeamPermissionsCrud['Server']['Read'][]>;
    listServerProjectPermissions(options: {
        userId?: string;
        recursive: boolean;
    }, session: InternalSession | null): Promise<ProjectPermissionsCrud['Server']['Read'][]>;
    listServerUsers(options: {
        cursor?: string;
        limit?: number;
        orderBy?: 'signedUpAt';
        desc?: boolean;
        query?: string;
    }): Promise<UsersCrud['Server']['List']>;
    listServerTeams(options?: {
        userId?: string;
    }): Promise<TeamsCrud['Server']['Read'][]>;
    getServerTeam(teamId: string): Promise<TeamsCrud['Server']['Read']>;
    listServerTeamUsers(teamId: string): Promise<UsersCrud['Server']['Read'][]>;
    createServerTeam(data: TeamsCrud['Server']['Create']): Promise<TeamsCrud['Server']['Read']>;
    updateServerTeam(teamId: string, data: TeamsCrud['Server']['Update']): Promise<TeamsCrud['Server']['Read']>;
    deleteServerTeam(teamId: string): Promise<void>;
    addServerUserToTeam(options: {
        userId: string;
        teamId: string;
    }): Promise<TeamMembershipsCrud['Server']['Read']>;
    removeServerUserFromTeam(options: {
        userId: string;
        teamId: string;
    }): Promise<void>;
    updateServerUser(userId: string, update: UsersCrud['Server']['Update']): Promise<UsersCrud['Server']['Read']>;
    createServerProviderAccessToken(userId: string, provider: string, scope: string): Promise<ConnectedAccountAccessTokenCrud['Server']['Read']>;
    createServerUserSession(userId: string, expiresInMillis: number, isImpersonation: boolean): Promise<{
        accessToken: string;
        refreshToken: string;
    }>;
    leaveServerTeam(options: {
        teamId: string;
        userId: string;
    }): Promise<void>;
    updateServerTeamMemberProfile(options: {
        teamId: string;
        userId: string;
        profile: TeamMemberProfilesCrud['Server']['Update'];
    }): Promise<void>;
    grantServerTeamUserPermission(teamId: string, userId: string, permissionId: string): Promise<void>;
    grantServerProjectPermission(userId: string, permissionId: string): Promise<void>;
    revokeServerTeamUserPermission(teamId: string, userId: string, permissionId: string): Promise<void>;
    revokeServerProjectPermission(userId: string, permissionId: string): Promise<void>;
    deleteServerUser(userId: string): Promise<void>;
    createServerContactChannel(data: ContactChannelsCrud['Server']['Create']): Promise<ContactChannelsCrud['Server']['Read']>;
    updateServerContactChannel(userId: string, contactChannelId: string, data: ContactChannelsCrud['Server']['Update']): Promise<ContactChannelsCrud['Server']['Read']>;
    deleteServerContactChannel(userId: string, contactChannelId: string): Promise<void>;
    listServerContactChannels(userId: string): Promise<ContactChannelsCrud['Server']['Read'][]>;
    sendServerContactChannelVerificationEmail(userId: string, contactChannelId: string, callbackUrl: string): Promise<void>;
    listServerSessions(userId: string): Promise<SessionsCrud['Server']['Read'][]>;
    deleteServerSession(sessionId: string): Promise<void>;
    sendServerTeamInvitation(options: {
        email: string;
        teamId: string;
        callbackUrl: string;
    }): Promise<void>;
    updatePassword(options: {
        oldPassword: string;
        newPassword: string;
    }): Promise<KnownErrors["PasswordConfirmationMismatch"] | KnownErrors["PasswordRequirementsNotMet"] | undefined>;
}

export { type ServerAuthApplicationOptions, StackServerInterface };
