import { CrudSchemaFromOptions, CrudTypeOf } from '../../crud.mjs';
import * as yup from 'yup';
import '../../utils/types.mjs';

declare const sessionsCrudServerCreateSchema: yup.ObjectSchema<{
    user_id: string;
    expires_in_millis: number;
    is_impersonation: boolean;
}, yup.AnyObject, {
    user_id: undefined;
    expires_in_millis: number;
    is_impersonation: false;
}, "">;
declare const sessionsCreateOutputSchema: yup.ObjectSchema<{
    refresh_token: string;
    access_token: string;
}, yup.AnyObject, {
    refresh_token: undefined;
    access_token: undefined;
}, "">;
declare const sessionsCrudReadSchema: yup.ObjectSchema<{
    id: string;
    user_id: string;
    created_at: number;
    is_impersonation: boolean;
    last_used_at: number | undefined;
    is_current_session: boolean | undefined;
    last_used_at_end_user_ip_info: {
        countryCode?: string | null | undefined;
        regionCode?: string | null | undefined;
        cityName?: string | null | undefined;
        latitude?: number | null | undefined;
        longitude?: number | null | undefined;
        tzIdentifier?: string | null | undefined;
        ip: string;
    } | undefined;
}, yup.AnyObject, {
    id: undefined;
    user_id: undefined;
    created_at: undefined;
    is_impersonation: undefined;
    last_used_at: undefined;
    is_current_session: undefined;
    last_used_at_end_user_ip_info: {
        ip: undefined;
        countryCode: undefined;
        regionCode: undefined;
        cityName: undefined;
        latitude: undefined;
        longitude: undefined;
        tzIdentifier: undefined;
    };
}, "">;
declare const sessionsCrudDeleteSchema: yup.MixedSchema<{} | undefined, yup.AnyObject, undefined, "">;
declare const sessionsCrud: CrudSchemaFromOptions<{
    serverReadSchema: yup.ObjectSchema<{
        id: string;
        user_id: string;
        created_at: number;
        is_impersonation: boolean;
        last_used_at: number | undefined;
        is_current_session: boolean | undefined;
        last_used_at_end_user_ip_info: {
            countryCode?: string | null | undefined;
            regionCode?: string | null | undefined;
            cityName?: string | null | undefined;
            latitude?: number | null | undefined;
            longitude?: number | null | undefined;
            tzIdentifier?: string | null | undefined;
            ip: string;
        } | undefined;
    }, yup.AnyObject, {
        id: undefined;
        user_id: undefined;
        created_at: undefined;
        is_impersonation: undefined;
        last_used_at: undefined;
        is_current_session: undefined;
        last_used_at_end_user_ip_info: {
            ip: undefined;
            countryCode: undefined;
            regionCode: undefined;
            cityName: undefined;
            latitude: undefined;
            longitude: undefined;
            tzIdentifier: undefined;
        };
    }, "">;
    serverDeleteSchema: yup.MixedSchema<{} | undefined, yup.AnyObject, undefined, "">;
    clientReadSchema: yup.ObjectSchema<{
        id: string;
        user_id: string;
        created_at: number;
        is_impersonation: boolean;
        last_used_at: number | undefined;
        is_current_session: boolean | undefined;
        last_used_at_end_user_ip_info: {
            countryCode?: string | null | undefined;
            regionCode?: string | null | undefined;
            cityName?: string | null | undefined;
            latitude?: number | null | undefined;
            longitude?: number | null | undefined;
            tzIdentifier?: string | null | undefined;
            ip: string;
        } | undefined;
    }, yup.AnyObject, {
        id: undefined;
        user_id: undefined;
        created_at: undefined;
        is_impersonation: undefined;
        last_used_at: undefined;
        is_current_session: undefined;
        last_used_at_end_user_ip_info: {
            ip: undefined;
            countryCode: undefined;
            regionCode: undefined;
            cityName: undefined;
            latitude: undefined;
            longitude: undefined;
            tzIdentifier: undefined;
        };
    }, "">;
    clientDeleteSchema: yup.MixedSchema<{} | undefined, yup.AnyObject, undefined, "">;
    docs: {
        serverList: {
            summary: string;
            description: string;
            tags: string[];
        };
        serverDelete: {
            summary: string;
            description: string;
            tags: string[];
        };
        clientList: {
            summary: string;
            description: string;
            tags: string[];
        };
        clientDelete: {
            summary: string;
            description: string;
            tags: string[];
        };
    };
}>;
type SessionsCrud = CrudTypeOf<typeof sessionsCrud>;

export { type SessionsCrud, sessionsCreateOutputSchema, sessionsCrud, sessionsCrudDeleteSchema, sessionsCrudReadSchema, sessionsCrudServerCreateSchema };
