import { CrudSchemaFromOptions, CrudTypeOf } from '../../crud.mjs';
import * as yup from 'yup';
import '../../utils/types.mjs';

declare const contactChannelsClientReadSchema: yup.ObjectSchema<{
    user_id: string;
    id: string;
    value: string;
    type: "email";
    used_for_auth: boolean;
    is_verified: boolean;
    is_primary: boolean;
}, yup.AnyObject, {
    user_id: undefined;
    id: undefined;
    value: undefined;
    type: undefined;
    used_for_auth: undefined;
    is_verified: undefined;
    is_primary: undefined;
}, "">;
declare const contactChannelsCrudClientUpdateSchema: yup.ObjectSchema<{
    value: string | undefined;
    type: "email" | undefined;
    used_for_auth: boolean | undefined;
    is_primary: boolean | undefined;
}, yup.AnyObject, {
    value: undefined;
    type: undefined;
    used_for_auth: undefined;
    is_primary: undefined;
}, "">;
declare const contactChannelsCrudServerUpdateSchema: yup.ObjectSchema<{
    value: string | undefined;
    type: "email" | undefined;
    used_for_auth: boolean | undefined;
    is_primary: boolean | undefined;
} & {
    is_verified: boolean | undefined;
}, yup.AnyObject, {
    value: undefined;
    type: undefined;
    used_for_auth: undefined;
    is_primary: undefined;
    is_verified: undefined;
}, "">;
declare const contactChannelsCrudClientCreateSchema: yup.ObjectSchema<{
    user_id: string;
    value: string;
    type: "email";
    used_for_auth: boolean;
    is_primary: boolean | undefined;
}, yup.AnyObject, {
    user_id: undefined;
    value: undefined;
    type: undefined;
    used_for_auth: undefined;
    is_primary: undefined;
}, "">;
declare const contactChannelsCrudServerCreateSchema: yup.ObjectSchema<{
    user_id: string;
    value: string;
    type: "email";
    used_for_auth: boolean;
    is_primary: boolean | undefined;
} & {
    is_verified: boolean | undefined;
}, yup.AnyObject, {
    user_id: undefined;
    value: undefined;
    type: undefined;
    used_for_auth: undefined;
    is_primary: undefined;
    is_verified: undefined;
}, "">;
declare const contactChannelsCrudClientDeleteSchema: yup.MixedSchema<{} | undefined, yup.AnyObject, undefined, "">;
declare const contactChannelsCrud: CrudSchemaFromOptions<{
    clientReadSchema: yup.ObjectSchema<{
        user_id: string;
        id: string;
        value: string;
        type: "email";
        used_for_auth: boolean;
        is_verified: boolean;
        is_primary: boolean;
    }, yup.AnyObject, {
        user_id: undefined;
        id: undefined;
        value: undefined;
        type: undefined;
        used_for_auth: undefined;
        is_verified: undefined;
        is_primary: undefined;
    }, "">;
    clientUpdateSchema: yup.ObjectSchema<{
        value: string | undefined;
        type: "email" | undefined;
        used_for_auth: boolean | undefined;
        is_primary: boolean | undefined;
    }, yup.AnyObject, {
        value: undefined;
        type: undefined;
        used_for_auth: undefined;
        is_primary: undefined;
    }, "">;
    clientCreateSchema: yup.ObjectSchema<{
        user_id: string;
        value: string;
        type: "email";
        used_for_auth: boolean;
        is_primary: boolean | undefined;
    }, yup.AnyObject, {
        user_id: undefined;
        value: undefined;
        type: undefined;
        used_for_auth: undefined;
        is_primary: undefined;
    }, "">;
    clientDeleteSchema: yup.MixedSchema<{} | undefined, yup.AnyObject, undefined, "">;
    serverUpdateSchema: yup.ObjectSchema<{
        value: string | undefined;
        type: "email" | undefined;
        used_for_auth: boolean | undefined;
        is_primary: boolean | undefined;
    } & {
        is_verified: boolean | undefined;
    }, yup.AnyObject, {
        value: undefined;
        type: undefined;
        used_for_auth: undefined;
        is_primary: undefined;
        is_verified: undefined;
    }, "">;
    serverCreateSchema: yup.ObjectSchema<{
        user_id: string;
        value: string;
        type: "email";
        used_for_auth: boolean;
        is_primary: boolean | undefined;
    } & {
        is_verified: boolean | undefined;
    }, yup.AnyObject, {
        user_id: undefined;
        value: undefined;
        type: undefined;
        used_for_auth: undefined;
        is_primary: undefined;
        is_verified: undefined;
    }, "">;
    docs: {
        clientRead: {
            summary: string;
            description: string;
            tags: string[];
        };
        clientCreate: {
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
        clientList: {
            summary: string;
            description: string;
            tags: string[];
        };
    };
}>;
type ContactChannelsCrud = CrudTypeOf<typeof contactChannelsCrud>;

export { type ContactChannelsCrud, contactChannelsClientReadSchema, contactChannelsCrud, contactChannelsCrudClientCreateSchema, contactChannelsCrudClientDeleteSchema, contactChannelsCrudClientUpdateSchema, contactChannelsCrudServerCreateSchema, contactChannelsCrudServerUpdateSchema };
