import { CrudSchemaFromOptions, CrudTypeOf } from '../../crud.js';
import * as yup from 'yup';
import '../../utils/types.js';

declare const teamMemberProfilesCrudClientReadSchema: yup.ObjectSchema<{
    team_id: string;
    user_id: string;
    display_name: string | null;
    profile_image_url: string | null;
}, yup.AnyObject, {
    team_id: undefined;
    user_id: undefined;
    display_name: undefined;
    profile_image_url: undefined;
}, "">;
declare const teamMemberProfilesCrudServerReadSchema: yup.ObjectSchema<{
    team_id: string;
    user_id: string;
    display_name: string | null;
    profile_image_url: string | null;
} & {
    user: {
        id: string;
        display_name: string | null;
        oauth_providers: {
            email?: string | null | undefined;
            id: string;
            account_id: string;
        }[];
        profile_image_url: string | null;
        client_metadata: {} | null;
        client_read_only_metadata: {} | null;
        server_metadata: {} | null;
        primary_email: string | null;
        primary_email_verified: boolean;
        primary_email_auth_enabled: boolean;
        passkey_auth_enabled: boolean;
        otp_auth_enabled: boolean;
        selected_team_id: string | null;
        is_anonymous: boolean;
        selected_team: {
            client_metadata?: {} | null | undefined;
            client_read_only_metadata?: {} | null | undefined;
            server_metadata?: {} | null | undefined;
            id: string;
            display_name: string;
            created_at_millis: number;
            profile_image_url: string | null;
        } | null;
        signed_up_at_millis: number;
        has_password: boolean;
        last_active_at_millis: number;
        auth_with_email: boolean;
        requires_totp_mfa: boolean;
    };
}, yup.AnyObject, {
    team_id: undefined;
    user_id: undefined;
    display_name: undefined;
    profile_image_url: undefined;
    user: {
        id: undefined;
        primary_email: undefined;
        primary_email_verified: undefined;
        primary_email_auth_enabled: undefined;
        display_name: undefined;
        selected_team: {
            id: undefined;
            display_name: undefined;
            profile_image_url: undefined;
            client_metadata: undefined;
            client_read_only_metadata: undefined;
            created_at_millis: undefined;
            server_metadata: undefined;
        };
        selected_team_id: undefined;
        profile_image_url: undefined;
        signed_up_at_millis: undefined;
        has_password: undefined;
        otp_auth_enabled: undefined;
        passkey_auth_enabled: undefined;
        client_metadata: undefined;
        client_read_only_metadata: undefined;
        server_metadata: undefined;
        last_active_at_millis: undefined;
        is_anonymous: undefined;
        oauth_providers: undefined;
        auth_with_email: undefined;
        requires_totp_mfa: undefined;
    };
}, "">;
declare const teamMemberProfilesCrudClientUpdateSchema: yup.ObjectSchema<{
    display_name: string | undefined;
    profile_image_url: string | null | undefined;
}, yup.AnyObject, {
    display_name: undefined;
    profile_image_url: undefined;
}, "">;
declare const teamMemberProfilesCrud: CrudSchemaFromOptions<{
    clientReadSchema: yup.ObjectSchema<{
        team_id: string;
        user_id: string;
        display_name: string | null;
        profile_image_url: string | null;
    }, yup.AnyObject, {
        team_id: undefined;
        user_id: undefined;
        display_name: undefined;
        profile_image_url: undefined;
    }, "">;
    serverReadSchema: yup.ObjectSchema<{
        team_id: string;
        user_id: string;
        display_name: string | null;
        profile_image_url: string | null;
    } & {
        user: {
            id: string;
            display_name: string | null;
            oauth_providers: {
                email?: string | null | undefined;
                id: string;
                account_id: string;
            }[];
            profile_image_url: string | null;
            client_metadata: {} | null;
            client_read_only_metadata: {} | null;
            server_metadata: {} | null;
            primary_email: string | null;
            primary_email_verified: boolean;
            primary_email_auth_enabled: boolean;
            passkey_auth_enabled: boolean;
            otp_auth_enabled: boolean;
            selected_team_id: string | null;
            is_anonymous: boolean;
            selected_team: {
                client_metadata?: {} | null | undefined;
                client_read_only_metadata?: {} | null | undefined;
                server_metadata?: {} | null | undefined;
                id: string;
                display_name: string;
                created_at_millis: number;
                profile_image_url: string | null;
            } | null;
            signed_up_at_millis: number;
            has_password: boolean;
            last_active_at_millis: number;
            auth_with_email: boolean;
            requires_totp_mfa: boolean;
        };
    }, yup.AnyObject, {
        team_id: undefined;
        user_id: undefined;
        display_name: undefined;
        profile_image_url: undefined;
        user: {
            id: undefined;
            primary_email: undefined;
            primary_email_verified: undefined;
            primary_email_auth_enabled: undefined;
            display_name: undefined;
            selected_team: {
                id: undefined;
                display_name: undefined;
                profile_image_url: undefined;
                client_metadata: undefined;
                client_read_only_metadata: undefined;
                created_at_millis: undefined;
                server_metadata: undefined;
            };
            selected_team_id: undefined;
            profile_image_url: undefined;
            signed_up_at_millis: undefined;
            has_password: undefined;
            otp_auth_enabled: undefined;
            passkey_auth_enabled: undefined;
            client_metadata: undefined;
            client_read_only_metadata: undefined;
            server_metadata: undefined;
            last_active_at_millis: undefined;
            is_anonymous: undefined;
            oauth_providers: undefined;
            auth_with_email: undefined;
            requires_totp_mfa: undefined;
        };
    }, "">;
    clientUpdateSchema: yup.ObjectSchema<{
        display_name: string | undefined;
        profile_image_url: string | null | undefined;
    }, yup.AnyObject, {
        display_name: undefined;
        profile_image_url: undefined;
    }, "">;
    docs: {
        clientList: {
            summary: string;
            description: string;
            tags: string[];
        };
        serverList: {
            summary: string;
            description: string;
            tags: string[];
        };
        clientRead: {
            summary: string;
            description: string;
            tags: string[];
        };
        serverRead: {
            summary: string;
            description: string;
            tags: string[];
        };
        clientUpdate: {
            summary: string;
            description: string;
            tags: string[];
        };
        serverUpdate: {
            summary: string;
            description: string;
            tags: string[];
        };
    };
}>;
type TeamMemberProfilesCrud = CrudTypeOf<typeof teamMemberProfilesCrud>;

export { type TeamMemberProfilesCrud, teamMemberProfilesCrud, teamMemberProfilesCrudClientReadSchema, teamMemberProfilesCrudClientUpdateSchema, teamMemberProfilesCrudServerReadSchema };
