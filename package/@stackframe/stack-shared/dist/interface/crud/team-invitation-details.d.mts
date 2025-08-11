import { CrudSchemaFromOptions, CrudTypeOf } from '../../crud.mjs';
import * as yup from 'yup';
import '../../utils/types.mjs';

declare const teamInvitationDetailsClientReadSchema: yup.ObjectSchema<{
    team_id: string;
    team_display_name: string;
}, yup.AnyObject, {
    team_id: undefined;
    team_display_name: undefined;
}, "">;
declare const teamInvitationDetailsCrud: CrudSchemaFromOptions<{
    clientReadSchema: yup.ObjectSchema<{
        team_id: string;
        team_display_name: string;
    }, yup.AnyObject, {
        team_id: undefined;
        team_display_name: undefined;
    }, "">;
    docs: {
        clientRead: {
            summary: string;
            description: string;
            tags: string[];
        };
    };
}>;
type TeamInvitationDetailsCrud = CrudTypeOf<typeof teamInvitationDetailsCrud>;

export { type TeamInvitationDetailsCrud, teamInvitationDetailsClientReadSchema, teamInvitationDetailsCrud };
