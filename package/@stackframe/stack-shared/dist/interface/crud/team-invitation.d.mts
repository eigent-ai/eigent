import { CrudSchemaFromOptions, CrudTypeOf } from '../../crud.mjs';
import * as yup from 'yup';
import '../../utils/types.mjs';

declare const teamInvitationDetailsClientReadSchema: yup.ObjectSchema<{
    id: string;
    team_id: string;
    expires_at_millis: number;
    recipient_email: string;
}, yup.AnyObject, {
    id: undefined;
    team_id: undefined;
    expires_at_millis: undefined;
    recipient_email: undefined;
}, "">;
declare const teamInvitationCrud: CrudSchemaFromOptions<{
    clientReadSchema: yup.ObjectSchema<{
        id: string;
        team_id: string;
        expires_at_millis: number;
        recipient_email: string;
    }, yup.AnyObject, {
        id: undefined;
        team_id: undefined;
        expires_at_millis: undefined;
        recipient_email: undefined;
    }, "">;
    clientDeleteSchema: yup.MixedSchema<any, yup.AnyObject, undefined, "">;
    docs: {
        clientRead: {
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
type TeamInvitationCrud = CrudTypeOf<typeof teamInvitationCrud>;

export { type TeamInvitationCrud, teamInvitationCrud, teamInvitationDetailsClientReadSchema };
