import { CrudSchemaFromOptions, CrudTypeOf } from '../../crud.js';
import * as yup from 'yup';
import '../../utils/types.js';

declare const svixTokenAdminReadSchema: yup.ObjectSchema<{
    token: string;
}, yup.AnyObject, {
    token: undefined;
}, "">;
declare const svixTokenAdminCreateSchema: yup.ObjectSchema<{}, yup.AnyObject, {}, "">;
declare const svixTokenCrud: CrudSchemaFromOptions<{
    adminReadSchema: yup.ObjectSchema<{
        token: string;
    }, yup.AnyObject, {
        token: undefined;
    }, "">;
    adminCreateSchema: yup.ObjectSchema<{}, yup.AnyObject, {}, "">;
    docs: {
        adminCreate: {
            hidden: true;
        };
    };
}>;
type SvixTokenCrud = CrudTypeOf<typeof svixTokenCrud>;

export { type SvixTokenCrud, svixTokenAdminCreateSchema, svixTokenAdminReadSchema, svixTokenCrud };
