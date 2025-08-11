import { CrudSchemaFromOptions, CrudTypeOf } from '../../crud.mjs';
import * as yup from 'yup';
import '../../utils/types.mjs';

declare const usersCrudServerUpdateSchema: yup.ObjectSchema<{
    display_name: string | null | undefined;
    profile_image_url: string | null | undefined;
    client_metadata: {} | null | undefined;
    client_read_only_metadata: {} | null | undefined;
    server_metadata: {} | null | undefined;
    primary_email: string | null | undefined;
    primary_email_verified: boolean | undefined;
    primary_email_auth_enabled: boolean | undefined;
    passkey_auth_enabled: boolean | undefined;
    password: string | null | undefined;
    password_hash: string | undefined;
    otp_auth_enabled: boolean | undefined;
    totp_secret_base64: string | null | undefined;
    selected_team_id: string | null | undefined;
    is_anonymous: boolean | undefined;
}, yup.AnyObject, {
    display_name: undefined;
    profile_image_url: undefined;
    client_metadata: undefined;
    client_read_only_metadata: undefined;
    server_metadata: undefined;
    primary_email: undefined;
    primary_email_verified: undefined;
    primary_email_auth_enabled: undefined;
    passkey_auth_enabled: undefined;
    password: undefined;
    password_hash: undefined;
    otp_auth_enabled: undefined;
    totp_secret_base64: undefined;
    selected_team_id: undefined;
    is_anonymous: undefined;
}, "">;
declare const usersCrudServerReadSchema: yup.ObjectSchema<{
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
declare const usersCrudServerCreateSchema: yup.ObjectSchema<{
    password: string | null | undefined;
    display_name: string | null | undefined;
    profile_image_url: string | null | undefined;
    client_metadata: {} | null | undefined;
    client_read_only_metadata: {} | null | undefined;
    server_metadata: {} | null | undefined;
    primary_email: string | null | undefined;
    primary_email_verified: boolean | undefined;
    primary_email_auth_enabled: boolean | undefined;
    passkey_auth_enabled: boolean | undefined;
    password_hash: string | undefined;
    otp_auth_enabled: boolean | undefined;
    totp_secret_base64: string | null | undefined;
    is_anonymous: boolean | undefined;
} & {
    oauth_providers: {
        id: string;
        account_id: string;
        email: string | null;
    }[] | undefined;
    is_anonymous: boolean | undefined;
}, yup.AnyObject, {
    display_name: undefined;
    profile_image_url: undefined;
    client_metadata: undefined;
    client_read_only_metadata: undefined;
    server_metadata: undefined;
    primary_email: undefined;
    primary_email_verified: undefined;
    primary_email_auth_enabled: undefined;
    passkey_auth_enabled: undefined;
    password: undefined;
    password_hash: undefined;
    otp_auth_enabled: undefined;
    totp_secret_base64: undefined;
    selected_team_id: undefined;
    is_anonymous: undefined;
    oauth_providers: undefined;
}, "">;
declare const usersCrudServerDeleteSchema: yup.MixedSchema<{} | undefined, yup.AnyObject, undefined, "">;
declare const usersCrud: CrudSchemaFromOptions<{
    serverReadSchema: yup.ObjectSchema<{
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
    serverUpdateSchema: yup.ObjectSchema<{
        display_name: string | null | undefined;
        profile_image_url: string | null | undefined;
        client_metadata: {} | null | undefined;
        client_read_only_metadata: {} | null | undefined;
        server_metadata: {} | null | undefined;
        primary_email: string | null | undefined;
        primary_email_verified: boolean | undefined;
        primary_email_auth_enabled: boolean | undefined;
        passkey_auth_enabled: boolean | undefined;
        password: string | null | undefined;
        password_hash: string | undefined;
        otp_auth_enabled: boolean | undefined;
        totp_secret_base64: string | null | undefined;
        selected_team_id: string | null | undefined;
        is_anonymous: boolean | undefined;
    }, yup.AnyObject, {
        display_name: undefined;
        profile_image_url: undefined;
        client_metadata: undefined;
        client_read_only_metadata: undefined;
        server_metadata: undefined;
        primary_email: undefined;
        primary_email_verified: undefined;
        primary_email_auth_enabled: undefined;
        passkey_auth_enabled: undefined;
        password: undefined;
        password_hash: undefined;
        otp_auth_enabled: undefined;
        totp_secret_base64: undefined;
        selected_team_id: undefined;
        is_anonymous: undefined;
    }, "">;
    serverCreateSchema: yup.ObjectSchema<{
        password: string | null | undefined;
        display_name: string | null | undefined;
        profile_image_url: string | null | undefined;
        client_metadata: {} | null | undefined;
        client_read_only_metadata: {} | null | undefined;
        server_metadata: {} | null | undefined;
        primary_email: string | null | undefined;
        primary_email_verified: boolean | undefined;
        primary_email_auth_enabled: boolean | undefined;
        passkey_auth_enabled: boolean | undefined;
        password_hash: string | undefined;
        otp_auth_enabled: boolean | undefined;
        totp_secret_base64: string | null | undefined;
        is_anonymous: boolean | undefined;
    } & {
        oauth_providers: {
            id: string;
            account_id: string;
            email: string | null;
        }[] | undefined;
        is_anonymous: boolean | undefined;
    }, yup.AnyObject, {
        display_name: undefined;
        profile_image_url: undefined;
        client_metadata: undefined;
        client_read_only_metadata: undefined;
        server_metadata: undefined;
        primary_email: undefined;
        primary_email_verified: undefined;
        primary_email_auth_enabled: undefined;
        passkey_auth_enabled: undefined;
        password: undefined;
        password_hash: undefined;
        otp_auth_enabled: undefined;
        totp_secret_base64: undefined;
        selected_team_id: undefined;
        is_anonymous: undefined;
        oauth_providers: undefined;
    }, "">;
    serverDeleteSchema: yup.MixedSchema<{} | undefined, yup.AnyObject, undefined, "">;
    docs: {
        serverCreate: {
            tags: string[];
            summary: string;
            description: string;
        };
        serverRead: {
            tags: string[];
            summary: string;
            description: string;
        };
        serverUpdate: {
            tags: string[];
            summary: string;
            description: string;
        };
        serverDelete: {
            tags: string[];
            summary: string;
            description: string;
        };
        serverList: {
            tags: string[];
            summary: string;
            description: string;
        };
    };
}>;
type UsersCrud = CrudTypeOf<typeof usersCrud>;
declare const userCreatedWebhookEvent: {
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
};
declare const userUpdatedWebhookEvent: {
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
};
declare const userDeletedWebhookEvent: {
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
};

export { type UsersCrud, userCreatedWebhookEvent, userDeletedWebhookEvent, userUpdatedWebhookEvent, usersCrud, usersCrudServerCreateSchema, usersCrudServerDeleteSchema, usersCrudServerReadSchema, usersCrudServerUpdateSchema };
