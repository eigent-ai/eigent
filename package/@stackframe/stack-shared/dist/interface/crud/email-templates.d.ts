import { CrudSchemaFromOptions, CrudTypeOf } from '../../crud.js';
import * as yup from 'yup';
import '../../utils/types.js';

type EmailTemplateType = typeof emailTemplateTypes[number];
declare const emailTemplateTypes: readonly ["email_verification", "password_reset", "magic_link", "team_invitation"];
declare const emailTemplateAdminReadSchema: yup.ObjectSchema<{
    type: "email_verification" | "password_reset" | "magic_link" | "team_invitation";
    subject: string;
    content: {} | null;
    is_default: boolean;
}, yup.AnyObject, {
    type: undefined;
    subject: undefined;
    content: undefined;
    is_default: undefined;
}, "">;
declare const emailTemplateCrudAdminUpdateSchema: yup.ObjectSchema<{
    content: {} | undefined;
    subject: string | undefined;
}, yup.AnyObject, {
    content: undefined;
    subject: undefined;
}, "">;
declare const emailTemplateCrudAdminDeleteSchema: yup.MixedSchema<{} | undefined, yup.AnyObject, undefined, "">;
declare const emailTemplateCrudAdminCreateSchema: yup.ObjectSchema<{
    type: "email_verification" | "password_reset" | "magic_link" | "team_invitation";
    content: {} | null;
    subject: string;
}, yup.AnyObject, {
    type: undefined;
    content: undefined;
    subject: undefined;
}, "">;
declare const emailTemplateCrud: CrudSchemaFromOptions<{
    adminReadSchema: yup.ObjectSchema<{
        type: "email_verification" | "password_reset" | "magic_link" | "team_invitation";
        subject: string;
        content: {} | null;
        is_default: boolean;
    }, yup.AnyObject, {
        type: undefined;
        subject: undefined;
        content: undefined;
        is_default: undefined;
    }, "">;
    adminUpdateSchema: yup.ObjectSchema<{
        content: {} | undefined;
        subject: string | undefined;
    }, yup.AnyObject, {
        content: undefined;
        subject: undefined;
    }, "">;
    adminCreateSchema: yup.ObjectSchema<{
        type: "email_verification" | "password_reset" | "magic_link" | "team_invitation";
        content: {} | null;
        subject: string;
    }, yup.AnyObject, {
        type: undefined;
        content: undefined;
        subject: undefined;
    }, "">;
    adminDeleteSchema: yup.MixedSchema<{} | undefined, yup.AnyObject, undefined, "">;
    docs: {
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
        adminList: {
            hidden: true;
        };
    };
}>;
type EmailTemplateCrud = CrudTypeOf<typeof emailTemplateCrud>;

export { type EmailTemplateCrud, type EmailTemplateType, emailTemplateAdminReadSchema, emailTemplateCrud, emailTemplateCrudAdminCreateSchema, emailTemplateCrudAdminDeleteSchema, emailTemplateCrudAdminUpdateSchema, emailTemplateTypes };
