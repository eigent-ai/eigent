import { CrudSchemaFromOptions, CrudTypeOf } from '../../crud.js';
import * as yup from 'yup';
import '../../utils/types.js';

declare const userApiKeysCrud: CrudSchemaFromOptions<{
    clientReadSchema: yup.ObjectSchema<{
        id: string;
        description: string;
        expires_at_millis: number | undefined;
        manually_revoked_at_millis: number | undefined;
        created_at_millis: number;
        is_public: boolean;
        value: {
            last_four: string;
        };
        type: "user";
        user_id: string;
    }, yup.AnyObject, {
        id: undefined;
        description: undefined;
        expires_at_millis: undefined;
        manually_revoked_at_millis: undefined;
        created_at_millis: undefined;
        is_public: undefined;
        value: {
            last_four: undefined;
        };
        type: undefined;
        user_id: undefined;
    }, "">;
    clientUpdateSchema: yup.ObjectSchema<{
        description: string | undefined;
        revoked: boolean | undefined;
    }, yup.AnyObject, {
        description: undefined;
        revoked: undefined;
    }, "">;
    docs: {
        clientCreate: {
            description: string;
            displayName: string;
            tags: string[];
            summary: string;
        };
        clientList: {
            description: string;
            displayName: string;
            summary: string;
            tags: string[];
        };
        clientRead: {
            description: string;
            displayName: string;
            summary: string;
            tags: string[];
        };
        clientUpdate: {
            description: string;
            displayName: string;
            summary: string;
            tags: string[];
        };
        serverDelete: {
            description: string;
            displayName: string;
            summary: string;
            tags: string[];
        };
    };
}>;
declare const userApiKeysCreateInputSchema: yup.ObjectSchema<{
    description: string;
    expires_at_millis: number | null;
    is_public: boolean | undefined;
    user_id: string;
}, yup.AnyObject, {
    description: undefined;
    expires_at_millis: undefined;
    is_public: undefined;
    user_id: undefined;
}, "">;
declare const userApiKeysCreateOutputSchema: yup.ObjectSchema<{
    type: "user";
    description: string;
    id: string;
    created_at_millis: number;
    expires_at_millis: number | undefined;
    manually_revoked_at_millis: number | undefined;
    user_id: string;
    is_public: boolean;
} & {
    value: string;
}, yup.AnyObject, {
    id: undefined;
    description: undefined;
    expires_at_millis: undefined;
    manually_revoked_at_millis: undefined;
    created_at_millis: undefined;
    is_public: undefined;
    value: undefined;
    type: undefined;
    user_id: undefined;
}, "">;
type UserApiKeysCrud = CrudTypeOf<typeof userApiKeysCrud>;
declare const teamApiKeysCrud: CrudSchemaFromOptions<{
    clientReadSchema: yup.ObjectSchema<{
        id: string;
        description: string;
        expires_at_millis: number | undefined;
        manually_revoked_at_millis: number | undefined;
        created_at_millis: number;
        is_public: boolean;
        value: {
            last_four: string;
        };
        type: "team";
        team_id: string;
    }, yup.AnyObject, {
        id: undefined;
        description: undefined;
        expires_at_millis: undefined;
        manually_revoked_at_millis: undefined;
        created_at_millis: undefined;
        is_public: undefined;
        value: {
            last_four: undefined;
        };
        type: undefined;
        team_id: undefined;
    }, "">;
    clientUpdateSchema: yup.ObjectSchema<{
        description: string | undefined;
        revoked: boolean | undefined;
    }, yup.AnyObject, {
        description: undefined;
        revoked: undefined;
    }, "">;
    docs: {
        clientCreate: {
            description: string;
            displayName: string;
            tags: string[];
            summary: string;
        };
        clientList: {
            description: string;
            displayName: string;
            summary: string;
            tags: string[];
        };
        clientRead: {
            description: string;
            displayName: string;
            summary: string;
            tags: string[];
        };
        clientUpdate: {
            description: string;
            displayName: string;
            summary: string;
            tags: string[];
        };
        serverDelete: {
            description: string;
            displayName: string;
            summary: string;
            tags: string[];
        };
    };
}>;
declare const teamApiKeysCreateInputSchema: yup.ObjectSchema<{
    description: string;
    expires_at_millis: number | null;
    is_public: boolean | undefined;
    team_id: string;
}, yup.AnyObject, {
    description: undefined;
    expires_at_millis: undefined;
    is_public: undefined;
    team_id: undefined;
}, "">;
declare const teamApiKeysCreateOutputSchema: yup.ObjectSchema<{
    type: "team";
    description: string;
    id: string;
    created_at_millis: number;
    expires_at_millis: number | undefined;
    manually_revoked_at_millis: number | undefined;
    team_id: string;
    is_public: boolean;
} & {
    value: string;
}, yup.AnyObject, {
    id: undefined;
    description: undefined;
    expires_at_millis: undefined;
    manually_revoked_at_millis: undefined;
    created_at_millis: undefined;
    is_public: undefined;
    value: undefined;
    type: undefined;
    team_id: undefined;
}, "">;
type TeamApiKeysCrud = CrudTypeOf<typeof teamApiKeysCrud>;

export { type TeamApiKeysCrud, type UserApiKeysCrud, teamApiKeysCreateInputSchema, teamApiKeysCreateOutputSchema, teamApiKeysCrud, userApiKeysCreateInputSchema, userApiKeysCreateOutputSchema, userApiKeysCrud };
