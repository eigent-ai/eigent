import { CrudSchemaFromOptions, CrudTypeOf } from '../../crud.mjs';
import * as yup from 'yup';
import '../../utils/types.mjs';

declare const internalApiKeysCreateInputSchema: yup.ObjectSchema<{
    description: string;
    expires_at_millis: number;
    has_publishable_client_key: boolean;
    has_secret_server_key: boolean;
    has_super_secret_admin_key: boolean;
}, yup.AnyObject, {
    description: undefined;
    expires_at_millis: undefined;
    has_publishable_client_key: undefined;
    has_secret_server_key: undefined;
    has_super_secret_admin_key: undefined;
}, "">;
declare const internalApiKeysCreateOutputSchema: yup.ObjectSchema<{
    id: string;
    description: string;
    expires_at_millis: number;
    manually_revoked_at_millis: number | undefined;
    created_at_millis: number;
} & {
    publishable_client_key: string | undefined;
    secret_server_key: string | undefined;
    super_secret_admin_key: string | undefined;
}, yup.AnyObject, {
    id: undefined;
    description: undefined;
    expires_at_millis: undefined;
    manually_revoked_at_millis: undefined;
    created_at_millis: undefined;
    publishable_client_key: undefined;
    secret_server_key: undefined;
    super_secret_admin_key: undefined;
}, "">;
declare const internalApiKeysCrudAdminObfuscatedReadSchema: yup.ObjectSchema<{
    id: string;
    description: string;
    expires_at_millis: number;
    manually_revoked_at_millis: number | undefined;
    created_at_millis: number;
} & {
    publishable_client_key: {
        last_four: string;
    } | undefined;
    secret_server_key: {
        last_four: string;
    } | undefined;
    super_secret_admin_key: {
        last_four: string;
    } | undefined;
}, yup.AnyObject, {
    id: undefined;
    description: undefined;
    expires_at_millis: undefined;
    manually_revoked_at_millis: undefined;
    created_at_millis: undefined;
    publishable_client_key: {
        last_four: undefined;
    };
    secret_server_key: {
        last_four: undefined;
    };
    super_secret_admin_key: {
        last_four: undefined;
    };
}, "">;
declare const internalApiKeysCrudAdminUpdateSchema: yup.ObjectSchema<{
    description: string | undefined;
    revoked: boolean | undefined;
}, yup.AnyObject, {
    description: undefined;
    revoked: undefined;
}, "">;
declare const internalApiKeysCrudAdminDeleteSchema: yup.MixedSchema<{} | undefined, yup.AnyObject, undefined, "">;
declare const internalApiKeysCrud: CrudSchemaFromOptions<{
    adminReadSchema: yup.ObjectSchema<{
        id: string;
        description: string;
        expires_at_millis: number;
        manually_revoked_at_millis: number | undefined;
        created_at_millis: number;
    } & {
        publishable_client_key: {
            last_four: string;
        } | undefined;
        secret_server_key: {
            last_four: string;
        } | undefined;
        super_secret_admin_key: {
            last_four: string;
        } | undefined;
    }, yup.AnyObject, {
        id: undefined;
        description: undefined;
        expires_at_millis: undefined;
        manually_revoked_at_millis: undefined;
        created_at_millis: undefined;
        publishable_client_key: {
            last_four: undefined;
        };
        secret_server_key: {
            last_four: undefined;
        };
        super_secret_admin_key: {
            last_four: undefined;
        };
    }, "">;
    adminUpdateSchema: yup.ObjectSchema<{
        description: string | undefined;
        revoked: boolean | undefined;
    }, yup.AnyObject, {
        description: undefined;
        revoked: undefined;
    }, "">;
    adminDeleteSchema: yup.MixedSchema<{} | undefined, yup.AnyObject, undefined, "">;
    docs: {
        adminList: {
            hidden: true;
        };
        adminRead: {
            hidden: true;
        };
        adminCreate: {
            hidden: true;
        };
        adminUpdate: {
            hidden: true;
        };
        adminDelete: {
            hidden: true;
        };
    };
}>;
type InternalApiKeysCrud = CrudTypeOf<typeof internalApiKeysCrud>;

export { type InternalApiKeysCrud, internalApiKeysCreateInputSchema, internalApiKeysCreateOutputSchema, internalApiKeysCrud, internalApiKeysCrudAdminDeleteSchema, internalApiKeysCrudAdminObfuscatedReadSchema, internalApiKeysCrudAdminUpdateSchema };
