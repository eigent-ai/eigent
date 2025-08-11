import * as yup from 'yup';

declare module "yup" {
    interface StringSchema<TType, TContext, TDefault, TFlags> {
        nonEmpty(message?: string): StringSchema<TType, TContext, TDefault, TFlags>;
        empty(): StringSchema<TType, TContext, TDefault, TFlags>;
    }
    interface Schema<TType, TContext, TDefault, TFlags> {
        getNested<K extends keyof NonNullable<TType>>(path: K): yup.Schema<NonNullable<TType>[K], TContext, TDefault, TFlags>;
        concat<U extends yup.AnySchema>(schema: U): yup.Schema<Omit<NonNullable<TType>, keyof yup.InferType<U>> & yup.InferType<U> | (TType & (null | undefined)), TContext, TDefault, TFlags>;
    }
}
declare function yupValidate<S extends yup.ISchema<any>>(schema: S, obj: unknown, options?: yup.ValidateOptions & {
    currentUserId?: string | null;
}): Promise<yup.InferType<S>>;
declare const StackAdaptSentinel: unique symbol;
type StackAdaptSentinel = typeof StackAdaptSentinel;
declare function yupString<A extends string, B extends yup.Maybe<yup.AnyObject> = yup.AnyObject>(...args: Parameters<typeof yup.string<A, B>>): yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare function yupNumber<A extends number, B extends yup.Maybe<yup.AnyObject> = yup.AnyObject>(...args: Parameters<typeof yup.number<A, B>>): yup.NumberSchema<number | undefined, yup.AnyObject, undefined, "">;
declare function yupBoolean<A extends boolean, B extends yup.Maybe<yup.AnyObject> = yup.AnyObject>(...args: Parameters<typeof yup.boolean<A, B>>): yup.BooleanSchema<boolean | undefined, yup.AnyObject, undefined, "">;
/**
 * @deprecated, use number of milliseconds since epoch instead
 */
declare function yupDate<A extends Date, B extends yup.Maybe<yup.AnyObject> = yup.AnyObject>(...args: Parameters<typeof yup.date<A, B>>): yup.DateSchema<Date | undefined, yup.AnyObject, undefined, "">;
declare function yupMixed<A extends {}>(...args: Parameters<typeof yup.mixed<A>>): yup.MixedSchema<A | undefined, yup.AnyObject, undefined, "">;
declare function yupArray<A extends yup.Maybe<yup.AnyObject> = yup.AnyObject, B = any>(...args: Parameters<typeof yup.array<A, B>>): yup.ArraySchema<B[] | undefined, A, undefined, "">;
declare function yupTuple<T extends [unknown, ...unknown[]]>(...args: Parameters<typeof yup.tuple<T>>): yup.TupleSchema<T | undefined, yup.AnyObject, undefined, "">;
declare function yupObject<A extends yup.Maybe<yup.AnyObject>, B extends yup.ObjectShape>(...args: Parameters<typeof yup.object<A, B>>): yup.ObjectSchema<yup.TypeFromShape<B, yup.AnyObject> extends infer T ? T extends yup.TypeFromShape<B, yup.AnyObject> ? T extends {} ? { [k in keyof T]: T[k]; } : T : never : never, yup.AnyObject, yup.DefaultFromShape<B> extends infer T_1 ? T_1 extends yup.DefaultFromShape<B> ? T_1 extends {} ? { [k_1 in keyof T_1]: T_1[k_1]; } : T_1 : never : never, "">;
declare function yupNever(): yup.MixedSchema<never>;
declare function yupUnion<T extends yup.ISchema<any>[]>(...args: T): yup.MixedSchema<yup.InferType<T[number]>>;
declare function yupRecord<K extends yup.StringSchema, T extends yup.AnySchema>(keySchema: K, valueSchema: T): yup.MixedSchema<Record<string, yup.InferType<T>>>;
declare function ensureObjectSchema<T extends yup.AnyObject>(schema: yup.Schema<T>): yup.ObjectSchema<T> & typeof schema;
declare const adaptSchema: yup.MixedSchema<typeof StackAdaptSentinel | undefined, yup.AnyObject, undefined, "">;
/**
 * Yup's URL schema does not recognize some URLs (including `http://localhost`) as a valid URL. This schema is a workaround for that.
 */
