import { CrudSchemaFromOptions, CrudTypeOf } from '../../crud.mjs';
import * as yup from 'yup';
import '../../utils/types.mjs';

declare const teamsCrudClientReadSchema: yup.ObjectSchema<{
    id: string;
    display_name: string;
    profile_image_url: string | null;
    client_metadata: {} | null | undefined;
    client_read_only_metadata: {} | null | undefined;
}, yup.AnyObject, {
    id: undefined;
    display_name: undefined;
    profile_image_url: undefined;
    client_metadata: undefined;
    client_read_only_metadata: undefined;
}, "">;
declare const teamsCrudServerReadSchema: yup.ObjectSchema<{
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
declare const teamsCrudClientUpdateSchema: yup.ObjectSchema<{
    display_name: string | undefined;
    profile_image_url: string | null | undefined;
    client_metadata: {} | null | undefined;
}, yup.AnyObject, {
    display_name: undefined;
    profile_image_url: undefined;
    client_metadata: undefined;
}, "">;
declare const teamsCrudServerUpdateSchema: yup.ObjectSchema<{
    display_name: string | undefined;
    profile_image_url: string | null | undefined;
    client_metadata: {} | null | undefined;
} & {
    client_read_only_metadata: {} | null | undefined;
    server_metadata: {} | null | undefined;
}, yup.AnyObject, {
    display_name: undefined;
    profile_image_url: undefined;
    client_metadata: undefined;
    client_read_only_metadata: undefined;
    server_metadata: undefined;
}, "">;
declare const teamsCrudClientCreateSchema: yup.ObjectSchema<{
    display_name: string;
    profile_image_url: string | null | undefined;
    client_metadata: {} | null | undefined;
} & {
    display_name: string;
    creator_user_id: string | undefined;
}, yup.AnyObject, {
    display_name: undefined;
    profile_image_url: undefined;
    client_metadata: undefined;
    creator_user_id: undefined;
}, "">;
declare const teamsCrudServerCreateSchema: yup.ObjectSchema<{
    display_name: string;
    profile_image_url: string | null | undefined;
    client_metadata: {} | null | undefined;
    client_read_only_metadata: {} | null | undefined;
    server_metadata: {} | null | undefined;
} & {
    display_name: string;
    creator_user_id: string | undefined;
}, yup.AnyObject, {
    display_name: undefined;
    profile_image_url: undefined;
    client_metadata: undefined;
    client_read_only_metadata: undefined;
    server_metadata: undefined;
    creator_user_id: undefined;
}, "">;
declare const teamsCrudClientDeleteSchema: yup.MixedSchema<{} | undefined, yup.AnyObject, undefined, "">;
declare const teamsCrudServerDeleteSchema: yup.MixedSchema<{} | undefined, yup.AnyObject, undefined, "">;
declare const teamsCrud: CrudSchemaFromOptions<{
    clientReadSchema: yup.ObjectSchema<{
        id: string;
        display_name: string;
        profile_image_url: string | null;
        client_metadata: {} | null | undefined;
        client_read_only_metadata: {} | null | undefined;
    }, yup.AnyObject, {
        id: undefined;
        display_name: undefined;
        profile_image_url: undefined;
        client_metadata: undefined;
        client_read_only_metadata: undefined;
    }, "">;
    clientUpdateSchema: yup.ObjectSchema<{
        display_name: string | undefined;
        profile_image_url: string | null | undefined;
        client_metadata: {} | null | undefined;
    }, yup.AnyObject, {
        display_name: undefined;
        profile_image_url: undefined;
        client_metadata: undefined;
    }, "">;
    clientCreateSchema: yup.ObjectSchema<{
        display_name: string;
        profile_image_url: string | null | undefined;
        client_metadata: {} | null | undefined;
    } & {
        display_name: string;
        creator_user_id: string | undefined;
    }, yup.AnyObject, {
        display_name: undefined;
        profile_image_url: undefined;
        client_metadata: undefined;
        creator_user_id: undefined;
    }, "">;
    clientDeleteSchema: yup.MixedSchema<{} | undefined, yup.AnyObject, undefined, "">;
    serverReadSchema: yup.ObjectSchema<{
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
    serverUpdateSchema: yup.ObjectSchema<{
        display_name: string | undefined;
        profile_image_url: string | null | undefined;
        client_metadata: {} | null | undefined;
    } & {
        client_read_only_metadata: {} | null | undefined;
        server_metadata: {} | null | undefined;
    }, yup.AnyObject, {
        display_name: undefined;
        profile_image_url: undefined;
        client_metadata: undefined;
        client_read_only_metadata: undefined;
        server_metadata: undefined;
    }, "">;
    serverCreateSchema: yup.ObjectSchema<{
        display_name: string;
        profile_image_url: string | null | undefined;
        client_metadata: {} | null | undefined;
        client_read_only_metadata: {} | null | undefined;
        server_metadata: {} | null | undefined;
    } & {
        display_name: string;
        creator_user_id: string | undefined;
    }, yup.AnyObject, {
        display_name: undefined;
        profile_image_url: undefined;
        client_metadata: undefined;
        client_read_only_metadata: undefined;
        server_metadata: undefined;
        creator_user_id: undefined;
    }, "">;
    serverDeleteSchema: yup.MixedSchema<{} | undefined, yup.AnyObject, undefined, "">;
    docs: {
        clientList: {
            summary: string;
            description: string;
            tags: string[];
        };
        clientCreate: {
            summary: string;
            description: string;
            tags: string[];
        };
        clientRead: {
            summary: string;
            description: string;
            tags: string[];
        };
        clientUpdate: {
            summary: string;
            description: string;
            tags: string[];
        };
        clientDelete: {
            summary: string;
            description: string;
            tags: string[];
        };
        serverCreate: {
            summary: string;
            description: string;
            tags: string[];
        };
        serverList: {
            summary: string;
            description: string;
            tags: string[];
        };
        serverRead: {
            summary: string;
            description: string;
            tags: string[];
        };
        serverUpdate: {
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
type TeamsCrud = CrudTypeOf<typeof teamsCrud>;
declare const teamCreatedWebhookEvent: {
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
};
declare const teamUpdatedWebhookEvent: {
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
};
declare const teamDeletedWebhookEvent: {
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
};

export { type TeamsCrud, teamCreatedWebhookEvent, teamDeletedWebhookEvent, teamUpdatedWebhookEvent, teamsCrud, teamsCrudClientCreateSchema, teamsCrudClientDeleteSchema, teamsCrudClientReadSchema, teamsCrudClientUpdateSchema, teamsCrudServerCreateSchema, teamsCrudServerDeleteSchema, teamsCrudServerReadSchema, teamsCrudServerUpdateSchema };
