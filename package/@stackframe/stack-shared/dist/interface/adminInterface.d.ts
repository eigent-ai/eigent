import { InternalSession, AccessToken, RefreshToken } from '../sessions.js';
import { EmailTemplateCrud, EmailTemplateType } from './crud/email-templates.js';
import { InternalEmailsCrud } from './crud/emails.js';
import { InternalApiKeysCrud } from './crud/internal-api-keys.js';
import { ProjectPermissionDefinitionsCrud } from './crud/project-permissions.js';
import { ProjectsCrud } from './crud/projects.js';
import { SvixTokenCrud } from './crud/svix-token.js';
import { TeamPermissionDefinitionsCrud } from './crud/team-permissions.js';
import { ServerAuthApplicationOptions, StackServerInterface } from './serverInterface.js';
import './clientInterface.js';
import '../known-errors.js';
import 'jose';
import '../crud.js';
import 'yup';
import '../utils/types.js';
import '../utils/results.js';
import './crud/contact-channels.js';
import './crud/current-user.js';
import './crud/oauth.js';
import './crud/sessions.js';
import './crud/team-invitation.js';
import './crud/team-member-profiles.js';
import './crud/team-memberships.js';
import './crud/teams.js';
import './crud/users.js';
import '../utils/errors.js';
import '../utils/json.js';
import '@simplewebauthn/types';
import './crud/project-api-keys.js';

type AdminAuthApplicationOptions = ServerAuthApplicationOptions & ({
    superSecretAdminKey: string;
} | {
    projectOwnerSession: InternalSession;
});
type InternalApiKeyCreateCrudRequest = {
    has_publishable_client_key: boolean;
    has_secret_server_key: boolean;
    has_super_secret_admin_key: boolean;
    expires_at_millis: number;
    description: string;
};
type InternalApiKeyCreateCrudResponse = InternalApiKeysCrud["Admin"]["Read"] & {
    publishable_client_key?: string;
    secret_server_key?: string;
    super_secret_admin_key?: string;
};
declare class StackAdminInterface extends StackServerInterface {
    readonly options: AdminAuthApplicationOptions;
    constructor(options: AdminAuthApplicationOptions);
    sendAdminRequest(path: string, options: RequestInit, session: InternalSession | null, requestType?: "admin"): Promise<Response & {
        usedTokens: {
            accessToken: AccessToken;
            refreshToken: RefreshToken | null;
        } | null;
    }>;
    getProject(): Promise<ProjectsCrud["Admin"]["Read"]>;
    updateProject(update: ProjectsCrud["Admin"]["Update"]): Promise<ProjectsCrud["Admin"]["Read"]>;
    createInternalApiKey(options: InternalApiKeyCreateCrudRequest): Promise<InternalApiKeyCreateCrudResponse>;
    listInternalApiKeys(): Promise<InternalApiKeysCrud["Admin"]["Read"][]>;
    revokeInternalApiKeyById(id: string): Promise<void>;
    getInternalApiKey(id: string, session: InternalSession): Promise<InternalApiKeysCrud["Admin"]["Read"]>;
    listEmailTemplates(): Promise<EmailTemplateCrud['Admin']['Read'][]>;
    updateEmailTemplate(type: EmailTemplateType, data: EmailTemplateCrud['Admin']['Update']): Promise<EmailTemplateCrud['Admin']['Read']>;
    resetEmailTemplate(type: EmailTemplateType): Promise<void>;
    listTeamPermissionDefinitions(): Promise<TeamPermissionDefinitionsCrud['Admin']['Read'][]>;
    createTeamPermissionDefinition(data: TeamPermissionDefinitionsCrud['Admin']['Create']): Promise<TeamPermissionDefinitionsCrud['Admin']['Read']>;
    updateTeamPermissionDefinition(permissionId: string, data: TeamPermissionDefinitionsCrud['Admin']['Update']): Promise<TeamPermissionDefinitionsCrud['Admin']['Read']>;
    deleteTeamPermissionDefinition(permissionId: string): Promise<void>;
    listProjectPermissionDefinitions(): Promise<ProjectPermissionDefinitionsCrud['Admin']['Read'][]>;
    createProjectPermissionDefinition(data: ProjectPermissionDefinitionsCrud['Admin']['Create']): Promise<ProjectPermissionDefinitionsCrud['Admin']['Read']>;
    updateProjectPermissionDefinition(permissionId: string, data: ProjectPermissionDefinitionsCrud['Admin']['Update']): Promise<ProjectPermissionDefinitionsCrud['Admin']['Read']>;
    deleteProjectPermissionDefinition(permissionId: string): Promise<void>;
    getSvixToken(): Promise<SvixTokenCrud["Admin"]["Read"]>;
    deleteProject(): Promise<void>;
    getMetrics(): Promise<any>;
    sendTestEmail(data: {
        recipient_email: string;
        email_config: {
            host: string;
            port: number;
            username: string;
            password: string;
            sender_email: string;
            sender_name: string;
        };
    }): Promise<{
        success: boolean;
        error_message?: string;
    }>;
    listSentEmails(): Promise<InternalEmailsCrud["Admin"]["List"]>;
}

export { type AdminAuthApplicationOptions, type InternalApiKeyCreateCrudRequest, type InternalApiKeyCreateCrudResponse, StackAdminInterface };