declare const urlSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const jsonSchema: yup.MixedSchema<{} | null, yup.AnyObject, undefined, "">;
declare const jsonStringSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const jsonStringOrEmptySchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const base64Schema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const passwordSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
/**
 * A stricter email schema that does some additional checks for UX input. (Some emails are allowed by the spec, for
 * example `test@localhost` or `abc@gmail`, but almost certainly a user input error.)
 *
 * Note that some users in the DB have an email that doesn't match this regex, so most of the time you should use
 * `emailSchema` instead until we do the DB migration.
 */
declare const strictEmailSchema: (message: string | undefined) => yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const emailSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const clientOrHigherAuthTypeSchema: yup.StringSchema<"client" | "server" | "admin", yup.AnyObject, undefined, "">;
declare const serverOrHigherAuthTypeSchema: yup.StringSchema<"server" | "admin", yup.AnyObject, undefined, "">;
declare const adminAuthTypeSchema: yup.StringSchema<"admin", yup.AnyObject, undefined, "">;
declare const projectIdSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const projectBranchIdSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const projectDisplayNameSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const projectDescriptionSchema: yup.StringSchema<string | null | undefined, yup.AnyObject, undefined, "">;
declare const projectCreatedAtMillisSchema: yup.NumberSchema<number | undefined, yup.AnyObject, undefined, "">;
declare const projectUserCountSchema: yup.NumberSchema<number | undefined, yup.AnyObject, undefined, "">;
declare const projectIsProductionModeSchema: yup.BooleanSchema<boolean | undefined, yup.AnyObject, undefined, "">;
declare const projectConfigIdSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const projectAllowLocalhostSchema: yup.BooleanSchema<boolean | undefined, yup.AnyObject, undefined, "">;
declare const projectCreateTeamOnSignUpSchema: yup.BooleanSchema<boolean | undefined, yup.AnyObject, undefined, "">;
declare const projectMagicLinkEnabledSchema: yup.BooleanSchema<boolean | undefined, yup.AnyObject, undefined, "">;
declare const projectPasskeyEnabledSchema: yup.BooleanSchema<boolean | undefined, yup.AnyObject, undefined, "">;
declare const projectClientTeamCreationEnabledSchema: yup.BooleanSchema<boolean | undefined, yup.AnyObject, undefined, "">;
declare const projectClientUserDeletionEnabledSchema: yup.BooleanSchema<boolean | undefined, yup.AnyObject, undefined, "">;
declare const projectSignUpEnabledSchema: yup.BooleanSchema<boolean | undefined, yup.AnyObject, undefined, "">;
declare const projectCredentialEnabledSchema: yup.BooleanSchema<boolean | undefined, yup.AnyObject, undefined, "">;
declare const oauthIdSchema: yup.StringSchema<"apple" | "x" | "google" | "github" | "microsoft" | "spotify" | "facebook" | "discord" | "gitlab" | "bitbucket" | "linkedin" | undefined, yup.AnyObject, undefined, "">;
declare const oauthEnabledSchema: yup.BooleanSchema<boolean | undefined, yup.AnyObject, undefined, "">;
declare const oauthTypeSchema: yup.StringSchema<"shared" | "standard" | undefined, yup.AnyObject, undefined, "">;
declare const oauthClientIdSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const oauthClientSecretSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const oauthFacebookConfigIdSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const oauthMicrosoftTenantIdSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const oauthAccountMergeStrategySchema: yup.StringSchema<"link_method" | "raise_error" | "allow_duplicates" | undefined, yup.AnyObject, undefined, "">;
declare const emailTypeSchema: yup.StringSchema<"shared" | "standard" | undefined, yup.AnyObject, undefined, "">;
declare const emailSenderNameSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const emailHostSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const emailPortSchema: yup.NumberSchema<number | undefined, yup.AnyObject, undefined, "">;
declare const emailUsernameSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const emailSenderEmailSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const emailPasswordSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const handlerPathSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare class ReplaceFieldWithOwnUserId extends Error {
    readonly path: string;
    constructor(path: string);
}
declare const userIdOrMeSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const userIdSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const primaryEmailSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const primaryEmailAuthEnabledSchema: yup.BooleanSchema<boolean | undefined, yup.AnyObject, undefined, "">;
declare const primaryEmailVerifiedSchema: yup.BooleanSchema<boolean | undefined, yup.AnyObject, undefined, "">;
declare const userDisplayNameSchema: yup.StringSchema<string | null | undefined, yup.AnyObject, undefined, "">;
declare const selectedTeamIdSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const profileImageUrlSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const signedUpAtMillisSchema: yup.NumberSchema<number | undefined, yup.AnyObject, undefined, "">;
declare const userClientMetadataSchema: yup.MixedSchema<{} | null, yup.AnyObject, undefined, "">;
declare const userClientReadOnlyMetadataSchema: yup.MixedSchema<{} | null, yup.AnyObject, undefined, "">;
declare const userServerMetadataSchema: yup.MixedSchema<{} | null, yup.AnyObject, undefined, "">;
declare const userOAuthProviderSchema: yup.ObjectSchema<{
    id: string;
    type: "apple" | "x" | "google" | "github" | "microsoft" | "spotify" | "facebook" | "discord" | "gitlab" | "bitbucket" | "linkedin";
    provider_user_id: string;
}, yup.AnyObject, {
    id: undefined;
    type: undefined;
    provider_user_id: undefined;
}, "">;
declare const userLastActiveAtMillisSchema: yup.NumberSchema<number | null | undefined, yup.AnyObject, undefined, "">;
declare const userPasskeyAuthEnabledSchema: yup.BooleanSchema<boolean | undefined, yup.AnyObject, undefined, "">;
declare const userOtpAuthEnabledSchema: yup.BooleanSchema<boolean | undefined, yup.AnyObject, undefined, "">;
declare const userOtpAuthEnabledMutationSchema: yup.BooleanSchema<boolean | undefined, yup.AnyObject, undefined, "">;
declare const userHasPasswordSchema: yup.BooleanSchema<boolean | undefined, yup.AnyObject, undefined, "">;
declare const userPasswordMutationSchema: yup.StringSchema<string | null | undefined, yup.AnyObject, undefined, "">;
declare const userPasswordHashMutationSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const userTotpSecretMutationSchema: yup.StringSchema<string | null | undefined, yup.AnyObject, undefined, "">;
declare const signInEmailSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const emailOtpSignInCallbackUrlSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const emailVerificationCallbackUrlSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const accessTokenResponseSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const refreshTokenResponseSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const signInResponseSchema: yup.ObjectSchema<{
    refresh_token: string;
    access_token: string;
    is_new_user: boolean;
    user_id: string;
}, yup.AnyObject, {
    refresh_token: undefined;
    access_token: undefined;
    is_new_user: undefined;
    user_id: undefined;
}, "">;
declare const teamSystemPermissions: readonly ["$update_team", "$delete_team", "$read_members", "$remove_members", "$invite_members", "$manage_api_keys"];
declare const permissionDefinitionIdSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const customPermissionDefinitionIdSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const teamPermissionDescriptionSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const containedPermissionIdsSchema: yup.ArraySchema<string[] | undefined, yup.AnyObject, undefined, "">;
declare const teamIdSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const teamDisplayNameSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const teamProfileImageUrlSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const teamClientMetadataSchema: yup.MixedSchema<{} | null, yup.AnyObject, undefined, "">;
declare const teamClientReadOnlyMetadataSchema: yup.MixedSchema<{} | null, yup.AnyObject, undefined, "">;
declare const teamServerMetadataSchema: yup.MixedSchema<{} | null, yup.AnyObject, undefined, "">;
declare const teamCreatedAtMillisSchema: yup.NumberSchema<number | undefined, yup.AnyObject, undefined, "">;
declare const teamInvitationEmailSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const teamInvitationCallbackUrlSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const teamCreatorUserIdSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const teamMemberDisplayNameSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const teamMemberProfileImageUrlSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const contactChannelIdSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const contactChannelTypeSchema: yup.StringSchema<"email" | undefined, yup.AnyObject, undefined, "">;
declare const contactChannelValueSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const contactChannelUsedForAuthSchema: yup.BooleanSchema<boolean | undefined, yup.AnyObject, undefined, "">;
declare const contactChannelIsVerifiedSchema: yup.BooleanSchema<boolean | undefined, yup.AnyObject, undefined, "">;
declare const contactChannelIsPrimarySchema: yup.BooleanSchema<boolean | undefined, yup.AnyObject, undefined, "">;
declare const basicAuthorizationHeaderSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare const neonAuthorizationHeaderSchema: yup.StringSchema<string | undefined, yup.AnyObject, undefined, "">;
declare function yupDefinedWhen<S extends yup.AnyObject>(schema: S, triggers: Record<string, any>): S;
declare function yupDefinedAndNonEmptyWhen<S extends yup.StringSchema>(schema: S, triggers: Record<string, any>): S;

