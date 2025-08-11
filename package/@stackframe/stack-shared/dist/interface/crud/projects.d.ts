import { CrudSchemaFromOptions, CrudTypeOf } from '../../crud.js';
import * as yup from 'yup';
import '../../utils/types.js';

declare const emailConfigSchema: yup.ObjectSchema<{
    type: "shared" | "standard";
    host: string | undefined;
    port: number | undefined;
    username: string | undefined;
    password: string | undefined;
    sender_name: string | undefined;
    sender_email: string | undefined;
}, yup.AnyObject, {
    type: undefined;
    host: undefined;
    port: undefined;
    username: undefined;
    password: undefined;
    sender_name: undefined;
    sender_email: undefined;
}, "">;
declare const emailConfigWithoutPasswordSchema: yup.ObjectSchema<{
    type: "shared" | "standard";
    host: string | undefined;
    port: number | undefined;
    username: string | undefined;
    sender_name: string | undefined;
    sender_email: string | undefined;
}, yup.AnyObject, {
    type: undefined;
    host: undefined;
    port: undefined;
    username: undefined;
    password: undefined;
    sender_name: undefined;
    sender_email: undefined;
}, "">;
declare const projectsCrudAdminReadSchema: yup.ObjectSchema<{
    id: string;
    display_name: string;
    description: string;
    created_at_millis: number;
    user_count: number;
    is_production_mode: boolean;
    config: {
        allow_localhost: boolean;
        sign_up_enabled: boolean;
        credential_enabled: boolean;
        magic_link_enabled: boolean;
        passkey_enabled: boolean;
        client_team_creation_enabled: boolean;
        client_user_deletion_enabled: boolean;
        allow_user_api_keys: boolean;
        allow_team_api_keys: boolean;
        oauth_providers: {
            client_id?: string | undefined;
            client_secret?: string | undefined;
            facebook_config_id?: string | undefined;
            microsoft_tenant_id?: string | undefined;
            type: "shared" | "standard";
            id: "apple" | "x" | "google" | "github" | "microsoft" | "spotify" | "facebook" | "discord" | "gitlab" | "bitbucket" | "linkedin";
        }[];
        enabled_oauth_providers: {
            id: "apple" | "x" | "google" | "github" | "microsoft" | "spotify" | "facebook" | "discord" | "gitlab" | "bitbucket" | "linkedin";
        }[];
        domains: {
            domain: string;
            handler_path: string;
        }[];
        email_config: {
            host?: string | undefined;
            port?: number | undefined;
            username?: string | undefined;
            password?: string | undefined;
            sender_name?: string | undefined;
            sender_email?: string | undefined;
            type: "shared" | "standard";
        };
        create_team_on_sign_up: boolean;
        team_creator_default_permissions: {
            id: string;
        }[];
        team_member_default_permissions: {
            id: string;
        }[];
        user_default_permissions: {
            id: string;
        }[];
        oauth_account_merge_strategy: "link_method" | "raise_error" | "allow_duplicates";
    };
}, yup.AnyObject, {
    id: undefined;
    display_name: undefined;
    description: undefined;
    created_at_millis: undefined;
    user_count: undefined;
    is_production_mode: undefined;
    config: {
        allow_localhost: undefined;
        sign_up_enabled: undefined;
        credential_enabled: undefined;
        magic_link_enabled: undefined;
        passkey_enabled: undefined;
        client_team_creation_enabled: undefined;
        client_user_deletion_enabled: undefined;
        allow_user_api_keys: undefined;
        allow_team_api_keys: undefined;
        oauth_providers: undefined;
        enabled_oauth_providers: undefined;
        domains: undefined;
        email_config: {
            type: undefined;
            host: undefined;
            port: undefined;
            username: undefined;
            password: undefined;
            sender_name: undefined;
            sender_email: undefined;
        };
        create_team_on_sign_up: undefined;
        team_creator_default_permissions: undefined;
        team_member_default_permissions: undefined;
        user_default_permissions: undefined;
        oauth_account_merge_strategy: undefined;
    };
}, "">;
declare const projectsCrudClientReadSchema: yup.ObjectSchema<{
    id: string;
    display_name: string;
    config: {
        sign_up_enabled: boolean;
        credential_enabled: boolean;
        magic_link_enabled: boolean;
        passkey_enabled: boolean;
        client_team_creation_enabled: boolean;
        client_user_deletion_enabled: boolean;
        allow_user_api_keys: boolean;
        allow_team_api_keys: boolean;
        enabled_oauth_providers: {
            id: "apple" | "x" | "google" | "github" | "microsoft" | "spotify" | "facebook" | "discord" | "gitlab" | "bitbucket" | "linkedin";
        }[];
    };
}, yup.AnyObject, {
    id: undefined;
    display_name: undefined;
    config: {
        sign_up_enabled: undefined;
        credential_enabled: undefined;
        magic_link_enabled: undefined;
        passkey_enabled: undefined;
        client_team_creation_enabled: undefined;
        client_user_deletion_enabled: undefined;
        allow_user_api_keys: undefined;
        allow_team_api_keys: undefined;
        enabled_oauth_providers: undefined;
    };
}, "">;
declare const projectsCrudAdminUpdateSchema: yup.ObjectSchema<{
    display_name: string | undefined;
    description: string | null | undefined;
    is_production_mode: boolean | undefined;
    config: {
        allow_localhost?: boolean | undefined;
        sign_up_enabled?: boolean | undefined;
        credential_enabled?: boolean | undefined;
        magic_link_enabled?: boolean | undefined;
        passkey_enabled?: boolean | undefined;
        client_team_creation_enabled?: boolean | undefined;
        client_user_deletion_enabled?: boolean | undefined;
        allow_user_api_keys?: boolean | undefined;
        allow_team_api_keys?: boolean | undefined;
        oauth_providers?: {
            client_id?: string | undefined;
            client_secret?: string | undefined;
            facebook_config_id?: string | undefined;
            microsoft_tenant_id?: string | undefined;
            type: "shared" | "standard";
            id: "apple" | "x" | "google" | "github" | "microsoft" | "spotify" | "facebook" | "discord" | "gitlab" | "bitbucket" | "linkedin";
        }[] | undefined;
        domains?: {
            domain: string;
            handler_path: string;
        }[] | undefined;
        email_config?: {
            host?: string | undefined;
            port?: number | undefined;
            username?: string | undefined;
            password?: string | undefined;
            sender_name?: string | undefined;
            sender_email?: string | undefined;
            type: "shared" | "standard";
        } | undefined;
        create_team_on_sign_up?: boolean | undefined;
        team_creator_default_permissions?: {
            id: string;
        }[] | undefined;
        team_member_default_permissions?: {
            id: string;
        }[] | undefined;
        user_default_permissions?: {
            id: string;
        }[] | undefined;
        oauth_account_merge_strategy?: "link_method" | "raise_error" | "allow_duplicates" | undefined;
    } | undefined;
}, yup.AnyObject, {
    display_name: undefined;
    description: undefined;
    is_production_mode: undefined;
    config: undefined;
}, "">;
declare const projectsCrudAdminCreateSchema: yup.ObjectSchema<{
    display_name: string;
    description: string | null | undefined;
    is_production_mode: boolean | undefined;
    config: {
        allow_localhost?: boolean | undefined;
        sign_up_enabled?: boolean | undefined;
        credential_enabled?: boolean | undefined;
        magic_link_enabled?: boolean | undefined;
        passkey_enabled?: boolean | undefined;
        client_team_creation_enabled?: boolean | undefined;
        client_user_deletion_enabled?: boolean | undefined;
        allow_user_api_keys?: boolean | undefined;
        allow_team_api_keys?: boolean | undefined;
        oauth_providers?: {
            client_id?: string | undefined;
            client_secret?: string | undefined;
            facebook_config_id?: string | undefined;
            microsoft_tenant_id?: string | undefined;
            type: "shared" | "standard";
            id: "apple" | "x" | "google" | "github" | "microsoft" | "spotify" | "facebook" | "discord" | "gitlab" | "bitbucket" | "linkedin";
        }[] | undefined;
        domains?: {
            domain: string;
            handler_path: string;
        }[] | undefined;
        email_config?: {
            host?: string | undefined;
            port?: number | undefined;
            username?: string | undefined;
            password?: string | undefined;
            sender_name?: string | undefined;
            sender_email?: string | undefined;
            type: "shared" | "standard";
        } | undefined;
        create_team_on_sign_up?: boolean | undefined;
        team_creator_default_permissions?: {
            id: string;
        }[] | undefined;
        team_member_default_permissions?: {
            id: string;
        }[] | undefined;
        user_default_permissions?: {
            id: string;
        }[] | undefined;
        oauth_account_merge_strategy?: "link_method" | "raise_error" | "allow_duplicates" | undefined;
    } | undefined;
} & {
    display_name: string;
}, yup.AnyObject, {
    display_name: undefined;
    description: undefined;
    is_production_mode: undefined;
    config: undefined;
}, "">;
declare const projectsCrudAdminDeleteSchema: yup.MixedSchema<{} | undefined, yup.AnyObject, undefined, "">;
declare const clientProjectsCrud: CrudSchemaFromOptions<{
    clientReadSchema: yup.ObjectSchema<{
        id: string;
        display_name: string;
        config: {
            sign_up_enabled: boolean;
            credential_enabled: boolean;
            magic_link_enabled: boolean;
            passkey_enabled: boolean;
            client_team_creation_enabled: boolean;
            client_user_deletion_enabled: boolean;
            allow_user_api_keys: boolean;
            allow_team_api_keys: boolean;
            enabled_oauth_providers: {
                id: "apple" | "x" | "google" | "github" | "microsoft" | "spotify" | "facebook" | "discord" | "gitlab" | "bitbucket" | "linkedin";
            }[];
        };
    }, yup.AnyObject, {
        id: undefined;
        display_name: undefined;
        config: {
            sign_up_enabled: undefined;
            credential_enabled: undefined;
            magic_link_enabled: undefined;
            passkey_enabled: undefined;
            client_team_creation_enabled: undefined;
            client_user_deletion_enabled: undefined;
            allow_user_api_keys: undefined;
            allow_team_api_keys: undefined;
            enabled_oauth_providers: undefined;
        };
    }, "">;
    docs: {
        clientRead: {
            summary: string;
            description: string;
            tags: string[];
        };
    };
}>;
type ClientProjectsCrud = CrudTypeOf<typeof clientProjectsCrud>;
declare const projectsCrud: CrudSchemaFromOptions<{
    adminReadSchema: yup.ObjectSchema<{
        id: string;
        display_name: string;
        description: string;
        created_at_millis: number;
        user_count: number;
        is_production_mode: boolean;
        config: {
            allow_localhost: boolean;
            sign_up_enabled: boolean;
            credential_enabled: boolean;
            magic_link_enabled: boolean;
            passkey_enabled: boolean;
            client_team_creation_enabled: boolean;
            client_user_deletion_enabled: boolean;
            allow_user_api_keys: boolean;
            allow_team_api_keys: boolean;
            oauth_providers: {
                client_id?: string | undefined;
                client_secret?: string | undefined;
                facebook_config_id?: string | undefined;
                microsoft_tenant_id?: string | undefined;
                type: "shared" | "standard";
                id: "apple" | "x" | "google" | "github" | "microsoft" | "spotify" | "facebook" | "discord" | "gitlab" | "bitbucket" | "linkedin";
            }[];
            enabled_oauth_providers: {
                id: "apple" | "x" | "google" | "github" | "microsoft" | "spotify" | "facebook" | "discord" | "gitlab" | "bitbucket" | "linkedin";
            }[];
            domains: {
                domain: string;
                handler_path: string;
            }[];
            email_config: {
                host?: string | undefined;
                port?: number | undefined;
                username?: string | undefined;
                password?: string | undefined;
                sender_name?: string | undefined;
                sender_email?: string | undefined;
                type: "shared" | "standard";
            };
            create_team_on_sign_up: boolean;
            team_creator_default_permissions: {
                id: string;
            }[];
            team_member_default_permissions: {
                id: string;
            }[];
            user_default_permissions: {
                id: string;
            }[];
            oauth_account_merge_strategy: "link_method" | "raise_error" | "allow_duplicates";
        };
    }, yup.AnyObject, {
        id: undefined;
        display_name: undefined;
        description: undefined;
        created_at_millis: undefined;
        user_count: undefined;
        is_production_mode: undefined;
        config: {
            allow_localhost: undefined;
            sign_up_enabled: undefined;
            credential_enabled: undefined;
            magic_link_enabled: undefined;
            passkey_enabled: undefined;
            client_team_creation_enabled: undefined;
            client_user_deletion_enabled: undefined;
            allow_user_api_keys: undefined;
            allow_team_api_keys: undefined;
            oauth_providers: undefined;
            enabled_oauth_providers: undefined;
            domains: undefined;
            email_config: {
                type: undefined;
                host: undefined;
                port: undefined;
                username: undefined;
                password: undefined;
                sender_name: undefined;
                sender_email: undefined;
            };
            create_team_on_sign_up: undefined;
            team_creator_default_permissions: undefined;
            team_member_default_permissions: undefined;
            user_default_permissions: undefined;
            oauth_account_merge_strategy: undefined;
        };
    }, "">;
    adminUpdateSchema: yup.ObjectSchema<{
        display_name: string | undefined;
        description: string | null | undefined;
        is_production_mode: boolean | undefined;
        config: {
            allow_localhost?: boolean | undefined;
            sign_up_enabled?: boolean | undefined;
            credential_enabled?: boolean | undefined;
            magic_link_enabled?: boolean | undefined;
            passkey_enabled?: boolean | undefined;
            client_team_creation_enabled?: boolean | undefined;
            client_user_deletion_enabled?: boolean | undefined;
            allow_user_api_keys?: boolean | undefined;
            allow_team_api_keys?: boolean | undefined;
            oauth_providers?: {
                client_id?: string | undefined;
                client_secret?: string | undefined;
                facebook_config_id?: string | undefined;
                microsoft_tenant_id?: string | undefined;
                type: "shared" | "standard";
                id: "apple" | "x" | "google" | "github" | "microsoft" | "spotify" | "facebook" | "discord" | "gitlab" | "bitbucket" | "linkedin";
            }[] | undefined;
            domains?: {
                domain: string;
                handler_path: string;
            }[] | undefined;
            email_config?: {
                host?: string | undefined;
                port?: number | undefined;
                username?: string | undefined;
                password?: string | undefined;
                sender_name?: string | undefined;
                sender_email?: string | undefined;
                type: "shared" | "standard";
            } | undefined;
            create_team_on_sign_up?: boolean | undefined;
            team_creator_default_permissions?: {
                id: string;
            }[] | undefined;
            team_member_default_permissions?: {
                id: string;
            }[] | undefined;
            user_default_permissions?: {
                id: string;
            }[] | undefined;
            oauth_account_merge_strategy?: "link_method" | "raise_error" | "allow_duplicates" | undefined;
        } | undefined;
    }, yup.AnyObject, {
        display_name: undefined;
        description: undefined;
        is_production_mode: undefined;
        config: undefined;
    }, "">;
    adminDeleteSchema: yup.MixedSchema<{} | undefined, yup.AnyObject, undefined, "">;
    docs: {
        adminRead: {
            summary: string;
            description: string;
            tags: string[];
        };
        adminUpdate: {
            summary: string;
            description: string;
            tags: string[];
        };
        adminDelete: {
            summary: string;
            description: string;
            tags: string[];
        };
    };
}>;
type ProjectsCrud = CrudTypeOf<typeof projectsCrud>;
declare const adminUserProjectsCrud: CrudSchemaFromOptions<{
    clientReadSchema: yup.ObjectSchema<{
        id: string;
        display_name: string;
        description: string;
        created_at_millis: number;
        user_count: number;
        is_production_mode: boolean;
        config: {
            allow_localhost: boolean;
            sign_up_enabled: boolean;
            credential_enabled: boolean;
            magic_link_enabled: boolean;
            passkey_enabled: boolean;
            client_team_creation_enabled: boolean;
            client_user_deletion_enabled: boolean;
            allow_user_api_keys: boolean;
            allow_team_api_keys: boolean;
            oauth_providers: {
                client_id?: string | undefined;
                client_secret?: string | undefined;
                facebook_config_id?: string | undefined;
                microsoft_tenant_id?: string | undefined;
                type: "shared" | "standard";
                id: "apple" | "x" | "google" | "github" | "microsoft" | "spotify" | "facebook" | "discord" | "gitlab" | "bitbucket" | "linkedin";
            }[];
            enabled_oauth_providers: {
                id: "apple" | "x" | "google" | "github" | "microsoft" | "spotify" | "facebook" | "discord" | "gitlab" | "bitbucket" | "linkedin";
            }[];
            domains: {
                domain: string;
                handler_path: string;
            }[];
            email_config: {
                host?: string | undefined;
                port?: number | undefined;
                username?: string | undefined;
                password?: string | undefined;
                sender_name?: string | undefined;
                sender_email?: string | undefined;
                type: "shared" | "standard";
            };
            create_team_on_sign_up: boolean;
            team_creator_default_permissions: {
                id: string;
            }[];
            team_member_default_permissions: {
                id: string;
            }[];
            user_default_permissions: {
                id: string;
            }[];
            oauth_account_merge_strategy: "link_method" | "raise_error" | "allow_duplicates";
        };
    }, yup.AnyObject, {
        id: undefined;
        display_name: undefined;
        description: undefined;
        created_at_millis: undefined;
        user_count: undefined;
        is_production_mode: undefined;
        config: {
            allow_localhost: undefined;
            sign_up_enabled: undefined;
            credential_enabled: undefined;
            magic_link_enabled: undefined;
            passkey_enabled: undefined;
            client_team_creation_enabled: undefined;
            client_user_deletion_enabled: undefined;
            allow_user_api_keys: undefined;
            allow_team_api_keys: undefined;
            oauth_providers: undefined;
            enabled_oauth_providers: undefined;
            domains: undefined;
            email_config: {
                type: undefined;
                host: undefined;
                port: undefined;
                username: undefined;
                password: undefined;
                sender_name: undefined;
                sender_email: undefined;
            };
            create_team_on_sign_up: undefined;
            team_creator_default_permissions: undefined;
            team_member_default_permissions: undefined;
            user_default_permissions: undefined;
            oauth_account_merge_strategy: undefined;
        };
    }, "">;
    clientCreateSchema: yup.ObjectSchema<{
        display_name: string;
        description: string | null | undefined;
        is_production_mode: boolean | undefined;
        config: {
            allow_localhost?: boolean | undefined;
            sign_up_enabled?: boolean | undefined;
            credential_enabled?: boolean | undefined;
            magic_link_enabled?: boolean | undefined;
            passkey_enabled?: boolean | undefined;
            client_team_creation_enabled?: boolean | undefined;
            client_user_deletion_enabled?: boolean | undefined;
            allow_user_api_keys?: boolean | undefined;
            allow_team_api_keys?: boolean | undefined;
            oauth_providers?: {
                client_id?: string | undefined;
                client_secret?: string | undefined;
                facebook_config_id?: string | undefined;
                microsoft_tenant_id?: string | undefined;
                type: "shared" | "standard";
                id: "apple" | "x" | "google" | "github" | "microsoft" | "spotify" | "facebook" | "discord" | "gitlab" | "bitbucket" | "linkedin";
            }[] | undefined;
            domains?: {
                domain: string;
                handler_path: string;
            }[] | undefined;
            email_config?: {
                host?: string | undefined;
                port?: number | undefined;
                username?: string | undefined;
                password?: string | undefined;
                sender_name?: string | undefined;
                sender_email?: string | undefined;
                type: "shared" | "standard";
            } | undefined;
            create_team_on_sign_up?: boolean | undefined;
            team_creator_default_permissions?: {
                id: string;
            }[] | undefined;
            team_member_default_permissions?: {
                id: string;
            }[] | undefined;
            user_default_permissions?: {
                id: string;
            }[] | undefined;
            oauth_account_merge_strategy?: "link_method" | "raise_error" | "allow_duplicates" | undefined;
        } | undefined;
    } & {
        display_name: string;
    }, yup.AnyObject, {
        display_name: undefined;
        description: undefined;
        is_production_mode: undefined;
        config: undefined;
    }, "">;
    docs: {
        clientList: {
            hidden: true;
        };
        clientCreate: {
            hidden: true;
        };
    };
}>;
type AdminUserProjectsCrud = CrudTypeOf<typeof adminUserProjectsCrud>;

export { type AdminUserProjectsCrud, type ClientProjectsCrud, type ProjectsCrud, adminUserProjectsCrud, clientProjectsCrud, emailConfigSchema, emailConfigWithoutPasswordSchema, projectsCrud, projectsCrudAdminCreateSchema, projectsCrudAdminDeleteSchema, projectsCrudAdminReadSchema, projectsCrudAdminUpdateSchema, projectsCrudClientReadSchema };
