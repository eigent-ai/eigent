import { CrudSchemaFromOptions, CrudTypeOf } from '../../crud.js';
import * as yup from 'yup';
import '../../utils/types.js';

declare const connectedAccountAccessTokenReadSchema: yup.ObjectSchema<{
    access_token: string;
}, yup.AnyObject, {
    access_token: undefined;
}, "">;
declare const connectedAccountAccessTokenCreateSchema: yup.ObjectSchema<{
    scope: string | undefined;
}, yup.AnyObject, {
    scope: undefined;
}, "">;
declare const connectedAccountAccessTokenCrud: CrudSchemaFromOptions<{
    clientReadSchema: yup.ObjectSchema<{
        access_token: string;
    }, yup.AnyObject, {
        access_token: undefined;
    }, "">;
    clientCreateSchema: yup.ObjectSchema<{
        scope: string | undefined;
    }, yup.AnyObject, {
        scope: undefined;
    }, "">;
    docs: {
        clientCreate: {
            hidden: true;
        };
    };
}>;
type ConnectedAccountAccessTokenCrud = CrudTypeOf<typeof connectedAccountAccessTokenCrud>;

export { type ConnectedAccountAccessTokenCrud, connectedAccountAccessTokenCreateSchema, connectedAccountAccessTokenCrud, connectedAccountAccessTokenReadSchema };