export { ReplaceFieldWithOwnUserId, StackAdaptSentinel, accessTokenResponseSchema, adaptSchema, adminAuthTypeSchema, base64Schema, basicAuthorizationHeaderSchema, clientOrHigherAuthTypeSchema, contactChannelIdSchema, contactChannelIsPrimarySchema, contactChannelIsVerifiedSchema, contactChannelTypeSchema, contactChannelUsedForAuthSchema, contactChannelValueSchema, containedPermissionIdsSchema, customPermissionDefinitionIdSchema, emailHostSchema, emailOtpSignInCallbackUrlSchema, emailPasswordSchema, emailPortSchema, emailSchema, emailSenderEmailSchema, emailSenderNameSchema, emailTypeSchema, emailUsernameSchema, emailVerificationCallbackUrlSchema, ensureObjectSchema, handlerPathSchema, jsonSchema, jsonStringOrEmptySchema, jsonStringSchema, neonAuthorizationHeaderSchema, oauthAccountMergeStrategySchema, oauthClientIdSchema, oauthClientSecretSchema, oauthEnabledSchema, oauthFacebookConfigIdSchema, oauthIdSchema, oauthMicrosoftTenantIdSchema, oauthTypeSchema, passwordSchema, permissionDefinitionIdSchema, primaryEmailAuthEnabledSchema, primaryEmailSchema, primaryEmailVerifiedSchema, profileImageUrlSchema, projectAllowLocalhostSchema, projectBranchIdSchema, projectClientTeamCreationEnabledSchema, projectClientUserDeletionEnabledSchema, projectConfigIdSchema, projectCreateTeamOnSignUpSchema, projectCreatedAtMillisSchema, projectCredentialEnabledSchema, projectDescriptionSchema, projectDisplayNameSchema, projectIdSchema, projectIsProductionModeSchema, projectMagicLinkEnabledSchema, projectPasskeyEnabledSchema, projectSignUpEnabledSchema, projectUserCountSchema, refreshTokenResponseSchema, selectedTeamIdSchema, serverOrHigherAuthTypeSchema, signInEmailSchema, signInResponseSchema, signedUpAtMillisSchema, strictEmailSchema, teamClientMetadataSchema, teamClientReadOnlyMetadataSchema, teamCreatedAtMillisSchema, teamCreatorUserIdSchema, teamDisplayNameSchema, teamIdSchema, teamInvitationCallbackUrlSchema, teamInvitationEmailSchema, teamMemberDisplayNameSchema, teamMemberProfileImageUrlSchema, teamPermissionDescriptionSchema, teamProfileImageUrlSchema, teamServerMetadataSchema, teamSystemPermissions, urlSchema, userClientMetadataSchema, userClientReadOnlyMetadataSchema, userDisplayNameSchema, userHasPasswordSchema, userIdOrMeSchema, userIdSchema, userLastActiveAtMillisSchema, userOAuthProviderSchema, userOtpAuthEnabledMutationSchema, userOtpAuthEnabledSchema, userPasskeyAuthEnabledSchema, userPasswordHashMutationSchema, userPasswordMutationSchema, userServerMetadataSchema, userTotpSecretMutationSchema, yupArray, yupBoolean, yupDate, yupDefinedAndNonEmptyWhen, yupDefinedWhen, yupMixed, yupNever, yupNumber, yupObject, yupRecord, yupString, yupTuple, yupUnion, yupValidate };
