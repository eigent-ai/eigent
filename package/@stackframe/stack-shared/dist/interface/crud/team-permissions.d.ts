import { CrudSchemaFromOptions, CrudTypeOf } from '../../crud.js';
import * as yup from 'yup';
import '../../utils/types.js';

declare const teamPermissionsCrudClientReadSchema: yup.ObjectSchema<{
    id: string;
    user_id: string;
    team_id: string;
}, yup.AnyObject, {
    id: undefined;
    user_id: undefined;
    team_id: undefined;
}, "">;
declare const teamPermissionsCrudServerCreateSchema: yup.ObjectSchema<{}, yup.AnyObject, {}, "">;
declare const teamPermissionsCrudServerDeleteSchema: yup.MixedSchema<{} | undefined, yup.AnyObject, undefined, "">;
declare const teamPermissionsCrud: CrudSchemaFromOptions<{
    clientReadSchema: yup.ObjectSchema<{
        id: string;
        user_id: string;
        team_id: string;
    }, yup.AnyObject, {
        id: undefined;
        user_id: undefined;
        team_id: undefined;
    }, "">;
    serverCreateSchema: yup.ObjectSchema<{}, yup.AnyObject, {}, "">;
    serverDeleteSchema: yup.MixedSchema<{} | undefined, yup.AnyObject, undefined, "">;
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
        serverCreate: {
            summary: string;
            description: string;
            tags: string[];
        };
        serverDelete: {
            summary: string;
            description: string;
            tags: string[];
        };
    };
}>;
type TeamPermissionsCrud = CrudTypeOf<typeof teamPermissionsCrud>;
declare const teamPermissionCreatedWebhookEvent: {
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
};
declare const teamPermissionDeletedWebhookEvent: {
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
};
declare const teamPermissionDefinitionsCrudAdminReadSchema: yup.ObjectSchema<{
    id: string;
    description: string | undefined;
    contained_permission_ids: string[];
}, yup.AnyObject, {
    id: undefined;
    description: undefined;
    contained_permission_ids: undefined;
}, "">;
declare const teamPermissionDefinitionsCrudAdminCreateSchema: yup.ObjectSchema<{
    id: string;
    description: string | undefined;
    contained_permission_ids: string[] | undefined;
}, yup.AnyObject, {
    id: undefined;
    description: undefined;
    contained_permission_ids: undefined;
}, "">;
declare const teamPermissionDefinitionsCrudAdminUpdateSchema: yup.ObjectSchema<{
    id: string | undefined;
    description: string | undefined;
    contained_permission_ids: string[] | undefined;
}, yup.AnyObject, {
    id: undefined;
    description: undefined;
    contained_permission_ids: undefined;
}, "">;
declare const teamPermissionDefinitionsCrudAdminDeleteSchema: yup.MixedSchema<{} | undefined, yup.AnyObject, undefined, "">;
declare const teamPermissionDefinitionsCrud: CrudSchemaFromOptions<{
    adminReadSchema: yup.ObjectSchema<{
        id: string;
        description: string | undefined;
        contained_permission_ids: string[];
    }, yup.AnyObject, {
        id: undefined;
        description: undefined;
        contained_permission_ids: undefined;
    }, "">;
    adminCreateSchema: yup.ObjectSchema<{
        id: string;
        description: string | undefined;
        contained_permission_ids: string[] | undefined;
    }, yup.AnyObject, {
        id: undefined;
        description: undefined;
        contained_permission_ids: undefined;
    }, "">;
    adminUpdateSchema: yup.ObjectSchema<{
        id: string | undefined;
        description: string | undefined;
        contained_permission_ids: string[] | undefined;
    }, yup.AnyObject, {
        id: undefined;
        description: undefined;
        contained_permission_ids: undefined;
    }, "">;
    adminDeleteSchema: yup.MixedSchema<{} | undefined, yup.AnyObject, undefined, "">;
    docs: {
        adminList: {
            summary: string;
            description: string;
            tags: string[];
        };
        adminCreate: {
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
type TeamPermissionDefinitionsCrud = CrudTypeOf<typeof teamPermissionDefinitionsCrud>;

export { type TeamPermissionDefinitionsCrud, type TeamPermissionsCrud, teamPermissionCreatedWebhookEvent, teamPermissionDefinitionsCrud, teamPermissionDefinitionsCrudAdminCreateSchema, teamPermissionDefinitionsCrudAdminDeleteSchema, teamPermissionDefinitionsCrudAdminReadSchema, teamPermissionDefinitionsCrudAdminUpdateSchema, teamPermissionDeletedWebhookEvent, teamPermissionsCrud, teamPermissionsCrudClientReadSchema, teamPermissionsCrudServerCreateSchema, teamPermissionsCrudServerDeleteSchema };
