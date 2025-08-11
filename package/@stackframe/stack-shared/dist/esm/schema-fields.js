// src/schema-fields.ts
import * as yup from "yup";
import { KnownErrors } from ".";
import { isBase64 } from "./utils/bytes";
import { StackAssertionError, throwErr } from "./utils/errors";
import { decodeBasicAuthorizationHeader } from "./utils/http";
import { allProviders } from "./utils/oauth";
import { deepPlainClone, omit } from "./utils/objects";
import { isValidUrl } from "./utils/urls";
import { isUuid } from "./utils/uuids";
yup.addMethod(yup.string, "nonEmpty", function(message) {
  return this.test(
    "non-empty",
    message ?? (({ path }) => `${path} must not be empty`),
    (value) => {
      return value !== "";
    }
  );
});
yup.addMethod(yup.Schema, "getNested", function(path) {
  if (!path.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) throw new StackAssertionError(`yupSchema.getNested can currently only be used with alphanumeric keys. Fix this in the future. Provided key: ${path}`);
  return yup.reach(this, path);
});
async function yupValidate(schema, obj, options) {
  try {
    return await schema.validate(obj, {
      ...omit(options ?? {}, ["currentUserId"]),
      context: {
        ...options?.context,
        stackAllowUserIdMe: options?.currentUserId !== void 0
      }
    });
  } catch (error) {
    if (error instanceof ReplaceFieldWithOwnUserId) {
      const currentUserId = options?.currentUserId;
      if (!currentUserId) throw new KnownErrors.CannotGetOwnUserWithoutUser();
      let pathRemaining = error.path;
      const fieldPath = [];
      while (pathRemaining.length > 0) {
        if (pathRemaining.startsWith("[")) {
          const index = pathRemaining.indexOf("]");
          if (index < 0) throw new StackAssertionError("Invalid path");
          fieldPath.push(JSON.parse(pathRemaining.slice(1, index)));
          pathRemaining = pathRemaining.slice(index + 1);
        } else {
          let dotIndex = pathRemaining.indexOf(".");
          if (dotIndex === -1) dotIndex = pathRemaining.length;
          fieldPath.push(pathRemaining.slice(0, dotIndex));
          pathRemaining = pathRemaining.slice(dotIndex + 1);
        }
      }
      const newObj = deepPlainClone(obj);
      let it = newObj;
      for (const field of fieldPath.slice(0, -1)) {
        if (!Object.prototype.hasOwnProperty.call(it, field)) {
          throw new StackAssertionError(`Segment ${field} of path ${error.path} not found in object`);
        }
        it = it[field];
      }
      it[fieldPath[fieldPath.length - 1]] = currentUserId;
      return await yupValidate(schema, newObj, options);
    }
    throw error;
  }
}
var _idDescription = (identify) => `The unique identifier of the ${identify}`;
var _displayNameDescription = (identify) => `Human-readable ${identify} display name. This is not a unique identifier.`;
var _clientMetaDataDescription = (identify) => `Client metadata. Used as a data store, accessible from the client side. Do not store information that should not be exposed to the client.`;
var _clientReadOnlyMetaDataDescription = (identify) => `Client read-only, server-writable metadata. Used as a data store, accessible from the client side. Do not store information that should not be exposed to the client. The client can read this data, but cannot modify it. This is useful for things like subscription status.`;
var _profileImageUrlDescription = (identify) => `URL of the profile image for ${identify}. Can be a Base64 encoded image. Must be smaller than 100KB. Please compress and crop to a square before passing in.`;
var _serverMetaDataDescription = (identify) => `Server metadata. Used as a data store, only accessible from the server side. You can store secret information related to the ${identify} here.`;
var _atMillisDescription = (identify) => `(the number of milliseconds since epoch, January 1, 1970, UTC)`;
var _createdAtMillisDescription = (identify) => `The time the ${identify} was created ${_atMillisDescription(identify)}`;
var _signedUpAtMillisDescription = `The time the user signed up ${_atMillisDescription}`;
var _lastActiveAtMillisDescription = `The time the user was last active ${_atMillisDescription}`;
function yupString(...args) {
  return yup.string(...args);
}
function yupNumber(...args) {
  return yup.number(...args);
}
function yupBoolean(...args) {
  return yup.boolean(...args);
}
function yupDate(...args) {
  return yup.date(...args);
}
function yupMixed(...args) {
  return yup.mixed(...args);
}
function yupArray(...args) {
  return yup.array(...args);
}
function yupTuple(...args) {
  return yup.tuple(...args);
}
function yupObject(...args) {
  const object2 = yup.object(...args).test(
    "no-unknown-object-properties",
    ({ path }) => `${path} contains unknown properties`,
    (value, context) => {
      if (context.options.context?.noUnknownPathPrefixes?.some((prefix) => context.path.startsWith(prefix))) {
        if (context.schema.spec.noUnknown !== false) {
          const availableKeys = new Set(Object.keys(context.schema.fields));
          const unknownKeys = Object.keys(value ?? {}).filter((key) => !availableKeys.has(key));
          if (unknownKeys.length > 0) {
            return context.createError({
              message: `${context.path || "Object"} contains unknown properties: ${unknownKeys.join(", ")}`,
              path: context.path,
              params: { unknownKeys, availableKeys }
            });
          }
        }
      }
      return true;
    }
  );
  return object2.default(void 0);
}
function yupNever() {
  return yupMixed().test("never", "This value should never be reached", () => false);
}
function yupUnion(...args) {
  if (args.length === 0) throw new Error("yupUnion must have at least one schema");
  const [first] = args;
  const firstDesc = first.describe();
  for (const schema of args) {
    const desc = schema.describe();
    if (desc.type !== firstDesc.type) throw new StackAssertionError(`yupUnion must have schemas of the same type (got: ${firstDesc.type} and ${desc.type})`, { first, schema, firstDesc, desc });
  }
  return yupMixed().test("is-one-of", "Invalid value", async (value, context) => {
    const errors = [];
    for (const schema of args) {
      try {
        await yupValidate(schema, value, context.options);
        return true;
      } catch (e) {
        errors.push(e);
      }
    }
    return context.createError({
      message: `${context.path} is not matched by any of the provided schemas:
${errors.map((e, i) => "	Schema " + i + ": \n		" + e.errors.join("\n		")).join("\n")}`,
      path: context.path
    });
  });
}
function yupRecord(keySchema, valueSchema) {
  return yupObject().unknown(true).test(
    "record",
    "${path} must be a record of valid values",
    async function(value, context) {
      if (value == null) return true;
      const { path, createError } = this;
      if (typeof value !== "object") {
        return createError({ message: `${path} must be an object` });
      }
      for (const key of Object.keys(value)) {
        await yupValidate(keySchema, key, context.options);
        try {
          await yupValidate(valueSchema, value[key], {
            ...context.options,
            context: {
              ...context.options.context,
              path: path ? `${path}.${key}` : key
            }
          });
        } catch (e) {
          return createError({
            path: path ? `${path}.${key}` : key,
            message: e.message
          });
        }
      }
      return true;
    }
  );
}
function ensureObjectSchema(schema) {
  if (!(schema instanceof yup.ObjectSchema)) throw new StackAssertionError(`assertObjectSchema: schema is not an ObjectSchema: ${schema.describe().type}`);
  return schema;
}
var adaptSchema = yupMixed();
var urlSchema = yupString().test({
  name: "no-spaces",
  message: (params) => `${params.path} contains spaces`,
  test: (value) => value == null || !value.includes(" ")
}).test({
  name: "url",
  message: (params) => `${params.path} is not a valid URL`,
  test: (value) => value == null || isValidUrl(value)
});
var jsonSchema = yupMixed().nullable().defined().transform((value) => JSON.parse(JSON.stringify(value)));
var jsonStringSchema = yupString().test("json", (params) => `${params.path} is not valid JSON`, (value) => {
  if (value == null) return true;
  try {
    JSON.parse(value);
    return true;
  } catch (error) {
    return false;
  }
});
var jsonStringOrEmptySchema = yupString().test("json", (params) => `${params.path} is not valid JSON`, (value) => {
  if (!value) return true;
  try {
    JSON.parse(value);
    return true;
  } catch (error) {
    return false;
  }
});
var base64Schema = yupString().test("is-base64", (params) => `${params.path} is not valid base64`, (value) => {
  if (value == null) return true;
  return isBase64(value);
});
var passwordSchema = yupString().max(70);
var strictEmailSchema = (message) => yupString().email(message).matches(/^[^.]+(\.[^.]+)*@.*\.[^.][^.]+$/, message);
var emailSchema = yupString().email();
var clientOrHigherAuthTypeSchema = yupString().oneOf(["client", "server", "admin"]).defined();
var serverOrHigherAuthTypeSchema = yupString().oneOf(["server", "admin"]).defined();
var adminAuthTypeSchema = yupString().oneOf(["admin"]).defined();
var projectIdSchema = yupString().test((v) => v === void 0 || v === "internal" || isUuid(v)).meta({ openapiField: { description: _idDescription("project"), exampleValue: "e0b52f4d-dece-408c-af49-d23061bb0f8d" } });
var projectBranchIdSchema = yupString().nonEmpty().max(255).meta({ openapiField: { description: _idDescription("project branch"), exampleValue: "main" } });
var projectDisplayNameSchema = yupString().meta({ openapiField: { description: _displayNameDescription("project"), exampleValue: "MyMusic" } });
var projectDescriptionSchema = yupString().nullable().meta({ openapiField: { description: "A human readable description of the project", exampleValue: "A music streaming service" } });
var projectCreatedAtMillisSchema = yupNumber().meta({ openapiField: { description: _createdAtMillisDescription("project"), exampleValue: 163e10 } });
var projectUserCountSchema = yupNumber().meta({ openapiField: { description: "The number of users in this project", exampleValue: 10 } });
var projectIsProductionModeSchema = yupBoolean().meta({ openapiField: { description: "Whether the project is in production mode", exampleValue: true } });
var projectConfigIdSchema = yupString().meta({ openapiField: { description: _idDescription("project config"), exampleValue: "d09201f0-54f5-40bd-89ff-6d1815ddad24" } });
var projectAllowLocalhostSchema = yupBoolean().meta({ openapiField: { description: "Whether localhost is allowed as a domain for this project. Should only be allowed in development mode", exampleValue: true } });
var projectCreateTeamOnSignUpSchema = yupBoolean().meta({ openapiField: { description: "Whether a team should be created for each user that signs up", exampleValue: true } });
var projectMagicLinkEnabledSchema = yupBoolean().meta({ openapiField: { description: "Whether magic link authentication is enabled for this project", exampleValue: true } });
var projectPasskeyEnabledSchema = yupBoolean().meta({ openapiField: { description: "Whether passkey authentication is enabled for this project", exampleValue: true } });
var projectClientTeamCreationEnabledSchema = yupBoolean().meta({ openapiField: { description: "Whether client users can create teams", exampleValue: true } });
var projectClientUserDeletionEnabledSchema = yupBoolean().meta({ openapiField: { description: "Whether client users can delete their own account from the client", exampleValue: true } });
var projectSignUpEnabledSchema = yupBoolean().meta({ openapiField: { description: "Whether users can sign up new accounts, or whether they are only allowed to sign in to existing accounts. Regardless of this option, the server API can always create new users with the `POST /users` endpoint.", exampleValue: true } });
var projectCredentialEnabledSchema = yupBoolean().meta({ openapiField: { description: "Whether email password authentication is enabled for this project", exampleValue: true } });
var oauthIdSchema = yupString().oneOf(allProviders).meta({ openapiField: { description: `OAuth provider ID, one of ${allProviders.map((x) => `\`${x}\``).join(", ")}`, exampleValue: "google" } });
var oauthEnabledSchema = yupBoolean().meta({ openapiField: { description: "Whether the OAuth provider is enabled. If an provider is first enabled, then disabled, it will be shown in the list but with enabled=false", exampleValue: true } });
var oauthTypeSchema = yupString().oneOf(["shared", "standard"]).meta({ openapiField: { description: 'OAuth provider type, one of shared, standard. "shared" uses Stack shared OAuth keys and it is only meant for development. "standard" uses your own OAuth keys and will show your logo and company name when signing in with the provider.', exampleValue: "standard" } });
var oauthClientIdSchema = yupString().meta({ openapiField: { description: 'OAuth client ID. Needs to be specified when using type="standard"', exampleValue: "google-oauth-client-id" } });
var oauthClientSecretSchema = yupString().meta({ openapiField: { description: 'OAuth client secret. Needs to be specified when using type="standard"', exampleValue: "google-oauth-client-secret" } });
var oauthFacebookConfigIdSchema = yupString().meta({ openapiField: { description: "The configuration id for Facebook business login (for things like ads and marketing). This is only required if you are using the standard OAuth with Facebook and you are using Facebook business login." } });
var oauthMicrosoftTenantIdSchema = yupString().meta({ openapiField: { description: "The Microsoft tenant id for Microsoft directory. This is only required if you are using the standard OAuth with Microsoft and you have an Azure AD tenant." } });
var oauthAccountMergeStrategySchema = yupString().oneOf(["link_method", "raise_error", "allow_duplicates"]).meta({ openapiField: { description: "Determines how to handle OAuth logins that match an existing user by email. `link_method` adds the OAuth method to the existing user. `raise_error` rejects the login with an error. `allow_duplicates` creates a new user.", exampleValue: "link_method" } });
var emailTypeSchema = yupString().oneOf(["shared", "standard"]).meta({ openapiField: { description: 'Email provider type, one of shared, standard. "shared" uses Stack shared email provider and it is only meant for development. "standard" uses your own email server and will have your email address as the sender.', exampleValue: "standard" } });
var emailSenderNameSchema = yupString().meta({ openapiField: { description: 'Email sender name. Needs to be specified when using type="standard"', exampleValue: "Stack" } });
var emailHostSchema = yupString().meta({ openapiField: { description: 'Email host. Needs to be specified when using type="standard"', exampleValue: "smtp.your-domain.com" } });
var emailPortSchema = yupNumber().min(0).max(65535).meta({ openapiField: { description: 'Email port. Needs to be specified when using type="standard"', exampleValue: 587 } });
var emailUsernameSchema = yupString().meta({ openapiField: { description: 'Email username. Needs to be specified when using type="standard"', exampleValue: "smtp-email" } });
var emailSenderEmailSchema = emailSchema.meta({ openapiField: { description: 'Email sender email. Needs to be specified when using type="standard"', exampleValue: "example@your-domain.com" } });
var emailPasswordSchema = passwordSchema.meta({ openapiField: { description: 'Email password. Needs to be specified when using type="standard"', exampleValue: "your-email-password" } });
var handlerPathSchema = yupString().test("is-handler-path", "Handler path must start with /", (value) => value?.startsWith("/")).meta({ openapiField: { description: 'Handler path. If you did not setup a custom handler path, it should be "/handler" by default. It needs to start with /', exampleValue: "/handler" } });
var ReplaceFieldWithOwnUserId = class extends Error {
  constructor(path) {
    super(`This error should be caught by whoever validated the schema, and the field in the path '${path}' should be replaced with the current user's id. This is a workaround to yup not providing access to the context inside the transform function.`);
    this.path = path;
  }
};
var userIdMeSentinelUuid = "cad564fd-f81b-43f4-b390-98abf3fcc17e";
var userIdOrMeSchema = yupString().uuid().transform((v) => {
  if (v === "me") return userIdMeSentinelUuid;
  else return v;
}).test((v, context) => {
  if (!("stackAllowUserIdMe" in (context.options.context ?? {}))) throw new StackAssertionError("userIdOrMeSchema is not allowed in this context. Make sure you're using yupValidate from schema-fields.ts to validate, instead of schema.validate(...).");
  if (!context.options.context?.stackAllowUserIdMe) throw new StackAssertionError("userIdOrMeSchema is not allowed in this context. Make sure you're passing in the currentUserId option in yupValidate.");
  if (v === userIdMeSentinelUuid) throw new ReplaceFieldWithOwnUserId(context.path);
  return true;
}).meta({ openapiField: { description: "The ID of the user, or the special value `me` for the currently authenticated user", exampleValue: "3241a285-8329-4d69-8f3d-316e08cf140c" } });
var userIdSchema = yupString().uuid().meta({ openapiField: { description: _idDescription("user"), exampleValue: "3241a285-8329-4d69-8f3d-316e08cf140c" } });
var primaryEmailSchema = emailSchema.meta({ openapiField: { description: "Primary email", exampleValue: "johndoe@example.com" } });
var primaryEmailAuthEnabledSchema = yupBoolean().meta({ openapiField: { description: "Whether the primary email is used for authentication. If this is set to `false`, the user will not be able to sign in with the primary email with password or OTP", exampleValue: true } });
var primaryEmailVerifiedSchema = yupBoolean().meta({ openapiField: { description: "Whether the primary email has been verified to belong to this user", exampleValue: true } });
var userDisplayNameSchema = yupString().nullable().meta({ openapiField: { description: _displayNameDescription("user"), exampleValue: "John Doe" } });
var selectedTeamIdSchema = yupString().uuid().meta({ openapiField: { description: "ID of the team currently selected by the user", exampleValue: "team-id" } });
var profileImageUrlSchema = urlSchema.max(1e6).meta({ openapiField: { description: _profileImageUrlDescription("user"), exampleValue: "https://example.com/image.jpg" } });
var signedUpAtMillisSchema = yupNumber().meta({ openapiField: { description: _signedUpAtMillisDescription, exampleValue: 163e10 } });
var userClientMetadataSchema = jsonSchema.meta({ openapiField: { description: _clientMetaDataDescription("user"), exampleValue: { key: "value" } } });
var userClientReadOnlyMetadataSchema = jsonSchema.meta({ openapiField: { description: _clientReadOnlyMetaDataDescription("user"), exampleValue: { key: "value" } } });
var userServerMetadataSchema = jsonSchema.meta({ openapiField: { description: _serverMetaDataDescription("user"), exampleValue: { key: "value" } } });
var userOAuthProviderSchema = yupObject({
  id: yupString().defined(),
  type: yupString().oneOf(allProviders).defined(),
  provider_user_id: yupString().defined()
});
var userLastActiveAtMillisSchema = yupNumber().nullable().meta({ openapiField: { description: _lastActiveAtMillisDescription, exampleValue: 163e10 } });
var userPasskeyAuthEnabledSchema = yupBoolean().meta({ openapiField: { hidden: true, description: "Whether the user has passkeys enabled", exampleValue: false } });
var userOtpAuthEnabledSchema = yupBoolean().meta({ openapiField: { hidden: true, description: "Whether the user has OTP/magic link enabled. ", exampleValue: true } });
var userOtpAuthEnabledMutationSchema = yupBoolean().meta({ openapiField: { hidden: true, description: "Whether the user has OTP/magic link enabled. Note that only accounts with verified emails can sign-in with OTP.", exampleValue: true } });
var userHasPasswordSchema = yupBoolean().meta({ openapiField: { hidden: true, description: "Whether the user has a password set. If the user does not have a password set, they will not be able to sign in with email/password.", exampleValue: true } });
var userPasswordMutationSchema = passwordSchema.nullable().meta({ openapiField: { description: "Sets the user's password. Doing so revokes all current sessions.", exampleValue: "my-new-password" } }).max(70);
var userPasswordHashMutationSchema = yupString().nonEmpty().meta({ openapiField: { description: "If `password` is not given, sets the user's password hash to the given string in Modular Crypt Format (ex.: `$2a$10$VIhIOofSMqGdGlL4wzE//e.77dAQGqNtF/1dT7bqCrVtQuInWy2qi`). Doing so revokes all current sessions." } });
var userTotpSecretMutationSchema = base64Schema.nullable().meta({ openapiField: { description: "Enables 2FA and sets a TOTP secret for the user. Set to null to disable 2FA.", exampleValue: "dG90cC1zZWNyZXQ=" } });
var signInEmailSchema = strictEmailSchema(void 0).meta({ openapiField: { description: "The email to sign in with.", exampleValue: "johndoe@example.com" } });
var emailOtpSignInCallbackUrlSchema = urlSchema.meta({ openapiField: { description: "The base callback URL to construct the magic link from. A query parameter `code` with the verification code will be appended to it. The page should then make a request to the `/auth/otp/sign-in` endpoint.", exampleValue: "https://example.com/handler/magic-link-callback" } });
var emailVerificationCallbackUrlSchema = urlSchema.meta({ openapiField: { description: "The base callback URL to construct a verification link for the verification e-mail. A query parameter `code` with the verification code will be appended to it. The page should then make a request to the `/contact-channels/verify` endpoint.", exampleValue: "https://example.com/handler/email-verification" } });
var accessTokenResponseSchema = yupString().meta({ openapiField: { description: "Short-lived access token that can be used to authenticate the user", exampleValue: "eyJhmMiJB2TO...diI4QT" } });
var refreshTokenResponseSchema = yupString().meta({ openapiField: { description: "Long-lived refresh token that can be used to obtain a new access token", exampleValue: "i8ns3aq2...14y" } });
var signInResponseSchema = yupObject({
  refresh_token: refreshTokenResponseSchema.defined(),
  access_token: accessTokenResponseSchema.defined(),
  is_new_user: yupBoolean().meta({ openapiField: { description: "Whether the user is a new user", exampleValue: true } }).defined(),
  user_id: userIdSchema.defined()
});
var teamSystemPermissions = [
  "$update_team",
  "$delete_team",
  "$read_members",
  "$remove_members",
  "$invite_members",
  "$manage_api_keys"
];
var permissionDefinitionIdSchema = yupString().matches(/^\$?[a-z0-9_:]+$/, 'Only lowercase letters, numbers, ":", "_" and optional "$" at the beginning are allowed').test("is-system-permission", "System permissions must start with a dollar sign", (value, ctx) => {
  if (!value) return true;
  if (value.startsWith("$") && !teamSystemPermissions.includes(value)) {
    return ctx.createError({ message: "Invalid system permission" });
  }
  return true;
}).meta({ openapiField: { description: `The permission ID used to uniquely identify a permission. Can either be a custom permission with lowercase letters, numbers, \`:\`, and \`_\` characters, or one of the system permissions: ${teamSystemPermissions.map((x) => `\`${x}\``).join(", ")}`, exampleValue: "read_secret_info" } });
var customPermissionDefinitionIdSchema = yupString().matches(/^[a-z0-9_:]+$/, 'Only lowercase letters, numbers, ":", "_" are allowed').meta({ openapiField: { description: 'The permission ID used to uniquely identify a permission. Can only contain lowercase letters, numbers, ":", and "_" characters', exampleValue: "read_secret_info" } });
var teamPermissionDescriptionSchema = yupString().meta({ openapiField: { description: "A human-readable description of the permission", exampleValue: "Read secret information" } });
var containedPermissionIdsSchema = yupArray(permissionDefinitionIdSchema.defined()).meta({ openapiField: { description: "The IDs of the permissions that are contained in this permission", exampleValue: ["read_public_info"] } });
var teamIdSchema = yupString().uuid().meta({ openapiField: { description: _idDescription("team"), exampleValue: "ad962777-8244-496a-b6a2-e0c6a449c79e" } });
var teamDisplayNameSchema = yupString().meta({ openapiField: { description: _displayNameDescription("team"), exampleValue: "My Team" } });
var teamProfileImageUrlSchema = urlSchema.max(1e6).meta({ openapiField: { description: _profileImageUrlDescription("team"), exampleValue: "https://example.com/image.jpg" } });
var teamClientMetadataSchema = jsonSchema.meta({ openapiField: { description: _clientMetaDataDescription("team"), exampleValue: { key: "value" } } });
var teamClientReadOnlyMetadataSchema = jsonSchema.meta({ openapiField: { description: _clientReadOnlyMetaDataDescription("team"), exampleValue: { key: "value" } } });
var teamServerMetadataSchema = jsonSchema.meta({ openapiField: { description: _serverMetaDataDescription("team"), exampleValue: { key: "value" } } });
var teamCreatedAtMillisSchema = yupNumber().meta({ openapiField: { description: _createdAtMillisDescription("team"), exampleValue: 163e10 } });
var teamInvitationEmailSchema = emailSchema.meta({ openapiField: { description: "The email of the user to invite.", exampleValue: "johndoe@example.com" } });
var teamInvitationCallbackUrlSchema = urlSchema.meta({ openapiField: { description: "The base callback URL to construct an invite link with. A query parameter `code` with the verification code will be appended to it. The page should then make a request to the `/team-invitations/accept` endpoint.", exampleValue: "https://example.com/handler/team-invitation" } });
var teamCreatorUserIdSchema = userIdOrMeSchema.meta({ openapiField: { description: 'The ID of the creator of the team. If not specified, the user will not be added to the team. Can be either "me" or the ID of the user. Only used on the client side.', exampleValue: "me" } });
var teamMemberDisplayNameSchema = yupString().meta({ openapiField: { description: _displayNameDescription("team member") + " Note that this is separate from the display_name of the user.", exampleValue: "John Doe" } });
var teamMemberProfileImageUrlSchema = urlSchema.max(1e6).meta({ openapiField: { description: _profileImageUrlDescription("team member"), exampleValue: "https://example.com/image.jpg" } });
var contactChannelIdSchema = yupString().uuid().meta({ openapiField: { description: _idDescription("contact channel"), exampleValue: "b3d396b8-c574-4c80-97b3-50031675ceb2" } });
var contactChannelTypeSchema = yupString().oneOf(["email"]).meta({ openapiField: { description: `The type of the contact channel. Currently only "email" is supported.`, exampleValue: "email" } });
var contactChannelValueSchema = yupString().when("type", {
  is: "email",
  then: (schema) => schema.email()
}).meta({ openapiField: { description: "The value of the contact channel. For email, this should be a valid email address.", exampleValue: "johndoe@example.com" } });
var contactChannelUsedForAuthSchema = yupBoolean().meta({ openapiField: { description: "Whether the contact channel is used for authentication. If this is set to `true`, the user will be able to sign in with the contact channel with password or OTP.", exampleValue: true } });
var contactChannelIsVerifiedSchema = yupBoolean().meta({ openapiField: { description: "Whether the contact channel has been verified. If this is set to `true`, the contact channel has been verified to belong to the user.", exampleValue: true } });
var contactChannelIsPrimarySchema = yupBoolean().meta({ openapiField: { description: "Whether the contact channel is the primary contact channel. If this is set to `true`, it will be used for authentication and notifications by default.", exampleValue: true } });
var basicAuthorizationHeaderSchema = yupString().test("is-basic-authorization-header", 'Authorization header must be in the format "Basic <base64>"', (value) => {
  if (!value) return true;
  return decodeBasicAuthorizationHeader(value) !== null;
});
var neonAuthorizationHeaderSchema = basicAuthorizationHeaderSchema.test("is-neon-authorization-header", "Invalid client_id:client_secret values; did you use the correct values for the Neon integration?", (value) => {
  if (!value) return true;
  const [clientId, clientSecret] = decodeBasicAuthorizationHeader(value) ?? throwErr(`Neon authz header invalid? This should've been validated by basicAuthorizationHeaderSchema: ${value}`);
  for (const neonClientConfig of JSON.parse(process.env.STACK_NEON_INTEGRATION_CLIENTS_CONFIG || "[]")) {
    if (clientId === neonClientConfig.client_id && clientSecret === neonClientConfig.client_secret) return true;
  }
  return false;
});
function yupDefinedWhen(schema, triggers) {
  const entries = Object.entries(triggers);
  return schema.when(entries.map(([key]) => key), {
    is: (...values) => entries.every(([key, value], index) => value === values[index]),
    then: (schema2) => schema2.defined(),
    otherwise: (schema2) => schema2.optional()
  });
}
function yupDefinedAndNonEmptyWhen(schema, triggers) {
  const entries = Object.entries(triggers);
  return schema.when(entries.map(([key]) => key), {
    is: (...values) => entries.every(([key, value], index) => value === values[index]),
    then: (schema2) => schema2.defined().nonEmpty(),
    otherwise: (schema2) => schema2.optional()
  });
}
export {
  ReplaceFieldWithOwnUserId,
  accessTokenResponseSchema,
  adaptSchema,
  adminAuthTypeSchema,
  base64Schema,
  basicAuthorizationHeaderSchema,
  clientOrHigherAuthTypeSchema,
  contactChannelIdSchema,
  contactChannelIsPrimarySchema,
  contactChannelIsVerifiedSchema,
  contactChannelTypeSchema,
  contactChannelUsedForAuthSchema,
  contactChannelValueSchema,
  containedPermissionIdsSchema,
  customPermissionDefinitionIdSchema,
  emailHostSchema,
  emailOtpSignInCallbackUrlSchema,
  emailPasswordSchema,
  emailPortSchema,
  emailSchema,
  emailSenderEmailSchema,
  emailSenderNameSchema,
  emailTypeSchema,
  emailUsernameSchema,
  emailVerificationCallbackUrlSchema,
  ensureObjectSchema,
  handlerPathSchema,
  jsonSchema,
  jsonStringOrEmptySchema,
  jsonStringSchema,
  neonAuthorizationHeaderSchema,
  oauthAccountMergeStrategySchema,
  oauthClientIdSchema,
  oauthClientSecretSchema,
  oauthEnabledSchema,
  oauthFacebookConfigIdSchema,
  oauthIdSchema,
  oauthMicrosoftTenantIdSchema,
  oauthTypeSchema,
  passwordSchema,
  permissionDefinitionIdSchema,
  primaryEmailAuthEnabledSchema,
  primaryEmailSchema,
  primaryEmailVerifiedSchema,
  profileImageUrlSchema,
  projectAllowLocalhostSchema,
  projectBranchIdSchema,
  projectClientTeamCreationEnabledSchema,
  projectClientUserDeletionEnabledSchema,
  projectConfigIdSchema,
  projectCreateTeamOnSignUpSchema,
  projectCreatedAtMillisSchema,
  projectCredentialEnabledSchema,
  projectDescriptionSchema,
  projectDisplayNameSchema,
  projectIdSchema,
  projectIsProductionModeSchema,
  projectMagicLinkEnabledSchema,
  projectPasskeyEnabledSchema,
  projectSignUpEnabledSchema,
  projectUserCountSchema,
  refreshTokenResponseSchema,
  selectedTeamIdSchema,
  serverOrHigherAuthTypeSchema,
  signInEmailSchema,
  signInResponseSchema,
  signedUpAtMillisSchema,
  strictEmailSchema,
  teamClientMetadataSchema,
  teamClientReadOnlyMetadataSchema,
  teamCreatedAtMillisSchema,
  teamCreatorUserIdSchema,
  teamDisplayNameSchema,
  teamIdSchema,
  teamInvitationCallbackUrlSchema,
  teamInvitationEmailSchema,
  teamMemberDisplayNameSchema,
  teamMemberProfileImageUrlSchema,
  teamPermissionDescriptionSchema,
  teamProfileImageUrlSchema,
  teamServerMetadataSchema,
  teamSystemPermissions,
  urlSchema,
  userClientMetadataSchema,
  userClientReadOnlyMetadataSchema,
  userDisplayNameSchema,
  userHasPasswordSchema,
  userIdOrMeSchema,
  userIdSchema,
  userLastActiveAtMillisSchema,
  userOAuthProviderSchema,
  userOtpAuthEnabledMutationSchema,
  userOtpAuthEnabledSchema,
  userPasskeyAuthEnabledSchema,
  userPasswordHashMutationSchema,
  userPasswordMutationSchema,
  userServerMetadataSchema,
  userTotpSecretMutationSchema,
  yupArray,
  yupBoolean,
  yupDate,
  yupDefinedAndNonEmptyWhen,
  yupDefinedWhen,
  yupMixed,
  yupNever,
  yupNumber,
  yupObject,
  yupRecord,
  yupString,
  yupTuple,
  yupUnion,
  yupValidate
};
//# sourceMappingURL=schema-fields.js.map