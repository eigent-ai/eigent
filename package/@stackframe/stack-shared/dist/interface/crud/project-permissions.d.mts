import { CrudSchemaFromOptions, CrudTypeOf } from '../../crud.mjs';
import * as yup from 'yup';
import '../../utils/types.mjs';

declare const projectPermissionsCrudClientReadSchema: yup.ObjectSchema<{
    id: string;
    user_id: string;
}, yup.AnyObject, {
    id: undefined;
    user_id: undefined;
}, "">;
declare const projectPermissionsCrudServerCreateSchema: yup.ObjectSchema<{}, yup.AnyObject, {}, "">;
declare const projectPermissionsCrudServerDeleteSchema: yup.MixedSchema<{} | undefined, yup.AnyObject, undefined, "">;
declare const projectPermissionsCrud: CrudSchemaFromOptions<{
    clientReadSchema: yup.ObjectSchema<{
        id: string;
        user_id: string;
    }, yup.AnyObject, {
        id: undefined;
        user_id: undefined;
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
type ProjectPermissionsCrud = CrudTypeOf<typeof projectPermissionsCrud>;
declare const projectPermissionCreatedWebhookEvent: {
    type: string;
    schema: yup.ObjectSchema<{
        id: string;
        user_id: string;
    }, yup.AnyObject, {
        id: undefined;
        user_id: undefined;
    }, "">;
    metadata: {
        summary: string;
        description: string;
        tags: string[];
    };
};
declare const projectPermissionDeletedWebhookEvent: {
    type: string;
    schema: yup.ObjectSchema<{
        id: string;
        user_id: string;
    }, yup.AnyObject, {
        id: undefined;
        user_id: undefined;
    }, "">;
    metadata: {
        summary: string;
        description: string;
        tags: string[];
    };
};
declare const projectPermissionDefinitionsCrudAdminReadSchema: yup.ObjectSchema<{
    id: string;
    description: string | undefined;
    contained_permission_ids: string[];
}, yup.AnyObject, {
    id: undefined;
    description: undefined;
    contained_permission_ids: undefined;
}, "">;
declare const projectPermissionDefinitionsCrudAdminCreateSchema: yup.ObjectSchema<{
    id: string;
    description: string | undefined;
    contained_permission_ids: string[] | undefined;
}, yup.AnyObject, {
    id: undefined;
    description: undefined;
    contained_permission_ids: undefined;
}, "">;
declare const projectPermissionDefinitionsCrudAdminUpdateSchema: yup.ObjectSchema<{
    id: string | undefined;
    description: string | undefined;
    contained_permission_ids: string[] | undefined;
}, yup.AnyObject, {
    id: undefined;
    description: undefined;
    contained_permission_ids: undefined;
}, "">;
declare const projectPermissionDefinitionsCrudAdminDeleteSchema: yup.MixedSchema<{} | undefined, yup.AnyObject, undefined, "">;
declare const projectPermissionDefinitionsCrud: CrudSchemaFromOptions<{
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
type ProjectPermissionDefinitionsCrud = CrudTypeOf<typeof projectPermissionDefinitionsCrud>;

export { type ProjectPermissionDefinitionsCrud, type ProjectPermissionsCrud, projectPermissionCreatedWebhookEvent, projectPermissionDefinitionsCrud, projectPermissionDefinitionsCrudAdminCreateSchema, projectPermissionDefinitionsCrudAdminDeleteSchema, projectPermissionDefinitionsCrudAdminReadSchema, projectPermissionDefinitionsCrudAdminUpdateSchema, projectPermissionDeletedWebhookEvent, projectPermissionsCrud, projectPermissionsCrudClientReadSchema, projectPermissionsCrudServerCreateSchema, projectPermissionsCrudServerDeleteSchema };
