import * as yup from 'yup';

type WebhookEvent<S extends yup.Schema> = {
    type: string;
    schema: S;
    metadata: {
        summary: string;
        description: string;
        tags?: string[];
    };
};
declare const webhookEvents: readonly [{
    type: string;
    schema: yup.ObjectSchema<{
        id: string;
        primary_email: string | null;
        primary_email_verified: boolean;
        primary_email_auth_enabled: boolean;
        display_name: string | null;
        selected_team: {
            client_metadata?: {} | null | undefined;
            client_read_only_metadata?: {} | null | undefined;
            server_metadata?: {} | null | undefined;
            id: string;
            display_name: string;
            created_at_millis: number;
            profile_image_url: string | null;
        } | null;
        selected_team_id: string | null;
        profile_image_url: string | null;
        signed_up_at_millis: number;
        has_password: boolean;
        otp_auth_enabled: boolean;
        passkey_auth_enabled: boolean;
        client_metadata: {} | null;
        client_read_only_metadata: {} | null;
        server_metadata: {} | null;
        last_active_at_millis: number;
        is_anonymous: boolean;
        oauth_providers: {
            email?: string | null | undefined;
            id: string;
            account_id: string;
        }[];
        auth_with_email: boolean;
        requires_totp_mfa: boolean;
    }, yup.AnyObject, {
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
    }, "">;
    metadata: {
        summary: string;
        description: string;
        tags: string[];
    };
}, {
    type: string;
    schema: yup.ObjectSchema<{
        id: string;
        primary_email: string | null;
        primary_email_verified: boolean;
        primary_email_auth_enabled: boolean;
        display_name: string | null;
        selected_team: {
            client_metadata?: {} | null | undefined;
            client_read_only_metadata?: {} | null | undefined;
            server_metadata?: {} | null | undefined;
            id: string;
            display_name: string;
            created_at_millis: number;
            profile_image_url: string | null;
        } | null;
        selected_team_id: string | null;
        profile_image_url: string | null;
        signed_up_at_millis: number;
        has_password: boolean;
        otp_auth_enabled: boolean;
        passkey_auth_enabled: boolean;
        client_metadata: {} | null;
        client_read_only_metadata: {} | null;
        server_metadata: {} | null;
        last_active_at_millis: number;
        is_anonymous: boolean;
        oauth_providers: {
            email?: string | null | undefined;
            id: string;
            account_id: string;
        }[];
        auth_with_email: boolean;
        requires_totp_mfa: boolean;
    }, yup.AnyObject, {
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
    }, "">;
    metadata: {
        summary: string;
        description: string;
        tags: string[];
    };
}, {
    type: string;
    schema: yup.ObjectSchema<{
        id: string;
        teams: {
            id: string;
        }[];
    }, yup.AnyObject, {
        id: undefined;
        teams: undefined;
    }, "">;
    metadata: {
        summary: string;
        description: string;
        tags: string[];
    };
}, {
    type: string;
    schema: yup.ObjectSchema<{
        id: string;
        display_name: string;
        profile_image_url: string | null;
        client_metadata: {} | null | undefined;
        client_read_only_metadata: {} | null | undefined;
    } & {
        created_at_millis: number;
        server_metadata: {} | null | undefined;
    }, yup.AnyObject, {
        id: undefined;
        display_name: undefined;
        profile_image_url: undefined;
        client_metadata: undefined;
        client_read_only_metadata: undefined;
        created_at_millis: undefined;
        server_metadata: undefined;
    }, "">;
    metadata: {
        summary: string;
        description: string;
        tags: string[];
    };
}, {
    type: string;
    schema: yup.ObjectSchema<{
        id: string;
        display_name: string;
        profile_image_url: string | null;
        client_metadata: {} | null | undefined;
        client_read_only_metadata: {} | null | undefined;
    } & {
        created_at_millis: number;
        server_metadata: {} | null | undefined;
    }, yup.AnyObject, {
        id: undefined;
        display_name: undefined;
        profile_image_url: undefined;
        client_metadata: undefined;
        client_read_only_metadata: undefined;
        created_at_millis: undefined;
        server_metadata: undefined;
    }, "">;
    metadata: {
        summary: string;
        description: string;
        tags: string[];
    };
}, {
    type: string;
    schema: yup.ObjectSchema<{
        id: string;
    }, yup.AnyObject, {
        id: undefined;
    }, "">;
    metadata: {
        summary: string;
        description: string;
        tags: string[];
    };
}, {
    type: string;
    schema: yup.ObjectSchema<{
        team_id: string;
        user_id: string;
    }, yup.AnyObject, {
        team_id: undefined;
        user_id: undefined;
    }, "">;
    metadata: {
        summary: string;
        description: string;
        tags: string[];
    };
}, {
    type: string;
    schema: yup.ObjectSchema<{
        team_id: string;
        user_id: string;
    }, yup.AnyObject, {
        team_id: undefined;
        user_id: undefined;
    }, "">;
    metadata: {
        summary: string;
        description: string;
        tags: string[];
    };
}, {
    type: string;
    schema: yup.ObjectSchema<{
        id: string;
        user_id: string;
        team_id: string;
    }, yup.AnyObject, {
        id: undefined;
        user_id: undefined;
        team_id: undefined;
    }, "">;
    metadata: {
        summary: string;
        description: string;
        tags: string[];
    };
}, {
    type: string;
    schema: yup.ObjectSchema<{
        id: string;
        user_id: string;
        team_id: string;
    }, yup.AnyObject, {
        id: undefined;
        user_id: undefined;
        team_id: undefined;
    }, "">;
    metadata: {
        summary: string;
        description: string;
        tags: string[];
    };
}];

export { type WebhookEvent, webhookEvents };
