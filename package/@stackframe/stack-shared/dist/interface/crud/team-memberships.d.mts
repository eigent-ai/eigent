import { CrudSchemaFromOptions, CrudTypeOf } from '../../crud.mjs';
import * as yup from 'yup';
import '../../utils/types.mjs';

declare const teamMembershipsCrudClientReadSchema: yup.ObjectSchema<{
    team_id: string;
    user_id: string;
}, yup.AnyObject, {
    team_id: undefined;
    user_id: undefined;
}, "">;
declare const teamMembershipsCrudServerCreateSchema: yup.ObjectSchema<{}, yup.AnyObject, {}, "">;
declare const teamMembershipsCrudClientDeleteSchema: yup.MixedSchema<{} | undefined, yup.AnyObject, undefined, "">;
declare const teamMembershipsCrud: CrudSchemaFromOptions<{
    clientReadSchema: yup.ObjectSchema<{
        team_id: string;
        user_id: string;
    }, yup.AnyObject, {
        team_id: undefined;
        user_id: undefined;
    }, "">;
    clientDeleteSchema: yup.MixedSchema<{} | undefined, yup.AnyObject, undefined, "">;
    serverCreateSchema: yup.ObjectSchema<{}, yup.AnyObject, {}, "">;
    docs: {
        serverCreate: {
            summary: string;
            description: string;
            tags: string[];
        };
        clientDelete: {
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
type TeamMembershipsCrud = CrudTypeOf<typeof teamMembershipsCrud>;
declare const teamMembershipCreatedWebhookEvent: {
    type: string;
    schema: yup.ObjectSchema<{
        team_id: string;
        user_id: string;
    }, yup.AnyObject, {
        team_id: undefined;
        user_id: undefined;
    }, "">;
    metadata: {
        summary: string;
        description: string;
        tags: string[];
    };
};
declare const teamMembershipDeletedWebhookEvent: {
    type: string;
    schema: yup.ObjectSchema<{
        team_id: string;
        user_id: string;
    }, yup.AnyObject, {
        team_id: undefined;
        user_id: undefined;
    }, "">;
    metadata: {
        summary: string;
        description: string;
        tags: string[];
    };
};

export { type TeamMembershipsCrud, teamMembershipCreatedWebhookEvent, teamMembershipDeletedWebhookEvent, teamMembershipsCrud, teamMembershipsCrudClientDeleteSchema, teamMembershipsCrudClientReadSchema, teamMembershipsCrudServerCreateSchema };
