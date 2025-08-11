import { CrudSchemaFromOptions, CrudTypeOf } from '../../crud.mjs';
import * as yup from 'yup';
import '../../utils/types.mjs';

declare const sentEmailReadSchema: yup.ObjectSchema<{
    id: string;
    subject: string;
    sent_at_millis: number;
    to: string[] | undefined;
    sender_config: {
        host?: string | undefined;
        port?: number | undefined;
        username?: string | undefined;
        sender_name?: string | undefined;
        sender_email?: string | undefined;
        type: "shared" | "standard";
    };
    error: {} | null | undefined;
}, yup.AnyObject, {
    id: undefined;
    subject: undefined;
    sent_at_millis: undefined;
    to: undefined;
    sender_config: {
        type: undefined;
        host: undefined;
        port: undefined;
        username: undefined;
        password: undefined;
        sender_name: undefined;
        sender_email: undefined;
    };
    error: undefined;
}, "">;
declare const internalEmailsCrud: CrudSchemaFromOptions<{
    adminReadSchema: yup.ObjectSchema<{
        id: string;
        subject: string;
        sent_at_millis: number;
        to: string[] | undefined;
        sender_config: {
            host?: string | undefined;
            port?: number | undefined;
            username?: string | undefined;
            sender_name?: string | undefined;
            sender_email?: string | undefined;
            type: "shared" | "standard";
        };
        error: {} | null | undefined;
    }, yup.AnyObject, {
        id: undefined;
        subject: undefined;
        sent_at_millis: undefined;
        to: undefined;
        sender_config: {
            type: undefined;
            host: undefined;
            port: undefined;
            username: undefined;
            password: undefined;
            sender_name: undefined;
            sender_email: undefined;
        };
        error: undefined;
    }, "">;
}>;
type InternalEmailsCrud = CrudTypeOf<typeof internalEmailsCrud>;

export { type InternalEmailsCrud, internalEmailsCrud, sentEmailReadSchema };
